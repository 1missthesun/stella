/**
 * Catch-ups: a very short summary of a conversation's busy stretch (done,
 * ongoing, waiting on the user), asked for from the composer's "Catch up"
 * pill on any device and kept here so every device scrolls the same history.
 *
 * A request records a pending entry and runs one background job: it reads
 * the conversation's newest messages and running agents from its journal
 * (`OrchestratorSession.catchUpSource`), has Stella's light model write the
 * summary, and fills the entry in. The list view carries it to clients.
 * Nothing runs unless someone asks.
 */

import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import type { TSchema } from "@sinclair/typebox";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type {
  CatchUp,
  CatchUpItem,
  CatchUpLink,
  CatchUpState,
} from "@stella/contracts/backend/catch-ups";
import type {
  CatchUpSource,
  CatchUpSourceMessage,
} from "@stella/contracts/catch-up";
import { gatewayRelayBaseUrl } from "@stella/contracts/gateway/api";
import { stellaModel, stellaProvider } from "@stella/agent/provider/stella";
import { STELLA_DEFAULT_MODEL } from "@stella/model-catalog/aliases";
import { mintTurnCapability } from "../../capability-signer.js";
import { piModelSpec } from "../../orchestrator/support.js";
import { runClaudeDigest } from "../../integrations/claude-digest.js";
import { claudeCloudAccount } from "./engines.js";
import { object, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDbReader, OwnerDomain } from "../registry.js";
import { CONVERSATION_ID_PATTERN, liveConversation } from "./conversations.js";

const GENERATE_JOB = "catchUps.generate";
const KEPT_PER_CONVERSATION = 60;
const LISTED = 40;
const PENDING_STALE_MS = 3 * 60_000;

/** New messages a catch-up reads at most, newest kept. */
const MAX_NEW_MESSAGES = 60;
const MAX_NEW_CHARS = 40_000;
const NEW_MESSAGE_CHARS = 1_200;
/** Without an earlier catch-up: the last few hours, at least this many. */
const FIRST_WINDOW_MS = 6 * 60 * 60_000;
const FIRST_MIN_MESSAGES = 20;
/** Messages before the new ones, for context only. */
const CONTEXT_MESSAGES = 6;
const CONTEXT_MESSAGE_CHARS = 400;
const MAX_ITEMS = 5;
const ITEM_CHARS = 160;
const MAX_LINKS = 2;

const MAX_OUTPUT_TOKENS = 1_200;
const MODEL_TIMEOUT_MS = 60_000;
const RUN_BUDGET_MICRO_CENTS = 10_000_000;
const WRITE_TOOL = "write_catch_up";

export const CATCH_UPS_MIGRATION = {
  id: "catchUps.1-init",
  statements: [
    `CREATE TABLE catch_ups (
       catch_up_id TEXT PRIMARY KEY,
       conversation_id TEXT NOT NULL,
       state TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       through_at INTEGER,
       through_seq INTEGER,
       new_messages INTEGER,
       body_json TEXT,
       model TEXT,
       error TEXT
     )`,
    `CREATE INDEX catch_ups_conversation ON catch_ups (conversation_id, created_at)`,
  ],
};

type Row = {
  catch_up_id: string;
  conversation_id: string;
  state: string;
  created_at: number;
  updated_at: number;
  through_at: number | null;
  through_seq: number | null;
  new_messages: number | null;
  body_json: string | null;
  model: string | null;
  error: string | null;
};

type Body = Pick<CatchUp, "done" | "ongoing" | "waiting">;

const EMPTY_BODY: Body = { done: [], ongoing: [], waiting: [] };

const bodyOf = (row: Row): Body => {
  if (!row.body_json) return EMPTY_BODY;
  try {
    const parsed = JSON.parse(row.body_json) as Partial<Body>;
    return {
      done: Array.isArray(parsed.done) ? parsed.done : [],
      ongoing: Array.isArray(parsed.ongoing) ? parsed.ongoing : [],
      waiting: Array.isArray(parsed.waiting) ? parsed.waiting : [],
    };
  } catch {
    return EMPTY_BODY;
  }
};

const toCatchUp = (row: Row): CatchUp => ({
  catchUpId: row.catch_up_id,
  conversationId: row.conversation_id,
  createdAt: row.created_at,
  state: (["pending", "ready", "failed"] as const).includes(row.state as CatchUpState)
    ? (row.state as CatchUpState)
    : "failed",
  ...(row.through_at !== null ? { throughAt: row.through_at } : {}),
  ...(row.through_seq !== null ? { throughSeq: row.through_seq } : {}),
  ...(row.new_messages !== null ? { newMessages: row.new_messages } : {}),
  ...bodyOf(row),
  ...(row.error ? { error: row.error } : {}),
});

