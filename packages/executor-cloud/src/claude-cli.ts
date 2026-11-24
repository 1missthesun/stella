import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import {
  readClaudeCliVersion,
  runClaudeCliCommand,
} from "@stella/runtime/kernel/integrations/claude-cli-update.js";

const CLI_HOME = "/opt/stella/claude-cli";
const NATIVE_CLI = path.join(CLI_HOME, ".local", "bin", "claude");
const IMAGE_CLI = "/usr/local/bin/claude";
const STATUS_FILE = path.join(CLI_HOME, "refresh.json");
const LOCK_DIR = path.join(CLI_HOME, "refresh.lock");

const CHECK_INTERVAL_MS = 12 * 60 * 60_000;
const REFRESH_TIMEOUT_MS = 10 * 60_000;
const FIRST_INSTALL_WAIT_MS = 60_000;
const EXECUTOR = "/opt/stella/bin/stella-executor";
export const CLAUDE_CLI_REFRESH_FLAG = "--claude-cli-refresh";
export const CLAUDE_CLI_LOCK_HELD_FLAG = "--lock-held";

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const nativeStarts = async (): Promise<boolean> =>
  isExecutable(NATIVE_CLI) &&
  (await readClaudeCliVersion(NATIVE_CLI, installerEnv()).catch(() => null)) !== null;

const PASSED_ENV = /^(PATH|LANG|TZ|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|(https?|all|no)_proxy)$/i;

const installerEnv = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => PASSED_ENV.test(name)),
  ),
  HOME: CLI_HOME,
  CLAUDE_CONFIG_DIR: path.join(CLI_HOME, ".claude"),
  IS_SANDBOX: "1",
});

type RefreshStatus = {
  checkedAt: number;
  ok: boolean;
  version: string | null;
  output: string;
};

const readStatus = async (): Promise<RefreshStatus | null> => {
  try {
    return JSON.parse(await readFile(STATUS_FILE, "utf8")) as RefreshStatus;
  } catch {
    return null;
  }
};

const refreshInFlight = async (): Promise<boolean> => {
  const lock = await stat(LOCK_DIR).catch(() => null);
  if (!lock) return false;
  if (Date.now() - lock.mtimeMs < REFRESH_TIMEOUT_MS + 60_000) return true;
  await rm(LOCK_DIR, { recursive: true, force: true });
  return false;
};

const takeRefreshLock = async (): Promise<boolean> => {
  await mkdir(CLI_HOME, { recursive: true, mode: 0o755 });
  if (await refreshInFlight()) return false;
  try {
    await mkdir(LOCK_DIR);
    return true;
  } catch {
    return false;
  }
};

const runRefresh = async (): Promise<void> => {
  const installed = await nativeStarts();
  const last = await readStatus();
  const env = installerEnv();
  const result = installed
    ? await runClaudeCliCommand(NATIVE_CLI, ["update"], {
        env,
        timeoutMs: REFRESH_TIMEOUT_MS,
      })
    : await runClaudeCliCommand(IMAGE_CLI, ["install", "latest", ...(isExecutable(NATIVE_CLI) ? ["--force"] : [])], {
        env,
        timeoutMs: REFRESH_TIMEOUT_MS,
      });
  const version = isExecutable(NATIVE_CLI)
    ? await readClaudeCliVersion(NATIVE_CLI, env)
    : null;
  const status: RefreshStatus = {
    checkedAt: Date.now(),
    ok: result.exitCode === 0 && version !== null,
    version,
    output: result.output.slice(-500),
  };
  await writeFile(STATUS_FILE, `${JSON.stringify(status)}\n`, { mode: 0o644 });
  console.error(
    JSON.stringify({
      event: status.ok ? "claude_cli_refreshed" : "claude_cli_refresh_failed",
      action: installed ? "update" : "install",
      from: last?.version ?? null,
      ...status,
    }),
  );
};

export const refreshCloudClaudeCli = async (
  options: { lockHeld?: boolean } = {},
): Promise<void> => {
  if (options.lockHeld) {
    try {
      await runRefresh();
    } finally {
      await rm(LOCK_DIR, { recursive: true, force: true });
    }
    return;
  }
  await mkdir(CLI_HOME, { recursive: true, mode: 0o755 });
  const installed = await nativeStarts();
  const last = await readStatus();
  if (
    installed &&
    last?.ok &&
    Date.now() - last.checkedAt >= 0 &&
    Date.now() - last.checkedAt < CHECK_INTERVAL_MS
  ) {
    return;
  }
  if (!(await takeRefreshLock())) return;
  try {
    await runRefresh();
  } finally {
    await rm(LOCK_DIR, { recursive: true, force: true });
  }
};

const startRefreshHoldingLock = (): void => {
  const release = () => void rm(LOCK_DIR, { recursive: true, force: true });
  const child = spawn(EXECUTOR, [CLAUDE_CLI_REFRESH_FLAG, CLAUDE_CLI_LOCK_HELD_FLAG], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", release);
  child.unref();
};

const pointAtNativeCli = async (): Promise<boolean> => {
  if (!(await nativeStarts())) {
    if (process.env.STELLA_CLAUDE_CLI_PATH === NATIVE_CLI) {
      delete process.env.STELLA_CLAUDE_CLI_PATH;
    }
    return false;
  }
  process.env.STELLA_CLAUDE_CLI_PATH = NATIVE_CLI;
  return true;
};

export const prepareCloudClaudeCli = async (): Promise<void> => {
  if (!existsSync(EXECUTOR) || (await pointAtNativeCli())) return;
  if (isExecutable(NATIVE_CLI)) {
    console.error(JSON.stringify({ event: "claude_cli_native_unusable", last: await readStatus() }));
    if (await takeRefreshLock()) startRefreshHoldingLock();
    return;
  }
  const startedAt = Date.now();
  if (await takeRefreshLock()) startRefreshHoldingLock();
  while (
    Date.now() - startedAt < FIRST_INSTALL_WAIT_MS &&
    (await refreshInFlight())
  ) {
    await Effect.runPromise(Effect.sleep(500));
  }
  if (!(await pointAtNativeCli())) {
    console.error(
      JSON.stringify({
        event: "claude_cli_image_fallback",
        waitedMs: Date.now() - startedAt,
        last: await readStatus(),
      }),
    );
  }
};

export const warmCloudClaudeCli = async (): Promise<void> => {
  if (!existsSync(EXECUTOR)) return;
  if (!(await nativeStarts())) {
    await refreshCloudClaudeCli().catch(() => undefined);
  }
  const cli = (await nativeStarts()) ? NATIVE_CLI : IMAGE_CLI;
  await new Promise<void>((resolve) => {
    const reader = spawn("sh", ["-c", 'cat -- "$(readlink -f -- "$0")" >/dev/null', cli], {
      stdio: "ignore",
    });
    reader.on("error", () => resolve());
    reader.on("close", () => resolve());
  });
  await readClaudeCliVersion(cli, installerEnv()).catch(() => null);
  await refreshCloudClaudeCli().catch(() => undefined);
};
