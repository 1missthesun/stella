import { ownerGateStub } from "../rpc-release.js";
import { revokeOwnerSessions } from "../session-revocation.js";

export const signOutEverywhere = async (env: Cloudflare.Env, userId: string): Promise<void> => {
  if (!env.DB) throw new Error("D1 is not bound.");
  const signedIn = await env.DB.prepare('SELECT "id" FROM "session" WHERE "userId" = ?')
    .bind(userId)
    .all<{ id: string }>();
  const sessionIds = signedIn.results.map((row) => row.id);
  await revokeOwnerSessions(env, userId, { minIatMs: Date.now(), sessionIds, keepSockets: true });
  const gate = ownerGateStub(env.OWNER_GATES, userId);
  const { ownerGeneration } = await gate.snapshot();
  await gate.ownerInternal({ name: "devices.pushSessionsRevoked", args: {}, ownerGeneration });
  const deleted = await env.DB.prepare('DELETE FROM "session" WHERE "userId" = ? RETURNING "id"')
    .bind(userId)
    .all<{ id: string }>();
  await revokeOwnerSessions(env, userId, {
    minIatMs: Date.now(),
    sessionIds: [...new Set([...sessionIds, ...deleted.results.map((row) => row.id)])],
  });
};
