import {
  integrationSupportsMultipleAccounts,
  type IntegrationAccount,
} from "@stella/contracts/backend/integrations";
import {
  composioExecute,
  composioPrincipalFor,
  createComposioSession,
  deleteComposioAccount,
  deleteComposioSession,
  listComposioAccounts,
  purgeComposioConnection,
  type ComposioAccount,
  type ComposioConfig,
} from "../../integrations/composio.js";
import { RpcError } from "../errors.js";
import type { OwnerContext, OwnerDbReader } from "../registry.js";

export const INTEGRATION_ACCOUNTS_MIGRATION = {
  id: "integrations.2-accounts",
  statements: [
    `CREATE TABLE integration_accounts (
       integration_id TEXT NOT NULL,
       account_id TEXT NOT NULL,
       toolkit TEXT NOT NULL,
       session_id TEXT NOT NULL,
       email TEXT,
       is_primary INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (integration_id, account_id)
     )`,
    `INSERT INTO integration_accounts (integration_id, account_id, toolkit, session_id, is_primary, created_at)
       SELECT integration_id, '', toolkit, session_id, 1, created_at FROM integration_connections
        WHERE integration_id = 'gmail' OR (integration_id LIKE 'google%' AND integration_id <> 'googleads')`,
    "ALTER TABLE integration_connections ADD COLUMN multi_account INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE connect_requests ADD COLUMN add_account INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE connect_requests ADD COLUMN baseline_accounts INTEGER NOT NULL DEFAULT 0",
  ],
};

export type IntegrationRef = { id: string; toolkit: string };

type AccountRow = {
  account_id: string;
  toolkit: string;
  session_id: string;
  email: string | null;
  is_primary: number;
  created_at: number;
};

export type ResolvedIntegrationAccount = {
  accountId: string;
  sessionId: string;
  email?: string;
  label: string;
  primary: boolean;
};

const SYNC_TTL_MS = 30_000;
const LEGACY_ACCOUNT_ID = "";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const IDENTITY_PROBES: Record<string, { action: string; input: Record<string, unknown> }> = {
  gmail: { action: "GMAIL_GET_PROFILE", input: { user_id: "me" } },
  googlecalendar: { action: "GOOGLECALENDAR_GET_CALENDAR", input: { calendar_id: "primary" } },
  googledrive: { action: "GOOGLEDRIVE_GET_ABOUT", input: { fields: "user" } },
};

export const isMultiAccountIntegration = (id: string): boolean => integrationSupportsMultipleAccounts(id);

export const principalOf = async (ctx: OwnerContext): Promise<string> => {
  const row = ctx.db.one<{ composio_user_id: string }>(
    "SELECT composio_user_id FROM integration_principal WHERE id = 1",
  );
  if (row) return row.composio_user_id;
  const userId = await composioPrincipalFor(ctx.ownerId);
  ctx.db.run(
    "INSERT OR IGNORE INTO integration_principal (id, composio_user_id, created_at) VALUES (1, ?, ?)",
    userId,
    ctx.now,
  );
  return userId;
};

const linkSessionOf = (db: OwnerDbReader, integrationId: string) =>
  db.one<{ session_id: string; toolkit: string; multi_account: number }>(
    "SELECT session_id, toolkit, multi_account FROM integration_connections WHERE integration_id = ?",
    integrationId,
  );

const sessionInUse = (db: OwnerDbReader, sessionId: string): boolean =>
  Boolean(
    db.one("SELECT 1 AS used FROM integration_accounts WHERE session_id = ?", sessionId) ??
      db.one("SELECT 1 AS used FROM integration_connections WHERE session_id = ?", sessionId),
  );

/**
 * The integration's link session: the unpinned session whose connect links
 * add accounts. Multi-account integrations need one created in Composio's
 * multi-account mode so a second link adds an account instead of replacing.
 */
export const ensureLinkSession = async (
  ctx: OwnerContext,
  config: ComposioConfig,
  integration: IntegrationRef,
): Promise<string> => {
  const multi = isMultiAccountIntegration(integration.id);
  const usable = (row: ReturnType<typeof linkSessionOf>) => row && (!multi || row.multi_account === 1);
  const existing = linkSessionOf(ctx.db, integration.id);
  if (existing && usable(existing)) return existing.session_id;
  const sessionId = await createComposioSession(
    config,
    await principalOf(ctx),
    integration.toolkit,
    multi ? { multiAccount: true } : {},
  );
  const raced = linkSessionOf(ctx.db, integration.id);
  if (raced && usable(raced)) {
    await deleteComposioSession(config, sessionId).catch(() => undefined);
    return raced.session_id;
  }
  if (raced) {
    ctx.db.run(
      "UPDATE integration_connections SET session_id = ?, multi_account = 1 WHERE integration_id = ?",
      sessionId,
      integration.id,
    );
    if (!sessionInUse(ctx.db, raced.session_id)) {
      await deleteComposioSession(config, raced.session_id).catch(() => undefined);
    }
    return sessionId;
  }
  ctx.db.run(
    `INSERT INTO integration_connections (integration_id, toolkit, session_id, created_at, multi_account)
     VALUES (?, ?, ?, ?, ?)`,
    integration.id,
    integration.toolkit,
    sessionId,
    ctx.now,
    multi ? 1 : 0,
  );
  return sessionId;
};

