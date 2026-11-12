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

export type BriefEmail = {
  n: number;
  bucket: EmailBucket;
  from: string;
  subject: string;
  threadId: string;
  receivedAt: number;
  line: string;
  excerpt: string;
};

export type BriefOutput = {
  lead: string;
  sections: {
    heading: string;
    tone: "urgent" | "needs_you" | "fyi";
    blocks: { emails: number[]; title: string; points: string[]; suggestion?: { label: string; ask: string } }[];
  }[];
  skipped?: string;
};

const BRIEF_TOOL: Tool = {
  name: "write_briefing",
  description: "The briefing.",
  parameters: {
    type: "object",
    properties: {
      lead: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            tone: { type: "string", enum: ["urgent", "needs_you", "fyi"] },
            blocks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  emails: { type: "array", items: { type: "number" } },
                  title: { type: "string" },
                  points: { type: "array", items: { type: "string" } },
                  suggestion: {
                    type: "object",
                    properties: { label: { type: "string" }, ask: { type: "string" } },
                    required: ["label", "ask"],
                    additionalProperties: false,
                  },
                },
                required: ["emails", "title", "points"],
                additionalProperties: false,
              },
            },
          },
          required: ["heading", "tone", "blocks"],
          additionalProperties: false,
        },
      },
      skipped: { type: "string" },
    },
    required: ["lead", "sections"],
    additionalProperties: false,
  } as unknown as TSchema,
};

const BRIEF_BUCKET_WORDS: Record<EmailBucket, string> = {
  urgent: "urgent",
  needs_you: "needs them",
  worth_knowing: "worth knowing",
  noise: "noise",
};

const TONE_RANK: Record<"urgent" | "needs_you" | "fyi", number> = { urgent: 0, needs_you: 1, fyi: 2 };

const cleanText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";

/**
 * A briefing on new email, written the way a good assistant answers: one lead
 * sentence on what matters most, then short sections of points, related emails
 * merged into one point, each with at most one suggested next step.
 */
export const writeBrief = async (
  access: SorterAccess,
  emails: BriefEmail[],
  skipped: { from: string; subject: string }[],
  zone: string,
): Promise<{ brief: BriefOutput | null; usd: number }> => {
  const when = (at: number): string =>
    new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(at);
  const prompt = [
    `Now: ${when(Date.now())} (${zone}).`,
    "",
    ...emails.map((email) =>
      [
        `n: ${email.n}`,
        `sorted as: ${BRIEF_BUCKET_WORDS[email.bucket]}`,
        `from: ${email.from}`,
        `subject: ${email.subject}`,
        `thread: ${email.threadId}`,
        `received: ${when(email.receivedAt)}`,
        email.line ? `gist: ${email.line}` : "",
        `excerpt: ${email.excerpt || "(none)"}`,
        "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    skipped.length > 0
      ? `Skipped as noise (${skipped.length}): ${skipped
          .slice(0, 12)
          .map((mail) => `${mail.from} — "${mail.subject}"`)
          .join("; ")}`
      : "Nothing was skipped.",
  ].join("\n");
  const output = await completeWithTool(access, {
    purpose: "brief",
    system: [
      "You write a short briefing on someone's new email, addressed to them as \"you\", the way a sharp assistant would answer \"what came in?\".",
      "lead: one or two sentences on what matters most and what, if anything, they must do and by when. Bold (**…**) the people, amounts and deadlines that matter. No greeting.",
      "sections: group the emails into at most 3 sections in order of importance, each with a short heading of 1-3 words (\"Needs you\", \"Money\", \"Worth knowing\") and a tone: urgent if something can't wait, needs_you if they must reply, decide or act, fyi otherwise. Follow how each email was sorted unless the content clearly says otherwise. Every heading must be different; head an urgent section by what can't wait (\"Security\", \"Urgent\"), not \"Needs you\".",
      "blocks: one per matter. Put emails of the same thread or the same matter in one block (list every n it covers). Every email n must be in exactly one block.",
      "title: \"**Sender** · what it is about\", at most 8 words after the sender.",
      "points: 1-3 bullets of at most 14 words each with the facts that matter (amounts, dates, asks). Don't repeat the title. Bold sparingly.",
      "suggestion: only when there is an obvious next step Stella could do for them (reply, schedule, pay, file). label: 2-4 words starting with a verb (\"Reply approving\"). ask: the full instruction in their voice (\"Reply to Blue Metal approving the $4,800 quote\"). Leave it out for anything that needs nothing.",
      "skipped: if anything was skipped, one line starting with how many, saying what kind of mail it was.",
      "Plain words, no emoji, no quotes around titles. Answer only by calling write_briefing.",
    ].join("\n"),
    prompt,
    tool: BRIEF_TOOL,
    maxTokens: 2_400,
  });
  const raw = output.args;
  if (!raw) return { brief: null, usd: output.usd };
  const known = new Set(emails.map((email) => email.n));
  const used = new Set<number>();
  const sections: BriefOutput["sections"] = [];
  for (const entry of Array.isArray(raw.sections) ? raw.sections.slice(0, 4) : []) {
    if (!entry || typeof entry !== "object") continue;
    const section = entry as Record<string, unknown>;
    const tone = section.tone === "urgent" || section.tone === "needs_you" ? section.tone : "fyi";
    const blocks: BriefOutput["sections"][number]["blocks"] = [];
    for (const item of Array.isArray(section.blocks) ? section.blocks : []) {
      if (!item || typeof item !== "object") continue;
      const block = item as Record<string, unknown>;
      const ns = (Array.isArray(block.emails) ? block.emails : [])
        .map(Number)
        .filter((n) => known.has(n) && !used.has(n));
      const title = cleanText(block.title, 160);
      if (ns.length === 0 || !title) continue;
      ns.forEach((n) => used.add(n));
      const points = (Array.isArray(block.points) ? block.points : []).map((point) => cleanText(point, 220)).filter(Boolean).slice(0, 3);
      const suggestion = block.suggestion && typeof block.suggestion === "object" ? (block.suggestion as Record<string, unknown>) : null;
      const label = cleanText(suggestion?.label, 40);
      const ask = cleanText(suggestion?.ask, 300);
      blocks.push({ emails: ns, title, points, ...(label && ask ? { suggestion: { label, ask } } : {}) });
    }
    const heading = cleanText(section.heading, 40);
    if (blocks.length === 0 || !heading) continue;
    // Two sections under one heading read as a mistake: fold them, keeping the stronger tone.
    const same = sections.find((entry) => entry.heading.toLowerCase() === heading.toLowerCase());
    if (same) {
      same.blocks.push(...blocks);
      if (TONE_RANK[tone] < TONE_RANK[same.tone]) same.tone = tone;
    } else sections.push({ heading, tone, blocks });
  }
  const lead = cleanText(raw.lead, 500);
  // Anything the model left out still gets a plain block, so no email goes missing.
  const missed = emails.filter((email) => !used.has(email.n));
  if (missed.length > 0) {
    sections.push({
      heading: "Also",
      tone: "fyi",
      blocks: missed.map((email) => ({
        emails: [email.n],
        title: `**${email.from.replace(/\s*<[^>]*>\s*$/u, "") || email.from}** · ${email.subject}`,
        points: email.line ? [email.line] : [],
      })),
    });
  }
  if (!lead || sections.length === 0) return { brief: null, usd: output.usd };
  const skippedLine = cleanText(raw.skipped, 200);
  return { brief: { lead, sections, ...(skipped.length > 0 && skippedLine ? { skipped: skippedLine } : {}) }, usd: output.usd };
};

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
