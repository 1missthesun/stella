import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { decryptToken, encryptToken, isCurrentTokenVersion } from "../slack/crypto.js";
import { betterAuthCipherKey, betterAuthKeys } from "../secret-rotation.js";
import { fail, json } from "../http/response.js";

type SlackColumn = { table: string; column: string; keys: string[] };

const SLACK_COLUMNS: SlackColumn[] = [
  { table: "slack_installations", column: "bot_token_enc", keys: ["team_id"] },
  { table: "slack_workspace_settings", column: "repo_token_enc", keys: ["team_id"] },
  { table: "slack_repos", column: "token_enc", keys: ["team_id", "id"] },
  { table: "slack_environment_secrets", column: "value_enc", keys: ["team_id", "id"] },
];

type Counts = { total: number; legacy: number; migrated: number; failed: number };

const emptyCounts = (): Counts => ({ total: 0, legacy: 0, migrated: 0, failed: 0 });

const isLegacyJwk = (privateKey: string): boolean => {
  try {
    const data = JSON.parse(privateKey) as unknown;
    return typeof data === "string" && !data.startsWith("$ba$");
  } catch {
    return false;
  }
};

const run = async (env: Cloudflare.Env, migrate: boolean): Promise<Response> => {
  const db = env.DB;
  if (!db) return fail(503, "D1 is not bound.");
  const keys = betterAuthKeys(env);
  if (!keys) return fail(503, "BETTER_AUTH_SECRET is not configured.");
  const rotating = keys.previous !== undefined;
  if (migrate && !rotating) return fail(409, "BETTER_AUTH_SECRET_V2 is not set; nothing to re-encrypt.");
  const cipherKey = betterAuthCipherKey(keys);

  const jwks = emptyCounts();
  const rows = await db.prepare('SELECT "id", "privateKey" FROM "jwks"').all<{ id: string; privateKey: string }>();
  for (const row of rows.results ?? []) {
    jwks.total += 1;
    if (!isLegacyJwk(row.privateKey)) continue;
    jwks.legacy += 1;
    if (!migrate) continue;
    try {
      const plain = await symmetricDecrypt({ key: cipherKey, data: JSON.parse(row.privateKey) as string });
      const sealed = JSON.stringify(await symmetricEncrypt({ key: cipherKey, data: plain }));
      const updated = await db
        .prepare('UPDATE "jwks" SET "privateKey" = ? WHERE "id" = ? AND "privateKey" = ?')
        .bind(sealed, row.id, row.privateKey)
        .run();
      if ((updated.meta.changes ?? 0) > 0) jwks.migrated += 1;
    } catch {
      jwks.failed += 1;
    }
  }

  const slack: Record<string, Counts> = {};
  for (const target of SLACK_COLUMNS) {
    const counts = emptyCounts();
    slack[`${target.table}.${target.column}`] = counts;
    const selected = await db
      .prepare(`SELECT ${target.keys.join(", ")}, ${target.column} AS sealed FROM ${target.table} WHERE ${target.column} IS NOT NULL`)
      .all<Record<string, string>>()
      .catch(() => ({ results: [] as Array<Record<string, string>> }));
    for (const row of selected.results ?? []) {
      const sealed = row.sealed ?? "";
      counts.total += 1;
      if (!sealed.startsWith("v1.")) continue;
      counts.legacy += 1;
      if (!migrate || isCurrentTokenVersion(env, sealed)) continue;
      try {
        const next = await encryptToken(env, await decryptToken(env, sealed));
        const updated = await db
          .prepare(
            `UPDATE ${target.table} SET ${target.column} = ? WHERE ${target.keys.map((key) => `${key} = ?`).join(" AND ")} AND ${target.column} = ?`,
          )
          .bind(next, ...target.keys.map((key) => row[key]), sealed)
          .run();
        if ((updated.meta.changes ?? 0) > 0) counts.migrated += 1;
      } catch {
        counts.failed += 1;
      }
    }
  }

  return json({ rotating, migrate, jwks, slack });
};

export const secretRotationStatus = (env: Cloudflare.Env): Promise<Response> => run(env, false);

export const secretRotationReencrypt = (env: Cloudflare.Env): Promise<Response> => run(env, true);
