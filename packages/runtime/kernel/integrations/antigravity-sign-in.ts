import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { forkTimeoutFiber } from "../cli/effect-runtime.js";
import {
  ANTIGRAVITY_APP_DATA_DIR,
  antigravityCliEnv,
  antigravityCliSignedIn,
  antigravityTokenFile,
  findAntigravityCli,
} from "./antigravity-cli-acp.js";

/**
 * Signing in to Google Antigravity with Google's own login command
 * (`agy acp --login`): it prints Google's page, the person signs in there, and
 * the CLI reads the code that page shows. The CLI stores the sign-in; Stella
 * never reads it.
 */
const INSTALLER_SH = "https://antigravity.google/cli/install.sh";
const INSTALLER_PS1 = "https://antigravity.google/cli/install.ps1";
/** The first release whose custom agents can carry Stella's prompt and tools as tested. */
const MINIMUM_VERSION = "1.5.14";
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const UPDATE_TIMEOUT_MS = 5 * 60_000;
const VERSION_TIMEOUT_MS = 20_000;
const URL_TIMEOUT_MS = 45_000;
const FINISH_TIMEOUT_MS = 60_000;
const LOGOUT_TIMEOUT_MS = 20_000;

const canceled = () => new Error("Google sign-in was canceled.");

const run = (
  command: string,
  args: readonly string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<{ code: number | null; output: string }> =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      cwd: os.tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: options.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-4_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => resolve({ code: null, output: `${output}\n${error.message}`.trim() }));
    child.on("close", (code) => resolve({ code, output: output.trim() }));
  });

const lastLine = (output: string): string =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("http"))
    .at(-1) ?? "";

const olderThan = (version: string, minimum: string): boolean => {
  const left = version.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) < (right[index] ?? 0);
  }
  return false;
};

const versionOf = async (binary: string, signal: AbortSignal): Promise<string | undefined> => {
  const { code, output } = await run(binary, ["--version"], { timeoutMs: VERSION_TIMEOUT_MS, signal });
  return code === 0 ? /\d+\.\d+\.\d+/u.exec(output)?.[0] : undefined;
};

/** Google's own install command, as its download page gives it. */
const install = async (signal: AbortSignal): Promise<void> => {
  const { code, output } =
    process.platform === "win32"
      ? await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `irm ${INSTALLER_PS1} | iex`], { timeoutMs: INSTALL_TIMEOUT_MS, signal })
      : await run("bash", ["-c", `set -o pipefail; curl -fsSL ${INSTALLER_SH} | bash`], { timeoutMs: INSTALL_TIMEOUT_MS, signal });
  if (code !== 0 && !signal.aborted) throw new Error(lastLine(output) || "Google's Antigravity CLI didn't install.");
};

/** Finds a current `agy`, installing it with Google's installer, or updating one too old for Stella. */
const readyCli = async (signal: AbortSignal): Promise<string> => {
  if (!findAntigravityCli()) await install(signal);
  if (signal.aborted) throw canceled();
  const binary = findAntigravityCli();
  if (!binary) throw new Error("Google's Antigravity CLI didn't install.");
  let version = await versionOf(binary, signal);
  if (version && olderThan(version, MINIMUM_VERSION)) {
    await run(binary, ["update"], { timeoutMs: UPDATE_TIMEOUT_MS, signal });
    version = await versionOf(binary, signal);
  }
  if (signal.aborted) throw canceled();
  if (!version) throw new Error(`Google's Antigravity CLI at ${binary} doesn't start.`);
  if (olderThan(version, MINIMUM_VERSION)) {
    throw new Error(`Google's Antigravity CLI at ${binary} is version ${version}. Update it to ${MINIMUM_VERSION} or newer, then sign in again.`);
  }
  return binary;
};

const loginUrl = (output: string): string | undefined => {
  for (const candidate of output.match(/https:\/\/accounts\.google\.com\/\S+/gu) ?? []) {
    try {
      const url = new URL(candidate);
      if (url.origin === "https://accounts.google.com" && url.pathname.startsWith("/o/oauth2/") && url.searchParams.get("state")) return url.href;
    } catch {
      continue;
    }
  }
  return undefined;
};

