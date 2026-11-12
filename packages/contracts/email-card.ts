import {
  EMAIL_BUCKETS,
  EMAIL_REASONS,
  type EmailBucket,
  type EmailReason,
} from "./backend/email.js";

export const EMAIL_CARD_TYPE = "email";
export const EMAIL_CARD_MAX_ITEMS = 12;

export type EmailCardItem = {
  /** Its number in the card, which the user can refer to ("reply to the second one"). */
  n: number;
  itemId: string;
  account?: string;
  from: string;
  subject: string;
  line: string;
  bucket: EmailBucket;
  reason: EmailReason;
  messageId: string;
  threadId: string;
  receivedAt: number;
};

/**
 * Email surfaced in the chat. `urgent`: one email that couldn't wait.
 * `summary`: what built up since the last one. `rule`: an email that matched
 * a standing instruction the user asked to be told about.
 */
export type EmailCard = {
  type: typeof EMAIL_CARD_TYPE;
  cardId: string;
  kind: "urgent" | "summary" | "rule";
  items: EmailCardItem[];
  /** Emails left out as noise since the last summary. */
  noiseCount?: number;
  /** The standing instruction, in the user's words (`rule`). */
  ruleText?: string;
};

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseItem = (value: unknown): EmailCardItem | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const n = finite(raw.n);
  const itemId = text(raw.itemId, 128);
  const messageId = text(raw.messageId, 128);
  const threadId = text(raw.threadId, 128);
  const bucket = EMAIL_BUCKETS.find((entry) => entry === raw.bucket);
  const reason = EMAIL_REASONS.find((entry) => entry === raw.reason) ?? "other";
  if (n === undefined || !itemId || !messageId || !bucket) return null;
  const account = text(raw.account, 320);
  return {
    n,
    itemId,
    ...(account ? { account } : {}),
    from: text(raw.from, 200) || "Unknown sender",
    subject: text(raw.subject, 300) || "(no subject)",
    line: text(raw.line, 300),
    bucket,
    reason,
    messageId,
    threadId: threadId || messageId,
    receivedAt: finite(raw.receivedAt) ?? 0,
  };
};

export const parseEmailCard = (value: unknown): EmailCard | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== EMAIL_CARD_TYPE) return null;
  const kind = raw.kind === "urgent" || raw.kind === "summary" || raw.kind === "rule" ? raw.kind : null;
  const cardId = text(raw.cardId, 128);
  if (!kind || !cardId || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .slice(0, EMAIL_CARD_MAX_ITEMS)
    .map(parseItem)
    .filter((item): item is EmailCardItem => item !== null);
  if (items.length === 0) return null;
  const noiseCount = finite(raw.noiseCount);
  const ruleText = text(raw.ruleText, 600);
  return {
    type: EMAIL_CARD_TYPE,
    cardId,
    kind,
    items,
    ...(noiseCount !== undefined ? { noiseCount } : {}),
    ...(ruleText ? { ruleText } : {}),
  };
};

const BUCKET_WORDS: Record<EmailBucket, string> = {
  urgent: "Urgent",
  needs_you: "Needs you",
  worth_knowing: "Worth knowing",
  noise: "Noise",
};

export const EMAIL_REASON_WORDS: Record<EmailReason, string> = {
  deadline: "Deadline",
  money: "Money",
  security: "Security",
  waiting_on_you: "Waiting on you",
  travel: "Travel",
  personal: "Personal",
  work: "Work",
  account: "Account",
  news: "News",
  other: "Email",
};

/**
 * What Stella reads about a card the user saw, so "reply to the second one"
 * resolves to a real message. Plain text; ids are for the gmail tools.
 */
export const emailCardNoteText = (card: EmailCard): string => {
  const heading =
    card.kind === "urgent"
      ? "Stella's email sorting just showed the user this urgent email in the chat (as a card, not written by you):"
      : card.kind === "rule"
        ? `This email matched the user's standing instruction "${card.ruleText ?? ""}" and was shown to them in the chat as a card:`
        : "Stella's email sorting just showed the user this email summary in the chat (as a card, not written by you):";
  const lines = card.items.map((item) =>
    [
      `${item.n}. ${BUCKET_WORDS[item.bucket]} — ${item.from} — "${item.subject}"`,
      item.line ? ` — ${item.line}` : "",
      ` (account ${item.account ?? "primary"}, message_id ${item.messageId}, thread_id ${item.threadId})`,
    ].join(""),
  );
  return [
    heading,
    ...lines,
    ...(card.noiseCount ? [`${card.noiseCount} other emails were left out as noise.`] : []),
    "If the user refers to one of these (\"the second one\"), act on that email with the gmail tools, using its account and message_id. Don't comment on this note unless the user asks about their email.",
  ].join("\n");
};
