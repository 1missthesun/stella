import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeCliCommandEnv, runCliCommand } from "./claude-cli-command.js";
import {
  findUnrunnableExternalCliPath,
  resolveExternalCliPath,
} from "@stella/node-shared/integrations/external-cli-resolution.js";

/**
 * Which Claude Code Stella runs, and only one that has shown it runs.
 *
 * Whatever PATH names (a native install's launcher, an npm or Homebrew link,
 * a version manager's wrapper) can be left unusable by an install that was cut
 * off: a truncated binary, one without its execute bit, a version manager
 * pointing at a version that never finished. So before a process starts,
 * Stella asks the binary for `--version`, which takes a few milliseconds. A
 * binary that answers becomes the last-known-good one, kept (hard-linked, so
 * it costs no space while the original exists) where no installer touches it.
 * One that doesn't is never run: Stella falls back to the last-known-good
 * one, repairs the install the way it was made when it can, and otherwise
 * fails with what the binary printed and what to do.
 *
 * A version manager's wrapper (mise) updates its tool in the foreground of
 * whatever runs it first after its update interval, so a 20-second status
 * check could cut a download off. Stella runs the binary the wrapper would
 * run instead, and leaves updating to its updater, which waits for it.
 */

export const CLAUDE_CLI_UNUSABLE_CODE = "CLAUDE_CODE_CLI_UNUSABLE";

const PROBE_TIMEOUT_MS = 15_000;
const RESOLVE_TIMEOUT_MS = 10_000;
const REPAIR_TIMEOUT_MS = 15 * 60_000;
const FAILED_CHECK_TTL_MS = 30_000;
/** How long after a failed repair of the same binary Stella tries again by itself. */
const REPAIR_RETRY_MS = 30 * 60_000;
const REPAIR_LOCK_STALE_MS = REPAIR_TIMEOUT_MS + 5 * 60_000;
const REPAIR_LOCK_POLL_MS = 2_000;
/** How long a turn with nothing else to run waits for a repair. */
const TURN_REPAIR_WAIT_MS = 10 * 60_000;
const VERSION_PATTERN = /\b(\d+\.\d+\.\d+)\b/;

export type ClaudeCliInstallMethod =
  | "mise"
  | "native"
  | "npm"
  | "homebrew"
  | "winget"
  | "other";

export type ClaudeCliInstall = {
  /** What PATH or the configured path names. */
  launcher: string;
  method: ClaudeCliInstallMethod;
  /** What Stella runs: the launcher, or the binary behind a version manager's wrapper. */
  executable: string | null;
  /** Why there is no executable (the version manager couldn't name one). */
  problem?: string;
  /** The version manager's own program (mise). */
  manager?: string;
};

export type ClaudeCliCheck =
  | { ok: true; version: string }
  | { ok: false; problem: string };

export type ClaudeCliLaunch = {
  executable: string;
  version: string;
  /** Changes whenever a different binary would run. */
  identity: string;
  /** Set when the selected Claude Code can't start and this is the last one that did. */
  fallback?: { selected: string; problem: string };
};

export type ClaudeCliRepairOutcome =
  | { status: "repaired"; version: string; output: string }
  | { status: "failed"; output: string }
  | { status: "manual"; how: string }
  | { status: "skipped"; reason: string };

export type ClaudeCliUnusable = {
  install: ClaudeCliInstall | null;
  problem: string;
  repair?: ClaudeCliRepairOutcome;
};

export class ClaudeCliUnusableError extends Error {
  readonly code = CLAUDE_CLI_UNUSABLE_CODE;
  constructor(
    message: string,
    readonly detail: ClaudeCliUnusable,
  ) {
    super(message);
    this.name = "ClaudeCliUnusableError";
  }
}

// --- where things are -------------------------------------------------------

/**
 * Stella's own copy of the last Claude Code that ran, under its data folder.
 * Only where Stella has one (the desktop and headless Stella); a cloud
 * container keeps its own fallback in the image.
 */
const stateDir = (env: NodeJS.ProcessEnv): string | null => {
  const data = env.STELLA_DATA_DIR?.trim() || process.env.STELLA_DATA_DIR?.trim();
  return data ? path.join(path.resolve(data), "cache", "claude-cli") : null;
};

const realPathOf = (file: string): string => {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
};

