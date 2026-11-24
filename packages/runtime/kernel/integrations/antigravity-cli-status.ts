import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { antigravityModelsOf } from "@stella/contracts/engine-model-catalog";
import { forkTimeoutFiber } from "../cli/effect-runtime.js";

/**
 * Whether this computer is signed in to Google Antigravity, as Google's CLI
 * (`agy`) says itself. Where it keeps the sign-in (a file, the macOS Keychain)
 * is its own business and has changed between versions: Stella asks it over
 * ACP, which answers "Authentication required" to everything when signed out,
 * and remembers the answer beside the profile.
 */

export const ANTIGRAVITY_APP_DATA_DIR = "antigravity-acp";
const ASK_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 3_000;
/** How long an answer stands before a screen that shows it asks again. */
const SIGNED_IN_FRESH_MS = 5 * 60_000;
const SIGNED_OUT_FRESH_MS = 20_000;
const AUTH_REQUIRED = -32000;

export const ACP_INITIALIZE = {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: "stella", title: "Stella", version: "1.0.0" },
};

export const antigravityHomeFor = (dataDir: string): string =>
  process.env.STELLA_ANTIGRAVITY_CLI_HOME?.trim() || path.join(dataDir, "antigravity-cli", "default");

/** The environment every `agy` Stella starts gets: its own profile, no self-update, no browser. */
export const antigravityCliEnv = (home: string): Record<string, string> => ({
  GEMINI_HOME: home,
  AGY_CLI_DISABLE_AUTO_UPDATE: "1",
  // A sign-in prints Google's page and takes its code, as it does over SSH.
  SSH_CONNECTION: process.env.SSH_CONNECTION || "127.0.0.1 0 127.0.0.1 0",
  BROWSER: process.platform === "win32" ? "rem" : "true",
});

export const antigravityAcpArgs = (home: string): string[] => [
  "acp",
  "--gemini-dir",
  home,
  "--app-data-dir",
  ANTIGRAVITY_APP_DATA_DIR,
  "--disable-telemetry",
];

export type AntigravityCliAnswer =
  | { ok: true; signedIn: boolean; /** It has what Stella's turns need of it. */ usable: boolean }
  | { ok: false; problem: string };

type AcpReply = { id?: unknown; result?: any; error?: { code?: unknown; message?: unknown } };

/** Starts `agy acp`, makes these calls one after another, and ends it. Opens no session and runs no model. */
export const callAntigravityAcp = async (
  executable: string,
  home: string,
  calls: { method: string; params: unknown }[],
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = ASK_TIMEOUT_MS,
): Promise<{ replies: AcpReply[]; problem?: string }> => {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return await new Promise((resolve) => {
    const replies: AcpReply[] = [];
    let stderr = "";
    let settled = false;
    const child = spawn(executable, antigravityAcpArgs(home), {
      cwd: home,
      env: { ...env, ...antigravityCliEnv(home) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const finish = (problem?: string) => {
      if (settled) return;
      settled = true;
      stopTimer();
      const done = () => {
        stopClose();
        const detail = stderr.trim().split(/\r?\n/u).at(-1)?.slice(0, 300);
        resolve({ replies, ...(problem ? { problem: detail ? `${problem} ${detail}` : problem } : {}) });
      };
      // Closing its input lets it end by itself; killing it leaves a crash file on Windows.
      const stopClose = forkTimeoutFiber(CLOSE_TIMEOUT_MS, () => {
        child.kill("SIGTERM");
        done();
      });
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return done();
      child.once("exit", done);
      child.stdin.end();
    };
    const stopTimer = forkTimeoutFiber(timeoutMs, () => finish("didn't answer Stella in time."));
    const send = (index: number) => {
      const call = calls[index];
      if (!call) return finish();
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: index + 1, method: call.method, params: call.params })}\n`);
    };
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => finish(`can't be run (${error.message}).`));
    child.on("close", (code, signal) => finish(`ended (${signal ?? code}) before it answered Stella.`));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000);
    });
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: AcpReply & { method?: unknown };
        try {
          message = JSON.parse(line) as AcpReply & { method?: unknown };
        } catch {
          continue;
        }
        if (message.method !== undefined || message.id !== replies.length + 1) continue;
        replies.push(message);
        send(replies.length);
      }
    });
    send(0);
  });
};

export const isAntigravityAuthRequired = (error: unknown): boolean => {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return Number(code) === AUTH_REQUIRED || /authentication required/iu.test(String(message ?? ""));
};

