// Claude logins stay in each place's own Claude Code CLI; this domain keeps
// only identities. ChatGPT tokens leave it only through `credentials.chatgpt`.

import {
  isLegacyCloudExecution,
  type AgentModelReasoningEffort,
  type CloudExecutionSelection,
  type LegacyCloudExecutionSelection,
} from "@stella/contracts/agent-engine";
import { isAccountProviderId } from "@stella/contracts/backend/providers";
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_LEVELS,
  normalizeReasoningEffortLevel,
} from "@stella/contracts/reasoning-effort";
import { CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE } from "@stella/contracts/backend/billing";
import { cloudSandboxAccess } from "./billing.js";
import {
  CHATGPT_SIWC,
  CHATGPT_UNUSABLE_REFRESH_CODES,
  ChatGptError,
  chatGptAuthorizeUrl,
  chatGptLoopbackRedirectUri,
  createChatGptHostId,
  hasChatGptPlanUsage,
  isChatGptHostId,
  isIssuedChatGptClientId,
  parseChatGptCallback,
  type ChatGptCallback,
  type ChatGptRegistration,
  type ChatGptTokenSet,
} from "@stella/contracts/chatgpt-siwc";
import {
  chatGptDiscovery,
  completeChatGptSignIn,
  createChatGptPendingSignIn,
  listChatGptModels,
  refreshChatGptTokens,
  revokeChatGptRefreshToken,
} from "@stella/contracts/chatgpt-siwc-flows";
import {
  ENGINE_PROVIDERS,
  type ChatGptSharedRegistration,
  type ClaudeLoginPlace,
  type ClaudeOverview,
  type ClaudePlaceStatus,
  type EngineCalls,
  type EngineConnection,
  type EngineProvider,
  type EngineSettings,
} from "@stella/contracts/backend/engines";
import type {
  EngineAccessResponse,
  EngineAccessResult,
} from "@stella/contracts/gateway/usage";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import {
  cancelClaudeCloudLogin,
  claudeCloudAccountKey,
  deleteClaudeCloudLoginBackup,
  finishClaudeCloudLogin,
  newClaudeCloudLoginId,
  signOutClaudeCloudAccount,
  startClaudeCloudLogin,
} from "../../claude-cloud-login.js";
import { TEST_CLAUDE_EMAIL } from "../../test-claude.js";
import { array, boolean, empty, literal, number, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { ownerKekFor, ownerKeks, type OwnerKekTag } from "../../secret-rotation.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDbReader, OwnerDomain } from "../registry.js";
import { DEFAULT_CLOUD_ANTHROPIC_EXECUTION, DEFAULT_CLOUD_CODEX_EXECUTION } from "../../cloud-spawn-model.js";

export const ENGINES_MIGRATION = {
  id: "engines.1-init",
  statements: [
    `CREATE TABLE engine_credentials (
       provider TEXT PRIMARY KEY,
       payload TEXT NOT NULL,
       label TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE engine_connects (
       connect_id TEXT PRIMARY KEY,
       provider TEXT NOT NULL,
       verifier TEXT NOT NULL,
       state TEXT NOT NULL,
       expires_at INTEGER NOT NULL
     )`,
    `CREATE TABLE engine_settings (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       execution TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
  ],
};

export const ENGINE_ACCOUNTS_MIGRATION = {
  id: "engines.2-accounts",
  statements: [
    `CREATE TABLE engine_accounts (
       account_id TEXT PRIMARY KEY,
       provider TEXT NOT NULL,
       payload TEXT NOT NULL,
       label TEXT NOT NULL,
       identity TEXT,
       email TEXT,
       plan TEXT,
       limited_until INTEGER,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX engine_accounts_by_provider ON engine_accounts (provider, created_at)`,
    `CREATE TABLE engine_provider_settings (
       provider TEXT PRIMARY KEY,
       active_account_id TEXT,
       auto_switch INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL
     )`,
    `INSERT INTO engine_accounts (account_id, provider, payload, label, created_at, updated_at)
       SELECT lower(hex(randomblob(16))), provider, payload, label, created_at, updated_at
       FROM engine_credentials`,
    `INSERT INTO engine_provider_settings (provider, active_account_id, auto_switch, updated_at)
       SELECT provider, account_id, 0, updated_at FROM engine_accounts`,
    `DROP TABLE engine_credentials`,
  ],
};

export const ENGINE_DEVICE_REFRESH_MIGRATION = {
  id: "engines.3-device-refresh",
  statements: [
    `ALTER TABLE engine_accounts ADD COLUMN expires_at INTEGER`,
    `ALTER TABLE engine_accounts ADD COLUMN refresh_at INTEGER`,
    `CREATE TABLE engine_refresh_leases (
       account_id TEXT PRIMARY KEY,
       lease_id TEXT NOT NULL,
       payload TEXT NOT NULL,
       expires_at INTEGER NOT NULL
     )`,
    `DELETE FROM engine_connects WHERE provider = 'anthropic'`,
  ],
};

export const ENGINE_CHATGPT_SIWC_MIGRATION = {
  id: "engines.4-chatgpt-siwc",
  statements: [
    `DELETE FROM engine_refresh_leases
       WHERE account_id IN (SELECT account_id FROM engine_accounts WHERE provider <> 'anthropic')`,
    `DELETE FROM engine_accounts WHERE provider <> 'anthropic'`,
    `DELETE FROM engine_provider_settings WHERE provider <> 'anthropic'`,
    `ALTER TABLE engine_accounts ADD COLUMN status TEXT`,
    `ALTER TABLE engine_accounts ADD COLUMN name TEXT`,
    `ALTER TABLE engine_accounts ADD COLUMN plan_usage INTEGER`,
    `ALTER TABLE engine_provider_settings ADD COLUMN host_id TEXT`,
    `DROP TABLE engine_connects`,
    `CREATE TABLE engine_connects (
       connect_id TEXT PRIMARY KEY,
       provider TEXT NOT NULL,
       account_id TEXT,
       client_id TEXT,
       state TEXT NOT NULL,
       nonce TEXT NOT NULL,
       verifier TEXT NOT NULL,
       redirect_uri TEXT NOT NULL,
       expires_at INTEGER NOT NULL
     )`,
  ],
};

export const ENGINE_CLI_LOGINS_MIGRATION = {
  id: "engines.5-cli-logins",
  statements: [
    `DROP TABLE engine_refresh_leases`,
    `DELETE FROM engine_accounts WHERE provider = 'anthropic'`,
    `UPDATE engine_provider_settings SET active_account_id = NULL WHERE provider = 'anthropic'`,
    `ALTER TABLE engine_accounts DROP COLUMN expires_at`,
    `ALTER TABLE engine_accounts DROP COLUMN refresh_at`,
    `ALTER TABLE engine_accounts DROP COLUMN limited_until`,
    `ALTER TABLE engine_provider_settings DROP COLUMN auto_switch`,
    `CREATE TABLE engine_claude_places (
       account_id TEXT NOT NULL,
       place TEXT NOT NULL,
       device_name TEXT,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (account_id, place)
     )`,
    `CREATE TABLE engine_claude_logins (
       login_id TEXT PRIMARY KEY,
       expires_at INTEGER NOT NULL
     )`,
    `CREATE TABLE engine_chatgpt_registrations (
       client_id TEXT PRIMARY KEY,
       email TEXT,
       name TEXT,
       updated_at INTEGER NOT NULL
     )`,
    `INSERT OR IGNORE INTO engine_chatgpt_registrations (client_id, email, name, updated_at)
       SELECT identity, email, name, updated_at FROM engine_accounts
       WHERE provider = 'chatgpt' AND identity IS NOT NULL`,
  ],
};

export const ENGINE_PROVIDER_SELECTION_MIGRATION = {
  id: "engines.6-provider-selection",
  statements: [`ALTER TABLE engine_settings ADD COLUMN legacy_execution TEXT`],
};

export const ENGINE_CLAUDE_PER_PLACE_MIGRATION = {
  id: "engines.7-claude-per-place",
  statements: [
    `CREATE TABLE engine_claude_choices (
       place TEXT PRIMARY KEY,
       account_id TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `ALTER TABLE engine_claude_places ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`,
    `INSERT INTO engine_claude_choices (place, account_id, updated_at)
       SELECT p.place, s.active_account_id, s.updated_at
       FROM engine_provider_settings s
       JOIN engine_claude_places p ON p.account_id = s.active_account_id
       WHERE s.provider = 'anthropic'`,
    `DELETE FROM engine_provider_settings WHERE provider = 'anthropic'`,
  ],
};

export const ENGINE_CLAUDE_ONE_CHOICE_MIGRATION = {
  id: "engines.8-claude-one-choice",
  statements: [
    `INSERT INTO engine_claude_choices (place, account_id, updated_at)
       SELECT '*', account_id, updated_at FROM engine_claude_choices
       ORDER BY updated_at DESC LIMIT 1`,
    `DELETE FROM engine_claude_choices WHERE place <> '*'`,
    `CREATE TABLE engine_claude_devices (
       place TEXT PRIMARY KEY,
       device_name TEXT,
       cli_installed INTEGER,
       updated_at INTEGER NOT NULL
     )`,
  ],
};

const CONNECT_TTL_MS = 15 * 60_000;
const MAX_ACCOUNTS_PER_PROVIDER = 10;

const PROVIDER_LABELS: Record<EngineProvider, string> = {
  anthropic: "Claude (Pro/Max subscription)",
  chatgpt: "ChatGPT",
};

export const DEFAULT_EXECUTION: LegacyCloudExecutionSelection = {
  engine: "stella",
  provider: "stella",
  model: "stella/default",
  reasoningEffort: DEFAULT_REASONING_EFFORT,
};

type StoredEnginePayload = {
  access: string;
  refresh: string;
  expires: number;
  clientId?: string;
  subject?: string;
  scopes?: string[];
  earliestRefreshAt?: number;
};

const base64ToBytes = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const keyCache = new Map<string, Promise<CryptoKey>>();

const importedKey = (raw: string): Promise<CryptoKey> => {
  let key = keyCache.get(raw);
  if (!key) {
    key = crypto.subtle.importKey("raw", base64ToBytes(raw), { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
    keyCache.set(raw, key);
  }
  return key;
};

const currentCredentialKey = (env: Cloudflare.Env): { tag: OwnerKekTag; key: Promise<CryptoKey> } => {
  const keks = ownerKeks(env);
  const raw = keks ? ownerKekFor(keks, keks.current) : undefined;
  if (!keks || !raw) {
    throw new RpcError("UNAVAILABLE", "Engine connections aren't configured yet.", {
      retryable: false,
    });
  }
  return { tag: keks.current, key: importedKey(raw) };
};

const credentialKeyFor = (env: Cloudflare.Env, tag: string): Promise<CryptoKey> => {
  const keks = ownerKeks(env);
  const raw = keks ? ownerKekFor(keks, tag) : undefined;
  if (!raw) {
    throw new RpcError("UNAVAILABLE", "Engine connections aren't configured yet.", {
      retryable: false,
    });
  }
  return importedKey(raw);
};

const isCurrentKeyVersion = (env: Cloudflare.Env, encrypted: string): boolean => {
  const keks = ownerKeks(env);
  return !keks || encrypted.startsWith(`${keks.current}.`);
};

const additionalData = (ownerId: string, provider: EngineProvider) =>
  new TextEncoder().encode(`${ownerId}:${provider}`);

const encryptPayload = async (
  ctx: OwnerContext,
  provider: EngineProvider,
  payload: StoredEnginePayload,
): Promise<string> => {
  const current = currentCredentialKey(ctx.env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(ctx.ownerId, provider) },
      await current.key,
      new TextEncoder().encode(JSON.stringify(payload)),
    ),
  );
  return `${current.tag}.${bytesToBase64(iv)}.${bytesToBase64(ciphertext)}`;
};

const decryptPayload = async (
  ctx: OwnerContext,
  provider: EngineProvider,
  encrypted: string,
): Promise<StoredEnginePayload> => {
  const [version, iv, ciphertext] = encrypted.split(".");
  if ((version !== "v1" && version !== "v2") || !iv || !ciphertext) {
    throw new Error("Unreadable engine credential.");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv), additionalData: additionalData(ctx.ownerId, provider) },
    await credentialKeyFor(ctx.env, version),
    base64ToBytes(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as StoredEnginePayload;
};

const EXECUTION_ENGINES = ["stella", "anthropic", "chatgpt"] as const;
const PROVIDER_MODEL_ID = /^[A-Za-z0-9~][A-Za-z0-9._:/@~+-]{0,191}$/;
const REASONING_EFFORTS = ["none", ...REASONING_EFFORT_LEVELS, "default", "auto", "minimal"] as const;

const normalizeExecutionEffort = (
  effort: (typeof REASONING_EFFORTS)[number],
): AgentModelReasoningEffort =>
  effort === "none" ? "none" : normalizeReasoningEffortLevel(effort);

const MANAGED_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const ENGINE_NATIVE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const ANTHROPIC_NATIVE_MODEL_ID =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,191}|[A-Za-z0-9][A-Za-z0-9._-]{0,187}\[1m\])$/;

const parseExecutionShape = object({
  engine: literal(...EXECUTION_ENGINES),
  provider: literal(...EXECUTION_ENGINES),
  model: string({ max: 256 }),
  reasoningEffort: literal(...REASONING_EFFORTS),
});

const parseProviderExecutionShape = object({
  engine: literal("provider"),
  provider: string({ min: 1, max: 64 }),
  model: string({ max: 256 }),
  reasoningEffort: literal(...REASONING_EFFORTS),
});

const parseExecution = (value: unknown, path?: string): CloudExecutionSelection => {
  if (
    value &&
    typeof value === "object" &&
    (value as { engine?: unknown }).engine === "provider"
  ) {
    const input = parseProviderExecutionShape(value, path);
    if (!isAccountProviderId(input.provider)) {
      throw new RpcError("BAD_REQUEST", "Stella doesn't know that model provider.");
    }
    const model = input.model.trim();
    if (!PROVIDER_MODEL_ID.test(model)) {
      throw new RpcError("BAD_REQUEST", "Cloud execution model must be a model id of 1–192 safe characters.");
    }
    return { ...input, model, reasoningEffort: normalizeExecutionEffort(input.reasoningEffort) };
  }
  const input = parseExecutionShape(value, path);
  if (input.engine !== input.provider) {
    throw new RpcError("BAD_REQUEST", "Cloud execution engine and provider must identify the same route.");
  }
  const model = input.model.trim();
  if ((input.engine === "stella") !== model.startsWith("stella/")) {
    throw new RpcError(
      "BAD_REQUEST",
      input.engine === "stella"
        ? 'The managed cloud engine requires a canonical "stella/..." model id.'
        : "Connected cloud engines require an engine-native model id.",
    );
  }
  const pattern =
    input.engine === "stella"
      ? MANAGED_MODEL_ID
      : input.engine === "anthropic"
        ? ANTHROPIC_NATIVE_MODEL_ID
        : ENGINE_NATIVE_MODEL_ID;
  if (!pattern.test(model)) {
    throw new RpcError("BAD_REQUEST", "Cloud execution model must be a canonical model id of 1–192 safe characters.");
  }
  return {
    ...input,
    model,
    reasoningEffort: normalizeExecutionEffort(input.reasoningEffort),
  } as CloudExecutionSelection;
};

type SettingsRow = { execution: string; legacy_execution: string | null; updated_at: number };
type AccountRow = {
  account_id: string;
  provider: string;
  payload: string;
  label: string;
  identity: string | null;
  email: string | null;
  plan: string | null;
  status: string | null;
  name: string | null;
  plan_usage: number | null;
  created_at: number;
  updated_at: number;
};
type ProviderSettingsRow = {
  provider: string;
  active_account_id: string | null;
};
type ConnectRow = {
  provider: string;
  account_id: string | null;
  client_id: string | null;
  state: string;
  nonce: string;
  verifier: string;
  redirect_uri: string;
  expires_at: number;
};

type Selection = {
  selection: CloudExecutionSelection;
  execution: LegacyCloudExecutionSelection;
  selectedAt: number | null;
};

const parseStored = (raw: string | null): CloudExecutionSelection | null => {
  if (!raw) return null;
  try {
    return parseExecution(JSON.parse(raw));
  } catch {
    return null;
  }
};

const readSelection = (db: OwnerDbReader): Selection => {
  const row = db.one<SettingsRow>(
    "SELECT execution, legacy_execution, updated_at FROM engine_settings WHERE id = 1",
  );
  if (!row) return { selection: DEFAULT_EXECUTION, execution: DEFAULT_EXECUTION, selectedAt: null };
  const selection = parseStored(row.execution) ?? DEFAULT_EXECUTION;
  const legacy = parseStored(row.legacy_execution);
  const execution = isLegacyCloudExecution(selection)
    ? selection
    : legacy && isLegacyCloudExecution(legacy)
      ? legacy
      : DEFAULT_EXECUTION;
  return { selection, execution, selectedAt: row.updated_at };
};

const ACCOUNT_COLUMNS =
  "account_id, provider, payload, label, identity, email, plan, status, name, plan_usage, created_at, updated_at";

const accountsOf = (db: OwnerDbReader, provider: EngineProvider): AccountRow[] =>
  db.all<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM engine_accounts WHERE provider = ? ORDER BY created_at, rowid`,
    provider,
  );

const providerSettings = (db: OwnerDbReader, provider: EngineProvider): ProviderSettingsRow | null =>
  db.one<ProviderSettingsRow>(
    "SELECT provider, active_account_id FROM engine_provider_settings WHERE provider = ?",
    provider,
  );

const isServable = (row: AccountRow): boolean => row.status === null && row.plan_usage !== 0;

const activeAccountOf = (
  accounts: readonly AccountRow[],
  settings: ProviderSettingsRow | null,
): AccountRow | undefined => {
  const servable = accounts.filter(isServable);
  return servable.find((row) => row.account_id === settings?.active_account_id) ?? servable[0];
};

const readConnections = (db: OwnerDbReader): EngineConnection[] => {
  const claudeActive = claudeActiveByPlace(db);
  return ENGINE_PROVIDERS.flatMap((provider) => {
    const accounts = accountsOf(db, provider);
    const activeId =
      provider === "anthropic"
        ? claudeActive.get(CLOUD_PLACE)
        : activeAccountOf(accounts, providerSettings(db, provider))?.account_id;
    return accounts.map((row): EngineConnection => ({
      provider,
      accountId: row.account_id,
      label: row.label,
      ...(row.email ? { email: row.email } : {}),
      ...(row.plan ? { plan: row.plan } : {}),
      ...(row.name ? { name: row.name } : {}),
      ...(row.status === "signed_out" || row.status === "reauth_required"
        ? { status: row.status }
        : {}),
      ...(provider === "chatgpt"
        ? {
            planUsage: row.plan_usage !== 0,
            ...(row.identity ? { clientId: row.identity } : {}),
          }
        : { places: placesOf(db, row.account_id, claudeActive) }),
      active: row.account_id === activeId,
      updatedAt: row.updated_at,
    }));
  });
};

const readSettings = (db: OwnerDbReader): EngineSettings => {
  const claude = readClaudeOverview(db);
  return {
    ...readSelection(db),
    connections: readConnections(db),
    chatGptRegistrations: readRegistrations(db),
    ...(claude ? { claude } : {}),
  };
};

const connectedEnginesOf = (db: OwnerDbReader): NonNullable<OwnerSnapshot["connectedEngines"]> => {
  const claudeInCloud = claudeActiveByPlace(db).has(CLOUD_PLACE);
  return ENGINE_PROVIDERS.filter((provider) =>
    provider === "anthropic"
      ? claudeInCloud
      : Boolean(
          db.one(
            `SELECT 1 AS present FROM engine_accounts
             WHERE provider = ? AND status IS NULL AND (plan_usage IS NULL OR plan_usage <> 0) LIMIT 1`,
            provider,
          ),
        ),
  );
};

const connectedProvidersOf = (db: OwnerDbReader): string[] =>
  db
    .all<{ provider: string }>("SELECT provider FROM provider_credentials WHERE status = 'ok' ORDER BY provider")
    .map((row) => row.provider);

const ownerModeDefault = (
  connectedEngines: NonNullable<OwnerSnapshot["connectedEngines"]>,
): CloudExecutionSelection =>
  connectedEngines.includes("anthropic")
    ? DEFAULT_CLOUD_ANTHROPIC_EXECUTION
    : connectedEngines.includes("chatgpt")
      ? DEFAULT_CLOUD_CODEX_EXECUTION
      : DEFAULT_EXECUTION;

export const snapshotEngines = (
  db: OwnerDbReader,
  options: { ownerMode?: boolean; managedModels?: boolean } = {},
): Pick<OwnerSnapshot, "execution" | "connectedEngines" | "connectedProviders"> => {
  const connectedEngines = connectedEnginesOf(db);
  const connectedProviders = connectedProvidersOf(db);
  const { selection } = readSelection(db);
  const runnable =
    selection.engine === "stella" ||
    (selection.engine === "provider"
      ? connectedProviders.includes(selection.provider)
      : connectedEngines.includes(selection.engine));
  const fallback = options.ownerMode ? ownerModeDefault(connectedEngines) : DEFAULT_EXECUTION;
  const usesDefault =
    !runnable ||
    (selection.engine === "stella" &&
      (selection.model === DEFAULT_EXECUTION.model || options.managedModels === false));
  return {
    execution: usesDefault && options.ownerMode ? fallback : runnable ? selection : DEFAULT_EXECUTION,
    connectedEngines,
    connectedProviders,
  };
};

const writeSelection = (ctx: OwnerContext, execution: CloudExecutionSelection): void => {
  const legacy = isLegacyCloudExecution(execution) ? JSON.stringify(execution) : null;
  ctx.db.run(
    `INSERT INTO engine_settings (id, execution, legacy_execution, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET execution = excluded.execution,
       legacy_execution = COALESCE(excluded.legacy_execution, legacy_execution),
       updated_at = excluded.updated_at`,
    JSON.stringify(execution),
    legacy,
    ctx.now,
  );
};

export const resetExecutionForProvider = (ctx: OwnerContext, provider: string): void => {
  const { selection } = readSelection(ctx.db);
  if (selection.engine === "provider" && selection.provider === provider) {
    writeSelection(ctx, DEFAULT_EXECUTION);
  }
};

const writeActiveAccount = (
  ctx: OwnerContext,
  provider: EngineProvider,
  accountId: string | null,
): void => {
  ctx.db.run(
    `INSERT INTO engine_provider_settings (provider, active_account_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (provider) DO UPDATE SET active_account_id = excluded.active_account_id,
       updated_at = excluded.updated_at`,
    provider,
    accountId,
    Date.now(),
  );
};

const badRequest = (message: string) => new RpcError("BAD_REQUEST", message);

type AccountIdentity = { identity?: string; email?: string; plan?: string; name?: string };

const text = (value: unknown, max = 320): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

const writeAccount = (
  ctx: OwnerContext,
  provider: EngineProvider,
  stored: { payload: string; status?: "reauth_required"; planUsage?: boolean },
  identity: AccountIdentity,
): string => {
  const now = Date.now();
  const status = stored.status ?? null;
  const planUsage = stored.planUsage === undefined ? null : stored.planUsage ? 1 : 0;
  const makeActive = status === null && planUsage !== 0;
  const existing = identity.identity
    ? ctx.db.one<{ account_id: string }>(
        "SELECT account_id FROM engine_accounts WHERE provider = ? AND identity = ?",
        provider,
        identity.identity,
      )
    : null;
  if (existing) {
    ctx.db.run(
      `UPDATE engine_accounts SET payload = ?, status = ?, plan_usage = ?,
         email = COALESCE(?, email), plan = COALESCE(?, plan), name = COALESCE(?, name),
         updated_at = ? WHERE account_id = ?`,
      stored.payload,
      status,
      planUsage,
      identity.email ?? null,
      identity.plan ?? null,
      identity.name ?? null,
      now,
      existing.account_id,
    );
    if (makeActive) writeActiveAccount(ctx, provider, existing.account_id);
    return existing.account_id;
  }
  if (accountsOf(ctx.db, provider).length >= MAX_ACCOUNTS_PER_PROVIDER) {
    throw badRequest(
      `You can connect up to ${MAX_ACCOUNTS_PER_PROVIDER} accounts per provider. Remove one first.`,
    );
  }
  const accountId = crypto.randomUUID().replaceAll("-", "");
  ctx.db.run(
    `INSERT INTO engine_accounts (${ACCOUNT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    accountId,
    provider,
    stored.payload,
    PROVIDER_LABELS[provider],
    identity.identity ?? null,
    identity.email ?? null,
    identity.plan ?? null,
    status,
    identity.name ?? null,
    planUsage,
    now,
    now,
  );
  if (makeActive) writeActiveAccount(ctx, provider, accountId);
  return accountId;
};

const CLOUD_PLACE = "cloud";
const EVERY_PLACE = "*";
const devicePlace = (deviceId: string) => `device:${deviceId}`;

const claudeIdentity = (email: string): string => email.trim().toLowerCase();

const ensureClaudeAccount = (
  ctx: OwnerContext,
  login: { email: string; plan?: string },
): string => {
  const identity = claudeIdentity(login.email);
  const existing = ctx.db.one<{ account_id: string }>(
    "SELECT account_id FROM engine_accounts WHERE provider = 'anthropic' AND identity = ?",
    identity,
  );
  const now = Date.now();
  if (existing) {
    if (login.plan) {
      ctx.db.run(
        "UPDATE engine_accounts SET plan = ?, updated_at = ? WHERE account_id = ? AND COALESCE(plan, '') <> ?",
        login.plan,
        now,
        existing.account_id,
        login.plan,
      );
    }
    return existing.account_id;
  }
  if (accountsOf(ctx.db, "anthropic").length >= MAX_ACCOUNTS_PER_PROVIDER) {
    throw badRequest(
      `You can connect up to ${MAX_ACCOUNTS_PER_PROVIDER} Claude accounts. Remove one first.`,
    );
  }
  const accountId = crypto.randomUUID().replaceAll("-", "");
  ctx.db.run(
    `INSERT INTO engine_accounts (${ACCOUNT_COLUMNS}) VALUES (?, 'anthropic', '', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    accountId,
    PROVIDER_LABELS.anthropic,
    identity,
    login.email.trim(),
    login.plan ?? null,
    now,
    now,
  );
  return accountId;
};

type PlaceRow = {
  account_id: string;
  place: string;
  device_name: string | null;
  is_default: number;
  updated_at: number;
};

const PLACE_COLUMNS = "account_id, place, device_name, is_default, updated_at";

const chosenClaudeAccount = (db: OwnerDbReader): string | null =>
  db.one<{ account_id: string }>(
    `SELECT c.account_id AS account_id FROM engine_claude_choices c
       JOIN engine_accounts a ON a.account_id = c.account_id
       WHERE c.place = ? AND a.provider = 'anthropic'`,
    EVERY_PLACE,
  )?.account_id ?? null;

type HeldLogin = { account_id: string; place: string; is_default: number };

const heldClaudeLogins = (db: OwnerDbReader): Map<string, HeldLogin[]> => {
  const held = db.all<HeldLogin>(
    `SELECT p.account_id AS account_id, p.place AS place, p.is_default AS is_default
     FROM engine_claude_places p JOIN engine_accounts a ON a.account_id = p.account_id
     WHERE a.provider = 'anthropic' ORDER BY a.created_at, a.rowid`,
  );
  const byPlace = new Map<string, HeldLogin[]>();
  for (const row of held) byPlace.set(row.place, [...(byPlace.get(row.place) ?? []), row]);
  return byPlace;
};

const resolveClaudePlace = (
  rows: readonly HeldLogin[],
  chosen: string | null,
): { accountId: string; reason: "selected" | "own_login" | "other_login" } | null => {
  const selected = chosen ? rows.find((row) => row.account_id === chosen) : undefined;
  if (selected) return { accountId: selected.account_id, reason: "selected" };
  const own = rows.find((row) => row.is_default === 1);
  if (own) return { accountId: own.account_id, reason: "own_login" };
  const first = rows[0];
  return first ? { accountId: first.account_id, reason: "other_login" } : null;
};

const claudeActiveByPlace = (db: OwnerDbReader): Map<string, string> => {
  const chosen = chosenClaudeAccount(db);
  const active = new Map<string, string>();
  for (const [place, rows] of heldClaudeLogins(db)) {
    const pick = resolveClaudePlace(rows, chosen);
    if (pick) active.set(place, pick.accountId);
  }
  return active;
};

type ClaudeDeviceRow = {
  place: string;
  device_name: string | null;
  cli_installed: number | null;
  updated_at: number;
};

const readClaudeOverview = (db: OwnerDbReader): ClaudeOverview => {
  const chosen = chosenClaudeAccount(db);
  const held = heldClaudeLogins(db);
  const emails = new Map(
    db
      .all<{ account_id: string; email: string | null }>(
        "SELECT account_id, email FROM engine_accounts WHERE provider = 'anthropic'",
      )
      .map((row) => [row.account_id, row.email ?? undefined] as const),
  );
  const devices = new Map<string, { name?: string; cliInstalled?: boolean; updatedAt: number }>();
  for (const row of db.all<ClaudeDeviceRow>(
    "SELECT place, device_name, cli_installed, updated_at FROM engine_claude_devices",
  )) {
    devices.set(row.place, {
      ...(row.device_name ? { name: row.device_name } : {}),
      ...(row.cli_installed === null ? {} : { cliInstalled: row.cli_installed === 1 }),
      updatedAt: row.updated_at,
    });
  }
  for (const row of db.all<{ place: string; device_name: string | null; updated_at: number }>(
    "SELECT place, device_name, MAX(updated_at) AS updated_at FROM engine_claude_places WHERE place <> ? GROUP BY place",
    CLOUD_PLACE,
  )) {
    if (devices.has(row.place)) continue;
    devices.set(row.place, {
      ...(row.device_name ? { name: row.device_name } : {}),
      updatedAt: row.updated_at,
    });
  }
  const account = (accountId: string) => {
    const email = emails.get(accountId);
    return { accountId, ...(email ? { email } : {}) };
  };
  const statusOf = (place: string): Pick<ClaudePlaceStatus, "inUse" | "missingChosen" | "ownLogin"> => {
    const rows = held.get(place) ?? [];
    const pick = resolveClaudePlace(rows, chosen);
    const own = rows.find((row) => row.is_default === 1);
    return {
      inUse: pick ? { ...account(pick.accountId), reason: pick.reason } : null,
      ...(own ? { ownLogin: account(own.account_id) } : {}),
      missingChosen: Boolean(chosen && !rows.some((row) => row.account_id === chosen)),
    };
  };
  const cloudStatus = statusOf(CLOUD_PLACE);
  const cloudUpdatedAt =
    db.one<{ updated_at: number | null }>(
      "SELECT MAX(updated_at) AS updated_at FROM engine_claude_places WHERE place = ?",
      CLOUD_PLACE,
    )?.updated_at ?? 0;
  const places: ClaudePlaceStatus[] = [
    {
      kind: "cloud",
      inUse: cloudStatus.inUse,
      missingChosen: cloudStatus.missingChosen,
      updatedAt: cloudUpdatedAt,
    },
    ...[...devices]
      .map(([place, device]): ClaudePlaceStatus => ({
        kind: "device",
        deviceId: place.slice("device:".length),
        ...(device.name ? { deviceName: device.name } : {}),
        ...(device.cliInstalled === undefined ? {} : { cliInstalled: device.cliInstalled }),
        ...statusOf(place),
        updatedAt: device.updatedAt,
      }))
      .sort((a, b) => (a.deviceName ?? "").localeCompare(b.deviceName ?? "")),
  ];
  return { chosenAccountId: chosen, places };
};

const placesOf = (
  db: OwnerDbReader,
  accountId: string,
  active: ReadonlyMap<string, string>,
): ClaudeLoginPlace[] =>
  db
    .all<PlaceRow>(
      `SELECT ${PLACE_COLUMNS} FROM engine_claude_places WHERE account_id = ? ORDER BY place`,
      accountId,
    )
    .map((row): ClaudeLoginPlace =>
      row.place === CLOUD_PLACE
        ? { kind: "cloud", active: active.get(row.place) === accountId, updatedAt: row.updated_at }
        : {
            kind: "device",
            deviceId: row.place.slice("device:".length),
            ...(row.device_name ? { deviceName: row.device_name } : {}),
            ...(row.is_default ? { isDefault: true } : {}),
            active: active.get(row.place) === accountId,
            updatedAt: row.updated_at,
          },
    );

const reportClaudeLogins = (
  ctx: OwnerContext,
  args: EngineCalls["engines.reportClaudeLogins"]["args"],
): null => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "engines.reportClaudeLogins",
    { count: 60, windowMs: 10 * 60_000 },
    "Too many sign-in reports. Please wait a moment.",
  );
  const place = devicePlace(args.deviceId);
  const deviceName = text(args.deviceName, 120) ?? null;
  const cliInstalled = args.cliInstalled === undefined ? null : args.cliInstalled ? 1 : 0;
  const device = ctx.db.one<ClaudeDeviceRow>(
    "SELECT place, device_name, cli_installed, updated_at FROM engine_claude_devices WHERE place = ?",
    place,
  );
  if (!device || device.device_name !== deviceName || device.cli_installed !== cliInstalled) {
    ctx.db.run(
      `INSERT INTO engine_claude_devices (place, device_name, cli_installed, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (place) DO UPDATE SET device_name = excluded.device_name,
         cli_installed = excluded.cli_installed, updated_at = excluded.updated_at`,
      place,
      deviceName,
      cliInstalled,
      ctx.now,
    );
  }
  const seen = new Set<string>();
  for (const login of args.logins) {
    const email = text(login.email);
    if (!email || seen.has(claudeIdentity(email))) continue;
    seen.add(claudeIdentity(email));
    const accountId = ensureClaudeAccount(ctx, {
      email,
      ...(text(login.plan, 40) ? { plan: text(login.plan, 40)! } : {}),
    });
    const isDefault = login.isDefault === true ? 1 : 0;
    const current = ctx.db.one<PlaceRow>(
      `SELECT ${PLACE_COLUMNS} FROM engine_claude_places WHERE account_id = ? AND place = ?`,
      accountId,
      place,
    );
    if (!current || current.device_name !== deviceName || current.is_default !== isDefault) {
      ctx.db.run(
        `INSERT INTO engine_claude_places (account_id, place, device_name, is_default, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (account_id, place) DO UPDATE SET device_name = excluded.device_name,
           is_default = excluded.is_default, updated_at = excluded.updated_at`,
        accountId,
        place,
        deviceName,
        isDefault,
        ctx.now,
      );
    }
  }
  for (const row of ctx.db.all<{ account_id: string; identity: string | null }>(
    `SELECT p.account_id AS account_id, a.identity AS identity FROM engine_claude_places p
       JOIN engine_accounts a ON a.account_id = p.account_id WHERE p.place = ?`,
    place,
  )) {
    if (!row.identity || !seen.has(row.identity)) {
      ctx.db.run(
        "DELETE FROM engine_claude_places WHERE account_id = ? AND place = ?",
        row.account_id,
        place,
      );
    }
  }
  return null;
};

const startClaudeCloud = async (
  ctx: OwnerContext,
  args: EngineCalls["engines.startClaudeCloudLogin"]["args"],
): Promise<EngineCalls["engines.startClaudeCloudLogin"]["result"]> => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "engines.startClaudeCloudLogin",
    { count: 20, windowMs: 10 * 60_000 },
    "Too many sign-in attempts. Try again in a few minutes.",
  );
  if (!cloudSandboxAccess(ctx).enabled) {
    throw new RpcError("FORBIDDEN", CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE, {
      reason: "subscription_required",
    });
  }
  const loginId = newClaudeCloudLoginId();
  const email = text(args.email);
  const started = await startClaudeCloudLogin(ctx.env, ctx.ownerId, loginId, email);
  if (!started.ok) throw new RpcError("UNAVAILABLE", started.error, { retryable: true });
  ctx.db.run("DELETE FROM engine_claude_logins WHERE expires_at <= ?", ctx.now);
  ctx.db.run(
    "INSERT INTO engine_claude_logins (login_id, expires_at) VALUES (?, ?)",
    loginId,
    ctx.now + CONNECT_TTL_MS,
  );
  return { loginId, authorizeUrl: started.authorizeUrl };
};

const finishClaudeCloud = async (
  ctx: OwnerContext,
  args: EngineCalls["engines.finishClaudeCloudLogin"]["args"],
): Promise<EngineCalls["engines.finishClaudeCloudLogin"]["result"]> => {
  const pending = ctx.db.one<{ login_id: string; expires_at: number }>(
    "SELECT login_id, expires_at FROM engine_claude_logins WHERE login_id = ?",
    args.loginId,
  );
  if (!pending || pending.expires_at <= ctx.now) {
    throw badRequest("This sign-in expired. Start signing in to Claude again.");
  }
  ctx.db.run("DELETE FROM engine_claude_logins WHERE login_id = ?", args.loginId);
  const finished = await finishClaudeCloudLogin(ctx.env, ctx.ownerId, args.loginId, args.code.trim());
  if (!finished.ok) throw badRequest(finished.error);
  const accountId = ensureClaudeAccount(ctx, {
    email: finished.email,
    ...(finished.plan ? { plan: finished.plan } : {}),
  });
  ctx.db.run(
    `INSERT INTO engine_claude_places (account_id, place, device_name, updated_at) VALUES (?, ?, NULL, ?)
     ON CONFLICT (account_id, place) DO UPDATE SET updated_at = excluded.updated_at`,
    accountId,
    CLOUD_PLACE,
    Date.now(),
  );
  return { accountId, email: finished.email };
};

export const ensureTestClaudeCloudAccount = (ctx: OwnerContext): void => {
  const known = ctx.db.one<{ account_id: string }>(
    "SELECT account_id FROM engine_accounts WHERE provider = 'anthropic' AND identity = ?",
    claudeIdentity(TEST_CLAUDE_EMAIL),
  );
  if (known) return;
  if (accountsOf(ctx.db, "anthropic").length >= MAX_ACCOUNTS_PER_PROVIDER) return;
  const accountId = ensureClaudeAccount(ctx, { email: TEST_CLAUDE_EMAIL, plan: "test" });
  ctx.db.run(
    `INSERT INTO engine_claude_places (account_id, place, device_name, updated_at) VALUES (?, ?, NULL, ?)
     ON CONFLICT (account_id, place) DO UPDATE SET updated_at = excluded.updated_at`,
    accountId,
    CLOUD_PLACE,
    ctx.now,
  );
};

const cancelClaudeCloud = async (
  ctx: OwnerContext,
  args: EngineCalls["engines.cancelClaudeCloudLogin"]["args"],
): Promise<null> => {
  const pending = ctx.db.one<{ login_id: string }>(
    "SELECT login_id FROM engine_claude_logins WHERE login_id = ?",
    args.loginId,
  );
  if (!pending) return null;
  ctx.db.run("DELETE FROM engine_claude_logins WHERE login_id = ?", args.loginId);
  await cancelClaudeCloudLogin(ctx.env, ctx.ownerId, args.loginId).catch(() => undefined);
  return null;
};

const claudeAccount = (db: OwnerDbReader, accountId: string): AccountRow | null =>
  db.one<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM engine_accounts WHERE provider = 'anthropic' AND account_id = ?`,
    accountId,
  );

const signOutClaudeCloudRow = async (ctx: OwnerContext, row: AccountRow): Promise<void> => {
  if (row.email) {
    await signOutClaudeCloudAccount(ctx.env, ctx.ownerId, await claudeCloudAccountKey(row.email));
  }
  ctx.db.run(
    "DELETE FROM engine_claude_places WHERE account_id = ? AND place = ?",
    row.account_id,
    CLOUD_PLACE,
  );
};

const signOutClaudeCloud = async (
  ctx: OwnerContext,
  args: EngineCalls["engines.signOutClaudeCloud"]["args"],
): Promise<null> => {
  const row = claudeAccount(ctx.db, args.accountId);
  if (!row) throw new RpcError("NOT_FOUND", "That account isn't connected anymore.");
  await signOutClaudeCloudRow(ctx, row);
  return null;
};

export const claudeCloudAccount = async (
  ctx: OwnerContext,
): Promise<{ key: string; email: string } | { missing: true; email?: string }> => {
  const accountId = claudeActiveByPlace(ctx.db).get(CLOUD_PLACE);
  const active = accountId ? claudeAccount(ctx.db, accountId) : null;
  if (!active?.email) return { missing: true };
  return { key: await claudeCloudAccountKey(active.email), email: active.email };
};

const shareRegistration = (
  ctx: OwnerContext,
  registration: { clientId: string; email?: string; name?: string },
): void => {
  ctx.db.run(
    `INSERT INTO engine_chatgpt_registrations (client_id, email, name, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (client_id) DO UPDATE SET email = COALESCE(excluded.email, email),
       name = COALESCE(excluded.name, name), updated_at = excluded.updated_at`,
    registration.clientId,
    registration.email ?? null,
    registration.name ?? null,
    Date.now(),
  );
};

const shareChatGptRegistration = (
  ctx: OwnerContext,
  args: EngineCalls["engines.shareChatGptRegistration"]["args"],
): null => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "engines.shareChatGptRegistration",
    { count: 30, windowMs: 10 * 60_000 },
    "Too many ChatGPT registrations. Please wait a moment.",
  );
  if (!isIssuedChatGptClientId(args.clientId)) throw badRequest("That isn't a ChatGPT client id.");
  const email = text(args.email);
  const name = text(args.name, 200);
  shareRegistration(ctx, {
    clientId: args.clientId,
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
  });
  return null;
};

const readRegistrations = (db: OwnerDbReader): ChatGptSharedRegistration[] =>
  db
    .all<{ client_id: string; email: string | null; name: string | null; updated_at: number }>(
      "SELECT client_id, email, name, updated_at FROM engine_chatgpt_registrations ORDER BY updated_at DESC",
    )
    .map((row) => ({
      clientId: row.client_id,
      ...(row.email ? { email: row.email } : {}),
      ...(row.name ? { name: row.name } : {}),
      updatedAt: row.updated_at,
    }));

const cloudHostId = (ctx: OwnerContext): string => {
  const row = ctx.db.one<{ host_id: string | null }>(
    "SELECT host_id FROM engine_provider_settings WHERE provider = 'chatgpt'",
  );
  if (isChatGptHostId(row?.host_id)) return row.host_id;
  const hostId = createChatGptHostId();
  ctx.db.run(
    `INSERT INTO engine_provider_settings (provider, active_account_id, host_id, updated_at)
     VALUES ('chatgpt', NULL, ?, ?)
     ON CONFLICT (provider) DO UPDATE SET host_id = excluded.host_id`,
    hostId,
    ctx.now,
  );
  return hostId;
};

const chatGptAccount = (db: OwnerDbReader, accountId: string): AccountRow | null =>
  db.one<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM engine_accounts WHERE provider = 'chatgpt' AND account_id = ?`,
    accountId,
  );

const chatGptRpcError = (error: unknown): RpcError => {
  if (error instanceof RpcError) return error;
  if (error instanceof ChatGptError) {
    return error.retryable
      ? new RpcError("UNAVAILABLE", error.message, { retryable: true })
      : badRequest(error.message);
  }
  return new RpcError("UNAVAILABLE", "ChatGPT sign-in is temporarily unavailable. Try again.", {
    retryable: true,
  });
};

const startConnect = async (
  ctx: OwnerContext,
  args: EngineCalls["engines.startConnect"]["args"],
): Promise<EngineCalls["engines.startConnect"]["result"]> => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "engines.startConnect",
    { count: 20, windowMs: 10 * 60_000 },
    "Too many connect attempts. Try again in a few minutes.",
  );
  await currentCredentialKey(ctx.env).key;
  let saved: { accountId?: string; clientId: string; loginHint?: string } | undefined;
  if (!args.accountId && args.clientId) {
    const shared = ctx.db.one<{ client_id: string; email: string | null }>(
      "SELECT client_id, email FROM engine_chatgpt_registrations WHERE client_id = ?",
      args.clientId,
    );
    if (!shared || !isIssuedChatGptClientId(shared.client_id)) {
      throw new RpcError("NOT_FOUND", "That ChatGPT registration isn't known here anymore.");
    }
    const existing = ctx.db.one<{ account_id: string }>(
      "SELECT account_id FROM engine_accounts WHERE provider = 'chatgpt' AND identity = ?",
      shared.client_id,
    );
    saved = {
      ...(existing ? { accountId: existing.account_id } : {}),
      clientId: shared.client_id,
      ...(shared.email ? { loginHint: shared.email } : {}),
    };
  }
  if (args.accountId) {
    const row = chatGptAccount(ctx.db, args.accountId);
    if (!row) throw new RpcError("NOT_FOUND", "That ChatGPT account isn't saved anymore.");
    let payload: StoredEnginePayload;
    try {
      payload = await decryptPayload(ctx, "chatgpt", row.payload);
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw new RpcError("CONFLICT", "This ChatGPT account's registration is unreadable. Remove it and add it again.");
    }
    if (!isIssuedChatGptClientId(payload.clientId)) {
      throw new RpcError("CONFLICT", "This ChatGPT account's registration is incomplete. Remove it and add it again.");
    }
    saved = {
      accountId: row.account_id,
      clientId: payload.clientId,
      ...(row.email ? { loginHint: row.email } : {}),
    };
  }
  let authorizationEndpoint: string;
  try {
    authorizationEndpoint = (await chatGptDiscovery()).authorization_endpoint;
  } catch (error) {
    throw chatGptRpcError(error);
  }
  const pending = await createChatGptPendingSignIn();
  const redirectUri = chatGptLoopbackRedirectUri(
    args.redirectPort ?? CHATGPT_SIWC.defaultLoopbackPort,
  );
  const authorizeUrl = chatGptAuthorizeUrl({
    authorizationEndpoint,
    ...(saved ? { clientId: saved.clientId } : {}),
    hostId: cloudHostId(ctx),
    redirectUri,
    state: pending.state,
    nonce: pending.nonce,
    challenge: pending.challenge,
    ...(saved?.loginHint ? { loginHint: saved.loginHint } : {}),
    ...(args.enablePlanUsage ? { reconsent: true } : {}),
  });
  const connectId = crypto.randomUUID();
  ctx.db.run("DELETE FROM engine_connects WHERE expires_at <= ?", ctx.now);
  ctx.db.run(
    `INSERT INTO engine_connects
       (connect_id, provider, account_id, client_id, state, nonce, verifier, redirect_uri, expires_at)
     VALUES (?, 'chatgpt', ?, ?, ?, ?, ?, ?, ?)`,
    connectId,
    saved?.accountId ?? null,
    saved?.clientId ?? null,
    pending.state,
    pending.nonce,
    pending.verifier,
    redirectUri,
    ctx.now + CONNECT_TTL_MS,
  );
  return { connectId, authorizeUrl, redirectUri };
};

const reauthPayload = (clientId: string, subject?: string): StoredEnginePayload => ({
  access: "",
  refresh: "",
  expires: 0,
  clientId,
  ...(subject ? { subject } : {}),
});

const finishConnect = async (
  ctx: OwnerContext,
  args: EngineCalls["engines.finishConnect"]["args"],
): Promise<EngineCalls["engines.finishConnect"]["result"]> => {
  const connect = ctx.db.one<ConnectRow>(
    `SELECT provider, account_id, client_id, state, nonce, verifier, redirect_uri, expires_at
     FROM engine_connects WHERE connect_id = ?`,
    args.connectId,
  );
  if (!connect || connect.expires_at <= ctx.now || connect.provider !== "chatgpt") {
    throw badRequest("This sign-in attempt expired. Start signing in to ChatGPT again.");
  }
  let callback: ChatGptCallback;
  try {
    callback = parseChatGptCallback(args.pastedInput, {
      state: connect.state,
      ...(connect.client_id ? { savedClientId: connect.client_id } : {}),
    });
  } catch (error) {
    if (error instanceof ChatGptError && error.code !== "state_mismatch") {
      ctx.db.run("DELETE FROM engine_connects WHERE connect_id = ?", args.connectId);
    }
    throw chatGptRpcError(error);
  }
  ctx.db.run("DELETE FROM engine_connects WHERE connect_id = ?", args.connectId);

  let accountId =
    connect.account_id ??
    ctx.db.one<{ account_id: string }>(
      "SELECT account_id FROM engine_accounts WHERE provider = 'chatgpt' AND identity = ?",
      callback.clientId,
    )?.account_id ??
    null;
  let expectedSubject: string | undefined;
  if (accountId) {
    const row = chatGptAccount(ctx.db, accountId);
    if (!row) throw new RpcError("NOT_FOUND", "That ChatGPT account isn't saved anymore.");
    expectedSubject = await decryptPayload(ctx, "chatgpt", row.payload)
      .then((payload) => payload.subject)
      .catch(() => undefined);
  } else {
    accountId = writeAccount(
      ctx,
      "chatgpt",
      {
        payload: await encryptPayload(ctx, "chatgpt", reauthPayload(callback.clientId)),
        status: "reauth_required",
      },
      { identity: callback.clientId },
    );
  }

  let registration: ChatGptRegistration;
  try {
    registration = await completeChatGptSignIn({
      callback,
      verifier: connect.verifier,
      nonce: connect.nonce,
      redirectUri: connect.redirect_uri,
      ...(expectedSubject ? { expectedSubject } : {}),
    });
  } catch (error) {
    throw chatGptRpcError(error);
  }
  const payload: StoredEnginePayload = {
    access: registration.tokens.access,
    refresh: registration.tokens.refresh,
    expires: registration.tokens.expiresAt,
    clientId: registration.clientId,
    subject: registration.subject,
    scopes: registration.tokens.scopes,
    ...(registration.tokens.earliestRefreshAt !== undefined
      ? { earliestRefreshAt: registration.tokens.earliestRefreshAt }
      : {}),
  };
  writeAccount(
    ctx,
    "chatgpt",
    {
      payload: await encryptPayload(ctx, "chatgpt", payload),
      planUsage: registration.planUsage,
    },
    {
      identity: registration.clientId,
      ...(registration.email ? { email: registration.email } : {}),
      ...(registration.name ? { name: registration.name } : {}),
    },
  );
  shareRegistration(ctx, {
    clientId: registration.clientId,
    ...(registration.email ? { email: registration.email } : {}),
    ...(registration.name ? { name: registration.name } : {}),
  });
  return { accountId, planUsage: registration.planUsage };
};

const listModels = async (
  ctx: OwnerContext,
  _args: EngineCalls["engines.listModels"]["args"],
): Promise<EngineCalls["engines.listModels"]["result"]> => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "engines.listModels",
    { count: 30, windowMs: 60_000 },
    "Too many model list requests. Please wait a moment.",
  );
  const access = await sharedAccess(ctx);
  if (!access || "needsSignIn" in access) return null;
  try {
    return { models: await listChatGptModels(access.accessToken) };
  } catch (error) {
    throw chatGptRpcError(error);
  }
};

const signOutChatGpt = async (ctx: OwnerContext, row: AccountRow): Promise<boolean> => {
  let payload: StoredEnginePayload | null = null;
  try {
    payload = await decryptPayload(ctx, "chatgpt", row.payload);
  } catch {
    payload = null;
  }
  const revoked =
    payload?.clientId && payload.refresh
      ? await revokeChatGptRefreshToken({ clientId: payload.clientId, refreshToken: payload.refresh })
      : true;
  if (payload?.clientId) {
    const kept = await encryptPayload(ctx, "chatgpt", reauthPayload(payload.clientId, payload.subject));
    ctx.db.run(
      `UPDATE engine_accounts SET payload = ?, status = 'signed_out',
         updated_at = ? WHERE account_id = ? AND payload = ?`,
      kept,
      Date.now(),
      row.account_id,
      row.payload,
    );
  } else {
    ctx.db.run("DELETE FROM engine_accounts WHERE account_id = ?", row.account_id);
  }
  return revoked;
};

const disconnect = async (
  ctx: OwnerContext,
  args: EngineCalls["engines.disconnect"]["args"],
): Promise<EngineCalls["engines.disconnect"]["result"]> => {
  const targets = accountsOf(ctx.db, args.provider).filter(
    (row) => !args.accountId || row.account_id === args.accountId,
  );
  let revoked = true;
  if (args.provider === "chatgpt") {
    for (const row of targets) {
      if (row.status !== "signed_out" && !(await signOutChatGpt(ctx, row))) revoked = false;
      if (args.forget) ctx.db.run("DELETE FROM engine_accounts WHERE account_id = ?", row.account_id);
    }
  } else {
    for (const row of targets) {
      const inCloud = ctx.db.one(
        "SELECT 1 AS present FROM engine_claude_places WHERE account_id = ? AND place = 'cloud'",
        row.account_id,
      );
      if (inCloud) await signOutClaudeCloudRow(ctx, row).catch(() => undefined);
      ctx.db.run("DELETE FROM engine_claude_choices WHERE account_id = ?", row.account_id);
      ctx.db.run("DELETE FROM engine_claude_places WHERE account_id = ?", row.account_id);
      ctx.db.run("DELETE FROM engine_accounts WHERE account_id = ?", row.account_id);
    }
  }
  const remaining = accountsOf(ctx.db, args.provider);
  const servable = remaining.filter(isServable);
  if (args.provider === "chatgpt") {
    const settings = providerSettings(ctx.db, args.provider);
    if (!servable.some((row) => row.account_id === settings?.active_account_id)) {
      writeActiveAccount(ctx, args.provider, servable[0]?.account_id ?? null);
    }
  }
  if (servable.length === 0 && readSelection(ctx.db).selection.engine === args.provider) {
    writeSelection(ctx, DEFAULT_EXECUTION);
  }
  return args.provider === "chatgpt" ? { revoked } : null;
};

const setActiveAccount = (
  ctx: OwnerContext,
  args: EngineCalls["engines.setActiveAccount"]["args"],
): null => {
  const account = ctx.db.one<{ account_id: string }>(
    "SELECT account_id FROM engine_accounts WHERE provider = ? AND account_id = ?",
    args.provider,
    args.accountId,
  );
  if (!account) throw new RpcError("NOT_FOUND", "That account isn't connected anymore.");
  if (args.provider === "chatgpt") {
    writeActiveAccount(ctx, args.provider, account.account_id);
    return null;
  }
  writeClaudeChoice(ctx, account.account_id);
  return null;
};

const writeClaudeChoice = (ctx: OwnerContext, accountId: string | null): void => {
  if (!accountId) {
    ctx.db.run("DELETE FROM engine_claude_choices WHERE place = ?", EVERY_PLACE);
    return;
  }
  ctx.db.run(
    `INSERT INTO engine_claude_choices (place, account_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (place) DO UPDATE SET account_id = excluded.account_id, updated_at = excluded.updated_at`,
    EVERY_PLACE,
    accountId,
    ctx.now,
  );
};

const chooseClaudeAccount = (
  ctx: OwnerContext,
  args: EngineCalls["engines.chooseClaudeAccount"]["args"],
): null => {
  if (args.accountId && !claudeAccount(ctx.db, args.accountId)) {
    throw new RpcError("NOT_FOUND", "That account isn't connected anymore.");
  }
  writeClaudeChoice(ctx, args.accountId ?? null);
  return null;
};

const relayClaudeLogin = async (
  ctx: OwnerContext,
  deviceId: string,
  method: "claude.login.start" | "claude.login.finish" | "claude.login.cancel",
  params: Record<string, unknown>,
): Promise<unknown> => {
  const devices = await ctx.host.deviceDestinations().catch(() => []);
  const device = devices.find((candidate) => candidate.deviceId === deviceId);
  const label = device?.label?.trim() || "That computer";
  if (!device) {
    throw new RpcError("NOT_FOUND", "That computer isn't signed in to this Stella account anymore.");
  }
  if (!device.online) {
    throw new RpcError("UNAVAILABLE", `${label} is offline. Open Stella there and try again.`, {
      retryable: true,
      reason: "device_offline",
    });
  }
  if (!device.remoteExecutionEnabled) {
    ctx.host.askDeviceConsent({ deviceId, requestedAt: ctx.now });
    throw new RpcError(
      "FORBIDDEN",
      `${label} isn't accepting work from your other devices. Stella asked there; once it's allowed, try again.`,
      { retryable: true, reason: "device_not_enabled" },
    );
  }
  const answer = await ctx.host.relayDeviceRequest({ deviceId, method, params });
  if (answer.ok) return answer.value;
  if (answer.code === "device_offline") {
    throw new RpcError("UNAVAILABLE", `${label} is offline. Open Stella there and try again.`, {
      retryable: true,
      reason: "device_offline",
    });
  }
  if (answer.code === "bad_request" && /unknown request/iu.test(answer.message)) {
    throw badRequest(`Update Stella on ${label} to sign it in from here.`);
  }
  throw badRequest(answer.message);
};

const startClaudeDeviceLogin = async (
  ctx: OwnerContext,
  args: EngineCalls["engines.startClaudeDeviceLogin"]["args"],
): Promise<EngineCalls["engines.startClaudeDeviceLogin"]["result"]> => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "engines.startClaudeDeviceLogin",
    { count: 20, windowMs: 10 * 60_000 },
    "Too many sign-in attempts. Try again in a few minutes.",
  );
  const email = text(args.email);
  const value = (await relayClaudeLogin(ctx, args.deviceId, "claude.login.start", {
    ...(email ? { email } : {}),
  })) as { loginId?: unknown; authorizeUrl?: unknown } | null;
  const loginId = typeof value?.loginId === "string" ? value.loginId : "";
  const authorizeUrl = typeof value?.authorizeUrl === "string" ? value.authorizeUrl : "";
  if (!loginId || !/^https:\/\//u.test(authorizeUrl)) {
    throw new RpcError("UNAVAILABLE", "That computer didn't start the sign-in. Try again.", {
      retryable: true,
    });
  }
  return { loginId, authorizeUrl };
};

const finishClaudeDeviceLogin = async (
  ctx: OwnerContext,
  args: EngineCalls["engines.finishClaudeDeviceLogin"]["args"],
): Promise<EngineCalls["engines.finishClaudeDeviceLogin"]["result"]> => {
  const value = (await relayClaudeLogin(ctx, args.deviceId, "claude.login.finish", {
    loginId: args.loginId,
    code: args.code.trim(),
  })) as { email?: unknown } | null;
  return typeof value?.email === "string" && value.email ? { email: value.email } : {};
};

const cancelClaudeDeviceLogin = async (
  ctx: OwnerContext,
  args: EngineCalls["engines.cancelClaudeDeviceLogin"]["args"],
): Promise<null> => {
  await relayClaudeLogin(ctx, args.deviceId, "claude.login.cancel", {
    loginId: args.loginId,
  }).catch(() => undefined);
  return null;
};

const setExecution = (
  ctx: OwnerContext,
  args: EngineCalls["engines.setExecution"]["args"],
): null => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "engines.setExecution",
    { count: 60, windowMs: 60_000 },
    "Too many model changes. Please wait a moment.",
  );
  writeSelection(ctx, args.execution);
  return null;
};

/**
 * One resolution per owner at a time: a ChatGPT refresh can rotate and
 * invalidate its input token, so concurrent callers share it.
 */
const resolving = new Map<string, Promise<EngineAccessResult>>();

const ACCESS_MIN_VALIDITY_MS = 10 * 60_000;
const ACCESS_EXPIRY_MARGIN_MS = 60_000;

const toAccess = (payload: StoredEnginePayload, engineAccountId: string): EngineAccessResponse => ({
  accessToken: payload.access,
  engineAccountId,
  expiresAt: payload.expires,
});

const resolveAccess = async (ctx: OwnerContext): Promise<EngineAccessResult> => {
  const provider = "chatgpt" as const;
  let row = activeAccountOf(accountsOf(ctx.db, provider), providerSettings(ctx.db, provider));
  if (!row) {
    const stale = accountsOf(ctx.db, provider).find((account) => account.status === "reauth_required");
    return stale ? { needsSignIn: true, engineAccountId: stale.account_id } : null;
  }
  let payload: StoredEnginePayload;
  try {
    payload = await decryptPayload(ctx, provider, row.payload);
  } catch (error) {
    if (error instanceof RpcError) throw error;
    return null;
  }
  if (!isCurrentKeyVersion(ctx.env, row.payload)) {
    const encrypted = await encryptPayload(ctx, provider, payload);
    ctx.db.run(
      "UPDATE engine_accounts SET payload = ? WHERE account_id = ? AND payload = ?",
      encrypted,
      row.account_id,
      row.payload,
    );
    row = { ...row, payload: encrypted };
  }
  const now = Date.now();
  const usable = payload.expires > now + ACCESS_EXPIRY_MARGIN_MS;
  const due =
    payload.expires <= now + ACCESS_MIN_VALIDITY_MS &&
    (payload.earliestRefreshAt === undefined || payload.earliestRefreshAt <= now || !usable);
  if (!due && usable) return toAccess(payload, row.account_id);
  if (!payload.clientId || !payload.refresh || !payload.subject) {
    return { needsSignIn: true, engineAccountId: row.account_id };
  }

  let refreshed: ChatGptTokenSet;
  try {
    refreshed = await refreshChatGptTokens({
      clientId: payload.clientId,
      refreshToken: payload.refresh,
      scopes: payload.scopes ?? [],
      subject: payload.subject,
    });
  } catch (error) {
    const unusable =
      error instanceof ChatGptError &&
      (CHATGPT_UNUSABLE_REFRESH_CODES.has(error.code) ||
        error.code === "invalid_client" ||
        error.code === "account_mismatch");
    if (!unusable) return usable ? toAccess(payload, row.account_id) : null;
    const kept = await encryptPayload(ctx, provider, reauthPayload(payload.clientId, payload.subject));
    ctx.db.run(
      `UPDATE engine_accounts SET payload = ?, status = 'reauth_required', updated_at = ?
       WHERE account_id = ? AND payload = ?`,
      kept,
      Date.now(),
      row.account_id,
      row.payload,
    );
    return { needsSignIn: true, engineAccountId: row.account_id };
  }
  const next: StoredEnginePayload = {
    access: refreshed.access,
    refresh: refreshed.refresh,
    expires: refreshed.expiresAt,
    clientId: payload.clientId,
    subject: payload.subject,
    scopes: refreshed.scopes,
    ...(refreshed.earliestRefreshAt !== undefined
      ? { earliestRefreshAt: refreshed.earliestRefreshAt }
      : {}),
  };
  const encrypted = await encryptPayload(ctx, provider, next);
  const current = ctx.db.one<{ payload: string }>(
    "SELECT payload FROM engine_accounts WHERE account_id = ?",
    row.account_id,
  );
  if (current?.payload !== row.payload) return null;
  ctx.db.run(
    "UPDATE engine_accounts SET payload = ?, plan_usage = ?, updated_at = ? WHERE account_id = ?",
    encrypted,
    hasChatGptPlanUsage(refreshed.scopes) ? 1 : 0,
    Date.now(),
    row.account_id,
  );
  return toAccess(next, row.account_id);
};

const sharedAccess = async (ctx: OwnerContext): Promise<EngineAccessResult> => {
  const key = ctx.ownerId;
  const pending = resolving.get(key);
  if (pending) return await pending;
  const run = resolveAccess(ctx).finally(() => resolving.delete(key));
  resolving.set(key, run);
  return await run;
};

const engineAccess = async (ctx: OwnerContext, raw: unknown): Promise<EngineAccessResult> => {
  object({ provider: literal("chatgpt") })(raw);
  return await sharedAccess(ctx);
};

export const enginesDomain = {
  name: "engines",
  migrations: [
    ENGINES_MIGRATION,
    ENGINE_ACCOUNTS_MIGRATION,
    ENGINE_DEVICE_REFRESH_MIGRATION,
    ENGINE_CHATGPT_SIWC_MIGRATION,
    ENGINE_CLI_LOGINS_MIGRATION,
    ENGINE_PROVIDER_SELECTION_MIGRATION,
    ENGINE_CLAUDE_PER_PLACE_MIGRATION,
    ENGINE_CLAUDE_ONE_CHOICE_MIGRATION,
  ],
  views: {
    "engines.get": {
      parse: empty(),
      read: (ctx) => readSettings(ctx.db),
    },
  },
  calls: {
    "engines.cancelConnect": {
      scope: "owner",
      parse: object({ connectId: string({ min: 1, max: 64 }) }),
      handler: (ctx, { connectId }) => {
        ctx.db.run("DELETE FROM engine_connects WHERE connect_id = ?", connectId);
        return null;
      },
    },
    "engines.startConnect": {
      scope: "owner",
      parse: object({
        provider: literal("chatgpt"),
        redirectPort: optional(number({ int: true, min: 1024, max: 65_535 })),
        accountId: optional(string({ min: 1, max: 64 })),
        clientId: optional(string({ min: 1, max: 256 })),
        enablePlanUsage: optional(boolean()),
      }),
      handler: startConnect,
    },
    "engines.finishConnect": {
      scope: "owner",
      parse: object({
        connectId: string({ min: 1, max: 64 }),
        pastedInput: string({ min: 1, max: 8_192 }),
      }),
      handler: finishConnect,
    },
    "engines.shareChatGptRegistration": {
      scope: "owner",
      parse: object({
        clientId: string({ min: 1, max: 256 }),
        email: optional(string({ max: 512 })),
        name: optional(string({ max: 512 })),
      }),
      handler: shareChatGptRegistration,
    },
    "engines.reportClaudeLogins": {
      scope: "owner",
      parse: object({
        deviceId: string({ min: 1, max: 128 }),
        deviceName: optional(string({ max: 256 })),
        logins: array(
          object({
            email: string({ min: 3, max: 320 }),
            plan: optional(string({ max: 64 })),
            isDefault: optional(boolean()),
          }),
          { max: 20 },
        ),
        cliInstalled: optional(boolean()),
      }),
      handler: reportClaudeLogins,
    },
    "engines.chooseClaudeAccount": {
      scope: "owner",
      parse: object({ accountId: optional(string({ min: 1, max: 64 })) }),
      handler: chooseClaudeAccount,
    },
    "engines.startClaudeDeviceLogin": {
      scope: "owner",
      parse: object({
        deviceId: string({ min: 1, max: 128 }),
        email: optional(string({ max: 320 })),
      }),
      handler: startClaudeDeviceLogin,
    },
    "engines.finishClaudeDeviceLogin": {
      scope: "owner",
      parse: object({
        deviceId: string({ min: 1, max: 128 }),
        loginId: string({ min: 1, max: 64 }),
        code: string({ min: 1, max: 2_048 }),
      }),
      handler: finishClaudeDeviceLogin,
    },
    "engines.cancelClaudeDeviceLogin": {
      scope: "owner",
      parse: object({
        deviceId: string({ min: 1, max: 128 }),
        loginId: string({ min: 1, max: 64 }),
      }),
      handler: cancelClaudeDeviceLogin,
    },
    "engines.startClaudeCloudLogin": {
      scope: "owner",
      parse: object({ email: optional(string({ max: 320 })) }),
      handler: startClaudeCloud,
    },
    "engines.finishClaudeCloudLogin": {
      scope: "owner",
      parse: object({
        loginId: string({ min: 1, max: 64 }),
        code: string({ min: 1, max: 2_048 }),
      }),
      handler: finishClaudeCloud,
    },
    "engines.cancelClaudeCloudLogin": {
      scope: "owner",
      parse: object({ loginId: string({ min: 1, max: 64 }) }),
      handler: cancelClaudeCloud,
    },
    "engines.signOutClaudeCloud": {
      scope: "owner",
      parse: object({ accountId: string({ min: 1, max: 64 }) }),
      handler: signOutClaudeCloud,
    },
    "engines.disconnect": {
      scope: "owner",
      parse: object({
        provider: literal(...ENGINE_PROVIDERS),
        accountId: optional(string({ min: 1, max: 64 })),
        forget: optional(boolean()),
      }),
      handler: disconnect,
    },
    "engines.setActiveAccount": {
      scope: "owner",
      parse: object({
        provider: literal(...ENGINE_PROVIDERS),
        accountId: string({ min: 1, max: 64 }),
        deviceId: optional(string({ min: 1, max: 128 })),
      }),
      handler: setActiveAccount,
    },
    "engines.setExecution": {
      scope: "owner",
      parse: object({ execution: parseExecution }),
      handler: setExecution,
    },
    "engines.listModels": {
      scope: "owner",
      parse: object({ provider: literal("chatgpt") }),
      handler: listModels,
    },
  },
  credentials: {
    chatgpt: engineAccess,
  },
  internal: {
    "engines.claudeCloudAccount": (ctx) => claudeCloudAccount(ctx),
  },
  purge: async (ctx) => {
    await deleteClaudeCloudLoginBackup(ctx.env, ctx.ownerId);
    ctx.db.run("DELETE FROM engine_accounts");
    ctx.db.run("DELETE FROM engine_claude_places");
    ctx.db.run("DELETE FROM engine_claude_choices");
    ctx.db.run("DELETE FROM engine_claude_logins");
    ctx.db.run("DELETE FROM engine_claude_devices");
    ctx.db.run("DELETE FROM engine_chatgpt_registrations");
    ctx.db.run("DELETE FROM engine_provider_settings");
    ctx.db.run("DELETE FROM engine_connects");
    ctx.db.run("DELETE FROM engine_settings");
    return { pending: false };
  },
} satisfies OwnerDomain;
