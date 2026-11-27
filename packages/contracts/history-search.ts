import { parseWelcomeCard, WELCOME_TEXT } from "./welcome-message.js";

export const HISTORY_SEARCH_KINDS = [
  "user",
  "assistant",
  "agent_report",
  "agent_message",
] as const;
export type HistorySearchKind = (typeof HISTORY_SEARCH_KINDS)[number];

const AGENT_REPORT_RE =
  /^\[(?:Agent completed|Agent failed|Agent canceled|Task failed|Task canceled)\]/mu;
const AGENT_MESSAGE_RE = /<agent-message\b/u;

export const historySearchKind = (
  role: string,
  hidden: boolean,
  text: string,
): HistorySearchKind | null => {
  if (role === "assistant") return hidden ? null : "assistant";
  if (role !== "user") return null;
  if (!hidden) return "user";
  if (AGENT_REPORT_RE.test(text)) return "agent_report";
  if (AGENT_MESSAGE_RE.test(text)) return "agent_message";
  return null;
};

export const agentHistoryKind = (role: string, text: string): HistorySearchKind | null => {
  if (role === "assistant") return "assistant";
  if (role !== "user") return null;
  if (AGENT_REPORT_RE.test(text)) return "agent_report";
  if (AGENT_MESSAGE_RE.test(text)) return "agent_message";
  return "user";
};

export const historyMessageText = (message: unknown): string => {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; text?: unknown; content?: unknown };
    if (record.type === "toolCall" || record.type === "thinking") continue;
    if (typeof record.text === "string") parts.push(record.text);
    else if (typeof record.content === "string") parts.push(record.content);
  }
  return parts.join("\n");
};

export const historySearchMatch = (text: string): string =>
  historySearchTerms(text)
    .map((tokens) => `"${tokens.join(" ")}"`)
    .join(" ");

export const historySearchTerms = (text: string): string[][] => {
  const terms: string[][] = [];
  for (const [, phrase, word] of text.matchAll(/"([^"]*)"|(\S+)/gu)) {
    const tokens = historyTokens(phrase ?? word ?? "");
    if (tokens.length) terms.push(tokens);
  }
  return terms;
};

/** Lowercased letter-and-digit runs without diacritics, as `unicode61` makes them. */
export const historyTokens = (text: string): string[] =>
  (text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** A light English stem, so `reports` finds `report` as the index's `porter` stemmer does. */
const stem = (token: string): string => {
  if (token.length <= 3) return token;
  for (const suffix of ["ations", "ation", "ingly", "ings", "ing", "edly", "ies", "ied", "ed", "es", "ly", "s"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      const base = token.slice(0, -suffix.length);
      return suffix === "ies" || suffix === "ied" ? `${base}y` : base;
    }
  }
  return token;
};

const OPAQUE_SQL_RE =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/gu;

export const historyQueryStatement = (query: string): string => {
  const statement = query.trim().replace(/;\s*$/u, "");
  const code = statement.replace(OPAQUE_SQL_RE, " ").trim();
  if (code.includes(";")) {
    throw new Error("history.sql runs exactly one statement.");
  }
  if (!/^(?:select|with)\b/iu.test(code)) {
    throw new Error("history.sql accepts only a SELECT or WITH query.");
  }
  return statement;
};

export type HistorySearchOptions = {
  limit?: number;
  kinds?: readonly string[];
  order?: "relevance" | "newest";
  beforeSeq?: number;
};

export type HistorySearchHit = {
  seq: number;
  kind: string;
  at: string;
  turnId: string;
  snippet: string;
  archived: boolean;
};

export const HISTORY_SEARCH_LIMIT_DEFAULT = 20;
export const HISTORY_SEARCH_LIMIT_MAX = 100;

export const historySearchOptions = (value: unknown): HistorySearchOptions => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ...(typeof raw.limit === "number" ? { limit: raw.limit } : {}),
    ...(Array.isArray(raw.kinds)
      ? { kinds: raw.kinds.filter((kind): kind is string => typeof kind === "string") }
      : typeof raw.kinds === "string"
        ? { kinds: [raw.kinds] }
        : {}),
    ...(raw.order === "newest" || raw.order === "relevance" ? { order: raw.order } : {}),
    ...(typeof raw.beforeSeq === "number" ? { beforeSeq: raw.beforeSeq } : {}),
  };
};

