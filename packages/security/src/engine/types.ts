/** What one check run concluded about one thing on the computer or an account. */
export type FindingKind =
  | "update"
  | "extension"
  | "download"
  | "startup"
  | "encryption"
  | "firewall"
  | "screenlock"
  | "breach"
  | "news"
  | "email"
  | "app";

export type FixAction =
  /** Open a web page or an app settings page (ms-settings:, x-apple.systempreferences:, chrome://…). */
  | { kind: "open"; label: string; url: string; browser?: BrowserId }
  /** Move a file to the Trash / Recycle Bin. */
  | { kind: "trash"; label: string; path: string }
  /** Run a known fix with the OS asking for permission (firewall on, etc.). */
  | { kind: "fix"; label: string; fix: KnownFix }
  /** Move an email to spam in the connected mailbox. */
  | { kind: "email-spam"; label: string; account: string; messageId: string };

export type KnownFix = "firewall-on" | "update-system";

export type Finding = {
  /** Stable key: the same problem keeps the same id across runs, so "Not now" sticks. */
  id: string;
  kind: FindingKind;
  /** Short, plain words: "Update Chrome". */
  title: string;
  /** One sentence a non-technical person understands. */
  detail: string;
  /** true = shows as "needs you"; false = handled/informational line. */
  needsYou: boolean;
  /** Higher sorts first among needs-you items. */
  urgency: number;
  action?: FixAction;
  /** Facts kept on this computer, for the model and for "why". */
  evidence?: Record<string, unknown>;
};

/** A line in "Handled": what was checked or done, in plain words. */
export type HandledLine = { id: string; text: string; at: number };

export type CheckResult = { findings: Finding[]; handled: HandledLine[] };

export type BrowserId = "chrome" | "edge" | "brave" | "chromium" | "vivaldi" | "opera" | "arc" | "firefox" | "safari";

export type RunSummary = {
  startedAt: number;
  finishedAt: number;
  needsYou: Finding[];
  handled: HandledLine[];
  /** Everything the run looked at, for debugging/reporting only (stays local). */
  findings: Finding[];
  errors: { check: string; message: string }[];
  model: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
};
