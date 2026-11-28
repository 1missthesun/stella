// Claude Code's stored claude.ai login for one config folder, read and renewed the way Claude
// Code does, but addressing the Keychain by explicit path. Claude Code itself finds its macOS
// login through the user's Keychain search list and writes renewals to the default keychain, so
// a wrong search list or default keychain makes every login read as signed out although nothing
// was signed out. Stella reads the login here and hands Claude Code the access token instead
// (claude-code-host-login.ts in the runtime), so its runs never depend on that setting.
//
// Secrets only travel through stdin, stdout and memory: never a command line, an environment
// variable, a log line or a new file. A renewal is written back to where the login was read from
// (the same keychain, or Claude Code's own credentials file when that is where it lives).

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { forkDelayed, forkEvery, sleep } from "../shared/effect-timers.js";

const SECURITY = "/usr/bin/security";
const SECURITY_TIMEOUT_MS = 10_000;
const ITEM_NOT_FOUND = 44;
/** `security -i` reads one command per line and drops longer lines; Claude Code keeps under 4032. */
const SECURITY_LINE_LIMIT = 4_000;
const TOKEN_URL = ["https://platform.claude.com", "v1", "oauth", "token"].join("/");
const DEFAULT_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const DEFAULT_SCOPES = ["user:inference", "user:profile", "user:sessions:claude_code"];
const REFRESH_TIMEOUT_MS = 30_000;
/** Claude Code's refresh lock (proper-lockfile): stale after 60 s, kept fresh every 5 s. */
const LOCK_STALE_MS = 60_000;
const LOCK_UPDATE_MS = 5_000;
const LOCK_ATTEMPTS = 20;

/** The `claudeAiOauth` block, with every field Claude Code keeps beside the tokens. */
export type ClaudeOAuthRecord = Record<string, unknown> & {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
  clientId?: string;
};

export type ClaudeLoginSource =
  | { kind: "keychain"; keychain: string; service: string; account: string }
  | { kind: "file"; file: string };

export type ClaudeStoredLogin = {
  oauth: ClaudeOAuthRecord;
  /** The whole stored value, so a write keeps what Claude Code keeps beside the login. */
  document: Record<string, unknown>;
  source: ClaudeLoginSource;
};

export type ClaudeLoginRenewal =
  /** `unsaved`: renewed, but writing it back failed; the old refresh token is spent. */
  | { ok: true; login: ClaudeStoredLogin; unsaved?: true }
  /** Anthropic refused the refresh token: only signing in again helps. */
  | { ok: false; refused: true; detail: string }
  /** Anything else (offline, 5xx, a busy lock, a write that failed): try again later. */
  | { ok: false; refused: false; detail: string };

/**
 * The folder Claude Code takes as its config folder: the one Stella passes, else
 * `CLAUDE_CONFIG_DIR` from the environment, else null for its default (~/.claude).
 */
