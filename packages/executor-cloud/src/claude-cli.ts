import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import {
  readClaudeCliVersion,
  runClaudeCliCommand,
} from "@stella/runtime/kernel/integrations/claude-cli-update.js";

/**
 * Claude Code in a cloud container.
 *
 * The image carries a pinned copy, and moving that pin changes the image,
 * which resets every owner's container snapshot. So the copy turns run is a
 * native install Claude Code's own installer keeps beside the image, root-owned
 * and readable by the tool user like the image's copy: installed when a container first needs it, checked
 * for a newer release at container start at most twice a day, and carried by
 * the owner's snapshots. Versions sit side by side, so a running turn keeps
 * its binary. The image's copy is what a container falls back to when the
 * install cannot be reached.
 */
const CLI_HOME = "/opt/stella/claude-cli";
const NATIVE_CLI = path.join(CLI_HOME, ".local", "bin", "claude");
const IMAGE_CLI = "/usr/local/bin/claude";
const STATUS_FILE = path.join(CLI_HOME, "refresh.json");
const LOCK_DIR = path.join(CLI_HOME, "refresh.lock");

const CHECK_INTERVAL_MS = 12 * 60 * 60_000;
const REFRESH_TIMEOUT_MS = 10 * 60_000;
const FIRST_INSTALL_WAIT_MS = 60_000;
const REFRESH_START_GRACE_MS = 5_000;
const EXECUTOR = "/opt/stella/bin/stella-executor";
export const CLAUDE_CLI_REFRESH_FLAG = "--claude-cli-refresh";

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

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

/**
 * `stella-executor --claude-cli-refresh`: install the native copy, or let it
 * update itself. One at a time per container; a no-op when checked recently.
 */
export const refreshCloudClaudeCli = async (): Promise<void> => {
  await mkdir(CLI_HOME, { recursive: true, mode: 0o755 });
  const installed = isExecutable(NATIVE_CLI);
  const last = await readStatus();
  if (
    installed &&
    last?.ok &&
    Date.now() - last.checkedAt >= 0 &&
    Date.now() - last.checkedAt < CHECK_INTERVAL_MS
  ) {
    return;
  }
  if (await refreshInFlight()) return;
  try {
    await mkdir(LOCK_DIR);
  } catch {
    return;
  }
  try {
    const env = installerEnv();
    const result = installed
      ? await runClaudeCliCommand(NATIVE_CLI, ["update"], {
          env,
          timeoutMs: REFRESH_TIMEOUT_MS,
        })
      : await runClaudeCliCommand(IMAGE_CLI, ["install", "latest"], {
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
  } finally {
    await rm(LOCK_DIR, { recursive: true, force: true });
  }
};

const startRefresh = (): void => {
  const child = spawn(EXECUTOR, [CLAUDE_CLI_REFRESH_FLAG], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => undefined);
  child.unref();
};

const pointAtNativeCli = (): boolean => {
  if (!isExecutable(NATIVE_CLI)) return false;
  process.env.STELLA_CLAUDE_CLI_PATH = NATIVE_CLI;
  return true;
};

/**
 * Called before a Claude Code turn resolves `claude`. A container without the
 * native copy yet (a clean disk: first use, or the image moved) waits for the
 * install, bounded, because the image's pin may predate the model the turn
 * asked for; past that the turn runs on the image's copy. Nothing else waits.
 */
export const prepareCloudClaudeCli = async (): Promise<void> => {
  if (!existsSync(EXECUTOR) || pointAtNativeCli()) return;
  const startedAt = Date.now();
  if (!(await refreshInFlight())) startRefresh();
  while (Date.now() - startedAt < FIRST_INSTALL_WAIT_MS) {
    await Effect.runPromise(Effect.sleep(500));
    if (isExecutable(NATIVE_CLI)) break;
    const settled =
      Date.now() - startedAt > REFRESH_START_GRACE_MS &&
      !(await refreshInFlight());
    if (settled) break;
  }
  if (!pointAtNativeCli()) {
    console.error(
      JSON.stringify({
        event: "claude_cli_image_fallback",
        waitedMs: Date.now() - startedAt,
        last: await readStatus(),
      }),
    );
  }
};

/**
 * `stella-executor --warm`, at container start: bring the binary the next
 * turn will run into the page cache, then look for a newer release.
 */
export const warmCloudClaudeCli = async (): Promise<void> => {
  if (!existsSync(EXECUTOR)) return;
  const cli = isExecutable(NATIVE_CLI) ? NATIVE_CLI : IMAGE_CLI;
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