/** What this `agy` says about this profile's sign-in. */
export const askAntigravityCli = async (
  executable: string,
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AntigravityCliAnswer> => {
  const { replies, problem } = await callAntigravityAcp(
    executable,
    home,
    [
      { method: "initialize", params: ACP_INITIALIZE },
      { method: "session/list", params: { cwd: home } },
    ],
    env,
  );
  const [initialized, listed] = replies;
  if (!initialized || !listed) return { ok: false, problem: problem ?? "didn't answer Stella." };
  if (initialized.error) return { ok: false, problem: `refused Stella: ${String(initialized.error.message ?? "")}` };
  const capabilities = initialized.result?.agentCapabilities;
  const usable = capabilities?._meta?.antigravity?.systemPrompt?.append === true && Boolean(capabilities?.sessionCapabilities?.resume);
  if (!listed.error) return { ok: true, signedIn: true, usable };
  if (isAntigravityAuthRequired(listed.error)) return { ok: true, signedIn: false, usable };
  return { ok: false, problem: `answered Stella with "${String(listed.error.message ?? "an error")}".` };
};

type SignInRecord = {
  signedIn: boolean;
  at: number;
  /** When Stella last signed this computer out: what was running then must close. */
  signedOutAt?: number;
};

export const antigravitySignInRecordFile = (home: string): string => path.join(home, "stella-sign-in.json");

const readRecord = (home: string): SignInRecord | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(antigravitySignInRecordFile(home), "utf8")) as SignInRecord;
    return typeof parsed?.signedIn === "boolean" && typeof parsed.at === "number" ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const writeJson = (file: string, value: unknown): void => {
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    console.warn("[antigravity-cli] couldn't write", { file: path.basename(file), error: error instanceof Error ? error.message : String(error) });
  }
};

const writeRecord = (home: string, record: SignInRecord): void => writeJson(antigravitySignInRecordFile(home), record);

type ModelsRecord = {
  /** The account's Gemini models, as `agy` last reported them. */
  models: string[];
  /** Removed models the user has been told about. */
  told: string[];
};

const modelsFile = (home: string): string => path.join(home, "stella-models.json");

const readModels = (home: string): ModelsRecord => {
  try {
    const parsed = JSON.parse(readFileSync(modelsFile(home), "utf8")) as Partial<ModelsRecord>;
    return {
      models: antigravityModelsOf(parsed?.models),
      told: Array.isArray(parsed?.told) ? parsed.told.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return { models: [], told: [] };
  }
};

/** The Gemini models `agy` last reported for the account signed in here; none until a first turn. */
export const knownAntigravityModels = (home: string): string[] => readModels(home).models;

export const noteAntigravityModels = (home: string, reported: readonly string[]): void => {
  const models = antigravityModelsOf(reported);
  const last = readModels(home);
  if (models.length === 0 || models.join() === last.models.join()) return;
  writeJson(modelsFile(home), { ...last, models });
};

/** Whether the user still has to hear that this model is gone; true once. */
export const claimAntigravityRemovalNotice = (home: string, model: string): boolean => {
  const last = readModels(home);
  if (last.told.includes(model)) return false;
  writeJson(modelsFile(home), { ...last, told: [...last.told, model].slice(-50) });
  return true;
};

/** Where `agy` before 1.5.16, and later ones off macOS, keep a sign-in: the only trace of one made before Stella kept a record. */
export const antigravityTokenFile = (home: string): string => path.join(home, ANTIGRAVITY_APP_DATA_DIR, "antigravity-oauth-token");

/** The last answer, without asking. */
export const knownAntigravitySignIn = (home: string): boolean => readRecord(home)?.signedIn ?? existsSync(antigravityTokenFile(home));

export const noteAntigravitySignIn = (home: string, signedIn: boolean): void => {
  const last = readRecord(home);
  if (last?.signedIn === signedIn && Date.now() - last.at < 10_000) return;
  const signedOutAt = last?.signedOutAt;
  writeRecord(home, { signedIn, at: Date.now(), ...(signedOutAt ? { signedOutAt } : {}) });
};

export const noteAntigravitySignedOut = (home: string): void => {
  writeRecord(home, { signedIn: false, at: Date.now(), signedOutAt: Date.now() });
  // The next account may have other models.
  const last = readModels(home);
  if (last.models.length > 0) writeJson(modelsFile(home), { ...last, models: [] });
};

export const antigravitySignedOutSince = (home: string, since: number): boolean => (readRecord(home)?.signedOutAt ?? 0) >= since;

const asking = new Map<string, Promise<boolean>>();

/** Asks `agy`; an `agy` that can't say leaves the last answer standing. */
export const refreshAntigravitySignIn = (home: string, executable: () => Promise<string | undefined>): Promise<boolean> => {
  const running = asking.get(home);
  if (running) return running;
  const ask = (async () => {
    const binary = await executable();
    if (!binary) return knownAntigravitySignIn(home);
    const started = Date.now();
    const answer = await askAntigravityCli(binary, home);
    if (!answer.ok) {
      console.warn("[antigravity-cli] couldn't check the sign-in", { problem: answer.problem });
      return knownAntigravitySignIn(home);
    }
    // Signed out while it was answering: that stands.
    if (antigravitySignedOutSince(home, started)) return false;
    noteAntigravitySignIn(home, answer.signedIn);
    return answer.signedIn;
  })().finally(() => asking.delete(home));
  asking.set(home, ask);
  return ask;
};

/** The sign-in for a screen or a turn: the last answer while it's fresh, else a new one. */
export const currentAntigravitySignIn = async (home: string, executable: () => Promise<string | undefined>): Promise<boolean> => {
  const record = readRecord(home);
  if (record && Date.now() - record.at < (record.signedIn ? SIGNED_IN_FRESH_MS : SIGNED_OUT_FRESH_MS)) return record.signedIn;
  return await refreshAntigravitySignIn(home, executable);
};
