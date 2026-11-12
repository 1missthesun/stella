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

/**
 * Whose key pays for email's model calls (sorting and the written parts), as
 * the Email page states it.
 * - `stella`: Stella's key, within the plan's email allowance. On Free that is
 *   sorting only (no written items or replies), a cent a month.
 * - `own_key`: the owner's own OpenRouter key saved to their account; Stella's
 *   allowance isn't used, only a daily rate limit applies.
 * - `server`: a self-hosted server, on that server's own OpenRouter key.
 */
export type EmailPayer = "stella" | "own_key" | "server";

export type EmailAccess = {
  payer: EmailPayer;
  /** The plan Stella's allowance comes from (only meaningful for `stella`). */
  plan: "free" | "paid";
  /** Stella writes Today items, replies and voice replies (false on Free: sorting only). */
  writes: boolean;
  /** This month's allowance on Stella's key, in USD (`stella` only). */
  limitUsd?: number;
  /** Sorting is paused: the month's allowance or the day's limit is used up. */
  paused?: { why: "month" | "day"; until: number };
  /** The owner's own key was refused just now (invalid or out of credit); Stella's allowance is used meanwhile. */
  ownKeyRefused?: string;
};

export type EmailStatus = {
  enabled: boolean;
  access: EmailAccess;
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

// Today ---------------------------------------------------------------------------

/** Where an item stands: still open, put off until a time, or settled. */
export type EmailMatterStatus = "open" | "later" | "done";

/** How an item was settled. */
export type EmailSettledHow =
  | "done"
  | "replied"
  | "drafted"
  | "handled"
  | "archived"
  | "replied_in_gmail"
  | "archived_in_gmail";

/**
 * The step Stella prepared, so one tap does it: a reply already written (it
 * opens for review and is sent only with the user's tap), or something Stella
 * does in the chat. `label` says what will happen ("Send reply approving the quote").
 */
export type EmailPrepared =
  | { kind: "reply"; label: string; body: string }
  | { kind: "ask"; label: string; ask: string };

/**
 * One item on the Today view: a matter (an email, or a thread or several
 * emails about the same thing), headlined by its outcome, with its next step
 * prepared. It stays until it is done, put off, or acted on through Stella.
 */
export type EmailMatter = {
  matterId: string;
  /** How it arrived: in a summary, at once as urgent, or by a standing instruction. */
  kind: "summary" | "urgent" | "rule";
  /** The arrival it came in (an entry of the history), for grouping notifications. */
  briefingId?: string;
  tone: EmailBriefTone;
  /** The outcome, in a few words ("BlueMetal renewal: sign off by Friday"). */
  headline: string;
  /** One sentence on what the email wants, for notifications ("Joyi needs a yes on the deposit by Monday"). */
  wants: string;
  /** Up to three short facts (light markdown, bold only). */
  points: string[];
  from: string;
  fromAddress: string;
  subject: string;
  account: string;
  /** The sorted emails it covers, oldest first. */
  itemIds: string[];
  threadId: string;
  /** The newest email, the one a reply answers. */
  messageId: string;
  receivedAt: number;
  arrivedAt: number;
  status: EmailMatterStatus;
  /** Put off until then (status "later"). */
  laterUntil?: number;
  /** When Later brings it back unless the user picks another time, as Stella judged from the email. */
  laterSuggestion: { at: number; why: string };
  /** It came back from Later (or a new email in its thread brought it back) at this time. */
  returnedAt?: number;
  /** A reply was saved as a Gmail draft at this time; the item stays open until it is sent or done. */
  draftedAt?: number;
  settledAt?: number;
  settledHow?: EmailSettledHow;
  prepared?: EmailPrepared;
  ruleText?: string;
};

/** Mail Stella left out, grouped by who sent it. */
export type EmailNoiseSender = {
  address: string;
  name: string;
  count: number;
  latestSubject: string;
  latestAt: number;
  itemIds: string[];
  /** How Unsubscribe works: Stella does it (one-click or by email), or it opens the sender's page. */
  unsubscribe?: "stella" | "link";
  unsubscribed?: boolean;
  /** A person, not a mailing list: shown apart from newsletters, under People. */
  person?: true;
};

export type EmailToday = {
  enabled: boolean;
  /** A sentence or two over what is open now; absent while it is rewritten. */
  lead?: string;
  /** Open now: urgent, then needs you, then worth knowing; newest first within each. */
  open: EmailMatter[];
  /** Waiting in Later, soonest back first. */
  later: EmailMatter[];
  /** Settled today, newest first (they can be reopened). */
  doneToday: EmailMatter[];
  /** Left out this week and not cleared, busiest sender first. */
  noise: EmailNoiseSender[];
  /** Today's mail read by Stella, and how much of it was left out. */
  readToday: { total: number; leftOut: number };
  /** Arrivals worth announcing (summaries, urgent mail, standing instructions) of the last two days, newest first. */
  alerts: { briefingId: string; kind: "summary" | "urgent" | "rule"; at: number; matterIds: string[] }[];
  multipleAccounts: boolean;
  lastCheckedAt?: number;
  access: EmailAccess;
};

/** One line of the plain log of what Stella read and did with the mail. */
export type EmailLogKind =
  | "briefed"
  | "urgent"
  | "rule"
  | "sent"
  | "drafted"
  | "done"
  | "later"
  | "returned"
  | "reopened"
  | "handled"
  | "archived"
  | "unsubscribed"
  | "cleared"
  | "replied_in_gmail"
  | "archived_in_gmail";

export type EmailLogEntry = {
  at: number;
  kind: EmailLogKind;
  /** The sender, for entries about one sender. */
  who?: string;
  /** The item's headline or the email's subject. */
  subject?: string;
  count?: number;
  /** For "later": when it comes back. */
  until?: number;
  matterId?: string;
};

export type EmailHistoryDay = {
  /** Local day, YYYY-MM-DD. */
  day: string;
  /** Mail read that day, and how much was left out. */
  read: number;
  leftOut: number;
  /** What came in that day, with where each stands now. */
  arrived: EmailMatter[];
  /** What Stella and the user did, newest first. */
  log: EmailLogEntry[];
};

export type EmailHistory = {
  /** The last two weeks, newest first, days with nothing left out. */
  days: EmailHistoryDay[];
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
  "email.focus": {
    args: EmailTargets & { action: EmailFocusAction; matterId?: string };
    result: { ok: true };
  };
  /** Plain-words search across the inboxes connected through Stella. */
  "email.search": { args: { query: string }; result: EmailSearchResult };
  /** Reads a whole thread in place. */
  "email.thread": { args: { itemId?: string; account?: string; threadId?: string }; result: EmailThread };
  /** Read an email, or reply to it (sent or saved as a draft), in a Gmail account connected through Stella. */
  /** Done, Later (until a time) or back to open. Done also marks its emails read in Gmail. */
  "email.settle": {
    args: { matterId: string; status: EmailMatterStatus; laterUntil?: number };
    result: { ok: true };
  };
  /** Sends the reply (or saves it as a Gmail draft) the user reviewed, and settles the item. */
  "email.sendReply": {
    args: { matterId: string; body: string; mode: "send" | "draft" };
    result: { text: string };
  };
  /** Turns what the user said into a reply in their voice, for them to review. Nothing is sent. */
  "email.voiceReply": { args: { matterId: string; words: string; draft?: string }; result: { body: string } };
  /** Stops a sender's mailing list: Stella does it when it can, otherwise it returns the sender's page. */
  "email.unsubscribe": { args: { address: string }; result: { done: boolean; url?: string } };
  /** Archives a left-out sender's mail of the week in Gmail. */
  "email.clearSender": { args: { address: string }; result: { cleared: number } };
  "email.mail": {
    args: { action: "read" | "reply" | "draft"; account?: string; messageId: string; body?: string; all?: boolean };
    result: { text: string };
  };
};

export type EmailViews = {
  /** Whether this backend runs email at all (see `email-feature.ts`). */
  "email.available": { args: Record<string, never>; result: { available: boolean } };
  "email.feed": { args: Record<string, never>; result: EmailFeed };
  "email.digests": { args: Record<string, never>; result: EmailDigests };
  "email.today": { args: Record<string, never>; result: EmailToday };
  "email.history": { args: Record<string, never>; result: EmailHistory };
};

export const EMAIL_PUSH_KIND = "email-urgent" as const;

export type EmailPushData = {
  kind: typeof EMAIL_PUSH_KIND;
  itemId: string;
  matterId?: string;
  conversationId?: string;
};