/** What `agy acp --login` reads: the code Google's page shows, or that page's address. */
const loginAnswer = (pasted: string): string => {
  const value = pasted.trim();
  if (/^[\w./~-]{1,2048}$/u.test(value)) return value;
  try {
    const url = new URL(value);
    if (!/\s/u.test(value) && url.origin === "https://antigravity.google" && url.searchParams.get("code")) return value;
  } catch {}
  throw new Error("That isn't the code Google showed. Copy it from Google's page and paste it here.");
};

const waiting = new Map<string, { answer(code: string): void }>();

export const answerAntigravitySignIn = (loginId: string, pasted: string): void => {
  const login = waiting.get(loginId);
  if (!login) throw new Error("This Google sign-in ended. Start it again.");
  login.answer(loginAnswer(pasted));
};

const endChild = (child: ChildProcess) => {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
};

const ended = (child: ChildProcess): Promise<number | null> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve(child.exitCode);
    else {
      child.once("exit", (code) => resolve(code));
      child.once("error", () => resolve(null));
    }
  });

export const signInAntigravity = async (args: {
  loginId: string;
  home: string;
  signal: AbortSignal;
  onUrl(url: string): void;
}): Promise<void> => {
  const { loginId, home, signal } = args;
  const binary = await readyCli(signal);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const child = spawn(binary, ["acp", "--login", "--gemini-dir", home, "--app-data-dir", ANTIGRAVITY_APP_DATA_DIR, "--disable-telemetry"], {
    cwd: home,
    env: { ...process.env, ...antigravityCliEnv(home) },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const exit = ended(child);
  const abort = () => endChild(child);
  signal.addEventListener("abort", abort, { once: true });
  child.stdin.on("error", () => undefined);
  let output = "";
  let opened = false;
  let stopTimer = forkTimeoutFiber(URL_TIMEOUT_MS, abort);
  const collect = (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-16_000);
    const url = opened ? undefined : loginUrl(output);
    if (!url || !output.includes("paste the authorization code")) return;
    opened = true;
    stopTimer();
    waiting.set(loginId, {
      answer: (code) => {
        waiting.delete(loginId);
        output = "";
        stopTimer = forkTimeoutFiber(FINISH_TIMEOUT_MS, abort);
        child.stdin.write(`${code}\n`);
      },
    });
    args.onUrl(url);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  try {
    if (signal.aborted) abort();
    const code = await exit;
    if (signal.aborted) throw canceled();
    if (code !== 0 || !antigravityCliSignedIn(home)) {
      throw new Error(lastLine(output) || "Google didn't complete the sign-in. Start again.");
    }
  } finally {
    stopTimer();
    waiting.delete(loginId);
    signal.removeEventListener("abort", abort);
    endChild(child);
  }
};

/** Signs out through the CLI, then removes its stored sign-in if that is still there. */
export const signOutAntigravity = async (home: string): Promise<void> => {
  const binary = findAntigravityCli();
  if (binary && antigravityCliSignedIn(home)) {
    const child = spawn(binary, ["acp", "--gemini-dir", home, "--app-data-dir", ANTIGRAVITY_APP_DATA_DIR, "--disable-telemetry"], {
      cwd: home,
      env: { ...process.env, ...antigravityCliEnv(home) },
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const exit = ended(child);
    child.stdin.on("error", () => undefined);
    const send = (id: number, method: string, params: unknown) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const stopTimer = forkTimeoutFiber(LOGOUT_TIMEOUT_MS, () => endChild(child));
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const { id } = JSON.parse(line) as { id?: unknown };
          if (id === 1) send(2, "logout", {});
          if (id === 2) endChild(child);
        } catch {
          continue;
        }
      }
    });
    send(1, "initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "stella", title: "Stella", version: "1.0.0" },
    });
    await exit;
    stopTimer();
  }
  await rm(antigravityTokenFile(home), { force: true });
};

export const antigravityInstalled = (): boolean => {
  const binary = findAntigravityCli();
  return binary !== undefined && existsSync(binary);
};
