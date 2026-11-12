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
  "No note yet. Usually what matters: people you know or have written to, anything that needs your reply or decision, deadlines, money, bills, security and account problems, travel changes. Newsletters, promotions, social notifications and receipts that need nothing usually don't.";

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
    `What matters to this person, in their own note ("you" is them): ${input.note.trim() || DEFAULT_NOTE}`,
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
      `At most 120 words. Write it to them in the second person ("You care about…", "Mail from your bank matters"), as a note they read about themselves. Answer only by calling set_note.`,
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

const BRIEF_BUCKET_WORDS: Record<EmailBucket, string> = {
  urgent: "urgent",
  needs_you: "needs them",
  worth_knowing: "worth knowing",
  noise: "noise",
};

const cleanText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";

const QUERY_TOOL: Tool = {
  name: "gmail_query",
  description: "The Gmail searches.",
  parameters: {
    type: "object",
    properties: { q: { type: "string" }, broader: { type: "string" } },
    required: ["q", "broader"],
    additionalProperties: false,
  } as unknown as TSchema,
};

/**
 * Turns plain words ("the invoice from Linear last month") into a Gmail
 * search, plus a looser one to try when the first finds nothing.
 */
export const gmailQueryFor = async (
  access: SorterAccess,
  words: string,
  zone: string,
): Promise<{ q: string; broader: string; usd: number }> => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
  const output = await completeWithTool(access, {
    purpose: "search",
    system: [
      "Turn what someone wants to find in their email into Gmail searches using Gmail's operators (from:, to:, subject:, has:attachment, filename:, after:YYYY/MM/DD, before:YYYY/MM/DD, newer_than:, is:unread, in:anywhere, OR, -word).",
      "q: the search. Use the user's key words as loose keywords; quote a phrase only if the user quoted it. A person's or company's name goes in as a bare word (it matches the sender, recipients and body), not from:, unless they give an email address or clearly mean the sender's address. Drop filler words such as email, emails, message, about, the.",
      "broader: a looser search for when q finds nothing: the one or two most distinctive words, with OR between alternatives (e.g. renewal OR quote).",
      "If the input already is a Gmail query or a single keyword, return it as is for both.",
      `Today is ${today}. Answer only by calling gmail_query.`,
    ].join("\n"),
    prompt: words,
    tool: QUERY_TOOL,
    maxTokens: 300,
  });
  const q = cleanText(output.args?.q, 300) || words.trim().slice(0, 300);
  const broader = cleanText(output.args?.broader, 300) || q;
  return { q, broader, usd: output.usd };
};

// Today ----------------------------------------------------------------------------

export type MatterEmail = {
  n: number;
  bucket: EmailBucket;
  from: string;
  to: string;
  subject: string;
  threadId: string;
  receivedAt: number;
  excerpt: string;
};

export type MatterOutput = {
  emails: number[];
  tone: "urgent" | "needs_you" | "fyi";
  headline: string;
  wants: string;
  points: string[];
  reply?: { label: string; body: string };
  action?: { label: string; ask: string };
  /** Local time "YYYY-MM-DD HH:MM" in the owner's zone, as the model gave it. */
  laterAt?: string;
  laterWhy?: string;
};

const MATTERS_TOOL: Tool = {
  name: "write_today",
  description: "The items for the Today list.",
  parameters: {
    type: "object",
    properties: {
      lead: { type: "string" },
      matters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            emails: { type: "array", items: { type: "number" } },
            tone: { type: "string", enum: ["urgent", "needs_you", "fyi"] },
            headline: { type: "string" },
            wants: { type: "string" },
            points: { type: "array", items: { type: "string" } },
            reply: {
              type: "object",
              properties: { label: { type: "string" }, body: { type: "string" } },
              required: ["label", "body"],
              additionalProperties: false,
            },
            action: {
              type: "object",
              properties: { label: { type: "string" }, ask: { type: "string" } },
              required: ["label", "ask"],
              additionalProperties: false,
            },
            later: {
              type: "object",
              properties: { at: { type: "string" }, why: { type: "string" } },
              required: ["at", "why"],
              additionalProperties: false,
            },
          },
          required: ["emails", "tone", "headline", "wants", "points", "later"],
          additionalProperties: false,
        },
      },
    },
    required: ["lead", "matters"],
    additionalProperties: false,
  } as unknown as TSchema,
};

