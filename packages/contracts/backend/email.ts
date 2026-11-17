import type { EmailPageView } from "../email-page.js";

/** How the October–November sorter classed an email; kept for the briefing cards still in old chats. */
export type EmailBucket = "urgent" | "needs_you" | "worth_knowing" | "noise";

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

/**
 * A standing instruction the user gave in plain words, which Stella keeps.
 * - `wake`: mail it is about wakes Stella at once (and can reach the phone).
 * - `act`: wake Stella at once to do what it says.
 * - `ignore`: it doesn't matter to the user; Stella leaves it out of the page.
 * Rules made before Stella read the mail herself say `tell`, which is `wake`.
 */
export type EmailRuleKind = "wake" | "act" | "ignore";

export type EmailRule = {
  ruleId: string;
  /** The user's own words. */
  text: string;
  /** Which emails it is about. */
  when: string;
  kind: EmailRuleKind;
  createdAt: number;
  firedCount: number;
  lastFiredAt?: number;
};

/** The Email page as every client shows it (the frame's data), plus what the host needs around it. */
export type EmailPageState = EmailPageView & {
  /** Gmail addresses connected through Stella, whether or not Email is on. */
  gmailConnected: string[];
  /** Gmail is connected only through Composio and needs reconnecting through Stella. */
  needsReconnect: boolean;
  rules: EmailRule[];
};

export type EmailCalls = {
  /** Turns Email on (Stella reads the mail and keeps the page) or off. */
  "email.setEnabled": { args: { enabled: boolean }; result: EmailPageState };
  /** The `email` tool's actions (see email-tool-def.ts), for Stella running on a computer. */
  "email.tool": { args: Record<string, unknown>; result: { text: string } };
};

export type EmailViews = {
  /** Whether this backend runs email at all (see `email-feature.ts`). */
  "email.available": { args: Record<string, never>; result: { available: boolean } };
  "email.page": { args: Record<string, never>; result: EmailPageState };
  /** The inboxes Stella reads while Email is on (none while it is off): whether her email instructions apply. */
  "email.accounts": { args: Record<string, never>; result: { accounts: string[] } };
};

export const EMAIL_PUSH_KIND = "email-urgent" as const;

export type EmailPushData = {
  kind: typeof EMAIL_PUSH_KIND;
  /** The page item it is about. */
  itemId: string;
  conversationId?: string;
};
