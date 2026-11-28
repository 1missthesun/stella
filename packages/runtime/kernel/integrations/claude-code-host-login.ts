// Hands Claude Code its claude.ai login on macOS instead of letting it look the login up itself.
//
// Claude Code finds its macOS login through the user's Keychain search list, so a wrong search
// list (or default keychain) makes every login read "Not logged in" although nothing was signed
// out. Stella reads the stored login by explicit path (claude-login-store.ts) and gives Claude
// Code the access token on a private pipe (file descriptor 3, which Claude Code reads once and
// closes over; never the command line or the environment). While the process lives, Stella
// renews the login before the token ends, under Claude Code's own refresh lock, writes the
// renewal back by explicit path, and pushes the new token into the process over its stdin
// (`update_environment_variables`, which Claude Code withholds from the commands it runs). A
// refused request makes Claude Code wait for a pushed token, and its `api_retry` notice tells
// Stella to send one.
//
// Only access tokens reach Claude Code; the refresh token stays where it is stored. A config
// folder with no usable stored login runs Claude Code as before, so its own messages (and
// Stella's sign-in handling) still apply.

import crypto from "node:crypto";
import type { Writable } from "node:stream";
import {
  readClaudeLogin,
  renewClaudeLogin,
  writeClaudeLogin,
  type ClaudeStoredLogin,
} from "@stella/node-shared/integrations/claude-login-store.js";
import { forkDelayed, sleep } from "@stella/node-shared/shared/effect-timers.js";

/** The descriptor Claude Code reads its token from (`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`). */
export const CLAUDE_HOST_LOGIN_FD = 3;
/** Renew a login whose access token ends within this. */
const RENEW_BEFORE_END_MS = 10 * 60_000;
/** Once a process's token is due, look for a newer one this often. */
const RECHECK_MS = 60_000;
/** A second look after a refused request, for a renewal another process is still finishing. */
const REFUSED_RECHECK_MS = 15_000;
/** How long a refused request waits for Stella's pushed token before it fails. */
const REFUSED_WAIT_MS = 60_000;
/** Stored logins are read at most this often per config folder (turn starts share one read). */
const READ_CACHE_MS = 10_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

type Account = {
  read?: { at: number; promise: Promise<ClaudeStoredLogin | null> };
  renewing?: Promise<ClaudeStoredLogin | null>;
  /** A renewal Anthropic issued that could not be written back yet. */
  unsaved?: { login: ClaudeStoredLogin; spentRefreshToken: string };
};

const accounts = new Map<string, Account>();
const keyOf = (configDir: string | null) => configDir ?? "";
const accountFor = (configDir: string | null): Account => {
  const key = keyOf(configDir);
  let account = accounts.get(key);
  if (!account) {
    account = {};
    accounts.set(key, account);
  }
  return account;
};

const label = (configDir: string | null) => (configDir ? configDir.split("/").filter(Boolean).at(-1) : "default");

const expiresAtOf = (login: ClaudeStoredLogin): number | undefined =>
  typeof login.oauth.expiresAt === "number" && Number.isFinite(login.oauth.expiresAt) ? login.oauth.expiresAt : undefined;

const hasRefreshToken = (login: ClaudeStoredLogin) =>
  typeof login.oauth.refreshToken === "string" && login.oauth.refreshToken.length > 0;

/** A login Claude Code could run on now, or after a renewal. */
const usable = (login: ClaudeStoredLogin, now = Date.now()): boolean => {
  if (login.oauth.loginEnded !== undefined) return false;
  const loginEnd = login.oauth.refreshTokenExpiresAt;
  if (typeof loginEnd === "number" && loginEnd <= now) return false;
  const expiresAt = expiresAtOf(login);
  return hasRefreshToken(login) || expiresAt === undefined || expiresAt > now;
};

const readStored = async (configDir: string | null, fresh: boolean): Promise<ClaudeStoredLogin | null> => {
  const account = accountFor(configDir);
  const now = Date.now();
  if (!fresh && account.read && now - account.read.at < READ_CACHE_MS) return await account.read.promise;
  const promise = (async () => {
    const stored = await readClaudeLogin(configDir).catch(() => null);
    const unsaved = account.unsaved;
    if (!unsaved) return stored;
    // Still the login whose refresh token the unsaved renewal spent: put the renewal back.
    if (stored && stored.oauth.refreshToken === unsaved.spentRefreshToken) {
      try {
        await writeClaudeLogin({ ...unsaved.login, source: stored.source });
        account.unsaved = undefined;
      } catch {}
      return unsaved.login;
    }
    // Something else stored a login since (a new sign-in): it wins.
    account.unsaved = undefined;
    return stored;
  })();
  account.read = { at: now, promise };
  return await promise;
};

/**
 * Renews the stored login when it has a refresh token. `heldAccessToken` is the
 * token the asker already has: a stored login with another one counts as renewed.
 */
const renew = (configDir: string | null, heldAccessToken: string | null): Promise<ClaudeStoredLogin | null> => {
  const account = accountFor(configDir);
  if (account.renewing) return account.renewing;
  const run = (async () => {
    const stored = await readStored(configDir, true);
    if (!stored) return null;
    if (heldAccessToken !== null && stored.oauth.accessToken !== heldAccessToken) return stored;
    if (!hasRefreshToken(stored)) return stored;
    if (account.unsaved) return stored;
    const outcome = await renewClaudeLogin(configDir, stored.oauth.accessToken);
    if (!outcome.ok) {
      console.warn(`[claude-login] renewing the Claude login for ${label(configDir)} didn't work: ${outcome.detail}`);
      return stored;
    }
    if (outcome.unsaved) {
      console.warn(`[claude-login] the renewed Claude login for ${label(configDir)} couldn't be saved; keeping it in memory`);
      account.unsaved = { login: outcome.login, spentRefreshToken: stored.oauth.refreshToken! };
    }
    account.read = { at: Date.now(), promise: Promise.resolve(outcome.login) };
    return outcome.login;
  })().finally(() => {
    if (account.renewing === run) account.renewing = undefined;
  });
  account.renewing = run;
  return run;
};

