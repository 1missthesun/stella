import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import type { TSchema } from "@sinclair/typebox";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type { EmailDigestItem } from "@stella/contracts/backend/email-digest";
import { gatewayRelayBaseUrl } from "@stella/contracts/gateway/api";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import { stellaModel, stellaProvider } from "@stella/agent/provider/stella";
import { STELLA_DEFAULT_MODEL } from "@stella/model-catalog/aliases";
import { mintTurnCapability } from "../capability-signer.js";
import { piModelSpec } from "../orchestrator/support.js";
import { composioExecute, type ComposioConfig } from "./composio.js";

export const GMAIL_INTEGRATION_ID = "gmail";
const FETCH_ACTION = "GMAIL_FETCH_EMAILS";
const MAX_MESSAGES = 30;
const SNIPPET_CHARS = 280;
const SUBJECT_CHARS = 160;
const SUMMARY_CHARS = 140;
const MAX_OUTPUT_TOKENS = 700;
const MODEL_TIMEOUT_MS = 60_000;
const RUN_BUDGET_MICRO_CENTS = 25_000_000;

export type GmailMessage = {
  id: string;
  threadId?: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt?: number;
  important: boolean;
  starred: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const clip = (value: string, max: number): string => {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

const messagesIn = (payload: Record<string, unknown>): unknown[] => {
  const queue: unknown[] = [payload];
  for (let depth = 0; depth < 4 && queue.length > 0; depth += 1) {
    const next: unknown[] = [];
    for (const value of queue) {
      if (!isRecord(value)) continue;
      if (Array.isArray(value.messages)) return value.messages;
      for (const key of ["data", "response_data", "result"]) {
        if (isRecord(value[key])) next.push(value[key]);
      }
    }
    queue.splice(0, queue.length, ...next);
  }
  return [];
};

const timestampOf = (raw: Record<string, unknown>): number | undefined => {
  const internal = Number(raw.internalDate ?? raw.internal_date);
  if (Number.isFinite(internal) && internal > 0) return internal;
  const iso = Date.parse(text(raw.messageTimestamp ?? raw.message_timestamp ?? raw.date));
  return Number.isFinite(iso) ? iso : undefined;
};

const toMessage = (raw: unknown): GmailMessage | null => {
  if (!isRecord(raw)) return null;
  const id = text(raw.messageId ?? raw.message_id ?? raw.id);
  if (!id) return null;
  const preview = isRecord(raw.preview) ? raw.preview : {};
  const labels = Array.isArray(raw.labelIds) ? raw.labelIds.map(String) : [];
  const threadId = text(raw.threadId ?? raw.thread_id);
  const receivedAt = timestampOf(raw);
  return {
    id,
    ...(threadId ? { threadId } : {}),
    from: clip(text(raw.sender ?? raw.from) || "Unknown sender", 120),
    subject: clip(text(raw.subject ?? preview.subject) || "(no subject)", SUBJECT_CHARS),
    snippet: clip(text(preview.body ?? raw.snippet ?? raw.messageText), SNIPPET_CHARS),
    ...(receivedAt !== undefined ? { receivedAt } : {}),
    important: labels.includes("IMPORTANT"),
    starred: labels.includes("STARRED"),
  };
};

export const fetchGmailSince = async (
  config: ComposioConfig,
  sessionId: string,
  sinceMs: number,
): Promise<GmailMessage[]> => {
  const query = `in:inbox -category:promotions -category:social after:${Math.floor(sinceMs / 1000)}`;
  const payload = await composioExecute(config, sessionId, {
    action: FETCH_ACTION,
    input: { query, max_results: MAX_MESSAGES, include_payload: false, verbose: true, user_id: "me" },
  });
  if (payload.successful === false || (isRecord(payload) && text(payload.error))) {
    throw new Error(`Gmail fetch failed: ${clip(text(payload.error) || "unknown error", 200)}`);
  }
  return messagesIn(payload).flatMap((raw) => {
    const message = toMessage(raw);
    return message ? [message] : [];
  });
};

const REPORT_TOOL = "report_emails";
const NOTHING_TOOL = "nothing_important";

const SYSTEM_PROMPT = [
  "You write a very short email digest for one person.",
  "From the new emails below, keep only the ones that genuinely matter to them:",
  "a real person writing to them, anything that needs a reply, decision or action,",
  "deadlines and time-sensitive things, money, bills, security, accounts, travel,",
  "legal, health, or news they would clearly want to know.",
  "Leave out newsletters, marketing, routine notifications and receipts that need nothing.",
  "Most runs keep few or none. Never pad.",
  "Answer by calling exactly one tool and write nothing else.",
  `If at least one email matters, call ${REPORT_TOOL} with those emails, ordered by importance.`,
  "Each summary is one plain line of at most 15 words saying what it is and what, if anything, is needed,",
  "without repeating the sender or subject.",
  `If none of them matters, call ${NOTHING_TOOL}.`,
].join("\n");

const DIGEST_TOOLS: Tool[] = [
  {
    name: REPORT_TOOL,
    description: "Report the emails that matter, most important first.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "The email's id, such as m1." },
              summary: { type: "string", description: "One plain line, at most 15 words." },
            },
            required: ["id", "summary"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    } as unknown as TSchema,
  },
  {
    name: NOTHING_TOOL,
    description: "None of the new emails is worth mentioning.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as unknown as TSchema,
  },
];

const promptFor = (messages: GmailMessage[]): string =>
  messages
    .map((message, index) =>
      [
        `id: m${index + 1}`,
        `from: ${message.from}`,
        `subject: ${message.subject}`,
        ...(message.important || message.starred
          ? [`gmail: ${[message.important ? "marked important" : "", message.starred ? "starred" : ""].filter(Boolean).join(", ")}`]
          : []),
        `excerpt: ${message.snippet || "(none)"}`,
      ].join("\n"),
    )
    .join("\n\n");

export type DigestVerdict =
  | { kind: "nothing_important" }
  | { kind: "important"; items: EmailDigestItem[] };

const itemsFrom = (raw: unknown, messages: GmailMessage[]): EmailDigestItem[] => {
  const seen = new Set<number>();
  return (Array.isArray(raw) ? raw : []).flatMap((item) => {
    if (!isRecord(item)) return [];
    const index = Number(text(item.id).replace(/^m/u, "")) - 1;
    const message = messages[index];
    const summary = clip(text(item.summary), SUMMARY_CHARS);
    if (!message || seen.has(index) || !summary) return [];
    seen.add(index);
    return [
      {
        from: message.from,
        subject: message.subject,
        summary,
        ...(message.threadId ? { threadId: message.threadId } : {}),
        ...(message.receivedAt !== undefined ? { receivedAt: message.receivedAt } : {}),
      },
    ];
  });
};

const verdictFrom = (calls: ToolCall[], messages: GmailMessage[]): DigestVerdict => {
  const names = new Set(calls.map((call) => call.name));
  if (names.has(REPORT_TOOL) && names.has(NOTHING_TOOL)) {
    throw new Error("The digest model both reported emails and said nothing was important.");
  }
  if (names.has(NOTHING_TOOL)) return { kind: "nothing_important" };
  const reports = calls.filter((call) => call.name === REPORT_TOOL);
  if (reports.length === 0) throw new Error("The digest model did not call a digest tool.");
  const items = itemsFrom(
    reports.flatMap((call) => (Array.isArray(call.arguments.items) ? call.arguments.items : [])),
    messages,
  );
  if (items.length === 0) throw new Error("The digest model reported no email it was given.");
  return { kind: "important", items };
};

export const digestExecution = (
  execution: CloudExecutionSelection,
): Extract<CloudExecutionSelection, { engine: "stella" }> =>
  execution.engine === "stella"
    ? execution
    : { engine: "stella", provider: "stella", model: STELLA_DEFAULT_MODEL, reasoningEffort: execution.reasoningEffort };

export type DigestModelInput = {
  env: Cloudflare.Env;
  ownerId: string;
  ownerGeneration: string;
  runId: string;
  execution: CloudExecutionSelection;
  audience: ManagedModelAudience;
  budgetMicroCents: number;
  messages: GmailMessage[];
};

export const pickImportant = async (input: DigestModelInput): Promise<{ verdict: DigestVerdict; model: string }> => {
  const gateway = input.env.MODEL_GATEWAY;
  const origin = input.env.MODEL_GATEWAY_URL?.trim() ?? "";
  if (!gateway || !origin) throw new Error("Model gateway is not configured.");
  const execution = digestExecution(input.execution);
  const capability = await mintTurnCapability(input.env, {
    ownerId: input.ownerId,
    ownerGeneration: input.ownerGeneration,
    turnId: `email-digest-${input.runId}`,
    conversationId: "email-digest",
    execution,
    audience: input.audience,
    budgetMicroCents: Math.min(input.budgetMicroCents, RUN_BUDGET_MICRO_CENTS),
    agentTypes: ["general"],
  });
  const spec = piModelSpec("general", execution, input.audience);
  const relayBaseUrl = gatewayRelayBaseUrl(origin);
  const models = createModels();
  models.setProvider(
    stellaProvider({
      access: {
        relayBaseUrl,
        capability: async () => capability.token,
        fetch: async (request, init) => {
          const outgoing = request instanceof Request ? new Request(request, init) : new Request(String(request), init);
          outgoing.headers.set("authorization", `Bearer ${capability.token}`);
          return await gateway.fetch(outgoing);
        },
      },
      models: [spec],
    }),
  );
  const answer = await models.completeSimple(
    stellaModel(spec, relayBaseUrl),
    {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: promptFor(input.messages), timestamp: Date.now() }],
      tools: DIGEST_TOOLS,
    },
    { maxTokens: MAX_OUTPUT_TOKENS, signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) },
  );
  if (answer.stopReason === "error" || answer.stopReason === "aborted") {
    throw new Error(clip(answer.errorMessage ?? "The digest model call failed.", 300));
  }
  const calls = answer.content.flatMap((part) => (part.type === "toolCall" ? [part] : []));
  return { verdict: verdictFrom(calls, input.messages), model: execution.model };
};