/** Oldest first. A failed one shows only while it is the newest, for its retry. */
const listFor = (db: OwnerDbReader, conversationId: string): CatchUp[] => {
  const rows = db
    .all<Row>(
      `SELECT * FROM catch_ups WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`,
      conversationId,
      LISTED,
    )
    .reverse();
  return rows
    .filter((row, index) => row.state !== "failed" || index === rows.length - 1)
    .map(toCatchUp);
};

const latestReady = (db: OwnerDbReader, conversationId: string): Row | null =>
  db.one<Row>(
    `SELECT * FROM catch_ups WHERE conversation_id = ? AND state = 'ready'
      ORDER BY created_at DESC LIMIT 1`,
    conversationId,
  );

const clip = (value: string, max: number): string => {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

const errorText = (error: unknown): string =>
  clip(error instanceof Error ? error.message : String(error), 300);

const request = async (
  ctx: OwnerContext,
  args: { conversationId: string },
): Promise<{ catchUpId: string }> => {
  if (!liveConversation(ctx.db, ctx.ownerId, args.conversationId)) {
    throw new RpcError("NOT_FOUND", "Conversation not found.");
  }
  const pending = ctx.db.one<Row>(
    `SELECT * FROM catch_ups WHERE conversation_id = ? AND state = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    args.conversationId,
  );
  // Two devices asking at once share one summary.
  if (pending && ctx.now - pending.created_at < PENDING_STALE_MS) {
    return { catchUpId: pending.catch_up_id };
  }
  if (pending) {
    ctx.db.run(
      `UPDATE catch_ups SET state = 'failed', error = ?, updated_at = ? WHERE catch_up_id = ?`,
      "Timed out.",
      ctx.now,
      pending.catch_up_id,
    );
  }
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "catchUps.request",
    { count: 30, windowMs: 60 * 60_000 },
    "Too many catch-ups. Try again in a few minutes.",
  );
  const catchUpId = crypto.randomUUID();
  ctx.db.run(
    `INSERT INTO catch_ups (catch_up_id, conversation_id, state, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)`,
    catchUpId,
    args.conversationId,
    ctx.now,
    ctx.now,
  );
  ctx.jobs.schedule(GENERATE_JOB, ctx.now, { catchUpId }, { id: `${GENERATE_JOB}:${catchUpId}` });
  return { catchUpId };
};

/** The messages a catch-up covers, and the ones before them for context. */
export const selectMessages = (
  messages: readonly CatchUpSourceMessage[],
  previous: { throughSeq: number } | null,
  now: number,
): { fresh: CatchUpSourceMessage[]; context: CatchUpSourceMessage[] } => {
  let start: number;
  if (previous) {
    start = messages.findIndex((message) => message.seq > previous.throughSeq);
    if (start < 0) start = messages.length;
  } else {
    const recent = messages.findIndex((message) => message.at >= now - FIRST_WINDOW_MS);
    start = Math.min(recent < 0 ? messages.length : recent, Math.max(0, messages.length - FIRST_MIN_MESSAGES));
  }
  start = Math.max(start, messages.length - MAX_NEW_MESSAGES);
  let chars = 0;
  for (let index = messages.length - 1; index >= start; index -= 1) {
    chars += Math.min(messages[index]!.text.length, NEW_MESSAGE_CHARS);
    if (chars > MAX_NEW_CHARS) {
      start = index + 1;
      break;
    }
  }
  return {
    fresh: messages.slice(start),
    context: messages.slice(Math.max(0, start - CONTEXT_MESSAGES), start),
  };
};

const SYSTEM_PROMPT = [
  "You write catch-ups for the user of Stella, a personal assistant that runs many background agents at once and relays their reports into one chat.",
  "When a lot happens quickly the user loses track; a catch-up tells them where things stand in five seconds of reading.",
  `Call ${WRITE_TOOL} once with three lists:`,
  "- waiting: every question, approval or decision Stella or an agent put to the user that a later user message doesn't answer. Check each Stella message ending in a question; small questions count too.",
  "- ongoing: work still in progress (the running agents listed, and anything Stella said is under way).",
  "- done: outcomes worth remembering: work that finished, decisions made, answers the user will act on.",
  `At most ${MAX_ITEMS - 1} items per list, each one plain line of at most 12 words naming the specific thing (the feature, file, person, place). No filler.`,
  "Merge related messages into one item. Each thing goes in one list only: an open question goes in waiting and nowhere else.",
  "Leave out small talk and throwaway one-off answers (a conversion, a joke, a poem) unless nothing else happened. Fewer items is better; an empty list is fine.",
  "Give each item the ids of the one or two messages that best show it (m ids for new messages, the p id for a carried item), most useful first; the user taps them to jump there.",
].join("\n");

const WRITE_TOOLS: Tool[] = [
  {
    name: WRITE_TOOL,
    description: "Write the catch-up.",
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        (["done", "ongoing", "waiting"] as const).map((list) => [
          list,
          {
            type: "array",
            maxItems: MAX_ITEMS,
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "One plain line, at most 14 words." },
                ids: {
                  type: "array",
                  maxItems: MAX_LINKS,
                  items: { type: "string", description: "A message id, such as m3." },
                },
              },
              required: ["text", "ids"],
              additionalProperties: false,
            },
          },
        ]),
      ),
      required: ["done", "ongoing", "waiting"],
      additionalProperties: false,
    } as unknown as TSchema,
  },
];

const ITEMS_SCHEMA = {
  type: "array",
  maxItems: MAX_ITEMS,
  items: {
    type: "object",
    properties: {
      text: { type: "string" },
      ids: { type: "array", maxItems: MAX_LINKS, items: { type: "string" } },
    },
    required: ["text", "ids"],
    additionalProperties: false,
  },
};

const CLAUDE_SCHEMA = {
  type: "object",
  properties: { done: ITEMS_SCHEMA, ongoing: ITEMS_SCHEMA, waiting: ITEMS_SCHEMA },
  required: ["done", "ongoing", "waiting"],
  additionalProperties: false,
};

const CLAUDE_SYSTEM_PROMPT = SYSTEM_PROMPT.replace(
  `Call ${WRITE_TOOL} once with three lists:`,
  "Answer with three lists:",
);

const minutesAgo = (at: number, now: number): string => {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} h ago`;
};

const promptFor = (input: {
  fresh: CatchUpSourceMessage[];
  context: CatchUpSourceMessage[];
  running: CatchUpSource["running"];
  previous: Body | null;
  now: number;
}): string => {
  const line = (message: CatchUpSourceMessage, id: string | null, max: number) =>
    `${id ? `[${id}] ` : ""}${message.role === "user" ? "User" : "Stella"} (${minutesAgo(message.at, input.now)}): ${clip(message.text, max)}`;
  const sections: string[] = [];
  if (input.previous) {
    const carried = carriedItems(input.previous);
    const items = (list: CatchUpItem[]) =>
      list.map((item) => `- [p${carried.indexOf(item) + 1}] ${item.text}`).join("\n") || "- (none)";
    sections.push(
      [
        "The previous catch-up the user already read. Carry an item forward (citing its p id) only if it is still true and the new messages don't settle it:",
        `Ongoing then:\n${items(input.previous.ongoing)}`,
        `Waiting on the user then:\n${items(input.previous.waiting)}`,
      ].join("\n"),
    );
  }
  if (input.context.length) {
    sections.push(
      `Earlier messages, for context only:\n${input.context.map((message) => line(message, null, CONTEXT_MESSAGE_CHARS)).join("\n")}`,
    );
  }
  sections.push(
    `New messages since then, oldest first:\n${input.fresh.map((message, index) => line(message, `m${index + 1}`, NEW_MESSAGE_CHARS)).join("\n\n")}`,
  );
  sections.push(
    input.running.length
      ? `Agents running right now:\n${input.running.map((agent) => `- ${clip(agent.title, 120)} (started ${minutesAgo(agent.startedAt, input.now)})`).join("\n")}`
      : "No agents are running right now.",
  );
  return sections.join("\n\n");
};

/** The previous catch-up's open items, which the prompt names p1, p2, … */
const carriedItems = (previous: Body): CatchUpItem[] => [...previous.ongoing, ...previous.waiting];

const itemsFrom = (
  raw: unknown,
  fresh: CatchUpSourceMessage[],
  carried: CatchUpItem[],
): CatchUpItem[] =>
  (Array.isArray(raw) ? raw : []).slice(0, MAX_ITEMS).flatMap((entry) => {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const text = typeof item?.text === "string" ? clip(item.text, ITEM_CHARS) : "";
    if (!text) return [];
    const ids = Array.isArray(item?.ids) ? item.ids : [];
    const links: CatchUpLink[] = [];
    for (const id of ids) {
      const match = /^\[?([mp])(\d+)\]?$/iu.exec(String(id).trim());
      if (!match) continue;
      const index = Number(match[2]) - 1;
      // A carried item keeps the links it had.
      const found: CatchUpLink[] =
        match[1]!.toLowerCase() === "p"
          ? (carried[index]?.links ?? [])
          : fresh[index]
            ? [{
                role: fresh[index]!.role,
                messageIds: fresh[index]!.messageIds,
                seq: fresh[index]!.seq,
                at: fresh[index]!.at,
              }]
            : [];
      for (const link of found) {
        if (!links.some((existing) => existing.seq === link.seq)) links.push(link);
      }
    }
    return [{ text, links: links.slice(0, MAX_LINKS) }];
  });

type SummarizeInput = Parameters<typeof promptFor>[0] & { catchUpId: string };
type Snapshot = Awaited<ReturnType<OwnerContext["host"]["snapshot"]>>;

const bodyFrom = (raw: Record<string, unknown>, input: SummarizeInput): Body => {
  const carried = input.previous ? carriedItems(input.previous) : [];
  return {
    done: itemsFrom(raw.done, input.fresh, carried),
    ongoing: itemsFrom(raw.ongoing, input.fresh, carried),
    waiting: itemsFrom(raw.waiting, input.fresh, carried),
  };
};

/**
 * Who writes it: someone on Claude Code gets Claude Code itself (Haiku at
 * medium effort, on their own Claude login in Stella's cloud); everyone else,
 * and Claude Code when that login is missing or fails, Stella's light model.
 */
const summarize = async (
  ctx: OwnerContext,
  input: SummarizeInput,
): Promise<{ body: Body; model: string }> => {
  const snapshot = await ctx.host.snapshot();
  if (snapshot.execution.engine === "anthropic") {
    const account = await claudeCloudAccount(ctx).catch(() => null);
    if (account && !("missing" in account)) {
      try {
        const outcome = await runClaudeDigest({
          env: ctx.env,
          ownerId: ctx.ownerId,
          account,
          systemPrompt: CLAUDE_SYSTEM_PROMPT,
          prompt: promptFor(input),
          schema: CLAUDE_SCHEMA,
          effort: "medium",
        });
        if (outcome.kind === "ok" && outcome.output && typeof outcome.output === "object") {
          return {
            body: bodyFrom(outcome.output as Record<string, unknown>, input),
            model: outcome.model,
          };
        }
        console.error(
          JSON.stringify({
            event: "catch_up_claude_fallback",
            reason: outcome.kind,
            message: outcome.kind === "ok" ? "no structured output" : outcome.message,
          }),
        );
      } catch (error) {
        console.error(JSON.stringify({ event: "catch_up_claude_fallback", reason: "error", message: errorText(error) }));
      }
    } else {
      console.error(JSON.stringify({ event: "catch_up_claude_fallback", reason: "no_cloud_account" }));
    }
  }
  return await summarizeWithStella(ctx, input, snapshot);
};

const summarizeWithStella = async (
  ctx: OwnerContext,
  input: SummarizeInput,
  snapshot: Snapshot,
): Promise<{ body: Body; model: string }> => {
  const gateway = ctx.env.MODEL_GATEWAY;
  const origin = ctx.env.MODEL_GATEWAY_URL?.trim() ?? "";
  if (!gateway || !origin) throw new Error("Model gateway is not configured.");
  const execution: Extract<CloudExecutionSelection, { engine: "stella" }> = {
    engine: "stella",
    provider: "stella",
    model: STELLA_DEFAULT_MODEL,
    reasoningEffort: "low",
  };
  const capability = await mintTurnCapability(ctx.env, {
    ownerId: ctx.ownerId,
    ownerGeneration: snapshot.ownerGeneration,
    turnId: `catch-up-${input.catchUpId}`,
    conversationId: "catch-up",
    execution,
    audience: snapshot.allowance.audience,
    budgetMicroCents: Math.min(snapshot.allowance.budgetMicroCents, RUN_BUDGET_MICRO_CENTS),
    agentTypes: ["general"],
  });
  const spec = piModelSpec("general", execution, snapshot.allowance.audience);
  const relayBaseUrl = gatewayRelayBaseUrl(origin);
  const models = createModels();
  models.setProvider(
    stellaProvider({
      access: {
        relayBaseUrl,
        capability: async () => capability.token,
        fetch: async (outgoingRequest, init) => {
          const outgoing =
            outgoingRequest instanceof Request
              ? new Request(outgoingRequest, init)
              : new Request(String(outgoingRequest), init);
          outgoing.headers.set("authorization", `Bearer ${capability.token}`);
          return await gateway.fetch(outgoing);
        },
      },
      models: [spec],
    }),
  );
  // The model now and then answers in prose instead of calling the tool:
  // take a JSON object it wrote instead, or ask once more.
  for (let attempt = 0; ; attempt += 1) {
    const answer = await models.completeSimple(
      stellaModel(spec, relayBaseUrl),
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: promptFor(input), timestamp: Date.now() }],
        tools: WRITE_TOOLS,
      },
      { maxTokens: MAX_OUTPUT_TOKENS, signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) },
    );
    if (answer.stopReason === "error" || answer.stopReason === "aborted") {
      throw new Error(clip(answer.errorMessage ?? "The catch-up model call failed.", 300));
    }
    const call = answer.content.find(
      (part): part is ToolCall => part.type === "toolCall" && part.name === WRITE_TOOL,
    );
    const written = call?.arguments ?? jsonObjectIn(
      answer.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
    );
    if (written) return { body: bodyFrom(written, input), model: execution.model };
    if (attempt >= 1) throw new Error("The catch-up model wrote no catch-up.");
  }
};

