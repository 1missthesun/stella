import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { forkTimeoutFiber } from "../cli/effect-runtime.js";
import {
  ANTIGRAVITY_APP_DATA_DIR,
  antigravityCliEnv,
  antigravityCliSignedIn,
  antigravityTokenFile,
} from "./antigravity-cli-acp.js";
import { antigravityCliKeeper, findAntigravityCli } from "./antigravity-cli-install.js";

/**
 * Signing in to Google Antigravity with Google's own login command
 * (`agy acp --login`): it prints Google's page, the person signs in there, and
 * the CLI reads the code that page shows. The CLI stores the sign-in; Stella
 * never reads it.
 */
const URL_TIMEOUT_MS = 45_000;
const FINISH_TIMEOUT_MS = 60_000;
const LOGOUT_TIMEOUT_MS = 20_000;

const canceled = () => new Error("Google sign-in was canceled.");

const lastLine = (output: string): string =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("http"))
    .at(-1) ?? "";

/** A current `agy` that starts, installed, updated or repaired first as needed. */
const readyCli = async (signal: AbortSignal): Promise<string> => {
  const found = await antigravityCliKeeper.inspect();
  if (signal.aborted) throw canceled();
  // Someone is waiting on this, so a repair that just failed is tried again.
  if (found && !found.check.ok) await antigravityCliKeeper.repair(found.install, { force: true });
  if (signal.aborted) throw canceled();
  return (await antigravityCliKeeper.select({ repair: "wait", signal })).executable;
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

export const antigravityInstalled = (): boolean => findAntigravityCli() !== undefined;
