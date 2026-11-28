import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { forkTimeoutFiber } from "../cli/effect-runtime.js";
import { antigravityCliExecutable, antigravityCliKeeper, findAntigravityCli } from "./antigravity-cli-install.js";
import {
  ACP_INITIALIZE,
  antigravityAcpArgs,
  antigravityCliEnv,
  antigravityTokenFile,
  askAntigravityCli,
  callAntigravityAcp,
  currentAntigravitySignIn,
  noteAntigravitySignedOut,
  noteAntigravitySignIn,
} from "./antigravity-cli-status.js";

const URL_TIMEOUT_MS = 45_000;
const FINISH_TIMEOUT_MS = 60_000;
const TURNS_CLOSE_MS = 2_500;

const canceled = () => new Error("Google sign-in was canceled.");

const lastLine = (output: string): string =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("http"))
    .at(-1) ?? "";

const readyCli = async (signal: AbortSignal): Promise<string> => {
  const found = await antigravityCliKeeper.inspect();
  if (signal.aborted) throw canceled();
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
  const already = await askAntigravityCli(binary, home);
  if (signal.aborted) throw canceled();
  if (already.ok && already.signedIn) return noteAntigravitySignIn(home, true);
  const child = spawn(binary, [...antigravityAcpArgs(home), "--login"], {
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
    if (code === 0) {
      const answer = /^logged in as /imu.test(output) ? undefined : await askAntigravityCli(binary, home);
      if (!answer || (answer.ok && answer.signedIn)) return noteAntigravitySignIn(home, true);
    }
    throw new Error(lastLine(output) || "Google didn't complete the sign-in. Start again.");
  } finally {
    stopTimer();
    waiting.delete(loginId);
    signal.removeEventListener("abort", abort);
    endChild(child);
  }
};

export const signOutAntigravity = async (home: string): Promise<void> => {
  noteAntigravitySignedOut(home);
  await new Promise<void>((resolve) => void forkTimeoutFiber(TURNS_CLOSE_MS, resolve));
  const { executable } = await antigravityCliKeeper.select({ repair: "wait" });
  const { replies, problem } = await callAntigravityAcp(executable, home, [
    { method: "initialize", params: ACP_INITIALIZE },
    { method: "logout", params: {} },
  ]);
  await rm(antigravityTokenFile(home), { force: true });
  const answer = await askAntigravityCli(executable, home);
  if (answer.ok && !answer.signedIn) return;
  if (answer.ok) noteAntigravitySignIn(home, true);
  const why = problem ?? (replies[1]?.error ? String(replies[1].error.message ?? "") : answer.ok ? "" : answer.problem);
  throw new Error(`Gemini couldn't sign out. Try again.${why ? ` (${why})` : ""}`);
};

export const antigravityInstalled = (): boolean => findAntigravityCli() !== undefined;

export const antigravitySignedIn = (home: string): Promise<boolean> => currentAntigravitySignIn(home, antigravityCliExecutable);
