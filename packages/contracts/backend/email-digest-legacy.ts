/**
 * The October email digest's calls, kept only so desktop and phone builds
 * from before the email redesign find them: the backend answers with an idle,
 * empty digest. Nothing new uses these.
 */
export type EmailDigestItem = {
  from: string;
  subject: string;
  summary: string;
  threadId?: string;
  receivedAt?: number;
  /** The connected Gmail account it arrived in, when several are connected. */
  account?: string;
};

export type EmailDigest = {
  digestId: string;
  createdAt: number;
  newCount: number;
  items: EmailDigestItem[];
};

export type EmailDigestOutcome = "digest" | "nothing_new" | "nothing_important" | "error";

export type EmailDigestNotice =
  | { kind: "claude_usage_limit"; resetsAt?: number }
  | { kind: "claude_failed" };

export type EmailDigestStatus = {
  enabled: boolean;
  running: boolean;
  lastCheckedAt?: number;
  lastOutcome?: EmailDigestOutcome;
  lastError?: string;
  nextCheckAt?: number;
  notice?: EmailDigestNotice;
};

export type EmailDigestFeed = {
  status: EmailDigestStatus;
  digests: EmailDigest[];
};

export type EmailDigestCalls = {
  "emailDigest.start": { args: Record<string, never>; result: { connected: boolean } };
  "emailDigest.checkNow": { args: Record<string, never>; result: { connected: boolean } };
};

export type EmailDigestViews = {
  "emailDigest.feed": { args: Record<string, never>; result: EmailDigestFeed };
};