export const historySearchKinds = (options: HistorySearchOptions): HistorySearchKind[] => {
  const kinds = (options.kinds ?? []).filter((kind): kind is HistorySearchKind =>
    (HISTORY_SEARCH_KINDS as readonly string[]).includes(kind),
  );
  if ((options.kinds?.length ?? 0) > 0 && kinds.length === 0) {
    throw new Error(`history.search kinds are ${HISTORY_SEARCH_KINDS.join(", ")}.`);
  }
  return kinds;
};

export const historySearchLimit = (options: HistorySearchOptions): number =>
  Math.min(Math.max(1, Math.floor(options.limit ?? HISTORY_SEARCH_LIMIT_DEFAULT)), HISTORY_SEARCH_LIMIT_MAX);

export type HistoryRecord = {
  seq: number;
  kind: HistorySearchKind;
  turnId: string;
  createdAtMs: number;
  text: string;
};

const SNIPPET_TOKENS = 32;

export type HistorySearchPlan = {
  terms: string[][];
  kinds: ReadonlySet<HistorySearchKind>;
  limit: number;
  order?: "relevance" | "newest";
  beforeSeq?: number;
};

export const historySearchPlan = (text: string, options: HistorySearchOptions = {}): HistorySearchPlan => {
  const terms = historySearchTerms(text).map((tokens) => tokens.map(stem));
  if (!terms.length) throw new Error("history.search needs at least one word to look for.");
  const kinds = new Set(historySearchKinds(options));
  const limit = historySearchLimit(options);
  return {
    terms,
    kinds,
    limit,
    ...(options.order ? { order: options.order } : {}),
    ...(Number.isSafeInteger(options.beforeSeq) ? { beforeSeq: options.beforeSeq as number } : {}),
  };
};

/** A record's words as search compares them: one stem per letter-and-digit run, in order (empty where a run normalizes to nothing). */
export const historyRecordTokens = (text: string): { raw: RegExpMatchArray[]; tokens: string[] } => {
  const raw = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  return { raw, tokens: raw.map((match) => stem(historyTokens(match[0])[0] ?? "")) };
};

export const searchHistoryRecords = (
  records: readonly HistoryRecord[],
  text: string,
  options: HistorySearchOptions = {},
): HistorySearchHit[] => {
  const plan = historySearchPlan(text, options);
  const candidates = records.filter(
    (record) =>
      (plan.kinds.size === 0 || plan.kinds.has(record.kind)) &&
      (plan.beforeSeq === undefined || record.seq < plan.beforeSeq),
  );
  const tokenized = candidates.map((record) => ({ record, ...historyRecordTokens(record.text) }));
  return rankHistoryMatches(plan, tokenized, {
    documents: tokenized.length,
    tokens: tokenized.reduce((sum, entry) => sum + entry.tokens.length, 0),
  });
};

/**
 * Ranks and snippets the records that contain every term. `corpus` counts all the records searched (after the kinds
 * and beforeSeq filters) and their tokens, so a caller that found the matching records with an index ranks them
 * exactly as a full scan would.
 */