const accountRowsOf = (db: OwnerDbReader, integrationId: string): AccountRow[] =>
  db.all<AccountRow>(
    `SELECT account_id, toolkit, session_id, email, is_primary, created_at
       FROM integration_accounts WHERE integration_id = ? ORDER BY created_at, account_id`,
    integrationId,
  );

const ensurePrimary = (ctx: OwnerContext, integrationId: string): void => {
  const rows = accountRowsOf(ctx.db, integrationId);
  const primaries = rows.filter((row) => row.is_primary === 1);
  if (primaries.length === 1 || rows.length === 0) return;
  const keep = primaries[0] ?? rows[0]!;
  ctx.db.run(
    "UPDATE integration_accounts SET is_primary = CASE WHEN account_id = ? THEN 1 ELSE 0 END WHERE integration_id = ?",
    keep.account_id,
    integrationId,
  );
};

const findEmail = (value: unknown, depth = 0): string | undefined => {
  if (depth > 5 || !value || typeof value !== "object") return undefined;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && /email|^id$/iu.test(key) && EMAIL_PATTERN.test(entry.trim())) {
      return entry.trim().toLowerCase();
    }
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const found = findEmail(entry, depth + 1);
    if (found) return found;
  }
  return undefined;
};

const probeIdentity = async (
  config: ComposioConfig,
  sessionId: string,
  toolkit: string,
): Promise<string | undefined> => {
  const probe = IDENTITY_PROBES[toolkit.toLowerCase()];
  if (!probe) return undefined;
  try {
    return findEmail(await composioExecute(config, sessionId, probe));
  } catch {
    return undefined;
  }
};

const pinnedSession = async (
  ctx: OwnerContext,
  config: ComposioConfig,
  integration: IntegrationRef,
  accountId: string,
): Promise<string> =>
  await createComposioSession(config, await principalOf(ctx), integration.toolkit, {
    connectedAccountId: accountId,
  });

const lastSync = new Map<string, { at: number; active: ReadonlySet<string> }>();
const inflightSync = new Map<string, Promise<ReadonlySet<string>>>();

const syncKey = (ctx: OwnerContext, integrationId: string) => `${ctx.ownerId}\0${integrationId}`;