export const effectiveClaudeConfigDir = (
  configDir: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null => configDir || env.CLAUDE_CONFIG_DIR || null;

/** Claude Code's item name: suffixed with the exact config folder string's hash when one is set. */
export const claudeCredentialsService = (configDir: string | null): string =>
  configDir
    ? `Claude Code-credentials-${createHash("sha256").update(configDir.normalize("NFC")).digest("hex").slice(0, 8)}`
    : "Claude Code-credentials";

/** The account name Claude Code files its item under. */
export const claudeCredentialsAccount = (env: NodeJS.ProcessEnv = process.env): string => {
  let name: string;
  try {
    name = env.USER || os.userInfo().username;
  } catch {
    name = "claude-code-user";
  }
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : "claude-code-user";
};

const claudeDataDir = (configDir: string | null): string => configDir ?? path.join(os.homedir(), ".claude");

let accountHome: string | null | undefined;
/**
 * The account's home folder from the user database, not `$HOME`: a sandbox or
 * test may point `$HOME` elsewhere, and Bun's `os.userInfo().homedir` follows it.
 */
export const accountHomeDir = (): string | null => {
  if (accountHome !== undefined) return accountHome;
  accountHome = null;
  if (process.platform === "darwin") {
    const result = spawnSync("/usr/bin/id", ["-P"], { encoding: "utf8", timeout: 5_000 });
    const home = result.status === 0 ? result.stdout.trim().split(":")[8] : undefined;
    if (home && path.isAbsolute(home)) accountHome = home;
  }
  if (accountHome === null) {
    try {
      accountHome = os.userInfo().homedir || null;
    } catch {
      accountHome = null;
    }
  }
  return accountHome;
};

/** The user's login keychain file, found by path rather than through the search list. */
export const loginKeychainPath = (): string | null => {
  const home = accountHomeDir();
  if (!home) return null;
  for (const name of ["login.keychain-db", "login.keychain"]) {
    const candidate = path.join(home, "Library", "Keychains", name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const runSecurity = (
  args: string[],
  input?: string,
): Promise<{ code: number | null; stdout: string }> =>
  new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(SECURITY, args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    } catch {
      resolve({ code: -1, stdout: "" });
      return;
    }
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    const cancelKill = forkDelayed(SECURITY_TIMEOUT_MS, () => child.kill());
    child.once("error", () => {
      cancelKill();
      resolve({ code: -1, stdout: "" });
    });
    child.once("close", (code) => {
      cancelKill();
      resolve({ code, stdout });
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input ?? "");
  });

const parseDocument = (raw: string): Record<string, unknown> | null => {
  const text = raw.trim();
  if (!text) return null;
  for (const candidate of [text, /^[0-9a-f]+$/i.test(text) ? Buffer.from(text, "hex").toString("utf8") : null]) {
    if (candidate === null) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {}
  }
  return null;
};

const oauthOf = (document: Record<string, unknown>): ClaudeOAuthRecord | null => {
  const oauth = document.claudeAiOauth;
  if (!oauth || typeof oauth !== "object" || Array.isArray(oauth)) return null;
  const record = oauth as Record<string, unknown>;
  if (typeof record.accessToken !== "string" || !record.accessToken) return null;
  return record as ClaudeOAuthRecord;
};

const fromKeychain = async (
  keychain: string,
  service: string,
  account: string,
): Promise<ClaudeStoredLogin | null | "unreadable"> => {
  const { code, stdout } = await runSecurity(["find-generic-password", "-a", account, "-w", "-s", service, keychain]);
  if (code === ITEM_NOT_FOUND) return null;
  if (code !== 0) return "unreadable";
  const document = parseDocument(stdout);
  const oauth = document ? oauthOf(document) : null;
  return document && oauth ? { oauth, document, source: { kind: "keychain", keychain, service, account } } : null;
};

/** The keychain an ordinary lookup finds the item in (attributes only: no secret is read). */
const keychainOnSearchList = async (service: string, account: string): Promise<string | null> => {
  const { code, stdout } = await runSecurity(["find-generic-password", "-a", account, "-s", service]);
  if (code !== 0) return null;
  const match = /^keychain: "(\/[^"\n]+)"/m.exec(stdout);
  return match?.[1] ?? null;
};

/**
 * The login Claude Code holds for this config folder, wherever it keeps it: on
 * macOS the login keychain (by path), then any keychain an ordinary lookup
 * reaches, then Claude Code's plaintext fallback file; elsewhere that file.
 * Null when there is no login (or one Claude Code marked ended).
 */
export const readClaudeLogin = async (
  configDir: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClaudeStoredLogin | null> => {
  if (process.platform === "darwin") {
    const service = claudeCredentialsService(configDir);
    const account = claudeCredentialsAccount(env);
    const login = loginKeychainPath();
    if (login) {
      const found = await fromKeychain(login, service, account);
      if (found && found !== "unreadable") return found;
    }
    const elsewhere = await keychainOnSearchList(service, account);
    if (elsewhere && elsewhere !== login) {
      const found = await fromKeychain(elsewhere, service, account);
      if (found && found !== "unreadable") return found;
    }
  }
  const file = path.join(claudeDataDir(configDir), ".credentials.json");
  let raw: string;
  try {
    raw = await fs.promises.readFile(file, "utf8");
  } catch {
    return null;
  }
  const document = parseDocument(raw);
  const oauth = document ? oauthOf(document) : null;
  return document && oauth ? { oauth, document, source: { kind: "file", file } } : null;
};

const serialize = (document: Record<string, unknown>): string =>
  // Claude Code keeps the item ASCII (it escapes the rest) so `security -X` hex round-trips.
  JSON.stringify(document).replace(/[^\x20-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

const keychainWriteLine = (source: Extract<ClaudeLoginSource, { kind: "keychain" }>, value: string): string =>
  `add-generic-password -U -a "${source.account}" -s "${source.service}" -X "${Buffer.from(value, "utf8").toString("hex")}" "${source.keychain}"\n`;

/** Whether a renewed login could be written back where it came from without a command-line argument. */
const canWriteBack = (login: ClaudeStoredLogin): boolean => {
  if (login.source.kind === "file") return true;
  // A renewal adds at most a few hundred characters: leave room for them.
  return keychainWriteLine(login.source, serialize(login.document)).length + 1_200 < SECURITY_LINE_LIMIT;
};

export const writeClaudeLogin = async (login: ClaudeStoredLogin): Promise<void> => {
  const value = serialize(login.document);
  if (login.source.kind === "keychain") {
    const line = keychainWriteLine(login.source, value);
    if (line.length >= SECURITY_LINE_LIMIT) throw new Error("The Claude login is too long to write back to the Keychain.");
    const { code } = await runSecurity(["-i"], line);
    if (code !== 0) throw new Error(`The Keychain refused the renewed Claude login (exit ${code}).`);
    return;
  }
  const target = login.source.file;
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temp, value, { mode: 0o600 });
  await fs.promises.rename(temp, target);
};

type HeldLock = { release: () => Promise<void> };

const lockOnce = async (lockPath: string): Promise<boolean> => {
  try {
    await fs.promises.mkdir(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  try {
    const stat = await fs.promises.stat(lockPath);
    if (Date.now() - stat.mtimeMs <= LOCK_STALE_MS) return false;
    await fs.promises.rm(lockPath, { recursive: true, force: true });
    await fs.promises.mkdir(lockPath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Claude Code's own refresh lock for this config folder (`.oauth_refresh.lock`
 * inside it and the older `<folder>.lock` beside it), so Stella and a Claude
 * Code using the same login never spend one refresh token twice.
 */
const takeRefreshLock = async (configDir: string | null): Promise<HeldLock | null> => {
  const dir = claudeDataDir(configDir);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => undefined);
  let real = dir;
  try {
    real = await fs.promises.realpath(dir);
  } catch {}
  const locks = [path.join(dir, ".oauth_refresh.lock"), `${real}.lock`];
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const held: string[] = [];
    let busy = false;
    for (const lock of locks) {
      if (await lockOnce(lock).catch(() => false)) held.push(lock);
      else {
        busy = true;
        break;
      }
    }
    if (!busy) {
      const stopTouching = forkEvery(LOCK_UPDATE_MS, () => {
        const now = new Date();
        for (const lock of held) void fs.promises.utimes(lock, now, now).catch(() => undefined);
      });
      return {
        release: async () => {
          stopTouching();
          for (const lock of held.reverse()) await fs.promises.rm(lock, { recursive: true, force: true }).catch(() => undefined);
        },
      };
    }
    for (const lock of held.reverse()) await fs.promises.rm(lock, { recursive: true, force: true }).catch(() => undefined);
    await sleep(1_000 + Math.random() * 1_000);
  }
  return null;
};

const postRefresh = async (
  oauth: ClaudeOAuthRecord,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; refused: boolean; detail: string }> => {
  const scopes = Array.isArray(oauth.scopes) && oauth.scopes.length > 0 ? oauth.scopes : DEFAULT_SCOPES;
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: oauth.refreshToken,
        client_id: typeof oauth.clientId === "string" && oauth.clientId ? oauth.clientId : DEFAULT_CLIENT_ID,
        scope: scopes.join(" "),
      }),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, refused: false, detail: error instanceof Error ? error.name : "network" };
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (response.status === 400 || response.status === 401) {
    const code = typeof body.error === "string" ? body.error : `http_${response.status}`;
    return { ok: false, refused: code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client", detail: code };
  }
  if (!response.ok || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    return { ok: false, refused: false, detail: `http_${response.status}` };
  }
  return { ok: true, body };
};

/**
 * Renews the login stored for this config folder with its refresh token, under
 * Claude Code's lock, and writes it back where it was read from. When another
 * process renewed it meanwhile, that login is returned instead. `heldAccessToken`
 * is the token the caller holds: a stored login with a different one is newer.
 */
export const renewClaudeLogin = async (
  configDir: string | null,
  heldAccessToken: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClaudeLoginRenewal> => {
  const lock = await takeRefreshLock(configDir).catch(() => null);
  if (!lock) return { ok: false, refused: false, detail: "lock_busy" };
  try {
    const current = await readClaudeLogin(configDir, env);
    if (!current) return { ok: false, refused: true, detail: "no_login" };
    if (heldAccessToken !== null && current.oauth.accessToken !== heldAccessToken) return { ok: true, login: current };
    if (typeof current.oauth.refreshToken !== "string" || !current.oauth.refreshToken) {
      return { ok: false, refused: false, detail: "no_refresh_token" };
    }
    if (!canWriteBack(current)) return { ok: false, refused: false, detail: "too_long_to_write_back" };
    const answer = await postRefresh(current.oauth);
    if (!answer.ok) return { ok: false, refused: answer.refused, detail: answer.detail };
    const now = Date.now();
    const body = answer.body;
    const oauth: ClaudeOAuthRecord = {
      ...current.oauth,
      accessToken: body.access_token as string,
      refreshToken:
        typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : current.oauth.refreshToken,
      expiresAt: now + (body.expires_in as number) * 1000,
      ...(typeof body.refresh_token_expires_in === "number" && body.refresh_token_expires_in > 0
        ? { refreshTokenExpiresAt: now + body.refresh_token_expires_in * 1000 }
        : {}),
      ...(typeof body.scope === "string" && body.scope.trim() ? { scopes: body.scope.trim().split(/\s+/) } : {}),
    };
    const renewed: ClaudeStoredLogin = { ...current, oauth, document: { ...current.document, claudeAiOauth: oauth } };
    try {
      await writeClaudeLogin(renewed);
    } catch {
      // The old refresh token is spent: hand back the renewal so the caller can
      // keep using it and write it again, rather than losing the login.
      return { ok: true, login: renewed, unsaved: true };
    }
    return { ok: true, login: renewed };
  } finally {
    await lock.release();
  }
};