const voiceBlock = (voice: string): string =>
  voice.trim()
    ? `How they write (a few of their own recent emails, for tone, length, greeting and sign-off only):\n${voice.trim()}`
    : "No samples of their writing: write plainly, briefly and warmly, and end without any sign-off or name (never sign with the email address or company).";

const REPLY_RULES =
  "Write it as the user, in first person, in their voice (match the samples: greeting, length, sign-off). Short and ready to send. Never invent facts, prices, dates, commitments or attachments they didn't give; when the reply needs a choice only they can make, write the answer the email plainly expects (such as approving or confirming) only if nothing suggests otherwise, else a short reply saying they'll come back on it.";

/**
 * Turns new email into items for the Today list: each matter headlined by its
 * outcome, one sentence on what it wants, a few facts, the next step prepared
 * (a reply already written, or something Stella can do), and when Later
 * should bring it back.
 */
export const writeMatters = async (
  access: SorterAccess,
  emails: MatterEmail[],
  zone: string,
  voice: string,
): Promise<{ lead: string; matters: MatterOutput[]; usd: number }> => {
  const when = (at: number): string =>
    new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
  const prompt = [
    `Now: ${when(Date.now())}, today is ${today} (${zone}).`,
    "",
    voiceBlock(voice),
    "",
    ...emails.map((email) =>
      [
        `n: ${email.n}`,
        `sorted as: ${BRIEF_BUCKET_WORDS[email.bucket]}`,
        `from: ${email.from}`,
        `to: ${email.to}`,
        `subject: ${email.subject}`,
        `thread: ${email.threadId}`,
        `received: ${when(email.receivedAt)}`,
        `text: ${email.excerpt || "(none)"}`,
        "",
      ].join("\n"),
    ),
  ].join("\n");
  const output = await completeWithTool(access, {
    purpose: "today",
    system: [
      "You prepare someone's new email for their Today list, a short list of what needs them, addressed to them as \"you\". Each item stays until they deal with it.",
      "lead: one sentence on what came in that matters most. Bold (**…**) the key person, amount or deadline. No greeting.",
      "matters: one per matter. Put emails of the same thread or the same matter in one (list every n it covers). Every email n must be in exactly one matter.",
      "tone: urgent if it can't wait hours, needs_you if they must reply, decide, pay or act, fyi otherwise. Follow how each email was sorted unless the content clearly says otherwise.",
      "headline: the outcome in at most 8 words, what needs to happen or what happened, naming the thing (\"BlueMetal renewal: sign off by Friday\", \"Lisbon flight moved to 9:40\"). Not just the sender, not the subject line. No bold.",
      "wants: one sentence of at most 20 words naming who wants what from them and by when (\"Joyi needs a yes on the €600 deposit by Monday.\"). For fyi, what happened.",
      "points: 0-2 bullets of at most 14 words with facts not already in the headline (amounts, dates, asks). Bold sparingly.",
      `reply: only when the obvious next step is replying. body: the reply. ${REPLY_RULES} label: at most 7 words saying what tapping does, starting with \"Send reply\" (\"Send reply approving the quote\", \"Send reply confirming Thursday\").`,
      "action: only when the next step is something else Stella can do for them (add to calendar, pay, file, track a delivery). label: at most 6 words saying what will happen (\"Add the flight to your calendar\"). ask: the full instruction in their voice. Never both reply and action; neither for fyi that needs nothing.",
      "later: when to bring it back if they put it off. at: local time \"YYYY-MM-DD HH:MM\", a sensible moment before any deadline (morning of the day before it's due), else 09:00 tomorrow. why: at most 5 words (\"the day before it's due\").",
      "Plain words, no emoji. Answer only by calling write_today.",
    ].join("\n"),
    prompt,
    tool: MATTERS_TOOL,
    maxTokens: 4_000,
  });
  const raw = output.args;
  const known = new Set(emails.map((email) => email.n));
  const used = new Set<number>();
  const matters: MatterOutput[] = [];
  for (const entry of Array.isArray(raw?.matters) ? raw.matters : []) {
    if (!entry || typeof entry !== "object") continue;
    const matter = entry as Record<string, unknown>;
    const ns = (Array.isArray(matter.emails) ? matter.emails : []).map(Number).filter((n) => known.has(n) && !used.has(n));
    const headline = cleanText(matter.headline, 120).replace(/\*\*/gu, "");
    if (ns.length === 0 || !headline) continue;
    ns.forEach((n) => used.add(n));
    const tone = matter.tone === "urgent" || matter.tone === "needs_you" ? matter.tone : "fyi";
    const reply = matter.reply && typeof matter.reply === "object" ? (matter.reply as Record<string, unknown>) : null;
    const action = matter.action && typeof matter.action === "object" ? (matter.action as Record<string, unknown>) : null;
    const later = matter.later && typeof matter.later === "object" ? (matter.later as Record<string, unknown>) : null;
    const replyLabel = cleanText(reply?.label, 60);
    const replyBody = typeof reply?.body === "string" ? reply.body.trim().slice(0, 4_000) : "";
    const actionLabel = cleanText(action?.label, 60);
    const actionAsk = cleanText(action?.ask, 300);
    matters.push({
      emails: ns,
      tone,
      headline,
      wants: cleanText(matter.wants, 220),
      points: (Array.isArray(matter.points) ? matter.points : []).map((point) => cleanText(point, 220)).filter(Boolean).slice(0, 2),
      ...(replyLabel && replyBody ? { reply: { label: replyLabel, body: replyBody } } : actionLabel && actionAsk ? { action: { label: actionLabel, ask: actionAsk } } : {}),
      ...(later ? { laterAt: cleanText(later.at, 20), laterWhy: cleanText(later.why, 60) } : {}),
    });
  }
  return { lead: cleanText(raw?.lead, 500), matters, usd: output.usd };
};