const reconcile = async (
  ctx: OwnerContext,
  config: ComposioConfig,
  integration: IntegrationRef,
): Promise<ReadonlySet<string>> => {
  if (!linkSessionOf(ctx.db, integration.id) && accountRowsOf(ctx.db, integration.id).length === 0) {
    return new Set();
  }
  const remote: ComposioAccount[] = await listComposioAccounts(config, integration.toolkit, await principalOf(ctx));
  const remoteById = new Map(remote.map((account) => [account.id, account]));
  const active = remote.filter((account) => account.status === "ACTIVE");
  const known = new Set(accountRowsOf(ctx.db, integration.id).map((row) => row.account_id));

  if (known.has(LEGACY_ACCOUNT_ID)) {
    const candidate = active.find((account) => !known.has(account.id));
    if (candidate) {
      const legacySession = accountRowsOf(ctx.db, integration.id).find(
        (row) => row.account_id === LEGACY_ACCOUNT_ID,
      )?.session_id;
      const sessionId = await pinnedSession(ctx, config, integration, candidate.id);
      ctx.db.run(
        `UPDATE integration_accounts SET account_id = ?, session_id = ?, email = COALESCE(email, ?)
          WHERE integration_id = ? AND account_id = ?`,
        candidate.id,
        sessionId,
        candidate.identity ?? null,
        integration.id,
        LEGACY_ACCOUNT_ID,
      );
      known.delete(LEGACY_ACCOUNT_ID);
      known.add(candidate.id);
      if (legacySession && !sessionInUse(ctx.db, legacySession)) {
        await deleteComposioSession(config, legacySession).catch(() => undefined);
      }
    }
  }

  for (const account of active) {
    if (known.has(account.id)) continue;
    const sessionId = await pinnedSession(ctx, config, integration, account.id);
    ctx.db.run(
      `INSERT OR IGNORE INTO integration_accounts
         (integration_id, account_id, toolkit, session_id, email, is_primary, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      integration.id,
      account.id,
      integration.toolkit,
      sessionId,
      account.identity ?? null,
      Date.now(),
    );
    const stored = ctx.db.one<{ session_id: string }>(
      "SELECT session_id FROM integration_accounts WHERE integration_id = ? AND account_id = ?",
      integration.id,
      account.id,
    );
    if (stored?.session_id !== sessionId) {
      await deleteComposioSession(config, sessionId).catch(() => undefined);
    }
    known.add(account.id);
  }

  for (const row of accountRowsOf(ctx.db, integration.id)) {
    if (row.account_id === LEGACY_ACCOUNT_ID || remoteById.has(row.account_id)) continue;
    ctx.db.run(
      "DELETE FROM integration_accounts WHERE integration_id = ? AND account_id = ?",
      integration.id,
      row.account_id,
    );
    if (!sessionInUse(ctx.db, row.session_id)) {
      await deleteComposioSession(config, row.session_id).catch(() => undefined);
    }
  }

  const activeIds = new Set(active.map((account) => account.id));
  for (const row of accountRowsOf(ctx.db, integration.id)) {
    if (row.email || !activeIds.has(row.account_id)) continue;
    const email = await probeIdentity(config, row.session_id, integration.toolkit);
    if (email) {
      ctx.db.run(
        "UPDATE integration_accounts SET email = ? WHERE integration_id = ? AND account_id = ?",
        email,
        integration.id,
        row.account_id,
      );
    }
  }
  ensurePrimary(ctx, integration.id);
  if (accountRowsOf(ctx.db, integration.id).some((row) => row.account_id === LEGACY_ACCOUNT_ID)) {
    activeIds.add(LEGACY_ACCOUNT_ID);
  }
  return activeIds;
};

/**
 * Brings `integration_accounts` in line with the user's Composio accounts
 * for this toolkit: pins a session to each new account, adopts a
 * pre-multi-account connection as the primary, and drops deleted ones.
 */
export const syncIntegrationAccounts = async (
  ctx: OwnerContext,
  config: ComposioConfig,
  integration: IntegrationRef,
  options: { force?: boolean } = {},
): Promise<ReadonlySet<string>> => {
  const key = syncKey(ctx, integration.id);
  const cached = lastSync.get(key);
  if (!options.force && cached && Date.now() - cached.at < SYNC_TTL_MS) return cached.active;
  let run = inflightSync.get(key);
  if (!run) {
    run = reconcile(ctx, config, integration)
      .then((active) => {
        lastSync.set(key, { at: Date.now(), active });
        return active;
      })
      .finally(() => inflightSync.delete(key));
    inflightSync.set(key, run);
  }
  return await run;
};

export const forgetIntegrationAccountSync = (ctx: OwnerContext, integrationId: string): void => {
  lastSync.delete(syncKey(ctx, integrationId));
};

const labelOf = (row: AccountRow, index: number): string =>
  row.email ?? (index === 0 ? "Connected account" : `Account ${index + 1}`);

export const integrationAccounts = (
  db: OwnerDbReader,
  integrationId: string,
  active: ReadonlySet<string>,
): IntegrationAccount[] =>
  accountRowsOf(db, integrationId).map((row, index) => ({
    id: row.account_id || "primary",
    ...(row.email ? { email: row.email } : {}),
    label: labelOf(row, index),
    primary: row.is_primary === 1,
    connected: active.has(row.account_id),
  }));

const matches = (row: AccountRow, index: number, wanted: string): boolean =>
  row.account_id === wanted ||
  (row.account_id === LEGACY_ACCOUNT_ID && wanted === "primary") ||
  row.email?.toLowerCase() === wanted ||
  labelOf(row, index).toLowerCase() === wanted;

const describeAccounts = (db: OwnerDbReader, integrationId: string): string =>
  accountRowsOf(db, integrationId)
    .map((row, index) => `${labelOf(row, index)}${row.is_primary === 1 ? " (primary)" : ""}`)
    .join(", ");

export const accountsSummaryText = describeAccounts;

const toResolved = (row: AccountRow, index: number): ResolvedIntegrationAccount => ({
  accountId: row.account_id,
  sessionId: row.session_id,
  ...(row.email ? { email: row.email } : {}),
  label: labelOf(row, index),
  primary: row.is_primary === 1,
});

/** The account an action runs as: the one named by email (or id), else the primary. */
export const resolveIntegrationAccount = async (
  ctx: OwnerContext,
  config: ComposioConfig,
  integration: IntegrationRef,
  requested?: string,
): Promise<ResolvedIntegrationAccount> => {
  const pick = (): ResolvedIntegrationAccount | null => {
    const rows = accountRowsOf(ctx.db, integration.id);
    if (rows.length === 0) return null;
    const wanted = requested?.trim().toLowerCase();
    if (!wanted) {
      const index = Math.max(0, rows.findIndex((row) => row.is_primary === 1));
      return toResolved(rows[index]!, index);
    }
    const index = rows.findIndex((row, position) => matches(row, position, wanted));
    return index >= 0 ? toResolved(rows[index]!, index) : null;
  };
  await syncIntegrationAccounts(ctx, config, integration).catch((error: unknown) => {
    console.error(JSON.stringify({
      event: "integration_accounts_sync_failed",
      integrationId: integration.id,
      message: error instanceof Error ? error.message : String(error),
    }));
  });
  let resolved = pick();
  if (!resolved && requested) {
    await syncIntegrationAccounts(ctx, config, integration, { force: true }).catch(() => undefined);
    resolved = pick();
  }
  if (resolved) return resolved;
  if (accountRowsOf(ctx.db, integration.id).length === 0) {
    throw new RpcError("CONFLICT", "Connect this integration before using it.", { reason: "not_connected" });
  }
  throw new RpcError(
    "BAD_REQUEST",
    `No connected account matches "${requested}". Connected: ${describeAccounts(ctx.db, integration.id)}.`,
  );
};

export const setPrimaryIntegrationAccount = async (
  ctx: OwnerContext,
  config: ComposioConfig,
  integration: IntegrationRef,
  account: string,
): Promise<IntegrationAccount[]> => {
  const target = await resolveIntegrationAccount(ctx, config, integration, account);
  ctx.db.run(
    "UPDATE integration_accounts SET is_primary = CASE WHEN account_id = ? THEN 1 ELSE 0 END WHERE integration_id = ?",
    target.accountId,
    integration.id,
  );
  return integrationAccounts(ctx.db, integration.id, await syncIntegrationAccounts(ctx, config, integration));
};

export const removeIntegrationAccount = async (
  ctx: OwnerContext,
  config: ComposioConfig,
  integration: IntegrationRef,
  account: string,
): Promise<IntegrationAccount[]> => {
  const target = await resolveIntegrationAccount(ctx, config, integration, account);
  const remaining = accountRowsOf(ctx.db, integration.id).filter((row) => row.account_id !== target.accountId);
  const link = linkSessionOf(ctx.db, integration.id);
  if (target.accountId === LEGACY_ACCOUNT_ID || remaining.length === 0) {
    await purgeComposioConnection(config, {
      sessionId: link?.session_id ?? null,
      toolkit: integration.toolkit,
      userId: await principalOf(ctx),
    });
    for (const row of accountRowsOf(ctx.db, integration.id)) {
      if (row.session_id !== link?.session_id) {
        await deleteComposioSession(config, row.session_id).catch(() => undefined);
      }
    }
    ctx.db.run("DELETE FROM integration_accounts WHERE integration_id = ?", integration.id);
    ctx.db.run("DELETE FROM integration_connections WHERE integration_id = ?", integration.id);
    forgetIntegrationAccountSync(ctx, integration.id);
    return [];
  }
  await deleteComposioAccount(config, target.accountId);
  if (target.sessionId !== link?.session_id) {
    await deleteComposioSession(config, target.sessionId).catch(() => undefined);
  }
  ctx.db.run(
    "DELETE FROM integration_accounts WHERE integration_id = ? AND account_id = ?",
    integration.id,
    target.accountId,
  );
  ensurePrimary(ctx, integration.id);
  forgetIntegrationAccountSync(ctx, integration.id);
  return integrationAccounts(
    ctx.db,
    integration.id,
    await syncIntegrationAccounts(ctx, config, integration, { force: true }),
  );
};

export const purgeIntegrationAccountSessions = async (
  ctx: OwnerContext,
  config: ComposioConfig | null,
  integrationId: string,
): Promise<void> => {
  const link = linkSessionOf(ctx.db, integrationId);
  for (const row of accountRowsOf(ctx.db, integrationId)) {
    if (config && row.session_id !== link?.session_id) {
      await deleteComposioSession(config, row.session_id).catch(() => undefined);
    }
  }
  ctx.db.run("DELETE FROM integration_accounts WHERE integration_id = ?", integrationId);
  forgetIntegrationAccountSync(ctx, integrationId);
};

export const accountSessionsFor = async (
  ctx: OwnerContext,
  config: ComposioConfig,
  integration: IntegrationRef,
): Promise<ResolvedIntegrationAccount[]> => {
  const active = await syncIntegrationAccounts(ctx, config, integration, { force: true });
  return accountRowsOf(ctx.db, integration.id)
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => active.has(row.account_id))
    .map(({ row, index }) => toResolved(row, index));
};
