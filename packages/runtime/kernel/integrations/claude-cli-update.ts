import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildExternalCliChildEnv,
  resolveExternalCliPath,
} from "./external-cli-resolution.js";

const UPDATE_TIMEOUT_MS = 20 * 60_000;
const VERSION_TIMEOUT_MS = 15_000;
const OUTPUT_TAIL_CHARS = 2_000;

export type ClaudeCliCommandResult = {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
};

export const runClaudeCliCommand = (
  executable: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal },
): Promise<ClaudeCliCommandResult> =>
  new Promise((resolve) => {
    let output = "";
    const startedAt = Date.now();
    const child = spawn(executable, [...args], {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: options.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-OUTPUT_TAIL_CHARS);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        timedOut:
          exitCode === null && Date.now() - startedAt >= options.timeoutMs,
        output: output.trim(),
      });
    };
    child.on("error", (error) => {
      output = `${output}\n${error.message}`;
      finish(null);
    });
    child.on("close", finish);
  });

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

const cliEnv = (executable: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const childEnv = buildExternalCliChildEnv(executable, env);
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;
  delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;
  return childEnv;
};

export const readClaudeCliVersion = async (
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> => {
  const result = await runClaudeCliCommand(executable, ["--version"], {
    env: cliEnv(executable, env),
    timeoutMs: VERSION_TIMEOUT_MS,
  });
  return /\d+\.\d+\.\d+/.exec(result.output)?.[0] ?? null;
};

export type ClaudeCliUpdateOutcome =
  | { status: "not_installed" }
  | { status: "turned_off"; by: string; version: string | null }
  | { status: "current"; version: string | null; output: string }
  | { status: "updated"; from: string | null; version: string; output: string }
  | { status: "failed"; version: string | null; output: string };

/**
 * Runs the installed CLI's own updater, which follows however it was
 * installed: a native install downloads the next version beside the running
 * one, an npm install reinstalls through npm, and a Homebrew, WinGet or Linux
 * package install is left to its package manager. The release channel and
 * `minimumVersion` in the user's Claude settings apply as they would in a
 * terminal.
 */
export const updateClaudeCli = async (
  options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<ClaudeCliUpdateOutcome> => {
  const env = options.env ?? process.env;
  let executable: string;
  try {
    executable = resolveExternalCliPath("claude", { env });
  } catch {
    return { status: "not_installed" };
  }
  const from = await readClaudeCliVersion(executable, env);
  const by = claudeCliUpdatesTurnedOffBy(env);
  if (by) return { status: "turned_off", by, version: from };
  const result = await runClaudeCliCommand(executable, ["update"], {
    env: cliEnv(executable, env),
    timeoutMs: UPDATE_TIMEOUT_MS,
    signal: options.signal,
  });
  let version = from;
  try {
    version = await readClaudeCliVersion(
      resolveExternalCliPath("claude", { env }),
      env,
    );
  } catch {
    version = from;
  }
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