const LEAD_TOOL: Tool = {
  name: "write_lead",
  description: "The lead sentence.",
  parameters: {
    type: "object",
    properties: { lead: { type: "string" } },
    required: ["lead"],
    additionalProperties: false,
  } as unknown as TSchema,
};

/** One or two sentences over what is open now, so the top of Today always reads true. */
export const writeTodayLead = async (
  access: SorterAccess,
  open: { tone: string; headline: string; wants: string }[],
): Promise<{ lead: string; usd: number }> => {
  const output = await completeWithTool(access, {
    purpose: "lead",
    system: [
      "Someone's Today list of email items is below, most pressing first. Write the lead at its top: one or two short sentences, addressed to them as \"you\", on what matters most right now and what they must do by when. Mention at most three items; don't count them. Bold (**…**) the key people, amounts and deadlines. No greeting, no emoji.",
      "Answer only by calling write_lead.",
    ].join("\n"),
    prompt: open.map((item, index) => `${index + 1}. [${item.tone}] ${item.headline} — ${item.wants}`).join("\n"),
    tool: LEAD_TOOL,
    maxTokens: 400,
  });
  return { lead: cleanText(output.args?.lead, 400), usd: output.usd };
};

const VOICE_TOOL: Tool = {
  name: "write_reply",
  description: "The reply.",
  parameters: {
    type: "object",
    properties: { body: { type: "string" } },
    required: ["body"],
    additionalProperties: false,
  } as unknown as TSchema,
};

/** What the user said out loud, written up as their reply to the email. Nothing is sent. */
export const writeVoiceReply = async (
  access: SorterAccess,
  args: { words: string; from: string; subject: string; text: string; draft?: string; voice: string },
): Promise<{ body: string; usd: number }> => {
  const output = await completeWithTool(access, {
    purpose: "voice-reply",
    system: [
      "The user spoke what they want to answer to an email. Write their reply from what they said.",
      `${REPLY_RULES} Keep everything they said (names, numbers, times) exactly, drop filler and false starts, and add nothing they didn't say beyond a greeting and sign-off in their style. If they gave instructions about the current draft ("make it shorter", "say Thursday instead"), apply them to it.`,
      "Answer only by calling write_reply with the reply text.",
    ].join("\n"),
    prompt: [
      voiceBlock(args.voice),
      "",
      `The email, from ${args.from}, subject "${args.subject}":`,
      args.text.slice(0, 3_000) || "(no text)",
      "",
      args.draft ? `Current draft:\n${args.draft.slice(0, 3_000)}\n` : "",
      `What they said: ${args.words}`,
    ].join("\n"),
    tool: VOICE_TOOL,
    maxTokens: 1_200,
  });
  const body = typeof output.args?.body === "string" ? output.args.body.trim().slice(0, 4_000) : "";
  return { body, usd: output.usd };
};
