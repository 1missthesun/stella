import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import type { TSchema } from "@sinclair/typebox";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import { EMAIL_REASONS, type EmailBucket, type EmailReason } from "@stella/contracts/backend/email";
import { GATEWAY_DECISIONS_PATH, gatewayRelayBaseUrl } from "@stella/contracts/gateway/api";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import { stellaModel, stellaProvider } from "@stella/agent/provider/stella";
import { STELLA_DEFAULT_MODEL } from "@stella/model-catalog/aliases";
import { mintTurnCapability } from "../capability-signer.js";
import { piModelSpec } from "../orchestrator/support.js";

/** Gemini Decision 1, USD per million input tokens (output is free). */
export const DECISION_INPUT_USD_PER_M = 0.1;
/** At or above this the sorter's "can't wait" probability makes an email urgent. */
export const URGENT_THRESHOLD = 0.8;
/** At or above this a standing instruction counts as matched. */
export const RULE_THRESHOLD = 0.6;
const MODEL_TIMEOUT_MS = 60_000;
/** Stella's light model (GPT-6 Luna), which writes summary lines and notes. */
const LIGHT_INPUT_USD_PER_M = 0.1;
const LIGHT_OUTPUT_USD_PER_M = 0.5;
const DECISION_TIMEOUT_MS = 25_000;
const RUN_BUDGET_MICRO_CENTS = 5_000_000;

export const DEFAULT_NOTE =
  "No note yet. Usually what matters: people they know or have written to, anything that needs their reply or decision, deadlines, money, bills, security and account problems, travel changes. Newsletters, promotions, social notifications and receipts that need nothing usually don't.";

export type SorterAccess = {
  env: Cloudflare.Env;
  ownerId: string;
  ownerGeneration: string;
  execution: CloudExecutionSelection;
  audience: ManagedModelAudience;
  budgetMicroCents: number;
};

export type SortInput = {
  note: string;
  account: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  receivedAt: number;
  text: string;
  labels: string[];
  bulk: boolean;
  /** How many times this inbox wrote to the sender in the last six months. */
  wroteToSender: number;
  rules: { ruleId: string; when: string }[];
  attachment?: { kind: "image" | "document"; mimeType: string; data: string; filename: string };
};

export type SortVerdict = {
  bucket: EmailBucket;
  urgentP: number;
  reason: EmailReason;
  ruleId?: string;
  inputTokens: number;
};

export class DecisionRefused extends Error {}

const execFor = (execution: CloudExecutionSelection): Extract<CloudExecutionSelection, { engine: "stella" }> =>
  execution.engine === "stella"
    ? execution
    : { engine: "stella", provider: "stella", model: STELLA_DEFAULT_MODEL, reasoningEffort: "low" };

const capabilityFor = async (access: SorterAccess, purpose: string) =>
  await mintTurnCapability(access.env, {
    ownerId: access.ownerId,
    ownerGeneration: access.ownerGeneration,
    turnId: `email-${purpose}-${crypto.randomUUID()}`,
    conversationId: "email",
    execution: execFor(access.execution),
    audience: access.audience,
    budgetMicroCents: Math.min(access.budgetMicroCents, RUN_BUDGET_MICRO_CENTS),
    agentTypes: ["general"],
  });

const REASON_CRITERIA: Record<EmailReason, string> = {
  deadline: "A date or deadline they must meet, or something expiring soon.",
  money: "Payments, bills, invoices, refunds, salary, or a charge.",
  security: "Sign-in alerts, password resets, fraud, or a security warning.",
  waiting_on_you: "Someone is waiting for their answer, approval or decision.",
  travel: "Flights, trains, hotels, bookings, or a change to a trip.",
  personal: "Family, friends, or someone personal writing to them.",
  work: "Their work: colleagues, clients, projects.",
  account: "A service or account they use: orders, deliveries, subscriptions, changes.",
  news: "News, newsletters, or updates to read when they like.",
  other: "Anything else.",
};

const relationLine = (count: number): string =>
  count > 0
    ? `They have written to this sender ${count} time${count === 1 ? "" : "s"} in the last six months.`
    : "They have never written to this sender in the last six months.";

