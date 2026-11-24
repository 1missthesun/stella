import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeCliCommandEnv, runCliCommand } from "./claude-cli-command.js";
import { claudeCliKeeper, type ClaudeCliInstallMethod } from "./claude-cli-launch.js";
import { updateCli, type CliUpdateOutcome } from "./cli-update.js";

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

export type ClaudeCliUpdateOutcome = CliUpdateOutcome<ClaudeCliInstallMethod>;

export const updateClaudeCli = async (
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<ClaudeCliUpdateOutcome> =>
  await updateCli(claudeCliKeeper, {
    env: options.env ?? process.env,
    commandEnv: claudeCliCommandEnv,
    turnedOffBy: claudeCliUpdatesTurnedOffBy,
  });