/** The stored login, renewed first when its access token is about to end. */
const currentLogin = async (configDir: string | null, fresh = false): Promise<ClaudeStoredLogin | null> => {
  const stored = await readStored(configDir, fresh);
  if (!stored || !usable(stored)) return stored;
  const expiresAt = expiresAtOf(stored);
  if (expiresAt !== undefined && expiresAt - Date.now() < RENEW_BEFORE_END_MS && hasRefreshToken(stored)) {
    return (await renew(configDir, stored.oauth.accessToken)) ?? stored;
  }
  return stored;
};

export type ClaudeHostLogin = {
  /** Environment for the Claude Code process: where to read the token, how long to wait for a new one, its plan. */
  env: Record<string, string>;
  /** The spawn's `stdio`: Claude Code's three streams and the token's pipe. */
  stdio: ["pipe", "pipe", "pipe", "pipe"];
  /** Writes the token to the spawned process's descriptor 3 and closes it. */
  handOver(pipe: Writable | null | undefined): void;
  /** Starts keeping the process's token fresh; `write` sends one stream-json line to its stdin. */
  attach(write: (line: string) => void): void;
  /** Reads one stdout event: true when it was the answer to a pushed token (nothing else to do with it). */
  handle(event: Record<string, unknown>): boolean;
  /** Before a turn on a process that is already running: push a newer stored token, if there is one. */
  sync(): Promise<void>;
  close(): void;
};

/**
 * The login to hand to a Claude Code process for this config folder (the exact
 * string Claude Code gets as `CLAUDE_CONFIG_DIR`; null for its default), or null
 * to let Claude Code find it itself: off macOS, or with no usable stored login.
 */
export const prepareClaudeHostLogin = async (configDir: string | null): Promise<ClaudeHostLogin | null> => {
  if (process.platform !== "darwin") return null;
  const first = await currentLogin(configDir).catch(() => null);
  if (!first || !usable(first)) return null;
  let held = first.oauth.accessToken;
  let heldExpiresAt = expiresAtOf(first);
  let write: ((line: string) => void) | null = null;
  let cancelTimer: (() => void) | null = null;
  let closed = false;
  const pushIds = new Set<string>();

  const push = (login: ClaudeStoredLogin | null): boolean => {
    if (closed || !write || !login || !usable(login) || login.oauth.accessToken === held) return false;
    held = login.oauth.accessToken;
    heldExpiresAt = expiresAtOf(login);
    const requestId = `stella-login-${crypto.randomUUID()}`;
    pushIds.add(requestId);
    write(
      JSON.stringify({
        type: "update_environment_variables",
        variables: { CLAUDE_CODE_OAUTH_TOKEN: login.oauth.accessToken },
        request_id: requestId,
      }),
    );
    schedule();
    return true;
  };

  const schedule = () => {
    cancelTimer?.();
    cancelTimer = null;
    if (closed || heldExpiresAt === undefined) return;
    const wait = Math.max(heldExpiresAt - RENEW_BEFORE_END_MS - Date.now(), RECHECK_MS);
    cancelTimer = forkDelayed(Math.min(wait, MAX_TIMER_MS), () => void due());
  };

  const due = async () => {
    if (closed) return;
    const next = await currentLogin(configDir, true).catch(() => null);
    if (!push(next)) schedule();
  };

  const refused = async () => {
    if (closed) return;
    // The token Claude Code holds was refused: a newer stored one, or a renewal of it.
    if (push(await renew(configDir, held).catch(() => null))) return;
    await sleep(REFUSED_RECHECK_MS);
    if (!closed) push(await readStored(configDir, true).catch(() => null));
  };

  return {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: String(CLAUDE_HOST_LOGIN_FD),
      CLAUDE_CODE_OAUTH_401_WAIT_MS: String(REFUSED_WAIT_MS),
      // What Claude Code would read from the stored login; a handed-over token carries no plan.
      ...(typeof first.oauth.subscriptionType === "string" && first.oauth.subscriptionType
        ? { CLAUDE_CODE_SUBSCRIPTION_TYPE: first.oauth.subscriptionType }
        : {}),
      ...(typeof first.oauth.rateLimitTier === "string" && first.oauth.rateLimitTier
        ? { CLAUDE_CODE_RATE_LIMIT_TIER: first.oauth.rateLimitTier }
        : {}),
    },
    stdio: ["pipe", "pipe", "pipe", "pipe"],
    handOver(pipe) {
      if (!pipe) return;
      pipe.on("error", () => undefined);
      pipe.end(`${first.oauth.accessToken}\n`);
    },
    attach(writeLine) {
      write = writeLine;
      schedule();
    },
    handle(event) {
      if (event.type === "control_response") {
        const response = event.response as { request_id?: unknown } | undefined;
        const id = typeof response?.request_id === "string" ? response.request_id : "";
        if (!pushIds.has(id)) return false;
        pushIds.delete(id);
        return true;
      }
      if (event.type === "system" && event.subtype === "api_retry" && event.error_status === 401) {
        void refused();
      }
      return false;
    },
    async sync() {
      if (closed) return;
      push(await currentLogin(configDir).catch(() => null));
    },
    close() {
      closed = true;
      write = null;
      cancelTimer?.();
      cancelTimer = null;
    },
  };
};
