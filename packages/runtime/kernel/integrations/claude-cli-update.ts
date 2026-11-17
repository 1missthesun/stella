import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeCliCommandEnv, runCliCommand } from "./claude-cli-command.js";
import {
  inspectClaudeCli,
  lastGoodClaudeCliVersion,
  repairClaudeCli,
  type ClaudeCliInstall,
  type ClaudeCliInstallMethod,
  type ClaudeCliRepairOutcome,
} from "./claude-cli-launch.js";

const UPDATE_TIMEOUT_MS = 20 * 60_000;
const VERSION_TIMEOUT_MS = 15_000;

export type ClaudeCliCommandResult = {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
};

export const runClaudeCliCommand = async (
  executable: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal },
): Promise<ClaudeCliCommandResult> => {
  const result = await runCliCommand(executable, args, options);
  return {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    output: result.spawnError
      ? `${result.output}\n${result.spawnError}`.trim()
      : result.output,
  };
};

const isOn = (value: unknown): boolean =>
  typeof value === "string"
    ? !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase())
    : value === true || (typeof value === "number" && value !== 0);

const settingsEnv = (file: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { env?: unknown };
    return parsed.env && typeof parsed.env === "object"
      ? (parsed.env as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const managedSettingsFile = (): string =>
  process.platform === "darwin"
    ? "/Library/Application Support/ClaudeCode/managed-settings.json"
    : process.platform === "win32"
      ? "C:\\Program Files\\ClaudeCode\\managed-settings.json"
      : "/etc/claude-code/managed-settings.json";

const UPDATE_OFF_SWITCHES = ["DISABLE_UPDATES", "DISABLE_AUTOUPDATER"] as const;

/**
 * Claude Code's own switches for "do not update me"
 * (https://code.claude.com/docs/en/setup#disable-auto-updates), read from the
 * places the CLI reads them. `claude update` ignores DISABLE_AUTOUPDATER
 * because a person typing it is asking; Stella running it unasked is the
 * background updater that switch turns off.
 */
export const claudeCliUpdatesTurnedOffBy = (
  env: NodeJS.ProcessEnv = process.env,
): string | null => {
  const userSettings = path.join(
    env.CLAUDE_CONFIG_DIR?.trim() ||
      path.join(env.HOME?.trim() || os.homedir(), ".claude"),
    "settings.json",
  );
  const sources: [string, Record<string, unknown>][] = [
    ["environment", env],
    [userSettings, settingsEnv(userSettings)],
    [managedSettingsFile(), settingsEnv(managedSettingsFile())],
  ];
  for (const [source, values] of sources) {
    const name = UPDATE_OFF_SWITCHES.find((key) => isOn(values[key]));
    if (name) return `${name} (${source})`;
  }
  return null;
};

/**
 * The version the binary reports, or null when it doesn't run: only an exit
 * of 0 with a version on stdout counts (an error that names a version, like
 * mise's "not provided by the active claude@2.1.326", is not one).
 */
export const readClaudeCliVersion = async (
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> => {
  const result = await runCliCommand(executable, ["--version"], {
    env: claudeCliCommandEnv(executable, env),
    timeoutMs: VERSION_TIMEOUT_MS,
  });
  return result.exitCode === 0
    ? (/\d+\.\d+\.\d+/.exec(result.stdout)?.[0] ?? null)
    : null;
};

export type ClaudeCliUpdateOutcome =
  | { status: "not_installed" }
  | { status: "turned_off"; by: string; version: string | null }
  | { status: "current"; version: string | null; output: string }
  | { status: "updated"; from: string | null; version: string; output: string }
  | { status: "failed"; version: string | null; output: string }
  /** It couldn't start; Stella repaired it and it runs now. */
  | { status: "repaired"; version: string; problem: string; output: string }
  /** It can't start and Stella couldn't repair it. Turns run the last working copy, if any. */
  | {
      status: "unusable";
      problem: string;
      repair: ClaudeCliRepairOutcome;
      method: ClaudeCliInstallMethod;
      fallback: string | null;
    };

/**
 * Repairs an install that can't start and says how that went: "repaired"
 * once it starts again, else "unusable" with what the binary printed and what
 * the repair did.
 */
const repairUnusable = async (
  install: ClaudeCliInstall,
  problem: string,
  env: NodeJS.ProcessEnv,
): Promise<ClaudeCliUpdateOutcome> => {
  const repair = await repairClaudeCli(install, { env, force: true });
  const after = await inspectClaudeCli(env);
  if (after?.check.ok) {
    return {
      status: "repaired",
      version: after.check.version,
      problem,
      output: repair.status === "failed" ? repair.output : "",
    };
  }
  return {
    status: "unusable",
    problem: after && !after.check.ok ? after.check.problem : problem,
    repair,
    method: install.method,
    fallback: lastGoodClaudeCliVersion(env),
  };
};

/**
 * Keeps the CLI current and working. First it checks that the selected
 * Claude Code starts; one that doesn't is repaired, not updated. Then it runs
 * the CLI's own updater through what PATH names, which follows however it
 * was installed: a native install downloads the next version beside the
 * running one, an npm install reinstalls through npm, a version manager's
 * wrapper (mise) updates its tool before running it, and a Homebrew, WinGet
 * or Linux package install is left to its package manager. Whatever that
 * leaves selected is checked before Stella runs it: one that doesn't start is
 * repaired, and until then turns keep running the last one that did. The
 * release channel and `minimumVersion` in the user's Claude settings apply
 * as they would in a terminal.
 */
export const updateClaudeCli = async (
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<ClaudeCliUpdateOutcome> => {
  const env = options.env ?? process.env;
  const before = await inspectClaudeCli(env);
  if (!before) return { status: "not_installed" };
  if (!before.check.ok) {
    return await repairUnusable(before.install, before.check.problem, env);
  }
  const from = before.check.version;
  const by = claudeCliUpdatesTurnedOffBy(env);
  if (by) return { status: "turned_off", by, version: from };
  const launcher = before.install.launcher;
  // Not stopped when Stella quits: an update cut off midway (a version
  // manager downloading in the foreground) is what leaves an install broken.
  // Only a hang past the timeout is ended.
  const result = await runClaudeCliCommand(launcher, ["update"], {
    env: claudeCliCommandEnv(launcher, env),
    timeoutMs: UPDATE_TIMEOUT_MS,
  });
  const after = await inspectClaudeCli(env);
  if (after && !after.check.ok) {
    return await repairUnusable(after.install, after.check.problem, env);
  }
  const version = after?.check.ok ? after.check.version : from;
  if (version && version !== from) {
    return { status: "updated", from, version, output: result.output };
  }
  return result.exitCode === 0
    ? { status: "current", version, output: result.output }
    : {
        status: "failed",
        version,
        output: result.timedOut
          ? `Timed out after ${UPDATE_TIMEOUT_MS / 60_000} minutes. ${result.output}`
          : result.output,
      };
};
