import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  findExternalCliPath,
  findUnrunnableExternalCliPath,
} from "@stella/node-shared/integrations/external-cli-resolution.js";
import { claudeCliCommandEnv, runCliCommand } from "./claude-cli-command.js";
import { CLI_REPAIR_TIMEOUT_MS, cliRealPath, createCliKeeper, type CliInstall, type CliRepairOutcome } from "./cli-keeper.js";
import { updateCli, type CliUpdateOutcome } from "./cli-update.js";

/**
 * Finding, installing, repairing and updating Google's Antigravity CLI
 * (`agy`), as Stella does Claude Code's (`cli-keeper.ts`): Google's own
 * installer puts it where Google puts it, a broken or half-installed one is
 * reinstalled while the last working copy stands in, and Google's own `update`
 * keeps it current. Google's installer also puts its folder on the person's
 * PATH; Stella finds the CLI without that, so it installs without it.
 */

const INSTALLER_SH = "https://antigravity.google/cli/install.sh";
const INSTALLER_PS1 = "https://antigravity.google/cli/install.ps1";
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** The first release whose custom agents can carry Stella's prompt and tools as tested. */
const MINIMUM_VERSION = "1.5.14";

const STAGING_PREFIX = ".stella-agy-";

export type AntigravityCliInstallMethod = "google" | "other";
type Install = CliInstall<AntigravityCliInstallMethod>;

const PROGRAM = process.platform === "win32" ? "agy.exe" : "agy";

/** Where Google's installer puts `agy`. */
const installDirectory = (env: NodeJS.ProcessEnv): string =>
  process.platform === "win32"
    ? path.join(env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local"), "agy", "bin")
    : path.join(env.HOME?.trim() || os.homedir(), ".local", "bin");

const installedAt = (env: NodeJS.ProcessEnv): string => path.join(installDirectory(env), PROGRAM);

/** `agy`, as a turn would run it: on PATH, or where Google's installer puts it. */
export const findAntigravityCli = (env: NodeJS.ProcessEnv = process.env): string | undefined =>
  findExternalCliPath("agy", { env }) ?? undefined;

const olderThan = (version: string, minimum: string): boolean => {
  const left = version.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) < (right[index] ?? 0);
  }
  return false;
};

const methodOf = (launcher: string, env: NodeJS.ProcessEnv): AntigravityCliInstallMethod =>
  cliRealPath(launcher) === cliRealPath(installedAt(env)) ? "google" : "other";

/** What there is, or the install Google's installer would make where there is none. */
const currentInstall = async (env: NodeJS.ProcessEnv): Promise<Install> => {
  const launcher = findAntigravityCli(env);
  if (launcher) return { launcher, method: methodOf(launcher, env), executable: launcher };
  const unrunnable = findUnrunnableExternalCliPath("agy", { env });
  if (unrunnable) {
    return { launcher: unrunnable, method: methodOf(unrunnable, env), executable: unrunnable, problem: "is there but can't be run." };
  }
  return { launcher: installedAt(env), method: "google", executable: null, problem: "isn't installed." };
};

const commandEnv = (executable: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => claudeCliCommandEnv(executable, env);

/**
 * Runs Google's installer into `directory`, kept off the person's PATH and
 * shell files: on Windows with the flags its `install` step takes; elsewhere,
 * where the script can't pass them on, with a throwaway home folder for that
 * step to write to.
 */
const runInstaller = async (
  directory: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
): Promise<{ exitCode: number | null; output: string }> => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "stella-agy-install-"));
  try {
    const windows = process.platform === "win32";
    const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const response = await fetch(windows ? INSTALLER_PS1 : INSTALLER_SH, { redirect: "follow", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) return { exitCode: null, output: `Google's download page answered ${response.status}.` };
    const script = path.join(work, windows ? "install.ps1" : "install.sh");
    await fs.writeFile(script, await response.text(), { mode: 0o700 });
    const home = path.join(work, "home");
    await fs.mkdir(home);
    const [command, args, overrides] = windows
      ? [
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "--dir", directory, "--skip-path", "--skip-aliases"],
          {},
        ]
      : ["bash", [script, "--dir", directory], { HOME: home, SHELL: "/bin/sh", ZDOTDIR: home, XDG_CONFIG_HOME: path.join(home, ".config") }];
    const result = await runCliCommand(command, args, {
      env: { ...commandEnv(path.join(directory, PROGRAM), env), ...overrides },
      timeoutMs: CLI_REPAIR_TIMEOUT_MS,
      cwd: work,
      ...(signal ? { signal } : {}),
    });
    return { exitCode: result.exitCode, output: result.spawnError ?? result.output };
  } catch (error) {
    return { exitCode: null, output: error instanceof Error ? error.message : String(error) };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
};