export const rankHistoryMatches = (
  plan: HistorySearchPlan,
  tokenized: ReadonlyArray<{ record: HistoryRecord; raw: RegExpMatchArray[]; tokens: string[] }>,
  corpus: { documents: number; tokens: number },
): HistorySearchHit[] => {
  const { terms, limit } = plan;
  const positions = (tokens: string[], phrase: string[]): number[] => {
    const found: number[] = [];
    for (let index = 0; index + phrase.length <= tokens.length; index += 1) {
      if (phrase.every((token, offset) => tokens[index + offset] === token)) found.push(index);
    }
    return found;
  };
  const matches = tokenized
    .map((entry) => ({ ...entry, hits: terms.map((phrase) => positions(entry.tokens, phrase)) }))
    .filter((entry) => entry.hits.every((found) => found.length > 0));
  const averageLength = corpus.tokens / Math.max(1, corpus.documents);
  const documents = Math.max(1, corpus.documents);
  const idfs = terms.map((_, index) => {
    const containing = matches.filter((other) => other.hits[index]!.length > 0).length;
    return Math.log(1 + (documents - containing + 0.5) / (containing + 0.5));
  });
  const score = (entry: (typeof matches)[number]): number =>
    entry.hits.reduce((sum, found, index) => {
      const frequency = found.length;
      return sum + (idfs[index]! * frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * (entry.tokens.length / averageLength)));
    }, 0);
  const scores = new Map(plan.order === "newest" ? [] : matches.map((entry) => [entry, score(entry)]));
  const ranked =
    plan.order === "newest"
      ? [...matches].sort((a, b) => b.record.seq - a.record.seq)
      : [...matches].sort((a, b) => scores.get(b)! - scores.get(a)! || b.record.seq - a.record.seq);
  return ranked.slice(0, limit).map((entry) => {
    const marked = new Set<number>();
    entry.hits.forEach((found, index) => {
      for (const start of found) for (let offset = 0; offset < terms[index]!.length; offset += 1) marked.add(start + offset);
    });
    const first = Math.min(...marked);
    const from = Math.max(0, first - Math.floor(SNIPPET_TOKENS / 3));
    const to = Math.min(entry.raw.length, from + SNIPPET_TOKENS);
    const startChar = entry.raw[from]?.index ?? 0;
    const lastToken = entry.raw[to - 1];
    const endChar = lastToken ? (lastToken.index ?? 0) + lastToken[0].length : entry.record.text.length;
    let snippet = "";
    let cursor = startChar;
    for (let index = from; index < to; index += 1) {
      const token = entry.raw[index]!;
      const at = token.index ?? 0;
      snippet += entry.record.text.slice(cursor, at);
      snippet += marked.has(index) ? `[${token[0]}]` : token[0];
      cursor = at + token[0].length;
    }
    snippet = snippet.replace(/\s+/gu, " ").trim();
    return {
      seq: entry.record.seq,
      kind: entry.record.kind,
      at: new Date(entry.record.createdAtMs).toISOString(),
      turnId: entry.record.turnId,
      snippet: `${startChar > 0 ? "…" : ""}${snippet}${endChar < entry.record.text.length ? "…" : ""}`,
      archived: false,
    };
  });
};

export type OwnHistoryRow = {
  seq: number;
  kind: "message";
  turnId: string;
  createdAtMs: number;
  role: "user" | "assistant" | "toolResult";
  payload: unknown;
};

export const withoutThinking = (message: object): unknown => {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return message;
  return { ...message, content: content.filter((part) => (part as { type?: unknown } | null)?.type !== "thinking") };
};

export const ownHistoryRecords = (rows: readonly OwnHistoryRow[]): HistoryRecord[] =>
  rows.flatMap((row) => {
    if (row.role === "toolResult") return [];
    const text = historyMessageText(row.payload).replace(/\s+/gu, " ").trim();
    const kind = agentHistoryKind(row.role, text);
    return kind && text ? [{ seq: row.seq, kind, turnId: row.turnId, createdAtMs: row.createdAtMs, text }] : [];
  });

export const OWN_READ_RECORDS_MAX = 200;

/** How one thread's history answers each query op; `answerOwnHistoryWith` checks the arguments first. */
export type OwnHistoryEngine = {
  search(text: string, options: HistorySearchOptions): unknown;
  read(fromSeq: number, toSeq: number): unknown;
  sql?(query: string, params: readonly unknown[]): unknown;
};

