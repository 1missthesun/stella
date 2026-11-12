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
  /** The user archived it from Stella (it left the Gmail inbox). */
  archived?: boolean;
};

/**
 * What one email row in the chat stands for, opened: the emails it surfaced
 * (in the order Stella refers to them) and the mail skipped as noise in its
 * stretch of time. `digestId` is the chat card's id.
 */
export type EmailDigest = {
  digestId: string;
  kind: "urgent" | "summary" | "rule";
  createdAt: number;
  /** When the stretch it covers began (the previous summary), for "since 2:10 pm". */
  sinceAt?: number;
  ruleText?: string;
  items: EmailItem[];
  /** Mail sorted as noise in its stretch, newest first; summaries only. */
  skipped: EmailItem[];
};

export type EmailDigests = {
  /** The last week's digests, newest first. */
  digests: EmailDigest[];
  /** More than one inbox is sorted (only then is an item's account worth showing). */
  multipleAccounts: boolean;
};

/** What the user asked Stella to do with one email from a digest. */
export type EmailFocusAction = "reply" | "handle" | "tell";

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
  /** Takes an email out of (or back into) the Gmail inbox. */
  "email.archive": { args: { itemId: string; archived: boolean }; result: { ok: true } };
  /**
   * Tells Stella, out of sight, which email the user's next message is about,
   * so a digest action can be a plain chat message that still names the real email.
   */
  "email.focus": { args: { itemId: string; action: EmailFocusAction }; result: { ok: true } };
  /** Read an email, or reply to it (sent or saved as a draft), in a Gmail account connected through Stella. */
  "email.mail": {
    args: { action: "read" | "reply" | "draft"; account?: string; messageId: string; body?: string; all?: boolean };
    result: { text: string };
  };
};

export type EmailViews = {
  "email.feed": { args: Record<string, never>; result: EmailFeed };
  "email.digests": { args: Record<string, never>; result: EmailDigests };
};

export const EMAIL_PUSH_KIND = "email-urgent" as const;

export type EmailPushData = {
  kind: typeof EMAIL_PUSH_KIND;
  itemId: string;
  conversationId?: string;
};