const versionOf = async (binary: string, env: NodeJS.ProcessEnv): Promise<string | null> => {
  const result = await runCliCommand(binary, ["--version"], { env: commandEnv(binary, env), timeoutMs: 15_000 });
  return result.exitCode === 0 ? (/\d+\.\d+\.\d+/u.exec(result.stdout)?.[0] ?? null) : null;
};

/** Too old but running: Google's own update. Otherwise a fresh install. */
const runRepair = async (install: Install, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<CliRepairOutcome> => {
  let output = "";
  if (install.executable && (await versionOf(install.executable, env))) {
    const updated = await runCliCommand(install.launcher, ["update"], {
      env: commandEnv(install.launcher, env),
      timeoutMs: CLI_REPAIR_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
    output = updated.spawnError ?? updated.output;
    const version = await versionOf(install.launcher, env);
    if (version && !olderThan(version, MINIMUM_VERSION)) return { status: "repaired", version, output };
  }
  if (install.method !== "google") return { status: "manual", how: manualRepair(install) };
  const target = installedAt(env);
  // Installed beside its place and moved in only once it starts, so an
  // install that fails or is cut off leaves what was there.
  let staged: string | undefined;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    for (const name of await fs.readdir(path.dirname(target))) {
      if (name.startsWith(STAGING_PREFIX)) await fs.rm(path.join(path.dirname(target), name), { recursive: true, force: true }).catch(() => undefined);
    }
    staged = await fs.mkdtemp(path.join(path.dirname(target), STAGING_PREFIX));
    const result = await runInstaller(staged, env, signal);
    const fresh = path.join(staged, PROGRAM);
    const version = existsSync(fresh) ? await versionOf(fresh, env) : null;
    if (!version || olderThan(version, MINIMUM_VERSION)) {
      return {
        status: "failed",
        output: [output, result.output].filter((text) => text.trim()).at(-1) || `The installer exited with code ${result.exitCode ?? "unknown"}.`,
      };
    }
    // Windows won't replace a program that is running, but lets it be renamed.
    if (process.platform === "win32") await fs.rename(target, path.join(staged, "replaced.exe")).catch(() => undefined);
    await fs.rename(fresh, target);
    return { status: "repaired", version, output: result.output };
  } catch (error) {
    return { status: "failed", output: error instanceof Error ? error.message : String(error) };
  } finally {
    if (staged) await fs.rm(staged, { recursive: true, force: true }).catch(() => undefined);
  }
};

const manualRepair = (install: Install | null): string =>
  install?.method === "other"
    ? "Reinstall or update Google Antigravity's `agy` the way it was installed, then try again."
    : "Check your internet connection, then try again.";

const unusable = (detail: { install: Install | null; problem: string; repair?: CliRepairOutcome }): Error => {
  const missing = detail.install?.executable === null;
  const repair = detail.repair;
  const why = repair?.status === "failed" ? ` ${repair.output.trim().split(/\r?\n/u).filter(Boolean).at(-1)?.slice(0, 300) ?? ""}` : "";
  const fix = repair?.status === "manual" ? repair.how : manualRepair(detail.install);
  return Object.assign(
    new Error(
      missing
        ? `Google Antigravity couldn't be set up on this computer.${why} ${fix}`
        : `Google Antigravity can't start on this computer: ${detail.install?.executable ?? "agy"} ${detail.problem}${why} ${fix}`,
    ),
    { code: "ANTIGRAVITY_CLI_UNUSABLE" },
  );
};

export const antigravityCliKeeper = createCliKeeper<AntigravityCliInstallMethod>({
  label: "Google Antigravity",
  log: "antigravity-cli",
  stateDirectory: "antigravity-cli",
  program: "agy",
  commandEnv,
  currentInstall,
  versionProblem: (version) =>
    olderThan(version, MINIMUM_VERSION) ? `is version ${version}, and Stella needs ${MINIMUM_VERSION} or newer.` : undefined,
  repairable: ["google", "other"],
  runRepair,
  manualRepair,
  unusable,
});

const isOn = (value: string | undefined): boolean =>
  value !== undefined && !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());

/**
 * One scheduled check: keeps `agy` current and working. Where Stella isn't
 * signed in to Google and `agy` isn't installed, there's nothing to keep.
 */
export const updateAntigravityCli = async (
  options: { signedIn: boolean; env?: NodeJS.ProcessEnv },
): Promise<CliUpdateOutcome<AntigravityCliInstallMethod>> => {
  const env = options.env ?? process.env;
  if (!options.signedIn && (await currentInstall(env)).executable === null) return { status: "not_installed" };
  return await updateCli(antigravityCliKeeper, {
    env,
    commandEnv,
    turnedOffBy: (values) => (isOn(values.AGY_CLI_DISABLE_AUTO_UPDATE) ? "AGY_CLI_DISABLE_AUTO_UPDATE (environment)" : null),
  });
};