export const answerOwnHistoryWith = (engine: OwnHistoryEngine, args: Record<string, unknown>): unknown => {
  if (args.op === "search") {
    if (typeof args.text !== "string" || !args.text.trim()) throw new Error("history.search requires the text to look for.");
    return engine.search(args.text, historySearchOptions(args.options));
  }
  if (args.op === "read") {
    if (!Number.isSafeInteger(args.fromSeq) || !Number.isSafeInteger(args.toSeq)) {
      throw new Error("history.read requires integer fromSeq and toSeq.");
    }
    return engine.read(args.fromSeq as number, args.toSeq as number);
  }
  if (args.op === "sql") {
    if (typeof args.query !== "string" || !args.query.trim()) throw new Error("history.sql requires a non-empty query string.");
    if (!engine.sql) throw new Error("history.sql is not available for your thread here; use history.search and history.read.");
    return engine.sql(args.query, Array.isArray(args.params) ? args.params : []);
  }
  throw new Error('history query op must be "search", "read" or "sql".');
};

export const answerOwnHistory = (rows: readonly OwnHistoryRow[], args: Record<string, unknown>): unknown =>
  answerOwnHistoryWith(
    {
      search: (text, options) => searchHistoryRecords(ownHistoryRecords(rows), text, options),
      read: (fromSeq, toSeq) => {
        const inRange = rows.filter((row) => row.seq >= fromSeq && row.seq <= toSeq);
        return { records: inRange.slice(0, OWN_READ_RECORDS_MAX), complete: inRange.length <= OWN_READ_RECORDS_MAX };
      },
    },
    args,
  );

export type HistoryReadEntry = {
  seq: number;
  role: string;
  at?: string;
  text: string;
};

const historyEntryOf = (input: unknown): HistoryReadEntry | null => {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (typeof record.seq !== "number") return null;
  const at =
    typeof record.createdAtMs === "number" && record.createdAtMs > 0
      ? new Date(record.createdAtMs).toISOString()
      : undefined;
  const base = { seq: record.seq, ...(at ? { at } : {}) };
  if (record.kind === "card") {
    if (parseWelcomeCard(record.card)) return { ...base, role: "assistant", text: WELCOME_TEXT };
    const card = record.card as { type?: unknown } | undefined;
    return { ...base, role: "card", text: typeof card?.type === "string" ? card.type : "" };
  }
  if (record.kind !== undefined && record.kind !== "message") return null;
  const payload =
    record.payload && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : {};
  const role =
    typeof record.role === "string"
      ? record.role
      : typeof payload.role === "string"
        ? payload.role
        : "unknown";
  const content = Array.isArray(payload.content) ? payload.content : [];
  const calls = content.flatMap((item) => {
    const part = item as { type?: unknown; name?: unknown } | null;
    return part?.type === "toolCall" && typeof part.name === "string" ? [`[tool call: ${part.name}]`] : [];
  });
  const name = typeof payload.toolName === "string" ? `[${payload.toolName} result] ` : "";
  const text = [`${name}${historyMessageText(payload)}`.trim(), ...calls].filter(Boolean).join("\n");
  return { ...base, role, text };
};

export const historyReadView = (result: unknown): unknown => {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object" && Array.isArray((result as { records?: unknown }).records)
      ? ((result as { records: unknown[] }).records)
      : null;
  if (!rows) return result;
  const records = rows.map(historyEntryOf).filter((entry): entry is HistoryReadEntry => entry !== null);
  if (Array.isArray(result)) return records;
  const rest = result as { complete?: unknown; missingBelowSeq?: unknown };
  return {
    records,
    ...(rest.complete === false ? { complete: false } : {}),
    ...(typeof rest.missingBelowSeq === "number" ? { missingBelowSeq: rest.missingBelowSeq } : {}),
  };
};