/** A `{done, ongoing, waiting}` object written as text, fenced or not. */
const jsonObjectIn = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      ["done", "ongoing", "waiting"].some((key) => key in parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }

};

const generate = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const catchUpId =
    payload && typeof payload === "object" && typeof (payload as { catchUpId?: unknown }).catchUpId === "string"
      ? (payload as { catchUpId: string }).catchUpId
      : "";
  const row = ctx.db.one<Row>(`SELECT * FROM catch_ups WHERE catch_up_id = ?`, catchUpId);
  if (!row || row.state !== "pending") return;
  const fail = (error: unknown) => {
    console.error(JSON.stringify({ event: "catch_up_failed", catchUpId, message: errorText(error) }));
    ctx.db.run(
      `UPDATE catch_ups SET state = 'failed', error = ?, updated_at = ? WHERE catch_up_id = ?`,
      "Stella couldn't write this catch-up.",
      Date.now(),
      catchUpId,
    );
  };
  try {
    const previous = latestReady(ctx.db, row.conversation_id);
    const source = await ctx.env.ORCHESTRATOR_SESSIONS.getByName(row.conversation_id).catchUpSource(ctx.ownerId);
    const { fresh, context } = selectMessages(
      source.messages,
      previous?.through_seq !== null && previous?.through_seq !== undefined
        ? { throughSeq: previous.through_seq }
        : null,
      Date.now(),
    );
    if (fresh.length === 0) {
      // Nothing new since the last one: that one still stands.
      ctx.db.run(`DELETE FROM catch_ups WHERE catch_up_id = ?`, catchUpId);
      return;
    }
    const { body, model } = await summarize(ctx, {
      catchUpId,
      fresh,
      context,
      running: source.running,
      previous: previous ? bodyOf(previous) : null,
      now: Date.now(),
    });
    const last = fresh[fresh.length - 1]!;
    const now = Date.now();
    ctx.db.run(
      `UPDATE catch_ups SET state = 'ready', through_at = ?, through_seq = ?, new_messages = ?,
         body_json = ?, model = ?, error = NULL, updated_at = ? WHERE catch_up_id = ? AND state = 'pending'`,
      last.at,
      last.seq,
      fresh.filter((message) => message.role === "assistant").length,
      JSON.stringify(body),
      model,
      now,
      catchUpId,
    );
    ctx.db.run(
      `DELETE FROM catch_ups WHERE conversation_id = ? AND catch_up_id NOT IN
         (SELECT catch_up_id FROM catch_ups WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?)`,
      row.conversation_id,
      row.conversation_id,
      KEPT_PER_CONVERSATION,
    );
  } catch (error) {
    fail(error);
  }
};

const conversationIdArg = string({ pattern: CONVERSATION_ID_PATTERN, max: 64 });

export const catchUpsDomain = {
  name: "catchUps",
  migrations: [CATCH_UPS_MIGRATION],
  calls: {
    "catchUps.request": {
      scope: "owner",
      requireAccount: true,
      parse: object({ conversationId: conversationIdArg }),
      handler: request,
    },
  },
  views: {
    "catchUps.list": {
      requireAccount: true,
      parse: object({ conversationId: conversationIdArg }),
      read: (ctx, args) => ({ catchUps: listFor(ctx.db, args.conversationId) }),
    },
  },
  jobs: {
    [GENERATE_JOB]: { run: generate, maxAttempts: 1 },
  },
  purge: (ctx) => {
    ctx.db.run("DELETE FROM catch_ups");
    return { pending: false };
  },
} satisfies OwnerDomain;
