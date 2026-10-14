import type { ReplyCounts, ReplyRef } from "@stella/contracts/reply-refs";

export type ReplyContextRow = {
  id: string;
  role: "user" | "assistant";
  hidden?: boolean;
  aliasIds?: readonly string[];
  refs?: readonly ReplyRef[];
  answersMessageIds?: readonly string[];
  ownsAgentIds?: readonly string[];
};

export type ReplyContextProjection = {
  contexts: ReadonlyMap<string, ReplyRef>;
  counts: ReplyCounts;
  agentOrigins: ReadonlyMap<string, string>;
};

export const replyRefKey = (ref: ReplyRef): string =>
  ref.kind === "agent" ? `a:${ref.threadId}` : `m:${ref.id}`;

const messageKey = (id: string) => `m:${id}`;
const agentKey = (id: string) => `a:${id}`;

type ReplyContextFold = {
  contexts: Map<string, ReplyRef>;
  counts: ReplyCounts;
  agentOrigins: Map<string, string>;
  exchanges: Map<string, Set<string>>;
  context: Set<string>;
  exchangeUserId: string | null;
};

const emptyReplyContextFold = (): ReplyContextFold => ({
  contexts: new Map(),
  counts: { messages: {}, agents: {} },
  agentOrigins: new Map(),
  exchanges: new Map(),
  context: new Set(),
  exchangeUserId: null,
});

type Undo = () => void;

/** Records how to take back each change a fold step makes, when `log` is given. */
const tracked = (log: Undo[] | undefined) => ({
  set<K, V>(map: Map<K, V>, key: K, value: V) {
    if (log) {
      const had = map.has(key);
      const previous = map.get(key);
      log.push(had ? () => map.set(key, previous as V) : () => map.delete(key));
    }
    map.set(key, value);
  },
  add<T>(set: Set<T>, value: T) {
    if (set.has(value)) return;
    set.add(value);
    log?.push(() => set.delete(value));
  },
  bump(bucket: Record<string, number>, key: string) {
    const previous = bucket[key];
    bucket[key] = (previous ?? 0) + 1;
    log?.push(previous === undefined ? () => delete bucket[key] : () => (bucket[key] = previous));
  },
});

const foldReplyContextRow = (
  fold: ReplyContextFold,
  row: ReplyContextRow,
  log?: Undo[],
): void => {
  if (row.hidden) return;
  const { contexts, counts, agentOrigins, exchanges } = fold;
  const change = tracked(log);
  if (row.role === "user") {
    if (log) {
      const { exchangeUserId, context } = fold;
      log.push(() => {
        fold.exchangeUserId = exchangeUserId;
        fold.context = context;
      });
    }
    fold.exchangeUserId = row.id;
    const context = new Set([messageKey(row.id)]);
    fold.context = context;
    change.set(exchanges, row.id, context);
    for (const alias of row.aliasIds ?? []) {
      context.add(messageKey(alias));
      change.set(exchanges, alias, context);
    }
    for (const id of row.ownsAgentIds ?? []) {
      context.add(agentKey(id));
      change.set(agentOrigins, id, row.id);
    }
    return;
  }
  const context = fold.context;
  const answers = row.answersMessageIds ?? [];
  const rejoined = answers
    .map((id) => exchanges.get(id))
    .filter((set): set is Set<string> => Boolean(set) && set !== context);
  for (const prior of rejoined) for (const key of prior) change.add(context, key);
  const origin = answers.find((id) => exchanges.has(id)) ?? fold.exchangeUserId;
  if (origin) {
    for (const id of row.ownsAgentIds ?? []) change.set(agentOrigins, id, origin);
  }
  const refs = row.refs ?? [];
  const distant = refs.filter((ref) => !context.has(replyRefKey(ref)));
  const candidates = distant.some((ref) => ref.kind === "agent")
    ? distant.filter((ref) => ref.kind === "agent")
    : distant;
  const visible = candidates[0];
  if (visible) change.set(contexts, row.id, visible);
  const countedMessages = new Set<string>();
  for (const ref of distant) {
    if (ref.kind === "message") {
      countedMessages.add(ref.id);
      continue;
    }
    change.bump(counts.agents, ref.threadId);
    const ask = agentOrigins.get(ref.threadId);
    if (ask) countedMessages.add(ask);
  }
  for (const id of countedMessages) change.bump(counts.messages, id);
  const added = [messageKey(row.id)];
  for (const alias of row.aliasIds ?? []) added.push(messageKey(alias));
  for (const ref of refs) added.push(replyRefKey(ref));
  for (const id of answers) added.push(messageKey(id));
  for (const id of row.ownsAgentIds ?? []) added.push(agentKey(id));
  for (const key of added) {
    change.add(context, key);
    for (const prior of rejoined) change.add(prior, key);
  }
};