const fileIdentity = (file: string): string | null => {
  try {
    const real = fs.realpathSync(file);
    const stat = fs.statSync(real);
    return `${real}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
};

const slashed = (file: string) => file.split(path.sep).join("/");

const methodOf = (realPath: string): ClaudeCliInstallMethod => {
  const file = slashed(realPath);
  if (/\/\.local\/share\/claude\/versions\//i.test(file)) return "native";
  if (/\/node_modules\/@anthropic-ai\/claude-code\//i.test(file)) return "npm";
  if (/\/(Caskroom|Cellar)\//.test(file)) return "homebrew";
  if (/\/WinGet\//i.test(file)) return "winget";
  return "other";
};

const isMise = (realPath: string) => /^mise(\.exe)?$/i.test(path.basename(realPath));

const lastLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";

/**
 * Offline, so asking mise never starts the download a wrapper run would;
 * quiet, so what it prints is only its errors.
 */
const miseEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  MISE_OFFLINE: "1",
  MISE_QUIET: "1",
});

/** What mise printed that says what's wrong: its errors, without its warnings and footers. */
const miseErrors = (text: string): string =>
  text
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim() &&
        !/^mise WARN/.test(line) &&
        !/^mise ERROR (Version:|Run with --verbose)/.test(line),
    )
    .join("\n")
    .trim();

const MISE_ANSWER_TTL_MS = 5_000;
const miseAnswers = new Map<string, { at: number; answer: Promise<ClaudeCliInstall> }>();

/** What PATH names, and what Stella should run for it. */
export const describeClaudeCliInstall = async (
  launcher: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClaudeCliInstall> => {
  const real = realPathOf(launcher);
  if (!isMise(real)) {
    return { launcher, method: methodOf(real), executable: launcher };
  }
  // Asked often (every turn, every session checkpoint): one answer serves a few seconds.
  const known = miseAnswers.get(launcher);
  if (known && Date.now() - known.at < MISE_ANSWER_TTL_MS) return await known.answer;
  const answer = askMise(launcher, real, env);
  miseAnswers.set(launcher, { at: Date.now(), answer });
  return await answer;
};

const askMise = async (
  launcher: string,
  real: string,
  env: NodeJS.ProcessEnv,
): Promise<ClaudeCliInstall> => {
  const which = await runCliCommand(real, ["which", "claude"], {
    env: miseEnv(env),
    timeoutMs: RESOLVE_TIMEOUT_MS,
    cwd: os.homedir(),
  });
  const named = which.exitCode === 0 ? lastLine(which.stdout) : "";
  if (named && path.isAbsolute(named)) {
    return { launcher, method: "mise", manager: real, executable: realPathOf(named) };
  }
  return {
    launcher,
    method: "mise",
    manager: real,
    executable: null,
    problem: `names no binary mise can run: ${
      which.spawnError ??
      (miseErrors(which.stderr || which.output) ||
        `\`mise which claude\` exited with code ${which.exitCode ?? "unknown"}.`)
    }`,
  };
};

// --- does it run --------------------------------------------------------------

const checkCache = new Map<string, { check: ClaudeCliCheck; at: number }>();

const describeRunFailure = (
  executable: string,
  result: Awaited<ReturnType<typeof runCliCommand>>,
): string => {
  if (result.spawnError) return `can't be run (${result.spawnError}).`;
  if (result.timedOut) {
    return `didn't answer \`--version\` within ${PROBE_TIMEOUT_MS / 1000} seconds.`;
  }
  const printed = (result.stderr || result.stdout).trim();
  const code = result.exitCode ?? "unknown";
  return printed
    ? `exited with code ${code}: ${printed}`
    : `exited with code ${code} without printing anything.`;
};

/** Asks the binary for its version. Exit 0 with a version on stdout is a binary that runs. */
export const checkClaudeCli = async (
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { fresh?: boolean } = {},
): Promise<ClaudeCliCheck> => {
  const identity = fileIdentity(executable);
  if (!identity) {
    return { ok: false, problem: "doesn't exist." };
  }
  const cached = options.fresh ? undefined : checkCache.get(identity);
  if (cached && (cached.check.ok || Date.now() - cached.at < FAILED_CHECK_TTL_MS)) {
    return cached.check;
  }
  const result = await runCliCommand(executable, ["--version"], {
    env: claudeCliCommandEnv(executable, env),
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const version = result.exitCode === 0 ? VERSION_PATTERN.exec(result.stdout)?.[1] : undefined;
  const check: ClaudeCliCheck = version
    ? { ok: true, version }
    : { ok: false, problem: describeRunFailure(executable, result) };
  checkCache.set(identity, { check, at: Date.now() });
  return check;
};

/** A process started from this binary exited before it said anything: check it again next time. */
export const noteClaudeCliLaunchFailed = (executable: string): void => {
  const identity = fileIdentity(executable);
  if (identity) checkCache.delete(identity);
};

// --- last known good ----------------------------------------------------------

type LastGood = {
  version: string;
  /** Where it was installed. */
  binary: string;
  /** Stella's own link or copy of it, which no installer removes. */
  saved: string | null;
  verifiedAt: number;
};

const lastGoodFile = (dir: string) => path.join(dir, "last-good.json");

const readLastGood = (dir: string): LastGood | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(lastGoodFile(dir), "utf8")) as LastGood;
    return typeof parsed?.version === "string" && typeof parsed.binary === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
};

const writeJson = (file: string, value: unknown) => {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
};

/** A program file that runs on its own: not a script that needs its package beside it. */
const isStandaloneProgram = (file: string): boolean => {
  try {
    const handle = fs.openSync(file, "r");
    try {
      const head = Buffer.alloc(4);
      fs.readSync(handle, head, 0, 4, 0);
      return head.subarray(0, 2).toString("latin1") !== "#!";
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return false;
  }
};

const saveCopy = async (dir: string, real: string, version: string): Promise<string | null> => {
  if (!isStandaloneProgram(real)) return null;
  const savedDir = path.join(dir, "last-good");
  await fs.promises.mkdir(savedDir, { recursive: true });
  const name = `claude-${version}${process.platform === "win32" ? ".exe" : ""}`;
  const target = path.join(savedDir, name);
  const sourceSize = (await fs.promises.stat(real)).size;
  const saved = await fs.promises
    .stat(target)
    .then((stat) => stat.size === sourceSize)
    .catch(() => false);
  if (!saved) {
    const temp = path.join(savedDir, `.${name}.${process.pid}.tmp`);
    await fs.promises.rm(temp, { force: true });
    try {
      await fs.promises.link(real, temp);
    } catch {
      // Another volume: a copy (a clone where the file system can).
      await fs.promises.copyFile(real, temp, fs.constants.COPYFILE_FICLONE);
    }
    if (process.platform !== "win32") await fs.promises.chmod(temp, 0o755);
    await fs.promises.rename(temp, target);
  }
  for (const entry of await fs.promises.readdir(savedDir)) {
    if (entry !== name && entry.startsWith("claude-")) {
      await fs.promises.rm(path.join(savedDir, entry), { force: true });
    }
  }
  return target;
};

let saving: Promise<void> = Promise.resolve();

/** Keeps this verified binary as the one to fall back to. */
const rememberLastGood = (env: NodeJS.ProcessEnv, executable: string, version: string) => {
  const dir = stateDir(env);
  if (!dir) return;
  const real = realPathOf(executable);
  const known = readLastGood(dir);
  if (
    known?.version === version &&
    known.binary === real &&
    (known.saved === null || fs.existsSync(known.saved))
  ) {
    return;
  }
  saving = saving.then(async () => {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      let saved: string | null = null;
      try {
        saved = await saveCopy(dir, real, version);
      } catch (error) {
        console.warn("[claude-cli] couldn't keep a copy of the working Claude Code", {
          binary: real,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      writeJson(lastGoodFile(dir), {
        version,
        binary: real,
        saved,
        verifiedAt: Date.now(),
      } satisfies LastGood);
    } catch (error) {
      console.warn("[claude-cli] couldn't record the working Claude Code", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

/** The last Claude Code that ran here, if it still does. */
const lastGoodLaunch = async (
  env: NodeJS.ProcessEnv,
  exclude: string | null,
): Promise<ClaudeCliLaunch | null> => {
  const dir = stateDir(env);
  if (!dir) return null;
  await saving;
  const known = readLastGood(dir);
  if (!known) return null;
  const excluded = exclude ? realPathOf(exclude) : null;
  for (const candidate of [known.binary, known.saved]) {
    if (!candidate || realPathOf(candidate) === excluded) continue;
    const check = await checkClaudeCli(candidate, env);
    if (check.ok) {
      return {
        executable: candidate,
        version: check.version,
        identity: `${fileIdentity(candidate)}:${check.version}`,
      };
    }
  }
  return null;
};

/** The version Stella last saw run here, for anything that only needs to know. */
export const lastGoodClaudeCliVersion = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const dir = stateDir(env);
  return dir ? (readLastGood(dir)?.version ?? null) : null;
};

// --- repair -------------------------------------------------------------------

type RepairRecord = { target: string; at: number; status: ClaudeCliRepairOutcome["status"] };

const repairFile = (dir: string) => path.join(dir, "repair.json");

const readRepair = (dir: string): RepairRecord | null => {
  try {
    return JSON.parse(fs.readFileSync(repairFile(dir), "utf8")) as RepairRecord;
  } catch {
    return null;
  }
};

const takeRepairLock = (dir: string): boolean => {
  const lock = path.join(dir, "repair.lock");
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.mkdirSync(lock);
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > REPAIR_LOCK_STALE_MS) {
        fs.rmSync(lock, { recursive: true, force: true });
        fs.mkdirSync(lock);
        return true;
      }
    } catch {
      // Another process took it in between.
    }
    return false;
  }
};

const releaseRepairLock = (dir: string) =>
  fs.rmSync(path.join(dir, "repair.lock"), { recursive: true, force: true });

const repairLockHeld = (dir: string): boolean => {
  try {
    return Date.now() - fs.statSync(path.join(dir, "repair.lock")).mtimeMs <= REPAIR_LOCK_STALE_MS;
  } catch {
    return false;
  }
};

/** The npm package folder (and global prefix) a Claude Code npm install lives in. */
const npmPackageOf = (realPath: string): { root: string; prefix: string } | null => {
  const file = slashed(realPath);
  const marker = "/node_modules/@anthropic-ai/claude-code/";
  const index = file.toLowerCase().indexOf(marker);
  if (index < 0) return null;
  const root = file.slice(0, index + marker.length - 1);
  const modules = file.slice(0, index);
  // <prefix>/lib/node_modules on macOS and Linux, <prefix>\node_modules on Windows.
  const prefix = modules.endsWith("/lib") ? modules.slice(0, -4) : modules;
  return { root: root.split("/").join(path.sep), prefix: prefix.split("/").join(path.sep) };
};

/** In words, how to fix an install Stella can't fix itself. */
export const claudeCliManualRepair = (install: ClaudeCliInstall | null): string => {
  switch (install?.method) {
    case "mise":
      return "Run `mise install --force claude` in a terminal.";
    case "native":
      return "Reinstall Claude Code: run `curl -fsSL https://claude.ai/install.sh | bash` in a terminal (on Windows, `irm https://claude.ai/install.ps1 | iex` in PowerShell).";
    case "npm":
      return "Run `npm install -g @anthropic-ai/claude-code` in a terminal.";
    case "homebrew":
      return "Run `brew reinstall --cask claude-code` in a terminal.";
    case "winget":
      return "Run `winget install --force Anthropic.ClaudeCode` in a terminal.";
    default:
      return "Reinstall Claude Code the way it was installed, then try again.";
  }
};

const runRepair = async (
  install: ClaudeCliInstall,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
): Promise<ClaudeCliRepairOutcome> => {
  if (install.method === "mise" && install.manager) {
    const current = await runCliCommand(install.manager, ["current", "claude"], {
      env: miseEnv(env),
      timeoutMs: RESOLVE_TIMEOUT_MS,
      cwd: os.homedir(),
    });
    const version = VERSION_PATTERN.exec(lastLine(current.stdout))?.[1];
    const result = await runCliCommand(
      install.manager,
      ["install", "--force", version ? `claude@${version}` : "claude"],
      { env, timeoutMs: REPAIR_TIMEOUT_MS, signal, cwd: os.homedir() },
    );
    return result.exitCode === 0
      ? { status: "repaired", version: version ?? "", output: result.output }
      : { status: "failed", output: result.spawnError ?? (miseErrors(result.output) || result.output) };
  }
  if (install.method === "native") {
    const { installClaudeCli } = await import("./claude-cli-install.js");
    const result = await installClaudeCli({ env, ...(signal ? { signal } : {}) });
    return result.status === "installed"
      ? { status: "repaired", version: result.version ?? "", output: "" }
      : { status: "failed", output: result.detail };
  }
  if (install.method === "npm") {
    const pkg = npmPackageOf(realPathOf(install.executable ?? install.launcher));
    if (!pkg) return { status: "manual", how: claudeCliManualRepair(install) };
    let version = "latest";
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(pkg.root, "package.json"), "utf8"),
      ) as { version?: unknown };
      if (typeof manifest.version === "string" && VERSION_PATTERN.test(manifest.version)) {
        version = manifest.version;
      }
    } catch {
      // A package folder without its manifest: install the latest.
    }
    const windows = process.platform === "win32";
    const npmBeside = path.join(pkg.prefix, windows ? "npm.cmd" : path.join("bin", "npm"));
    const npm = fs.existsSync(npmBeside) ? npmBeside : windows ? "npm.cmd" : "npm";
    const quote = (value: string) => (windows ? `"${value}"` : value);
    const result = await runCliCommand(
      windows ? quote(npm) : npm,
      ["install", "-g", "--prefix", quote(pkg.prefix), `@anthropic-ai/claude-code@${version}`],
      { env, timeoutMs: REPAIR_TIMEOUT_MS, signal, shell: windows },
    );
    return result.exitCode === 0
      ? { status: "repaired", version, output: result.output }
      : { status: "failed", output: result.spawnError ?? result.output };
  }
  return { status: "manual", how: claudeCliManualRepair(install) };
};

const repairs = new Map<string, Promise<ClaudeCliRepairOutcome>>();

/**
 * Repairs the install the way it was made: mise reinstalls its version, a
 * native install runs Anthropic's installer again, npm reinstalls the
 * package. One repair at a time across Stella's processes; one that failed
 * isn't retried by itself for half an hour (`force` does).
 */
export const repairClaudeCli = async (
  install: ClaudeCliInstall,
  options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; force?: boolean } = {},
): Promise<ClaudeCliRepairOutcome> => {
  const env = options.env ?? process.env;
  const dir = stateDir(env);
  if (!dir) return { status: "skipped", reason: "Stella keeps no Claude Code state here." };
  if (!["mise", "native", "npm"].includes(install.method)) {
    return { status: "manual", how: claudeCliManualRepair(install) };
  }
  const target = install.executable ?? install.launcher;
  const key = `${install.method}:${target}`;
  const running = repairs.get(key);
  if (running) return await running;
  const last = readRepair(dir);
  if (
    !options.force &&
    last?.target === key &&
    last.status !== "repaired" &&
    Date.now() - last.at < REPAIR_RETRY_MS
  ) {
    return { status: "skipped", reason: "A repair of this install failed a few minutes ago." };
  }
  const work = (async (): Promise<ClaudeCliRepairOutcome> => {
    if (!takeRepairLock(dir)) {
      // Another Stella process is repairing: wait for it to finish.
      while (repairLockHeld(dir)) {
        if (options.signal?.aborted) return { status: "skipped", reason: "Stopped." };
        await new Promise((resolve) => setTimeout(resolve, REPAIR_LOCK_POLL_MS));
      }
      return { status: "skipped", reason: "Repaired by another Stella process." };
    }
    try {
      console.warn("[claude-cli] repairing Claude Code", { method: install.method, target });
      const outcome = await runRepair(install, env, options.signal);
      try {
        writeJson(repairFile(dir), { target: key, at: Date.now(), status: outcome.status } satisfies RepairRecord);
      } catch {
        // Only spares a repeat attempt.
      }
      miseAnswers.clear();
      console.warn("[claude-cli] repair finished", {
        method: install.method,
        status: outcome.status,
        ...(outcome.status === "failed" ? { output: outcome.output.slice(-500) } : {}),
      });
      return outcome;
    } finally {
      releaseRepairLock(dir);
    }
  })().finally(() => repairs.delete(key));
  repairs.set(key, work);
  return await work;
};

// --- choosing what to run -----------------------------------------------------

const methodLabel: Record<ClaudeCliInstallMethod, string> = {
  mise: "installed with mise",
  native: "installed with Anthropic's installer",
  npm: "installed with npm",
  homebrew: "installed with Homebrew",
  winget: "installed with WinGet",
  other: "",
};

export const describeClaudeCliUnusable = (detail: ClaudeCliUnusable): string => {
  const install = detail.install;
  const program = install ? (install.executable ?? install.launcher) : "claude";
  const how = install && methodLabel[install.method] ? ` (${methodLabel[install.method]})` : "";
  const repair = detail.repair;
  const repairText =
    repair?.status === "failed"
      ? ` Stella tried to repair it, which failed: ${repair.output.trim().slice(-600) || "no output"}.`
      : repair?.status === "repaired"
        ? " Stella repaired it, but it still doesn't start."
        : "";
  const fix = repair?.status === "manual" ? repair.how : claudeCliManualRepair(install);
  return `Claude Code can't start on this computer: ${program}${how} ${detail.problem}${repairText} ${fix}`
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
};

/**
 * What PATH names. When nothing runnable is found but a `claude` is there
 * that can't be run (an install cut off midway: no execute bit, a link to a
 * file that's gone), that one, so it is repaired or stood in for; otherwise
 * the CLI's own "not found" error (Claude Code isn't installed).
 */
const currentInstall = async (env: NodeJS.ProcessEnv): Promise<ClaudeCliInstall> => {
  let launcher: string;
  try {
    launcher = resolveExternalCliPath("claude", { env });
  } catch (notFound) {
    const unrunnable = findUnrunnableExternalCliPath("claude", { env });
    if (!unrunnable) throw notFound;
    const real = realPathOf(unrunnable);
    return {
      launcher: unrunnable,
      method: methodOf(real),
      executable: unrunnable,
      problem: "is there but can't be run.",
    };
  }
  return await describeClaudeCliInstall(launcher, env);
};

const fallbacksNoted = new Set<string>();

export type SelectClaudeCliOptions = {
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /**
   * What a broken install sets off: `wait` repairs it and, when there is no
   * working copy to run meanwhile, waits for the repair (a turn about to
   * start); `background` repairs it without waiting; `none` only reports.
   */
  repair?: "wait" | "background" | "none";
  /** Called once when the caller is about to wait for a repair. */
  onRepairing?: () => void;
};

/**
 * The Claude Code to run now. Throws the CLI's own "not found" error when
 * none is installed, and a `ClaudeCliUnusableError` (with what the binary
 * printed and what to do) when the installed one can't start and nothing
 * else can stand in.
 */
export const selectClaudeCli = async (
  options: SelectClaudeCliOptions = {},
): Promise<ClaudeCliLaunch> => {
  const env = options.env ?? process.env;
  const install = await currentInstall(env);
  const target = install.executable;
  const check: ClaudeCliCheck = target
    ? await checkClaudeCli(target, env)
    : { ok: false, problem: install.problem ?? "names no binary." };
  if (check.ok && target) {
    rememberLastGood(env, target, check.version);
    return {
      executable: target,
      version: check.version,
      identity: `${fileIdentity(target)}:${check.version}`,
    };
  }
  const problem = check.ok ? "" : check.problem;
  const mode = options.repair ?? "background";
  // Never tied to the caller's signal: a stopped turn must not cut off an
  // install midway, which is how an install ends up broken.
  const repair = mode === "none" ? null : repairClaudeCli(install, { env });
  const fallback = await lastGoodLaunch(env, target);
  if (fallback) {
    const noted = `${target ?? install.launcher}>${fallback.identity}`;
    if (!fallbacksNoted.has(noted)) {
      fallbacksNoted.add(noted);
      console.warn("[claude-cli] running the last working Claude Code instead", {
        selected: target ?? install.launcher,
        fallback: fallback.executable,
        version: fallback.version,
        problem: problem.slice(0, 500),
      });
    }
    void repair?.catch(() => undefined);
    return { ...fallback, fallback: { selected: target ?? install.launcher, problem } };
  }
  let outcome: ClaudeCliRepairOutcome | undefined;
  if (repair && mode === "wait") {
    options.onRepairing?.();
    outcome = await Promise.race([
      repair,
      new Promise<ClaudeCliRepairOutcome>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve({ status: "skipped", reason: "The repair is still running." }),
          TURN_REPAIR_WAIT_MS,
        );
        timer.unref?.();
        // Stopping the turn stops the wait, not the repair.
        options.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(options.signal?.reason ?? new Error("Stopped."));
          },
          { once: true },
        );
      }),
    ]);
    if (outcome.status === "repaired" || outcome.status === "skipped") {
      const again = await selectClaudeCli({ ...options, repair: "none" }).catch(
        () => null,
      );
      if (again) return again;
    }
  } else {
    void repair?.catch(() => undefined);
  }
  const detail: ClaudeCliUnusable = {
    install,
    problem,
    ...(outcome && outcome.status !== "skipped" ? { repair: outcome } : {}),
  };
  throw new ClaudeCliUnusableError(describeClaudeCliUnusable(detail), detail);
};

/** What `selectClaudeCli` would pick, without repairing anything: for checks that only look. */
export const inspectClaudeCli = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ install: ClaudeCliInstall; check: ClaudeCliCheck } | null> => {
  let install: ClaudeCliInstall;
  try {
    install = await currentInstall(env);
  } catch {
    return null;
  }
  const check: ClaudeCliCheck = install.executable
    ? await checkClaudeCli(install.executable, env, { fresh: true })
    : { ok: false, problem: install.problem ?? "names no binary." };
  if (check.ok && install.executable) rememberLastGood(env, install.executable, check.version);
  return { install, check };
};