const inputText = (input: SortInput): string =>
  [
    `What matters to this person, in their own note: ${input.note.trim() || DEFAULT_NOTE}`,
    "",
    `A new email arrived in their inbox (${input.account}).`,
    relationLine(input.wroteToSender),
    input.bulk ? "It was sent to a mailing list (it has an unsubscribe header)." : "It was sent directly, not through a mailing list.",
    input.labels.length > 0 ? `Gmail labels: ${input.labels.join(", ")}` : "",
    `From: ${input.from}`,
    `To: ${input.to}`,
    input.cc ? `Cc: ${input.cc}` : "",
    `Subject: ${input.subject}`,
    `Received: ${new Date(input.receivedAt).toISOString()}`,
    input.attachment ? `Attachment: ${input.attachment.filename} (included)` : "",
    "",
    input.text || "(no text)",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");

export const decisionRequest = (input: SortInput): Record<string, unknown> => {
  const questions: Record<string, unknown> = {
    bucket: {
      type: "choice",
      instructions:
        "Judging by their note and the email, what does this email ask of the person it was sent to?",
      criteria: {
        needs_you:
          "They need to do something: reply, decide, pay, sign, fix, show up, or a real person wrote to them personally.",
        worth_knowing:
          "Nothing to do, but they would genuinely want to know: a real update about something they care about.",
        noise:
          "Safe to skip: marketing, newsletters, promotions, social or automated notifications, receipts that need nothing.",
      },
    },
    urgent: {
      type: "noul",
      instructions:
        "Would this person want to be interrupted about this email right now, rather than read it in a summary a few hours later?",
      criteria: {
        true_description:
          "Waiting hours would cost them: something is due or happening today, money or account security at risk, a trip changing, someone close needing them now.",
        false_description: "It can wait a few hours without harm, or it is routine, promotional or automated.",
      },
    },
    reason: {
      type: "choice",
      instructions: "What is this email mainly about?",
      criteria: Object.fromEntries(EMAIL_REASONS.map((reason) => [reason, REASON_CRITERIA[reason]])),
    },
  };
  if (input.rules.length > 0) {
    questions.rule = {
      type: "choice",
      instructions: "Which of the person's standing instructions is about this email, if any?",
      criteria: {
        none: "None of the instructions is about this email.",
        ...Object.fromEntries(input.rules.map((rule) => [rule.ruleId, rule.when])),
      },
    };
  }
  const blocks: Record<string, unknown>[] = [{ type: "text", text: inputText(input) }];
  if (input.attachment) {
    blocks.push({
      type: input.attachment.kind,
      data: input.attachment.data,
      mime_type: input.attachment.mimeType,
      ...(input.attachment.kind === "image" ? { resolution: "low" } : {}),
    });
  }
  return { input: blocks, questions };
};

type Answers = Record<string, { choice?: unknown; noul?: unknown; probabilities?: unknown } | undefined>;

export const verdictFrom = (payload: unknown, input: SortInput): SortVerdict => {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const answers = (record.answers && typeof record.answers === "object" ? record.answers : {}) as Answers;
  const usage = (record.usage && typeof record.usage === "object" ? record.usage : {}) as Record<string, unknown>;
  const choice = answers.bucket?.choice;
  const base: EmailBucket = choice === "needs_you" || choice === "worth_knowing" || choice === "noise" ? choice : "worth_knowing";
  const urgentP = typeof answers.urgent?.noul === "number" ? answers.urgent.noul : 0;
  const reason = EMAIL_REASONS.find((entry) => entry === answers.reason?.choice) ?? "other";
  const ruleChoice = answers.rule?.choice;
  const ruleProbability =
    typeof ruleChoice === "string" &&
    answers.rule?.probabilities &&
    typeof answers.rule.probabilities === "object"
      ? Number((answers.rule.probabilities as Record<string, unknown>)[ruleChoice])
      : 0;
  const ruleId =
    typeof ruleChoice === "string" &&
    ruleChoice !== "none" &&
    input.rules.some((rule) => rule.ruleId === ruleChoice) &&
    ruleProbability >= RULE_THRESHOLD
      ? ruleChoice
      : undefined;
  const bucket: EmailBucket = base !== "noise" && urgentP >= URGENT_THRESHOLD ? "urgent" : base;
  return {
    bucket,
    urgentP,
    reason,
    ...(ruleId ? { ruleId } : {}),
    inputTokens: typeof usage.total_input_tokens === "number" ? usage.total_input_tokens : 0,
  };
};

/** Sorts one email with Gemini Decision 1 through Stella's model gateway. */
export const sortEmail = async (access: SorterAccess, input: SortInput): Promise<SortVerdict> => {
  const gateway = access.env.MODEL_GATEWAY;
  const origin = access.env.MODEL_GATEWAY_URL?.trim() ?? "";
  if (!gateway || !origin) throw new Error("Model gateway is not configured.");
  const capability = await capabilityFor(access, "sort");
  const response = await gateway.fetch(
    new Request(`${origin.replace(/\/+$/u, "")}${GATEWAY_DECISIONS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${capability.token}` },
      body: JSON.stringify(decisionRequest(input)),
      signal: AbortSignal.timeout(DECISION_TIMEOUT_MS),
    }),
  );
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = payload?.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : {};
    const message = typeof error.message === "string" ? error.message : `The decision model answered ${response.status}.`;
    if (response.status === 400) throw new DecisionRefused(message);
    throw new Error(message);
  }
  return verdictFrom(payload, input);
};

