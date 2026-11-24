import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeCliCommandEnv, runCliCommand } from "./claude-cli-command.js";
import {
  CLI_REPAIR_TIMEOUT_MS,
  CLI_VERSION_PATTERN,
  cliRealPath,
  createCliKeeper,
  type CliCheck,
  type CliInstall,
  type CliLaunch,
  type CliRepairOutcome,
  type CliUnusable,
  type SelectCliOptions,
} from "./cli-keeper.js";
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

const RESOLVE_TIMEOUT_MS = 10_000;

export type ClaudeCliInstallMethod =
  | "mise"
  | "native"
  | "npm"
  | "homebrew"
  | "winget"
  | "other";

export type ClaudeCliInstall = CliInstall<ClaudeCliInstallMethod>;
export type ClaudeCliCheck = CliCheck;
export type ClaudeCliLaunch = CliLaunch;
export type ClaudeCliRepairOutcome = CliRepairOutcome;
export type ClaudeCliUnusable = CliUnusable<ClaudeCliInstallMethod>;
export type SelectClaudeCliOptions = SelectCliOptions;

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
  const real = cliRealPath(launcher);
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
    return { launcher, method: "mise", manager: real, executable: cliRealPath(named) };
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

// --- repair -------------------------------------------------------------------

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
    const version = CLI_VERSION_PATTERN.exec(lastLine(current.stdout))?.[1];
    const result = await runCliCommand(
      install.manager,
      ["install", "--force", version ? `claude@${version}` : "claude"],
      { env, timeoutMs: CLI_REPAIR_TIMEOUT_MS, signal, cwd: os.homedir() },
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
    const pkg = npmPackageOf(cliRealPath(install.executable ?? install.launcher));
    if (!pkg) return { status: "manual", how: claudeCliManualRepair(install) };
    let version = "latest";
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(pkg.root, "package.json"), "utf8"),
      ) as { version?: unknown };
      if (typeof manifest.version === "string" && CLI_VERSION_PATTERN.test(manifest.version)) {
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
      { env, timeoutMs: CLI_REPAIR_TIMEOUT_MS, signal, shell: windows },
    );
    return result.exitCode === 0
      ? { status: "repaired", version, output: result.output }
      : { status: "failed", output: result.spawnError ?? result.output };
  }
  return { status: "manual", how: claudeCliManualRepair(install) };
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
    const real = cliRealPath(unrunnable);
    return {
      launcher: unrunnable,
      method: methodOf(real),
      executable: unrunnable,
      problem: "is there but can't be run.",
    };
  }
  return await describeClaudeCliInstall(launcher, env);
};

export const claudeCliKeeper = createCliKeeper<ClaudeCliInstallMethod>({
  label: "Claude Code",
  log: "claude-cli",
  stateDirectory: "claude-cli",
  program: "claude",
  commandEnv: claudeCliCommandEnv,
  currentInstall,
  repairable: ["mise", "native", "npm"],
  runRepair,
  afterRepair: () => miseAnswers.clear(),
  manualRepair: claudeCliManualRepair,
  unusable: (detail) => new ClaudeCliUnusableError(describeClaudeCliUnusable(detail), detail),
});

/** Asks the binary for its version. Exit 0 with a version on stdout is a binary that runs. */
export const checkClaudeCli = claudeCliKeeper.probe;

/** A process started from this binary exited before it said anything: check it again next time. */
export const noteClaudeCliLaunchFailed = claudeCliKeeper.noteLaunchFailed;

/** The version Stella last saw run here, for anything that only needs to know. */
export const lastGoodClaudeCliVersion = claudeCliKeeper.lastGoodVersion;

/**
 * Repairs the install the way it was made: mise reinstalls its version, a
 * native install runs Anthropic's installer again, npm reinstalls the package.
 */
export const repairClaudeCli = claudeCliKeeper.repair;

/**
 * The Claude Code to run now. Throws the CLI's own "not found" error when
 * none is installed, and a `ClaudeCliUnusableError` (with what the binary
 * printed and what to do) when the installed one can't start and nothing
 * else can stand in.
 */
export const selectClaudeCli = claudeCliKeeper.select;

/** What `selectClaudeCli` would pick, without repairing anything: for checks that only look. */
export const inspectClaudeCli = claudeCliKeeper.inspect;
