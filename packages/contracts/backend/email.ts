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
  /** The written briefing, when the summary got one (older and urgent rows are shown from their items). */
  brief?: EmailBrief;
};

/**
 * A summary written the way a good assistant answers: a lead sentence on what
 * matters most, then sections of blocks. Text is light markdown (bold only).
 */
export type EmailBrief = {
  lead: string;
  sections: EmailBriefSection[];
  /** One line on what was skipped, when anything was. */
  skipped?: string;
};

/** How much a section asks of the user; it sets the colour, not the heading. */
export type EmailBriefTone = "urgent" | "needs_you" | "fyi";

export type EmailBriefSection = {
  heading: string;
  tone: EmailBriefTone;
  blocks: EmailBriefBlock[];
};

/** One point in the briefing; related emails (a thread, the same matter) share a block. */
export type EmailBriefBlock = {
  itemIds: string[];
  /** "**Sender** · what it is about". */
  title: string;
  points: string[];
  /** The one next step worth offering, if any. */
  suggestion?: EmailSuggestion;
};

export type EmailSuggestion = {
  /** Button text, a few words ("Reply approving"). */
  label: string;
  /** What Stella should do, in the user's voice ("Reply approving the $4,800 quote"). */
  ask: string;
};

/** An email found by search, outside any briefing. */
export type EmailFound = {
  account: string;
  messageId: string;
  threadId: string;
  from: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  receivedAt: number;
  unread: boolean;
  inInbox: boolean;
};

export type EmailSearchResult = {
  /** The Gmail search the words became, shown so the user can tell what was searched. */
  gmailQuery: string;
  results: EmailFound[];
};

/** One message of a thread, read in place. */
export type EmailMessage = {
  messageId: string;
  from: string;
  fromAddress: string;
  to: string;
  cc?: string;
  receivedAt: number;
  text: string;
  attachments: string[];
  /** An unsent draft (such as a reply Stella saved). */
  draft?: boolean;
};

export type EmailThread = {
  account: string;
  threadId: string;
  subject: string;
  messages: EmailMessage[];
};

/** Which emails a call is about: sorted ones by id, found ones by reference. */
export type EmailTargets = {
  /** One sorted email (the first digest clients' form). */
  itemId?: string;
  itemIds?: string[];
  found?: EmailFound[];
};

export type EmailDigests = {
  /** The last week's digests, newest first. */
  digests: EmailDigest[];
  /** More than one inbox is sorted (only then is an item's account worth showing). */
  multipleAccounts: boolean;
};

/** What the user asked Stella to do with one email from a digest. */
export type EmailFocusAction = "reply" | "handle" | "tell" | "suggest";

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
  /** Takes emails out of (or back into) the Gmail inbox. */
  "email.archive": { args: EmailTargets & { archived: boolean }; result: { ok: true } };
  /**
   * Tells Stella, out of sight, which emails the user's next message is about,
   * so a briefing action can be a plain chat message that still names the real email.
   */
  "email.focus": { args: EmailTargets & { action: EmailFocusAction }; result: { ok: true } };
  /** Plain-words search across the inboxes connected through Stella. */
  "email.search": { args: { query: string }; result: EmailSearchResult };
  /** Reads a whole thread in place. */
  "email.thread": { args: { itemId?: string; account?: string; threadId?: string }; result: EmailThread };
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
