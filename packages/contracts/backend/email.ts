/** What a new email asks of the user, as the sorter decided. */
export type EmailBucket = "urgent" | "needs_you" | "worth_knowing" | "noise";

/** Why it matters, from a fixed set, so an urgent alert needs no generated text. */
export type EmailReason =
  | "deadline"
  | "money"
  | "security"
  | "waiting_on_you"
  | "travel"
  | "personal"
  | "work"
  | "account"
  | "news"
  | "other";

export const EMAIL_BUCKETS: readonly EmailBucket[] = ["urgent", "needs_you", "worth_knowing", "noise"];
export const EMAIL_REASONS: readonly EmailReason[] = [
  "deadline",
  "money",
  "security",
  "waiting_on_you",
  "travel",
  "personal",
  "work",
  "account",
  "news",
  "other",
];

export type EmailItemState = "waiting" | "surfaced" | "summarized" | "dismissed";

export type EmailItem = {
  itemId: string;
  account: string;
  messageId: string;
  threadId: string;
  from: string;
  fromAddress: string;
  subject: string;
  bucket: EmailBucket;
  reason: EmailReason;
  receivedAt: number;
  state: EmailItemState;
  /** One plain line on what it is and what it needs, once a summary wrote it. */
  line?: string;
  /** The standing instruction it matched. */
  ruleId?: string;
  /** The user moved it to another bucket. */
  corrected?: boolean;
};

/** A standing instruction the user gave in plain words. */
export type EmailRule = {
  ruleId: string;
  /** The user's own words. */
  text: string;
  /** Which emails it is about, as the sorter checks it. */
  when: string;
  /** `tell`: surface it at once. `act`: start Stella on it with the instruction. */
  action: "tell" | "act";
  createdAt: number;
  firedCount: number;
  lastFiredAt?: number;
};

export type EmailAccountStatus = {
  email: string;
  /** Gmail pushes new mail to Stella (otherwise it is checked every few minutes). */
  live: boolean;
  lastSyncAt?: number;
  error?: string;
};

export type EmailUsage = {
  month: string;
  sorted: number;
  inputTokens: number;
  costUsd: number;
  /** The month's sorting cap was reached; new mail waits unsorted until next month. */
  capped: boolean;
};

export type EmailStatus = {
  enabled: boolean;
  /** Gmail addresses connected through Stella, whether or not sorting is on. */
  gmailConnected: string[];
  /** The inboxes being sorted (empty while sorting is off). */
  accounts: EmailAccountStatus[];
  /** Gmail is connected only through Composio and needs reconnecting through Stella. */
  needsReconnect: boolean;
  usage: EmailUsage;
  lastSummaryAt?: number;
};

export type EmailFeed = {
  status: EmailStatus;
  /** What matters to this user, in plain words; the sorter reads it with every email. */
  note: string;
  rules: EmailRule[];
  /** The last week's urgent, needs-you and worth-knowing emails, newest first. */
  items: EmailItem[];
  /** Emails left out as noise in the same week. */
  noiseCount: number;
};

export type EmailCalls = {
  "email.setEnabled": { args: { enabled: boolean }; result: EmailStatus };
  "email.correct": { args: { itemId: string; bucket: EmailBucket }; result: { ok: true } };
  "email.dismiss": { args: { itemId: string }; result: { ok: true } };
  "email.setNote": { args: { note: string }; result: { note: string } };
  "email.addRule": {
    args: { text: string; when: string; action: "tell" | "act" };
    result: { rule: EmailRule; rules: EmailRule[] };
  };
  "email.removeRule": { args: { ruleId: string }; result: { rules: EmailRule[] } };
  "email.rules": { args: Record<string, never>; result: { rules: EmailRule[]; note: string } };
  "email.checkNow": { args: Record<string, never>; result: EmailStatus };
};

export type EmailViews = {
  "email.feed": { args: Record<string, never>; result: EmailFeed };
};

export const EMAIL_PUSH_KIND = "email-urgent" as const;

export type EmailPushData = {
  kind: typeof EMAIL_PUSH_KIND;
  itemId: string;
  conversationId?: string;
};
