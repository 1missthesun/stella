/**
 * The email digest: a short, periodic summary of only the important new
 * mail in the owner's connected Gmail. The owner's object checks the inbox
 * on its own schedule (no device needs to be on), skips the model when
 * nothing arrived, and keeps the digests every client reads live.
 */

export type EmailDigestItem = {
  from: string;
  subject: string;
  /** One short line: what it is and what, if anything, it needs. */
  summary: string;
  threadId?: string;
  receivedAt?: number;
};

export type EmailDigest = {
  digestId: string;
  createdAt: number;
  /** New messages the run looked at, important or not. */
  newCount: number;
  items: EmailDigestItem[];
};

export type EmailDigestOutcome = "digest" | "nothing_new" | "nothing_important" | "error";

export type EmailDigestStatus = {
  /** False until the owner's Gmail first connects. */
  enabled: boolean;
  running: boolean;
  lastCheckedAt?: number;
  lastOutcome?: EmailDigestOutcome;
  lastError?: string;
  nextCheckAt?: number;
};

export type EmailDigestFeed = {
  status: EmailDigestStatus;
  /** Newest first. */
  digests: EmailDigest[];
};

export type EmailDigestCalls = {
  /** Start digests once Gmail is connected; answers whether it is. */
  "emailDigest.start": { args: Record<string, never>; result: { connected: boolean } };
  /** Check the inbox now instead of at the next scheduled time. */
  "emailDigest.checkNow": { args: Record<string, never>; result: { connected: boolean } };
};

export type EmailDigestViews = {
  "emailDigest.feed": { args: Record<string, never>; result: EmailDigestFeed };
};
