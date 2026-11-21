import type { CachedStatements } from "./shared.js";

const MAX_ERROR_LENGTH = 500;

export type OutboxRepoOptions = {
  columns: string;
  orderBy: string;
  pendingWhere?: string;
  deadLetterClears?: readonly string[];
};

export class OutboxRepo<T> {
  private readonly pendingClause: string;

  constructor(
    private readonly cached: CachedStatements,
    private readonly table: string,
    private readonly opts: OutboxRepoOptions,
  ) {
    this.pendingClause = opts.pendingWhere ? `WHERE ${opts.pendingWhere}` : "";
  }

  get(id: string): T | undefined {
    return this.cached
      .prepare(
        `SELECT ${this.opts.columns}
           FROM ${this.table}
          WHERE id = ?
          LIMIT 1`,
      )
      .get(id) as T | undefined;
  }

  list(
    limit = 256,
    filter?: { where: string; params: readonly unknown[] },
  ): T[] {
    const clauses = [
      ...(this.opts.pendingWhere ? [this.opts.pendingWhere] : []),
      ...(filter ? [filter.where] : []),
    ];
    return this.cached
      .prepare(
        `SELECT ${this.opts.columns}
           FROM ${this.table}
           ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
          ORDER BY ${this.opts.orderBy}
          LIMIT ?`,
      )
      .all(...(filter?.params ?? []), Math.max(1, Math.floor(limit))) as T[];
  }

  count(): number {
    const row = this.cached
      .prepare(
        `SELECT COUNT(*) AS count
           FROM ${this.table}
           ${this.pendingClause}`,
      )
      .get() as { count?: unknown } | undefined;
    return typeof row?.count === "number" ? row.count : 0;
  }

  markAttempt(
    id: string,
    args: { error?: string | null; nextAttemptAt?: number } = {},
  ): void {
    const now = Date.now();
    const error = args.error?.slice(0, MAX_ERROR_LENGTH) ?? null;
    if (args.nextAttemptAt === undefined) {
      this.cached
        .prepare(
          `UPDATE ${this.table}
              SET attempts = attempts + 1,
                  last_error = ?,
                  updated_at = ?
            WHERE id = ?`,
        )
        .run(error, now, id);
      return;
    }
    this.cached
      .prepare(
        `UPDATE ${this.table}
            SET attempts = attempts + 1,
                next_attempt_at = ?,
                last_error = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(Math.max(now, Math.floor(args.nextAttemptAt)), error, now, id);
  }

  delete(id: string): void {
    this.cached.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(id);
  }

  deadLetter(id: string, reason: string): void {
    const now = Date.now();
    const clears = (this.opts.deadLetterClears ?? [])
      .map((column) => `${column} = NULL,`)
      .join("\n                ");
    this.cached
      .prepare(
        `UPDATE ${this.table}
            SET payload_json = '{}',
                ${clears}
                last_error = ?,
                dead_lettered_at = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(reason.slice(0, MAX_ERROR_LENGTH), now, now, id);
  }
}
