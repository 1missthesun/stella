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

export function projectReplyContexts(
  rows: readonly ReplyContextRow[],
): ReplyContextProjection {
  const contexts = new Map<string, ReplyRef>();
  const counts: ReplyCounts = { messages: {}, agents: {} };
  const agentOrigins = new Map<string, string>();
  const exchanges = new Map<string, Set<string>>();
  let context = new Set<string>();
  let exchangeUserId: string | null = null;
  const bump = (bucket: Record<string, number>, key: string) => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };
  for (const row of rows) {
    if (row.hidden) continue;
    if (row.role === "user") {
      exchangeUserId = row.id;
      context = new Set([messageKey(row.id)]);
      exchanges.set(row.id, context);
      for (const alias of row.aliasIds ?? []) {
        context.add(messageKey(alias));
        exchanges.set(alias, context);
      }
      for (const id of row.ownsAgentIds ?? []) {
        context.add(agentKey(id));
        agentOrigins.set(id, row.id);
      }
      continue;
    }
    const answers = row.answersMessageIds ?? [];
    const rejoined = answers
      .map((id) => exchanges.get(id))
      .filter((set): set is Set<string> => Boolean(set) && set !== context);
    for (const prior of rejoined) for (const key of prior) context.add(key);
    const origin = answers.find((id) => exchanges.has(id)) ?? exchangeUserId;
    if (origin) {
      for (const id of row.ownsAgentIds ?? []) agentOrigins.set(id, origin);
    }
    const refs = row.refs ?? [];
    const distant = refs.filter((ref) => !context.has(replyRefKey(ref)));
    const candidates = distant.some((ref) => ref.kind === "agent")
      ? distant.filter((ref) => ref.kind === "agent")
      : distant;
    const visible = candidates[0];
    if (visible) contexts.set(row.id, visible);
    const countedMessages = new Set<string>();
    for (const ref of distant) {
      if (ref.kind === "message") {
        countedMessages.add(ref.id);
        continue;
      }
      bump(counts.agents, ref.threadId);
      const ask = agentOrigins.get(ref.threadId);
      if (ask) countedMessages.add(ask);
    }
    for (const id of countedMessages) bump(counts.messages, id);
    const added = [messageKey(row.id)];
    for (const alias of row.aliasIds ?? []) added.push(messageKey(alias));
    for (const ref of refs) added.push(replyRefKey(ref));
    for (const id of answers) added.push(messageKey(id));
    for (const id of row.ownsAgentIds ?? []) added.push(agentKey(id));
    for (const key of added) {
      context.add(key);
      for (const prior of rejoined) prior.add(key);
    }
  }
  return { contexts, counts, agentOrigins };
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
export const titleNamesThread = (title: string, threadId: string): boolean => {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/^(?:agent|thread):/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const a = slug(title);
  const b = slug(threadId);
  if (a.length === 0) return false;
  if (a === b) return true;
  return b.startsWith(`${a}-`) && /^[a-z0-9]{6}$/.test(b.slice(a.length + 1));
};