const completeWithTool = async (
  access: SorterAccess,
  args: { purpose: string; system: string; prompt: string; tool: Tool; maxTokens: number },
): Promise<{ args: Record<string, unknown> | null; usd: number }> => {
  const gateway = access.env.MODEL_GATEWAY;
  const origin = access.env.MODEL_GATEWAY_URL?.trim() ?? "";
  if (!gateway || !origin) throw new Error("Model gateway is not configured.");
  const execution = execFor(access.execution);
  const capability = await capabilityFor(access, args.purpose);
  const spec = piModelSpec("general", execution, access.audience);
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
      systemPrompt: args.system,
      messages: [{ role: "user", content: args.prompt, timestamp: Date.now() }],
      tools: [args.tool],
    },
    { maxTokens: args.maxTokens, signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) },
  );
  if (answer.stopReason === "error" || answer.stopReason === "aborted") {
    throw new Error((answer.errorMessage ?? "The summary model call failed.").slice(0, 300));
  }
  const call = answer.content.find(
    (part): part is ToolCall => part.type === "toolCall" && part.name === args.tool.name,
  );
  const reported = answer.usage?.cost?.total ?? 0;
  const usd =
    reported > 0
      ? reported
      : ((answer.usage?.input ?? 0) * LIGHT_INPUT_USD_PER_M + (answer.usage?.output ?? 0) * LIGHT_OUTPUT_USD_PER_M) / 1_000_000;
  return { args: call?.arguments ?? null, usd };
};

export type LineRequest = { n: number; from: string; subject: string; excerpt: string };

const LINES_TOOL: Tool = {
  name: "write_lines",
  description: "One line per email.",
  parameters: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: { n: { type: "number" }, line: { type: "string" } },
          required: ["n", "line"],
          additionalProperties: false,
        },
      },
    },
    required: ["lines"],
    additionalProperties: false,
  } as unknown as TSchema,
};

/** One plain line per email: what it is and what, if anything, it needs. Written by the engine's cheap model. */
export const writeLines = async (
  access: SorterAccess,
  emails: LineRequest[],
): Promise<{ lines: Map<number, string>; usd: number }> => {
  const prompt = emails
    .map((email) => `n: ${email.n}\nfrom: ${email.from}\nsubject: ${email.subject}\nexcerpt: ${email.excerpt || "(none)"}`)
    .join("\n\n");
  const output = await completeWithTool(access, {
    purpose: "lines",
    system: [
      "For each email below write one plain line of at most 14 words for its recipient: what it is and what, if anything, they need to do and by when.",
      "Don't repeat the sender's name or the subject. No quotes, no emoji.",
      "Answer only by calling write_lines once with every email.",
    ].join("\n"),
    prompt,
    tool: LINES_TOOL,
    maxTokens: 1_200,
  });
  const lines = new Map<number, string>();
  for (const entry of Array.isArray(output.args?.lines) ? output.args.lines : []) {
    if (!entry || typeof entry !== "object") continue;
    const n = Number((entry as Record<string, unknown>).n);
    const line = String((entry as Record<string, unknown>).line ?? "").replace(/\s+/gu, " ").trim().slice(0, 160);
    if (Number.isFinite(n) && line) lines.set(n, line);
  }
  return { lines, usd: output.usd };
};

const NOTE_TOOL: Tool = {
  name: "set_note",
  description: "The rewritten note.",
  parameters: {
    type: "object",
    properties: { note: { type: "string" } },
    required: ["note"],
    additionalProperties: false,
  } as unknown as TSchema,
};

export const NOTE_MAX_CHARS = 800;

/** Folds the user's recent corrections into their what-matters note. */
export const rewriteNote = async (
  access: SorterAccess,
  note: string,
  corrections: { from: string; subject: string; was: EmailBucket; now: EmailBucket | "dismissed" }[],
): Promise<{ note: string | null; usd: number }> => {
  const words: Record<string, string> = {
    urgent: "urgent",
    needs_you: "needs them",
    worth_knowing: "worth knowing",
    noise: "noise",
    dismissed: "not worth showing",
  };
  const output = await completeWithTool(access, {
    purpose: "note",
    system: [
      "You keep a short note, in plain words, of what matters to one person in their email, which an email sorter reads.",
      "Rewrite the note so it also reflects the corrections the person just made. Keep what still holds, generalise from the corrections (a sender, a kind of email) without inventing preferences.",
      `At most 120 words. Write it about them in the third person ("They care about…"). Answer only by calling set_note.`,
    ].join("\n"),
    prompt: [
      `Current note: ${note.trim() || DEFAULT_NOTE}`,
      "",
      "Corrections (the sorter's choice → what the person said):",
      ...corrections.map((entry) => `- ${entry.from} — "${entry.subject}": ${words[entry.was]} → ${words[entry.now]}`),
    ].join("\n"),
    tool: NOTE_TOOL,
    maxTokens: 600,
  });
  const next =
    typeof output.args?.note === "string" ? output.args.note.replace(/\s+/gu, " ").trim().slice(0, NOTE_MAX_CHARS) : "";
  return { note: next || null, usd: output.usd };
};