export function projectReplyContexts(
  rows: readonly ReplyContextRow[],
): ReplyContextProjection {
  const fold = emptyReplyContextFold();
  for (const row of rows) foldReplyContextRow(fold, row);
  return { contexts: fold.contexts, counts: fold.counts, agentOrigins: fold.agentOrigins };
}

/** Rows a projector can take back without refolding from the start. */
const REWINDABLE_ROWS = 64;

/**
 * A projector for a transcript that mostly grows at its end. It folds only
 * rows after the part it already folded, and when the latest rows change it
 * takes their changes back (from an undo log kept for the last rows) instead
 * of refolding everything. Unchanged input returns the previous projection.
 */
export function createReplyContextProjector(): (
  rows: readonly ReplyContextRow[],
) => ReplyContextProjection {
  let foldedRows: readonly ReplyContextRow[] = [];
  let fold = emptyReplyContextFold();
  let undo: Undo[][] = [];
  let projection: ReplyContextProjection | null = null;
  return (rows) => {
    let kept = 0;
    const shared = Math.min(rows.length, foldedRows.length);
    while (kept < shared && rows[kept] === foldedRows[kept]) kept += 1;
    if (projection && kept === rows.length && kept === foldedRows.length) {
      return projection;
    }
    if (kept < foldedRows.length - undo.length) {
      fold = emptyReplyContextFold();
      undo = [];
      kept = 0;
    } else {
      for (let row = foldedRows.length; row > kept; row -= 1) {
        const steps = undo.pop()!;
        for (let step = steps.length - 1; step >= 0; step -= 1) steps[step]!();
      }
    }
    for (let index = kept; index < rows.length; index += 1) {
      const log: Undo[] = [];
      foldReplyContextRow(fold, rows[index]!, log);
      undo.push(log);
    }
    if (undo.length > REWINDABLE_ROWS) undo = undo.slice(undo.length - REWINDABLE_ROWS);
    foldedRows = rows;
    projection = {
      contexts: new Map(fold.contexts),
      counts: {
        messages: { ...fold.counts.messages },
        agents: { ...fold.counts.agents },
      },
      agentOrigins: new Map(fold.agentOrigins),
    };
    return projection;
  };
}

/**
 * Whether a task title names a thread id. The orchestrator picks thread ids
 * as slugs of the task description ("Pricing research" → `pricing-research`),
 * so a spawn that only recorded its description can still be matched to the
 * thread a later report cites when no title map is available.
 */
/**
 * Whether a task title names a thread id. Desktop-run threads are keyed by
 * the slug of their description plus a short random tail
 * (`create-report-k3f9qz`); older ones were the bare slug. Either form names
 * the thread whose description slugs the same way.
 */
const slugs = new Map<string, string>();
const MAX_SLUGS = 4096;

const slug = (value: string): string => {
  let slugged = slugs.get(value);
  if (slugged === undefined) {
    slugged = value
      .toLowerCase()
      .replace(/^(?:agent|thread):/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slugs.size >= MAX_SLUGS) slugs.clear();
    slugs.set(value, slugged);
  }
  return slugged;
};

export const titleNamesThread = (title: string, threadId: string): boolean => {
  const a = slug(title);
  const b = slug(threadId);
  if (a.length === 0) return false;
  if (a === b) return true;
  return b.startsWith(`${a}-`) && /^[a-z0-9]{6}$/.test(b.slice(a.length + 1));
};

