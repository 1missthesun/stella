import type { EmailDigest, EmailDigestFeed } from "@stella/contracts/backend/email-digest-legacy";
import { empty } from "../args.js";
import type { OwnerDbReader, OwnerDomain } from "../registry.js";

/**
 * The October email digest, retired. Desktop and phone builds from before the
 * email redesign still open its section, so its calls answer as an idle
 * digest that found nothing new: the section looks quiet, not broken, and
 * still lists the digests the owner already had. Nothing is checked or sent.
 * Its tables (`email_digests`, `email_digest_state`, `email_digest_seen`)
 * are kept; nothing writes to them.
 */
const OLD_TABLES = ["email_digests", "email_digest_state", "email_digest_seen"] as const;

const hasTable = (db: OwnerDbReader, name: string): boolean =>
  Boolean(db.one("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?", name));

const parseItems = (json: string): EmailDigest["items"] => {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value)
      ? value.flatMap((raw) => {
          if (!raw || typeof raw !== "object") return [];
          const row = raw as Record<string, unknown>;
          const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : "");
          return [
            {
              from: text("from"),
              subject: text("subject"),
              summary: text("summary"),
              ...(text("threadId") ? { threadId: text("threadId") } : {}),
              ...(typeof row.receivedAt === "number" ? { receivedAt: row.receivedAt } : {}),
              ...(text("account") ? { account: text("account") } : {}),
            },
          ];
        })
      : [];
  } catch {
    return [];
  }
};

/** The owner's October digests, when their table is still the October one. */
const oldDigests = (db: OwnerDbReader): EmailDigest[] => {
  try {
    if (!hasTable(db, "email_digests")) return [];
    const columns = new Set(db.all<{ name: string }>("SELECT name FROM pragma_table_info('email_digests')").map((row) => row.name));
    if (!columns.has("items_json") || !columns.has("new_count")) return [];
    return db
      .all<{ digest_id: string; created_at: number; new_count: number; items_json: string }>(
        "SELECT digest_id, created_at, new_count, items_json FROM email_digests ORDER BY created_at DESC LIMIT 20",
      )
      .map((row) => ({ digestId: row.digest_id, createdAt: row.created_at, newCount: row.new_count, items: parseItems(row.items_json) }));
  } catch {
    return [];
  }
};

const idleFeed = (db: OwnerDbReader, now: number): EmailDigestFeed => ({
  status: { enabled: false, running: false, lastCheckedAt: now, lastOutcome: "nothing_new" },
  digests: oldDigests(db),
});

export const emailDigestLegacyDomain = {
  name: "emailDigest",
  calls: {
    "emailDigest.start": { scope: "owner", parse: empty(), handler: () => ({ connected: true }) },
    "emailDigest.checkNow": { scope: "owner", parse: empty(), handler: () => ({ connected: true }) },
  },
  views: {
    "emailDigest.feed": { parse: empty(), read: (ctx) => idleFeed(ctx.db, ctx.now) },
  },
  purge: (ctx) => {
    for (const table of OLD_TABLES) {
      // On dev stores `email_digests` may be the first version of the new table; clearing it is right there too.
      if (hasTable(ctx.db, table)) ctx.db.run(`DELETE FROM ${table}`);
    }
    return { pending: false };
  },
} satisfies OwnerDomain;
