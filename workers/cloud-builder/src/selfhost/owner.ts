/**
 * The self-hosted server's identity and its owner: one real, non-anonymous
 * Better Auth user created once by setup (`POST /api/admin/selfhost/owner`,
 * admin bearer), recorded with the server id and name in D1.
 */

import { createAuth } from "../auth/auth.js";
import { fail, json } from "../http/response.js";
import { ownerModeEnabled } from "./owner-mode.js";

export type ServerIdentity = { serverId: string; name: string; ownerUserId: string };

const OWNER_IDENTITY_LEVEL = 3;
const NAME_MAX = 80;
const DEFAULT_NAME = "Stella";

const db = (env: Cloudflare.Env): D1Database => {
  if (!env.DB) throw new Error("D1 is not bound.");
  return env.DB;
};

const randomId = (bytes: number): string =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

let cachedIdentity: { at: number; value: ServerIdentity | null } | undefined;
const IDENTITY_CACHE_MS = 30_000;

export const readServerIdentity = async (env: Cloudflare.Env, fresh = false): Promise<ServerIdentity | null> => {
  if (!ownerModeEnabled(env)) return null;
  if (!fresh && cachedIdentity && Date.now() - cachedIdentity.at < IDENTITY_CACHE_MS) return cachedIdentity.value;
  const row = await db(env)
    .prepare("SELECT server_id AS serverId, name, owner_user_id AS ownerUserId FROM selfhost_server WHERE id = 1")
    .first<ServerIdentity>();
  cachedIdentity = { at: Date.now(), value: row ?? null };
  return row ?? null;
};

const cleanName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, NAME_MAX);
  return name || null;
};

export const bootstrapOwnerRoute = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  if (!ownerModeEnabled(env)) return fail(404, "Owner mode is off.", { env: "STELLA_OWNER_MODE" });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown> | null;
  const requestedName = cleanName(body?.name);
  const existing = await readServerIdentity(env, true);
  const now = Date.now();
  if (existing) {
    if (requestedName && requestedName !== existing.name) {
      await db(env)
        .prepare("UPDATE selfhost_server SET name = ?, updated_at = ? WHERE id = 1")
        .bind(requestedName, now)
        .run();
      cachedIdentity = undefined;
    }
    return json({
      userId: existing.ownerUserId,
      serverId: existing.serverId,
      name: requestedName ?? existing.name,
      created: false,
    });
  }
  const serverId = `srv_${randomId(16)}`;
  const name = requestedName ?? DEFAULT_NAME;
  const context = await createAuth(env).$context;
  const user = await context.internalAdapter.createUser({
    email: `owner-${serverId.slice(4).toLowerCase()}@selfhost.stella.local`,
    name: "Owner",
    emailVerified: true,
    isAnonymous: false,
  } as never, { method: "admin" });
  const userId = (user as { id?: unknown } | null)?.id;
  if (typeof userId !== "string" || !userId) return fail(500, "Could not create the owner.");
  await context.internalAdapter.updateUser(userId, { identityLevel: OWNER_IDENTITY_LEVEL, isAnonymous: false });
  const inserted = await db(env)
    .prepare(
      `INSERT INTO selfhost_server (id, server_id, name, owner_user_id, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    )
    .bind(serverId, name, userId, now, now)
    .run();
  if (!inserted.meta.changes) {
    await db(env).prepare('DELETE FROM "user" WHERE "id" = ?').bind(userId).run();
    const winner = await readServerIdentity(env, true);
    if (!winner) return fail(500, "Could not record the owner.");
    return json({ userId: winner.ownerUserId, serverId: winner.serverId, name: winner.name, created: false });
  }
  cachedIdentity = undefined;
  console.log(JSON.stringify({ event: "selfhost_owner_created", serverId }));
  return json({ userId, serverId, name, created: true });
};
