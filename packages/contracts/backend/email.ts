import type { EmailPageView } from "../email-page.js";

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

export type EmailRuleKind = "wake" | "act" | "ignore";

export type EmailRule = {
  ruleId: string;
  text: string;
  when: string;
  kind: EmailRuleKind;
  createdAt: number;
  firedCount: number;
  lastFiredAt?: number;
};

export type EmailPageState = EmailPageView & {
  gmailConnected: string[];
  needsReconnect: boolean;
  rules: EmailRule[];
};

export type EmailCalls = {
  "email.setEnabled": { args: { enabled: boolean }; result: EmailPageState };
  "email.tool": { args: Record<string, unknown>; result: { text: string } };
};

export type EmailViews = {
  "email.available": { args: Record<string, never>; result: { available: boolean } };
  "email.page": { args: Record<string, never>; result: EmailPageState };
  "email.accounts": { args: Record<string, never>; result: { accounts: string[] } };
};

export const EMAIL_PUSH_KIND = "email-urgent" as const;

export type EmailPushData = {
  kind: typeof EMAIL_PUSH_KIND;
  itemId: string;
  conversationId?: string;
};
