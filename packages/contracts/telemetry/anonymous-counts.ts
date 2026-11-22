/**
 * Anonymous install counts: a small, fixed set of events every desktop
 * install may send, signed in or not. The only identifier is a random install
 * ID made on the computer; the telemetry worker replaces it with a keyed hash
 * before anything is stored. No content, paths, account IDs or IP addresses.
 */

/**
 * The one switch. While false, the desktop app records and sends nothing,
 * hides the "How did you find Stella?" question and the Settings toggle, and
 * the privacy text leaves out the counts paragraph. Turn it on only after the
 * telemetry worker's `/v1/counts` route is deployed.
 */
export const ANONYMOUS_COUNTS_ENABLED: boolean = true;

export const ANONYMOUS_COUNTS_SCHEMA_VERSION = 1 as const;

export const ANONYMOUS_COUNTS_ENDPOINTS = {
  development: "https://stella-v2-telemetry-dev.fromyou.workers.dev/v1/counts",
  production: "https://stella-v2-telemetry.fromyou.workers.dev/v1/counts",
} as const;

export const ANONYMOUS_COUNT_ENGINES = [
  "stella",
  "claude_code",
  "chatgpt",
  "api_key",
  "local",
  "none",
] as const;
export type AnonymousCountEngine = (typeof ANONYMOUS_COUNT_ENGINES)[number];

/** Answers to "How did you find Stella?", in the order the question shows them. */
export const FOUND_VIA_ANSWERS = [
  "google",
  "youtube",
  "tiktok_instagram",
  "reddit",
  "friend",
  "app_store",
  "ai_suggested",
  "other",
] as const;
export type FoundViaAnswer = (typeof FOUND_VIA_ANSWERS)[number];
export type FoundViaChoice = FoundViaAnswer | "skipped";

/** Desktop setup steps, in order; "chat" is the chat itself, once setup is done or skipped. */
export const SETUP_STEPS = ["signin", "extras", "chat"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Messages sent in an install's first 24 hours are counted up to this many. */
export const DAY1_MESSAGE_CAP = 30;
/** Failed replies are counted up to this many per local calendar day. */
export const TURN_ERRORS_PER_DAY = 10;

/** Why a reply failed or could not start; the kinds the desktop chat tells apart. */
export const TURN_ERROR_KINDS = [
  "account-auth",
  "billing",
  "capability-required",
  "chatgpt-auth",
  "chatgpt-usage-limit",
  "claude-code-login",
  "claude-code-not-installed",
  "claude-code-unusable",
  "claude-code-usage-limit",
  "content-blocked",
  "context-limit",
  "free-allowance-exhausted",
  "malformed-request",
  "model-restriction",
  "network",
  "provider-access",
  "rate-limit",
  "service-unavailable",
  "sign-in-required",
  "timeout",
  "unknown",
  "usage-limit-paused",
  "login-required",
  "no-engine",
] as const;
export type TurnErrorKind = (typeof TURN_ERROR_KINDS)[number];

export const ANONYMOUS_COUNT_PLATFORMS = ["darwin", "win32", "linux"] as const;
export type AnonymousCountPlatform = (typeof ANONYMOUS_COUNT_PLATFORMS)[number];

export type AnonymousCountEvent =
  /** First launch with counting on; `existingInstall` when onboarding was already done before counting existed. */
  | { type: "first_run"; existingInstall: boolean }
  | { type: "engine_chosen"; engine: AnonymousCountEngine }
  | { type: "first_reply"; engine: AnonymousCountEngine }
  /** At most one per local calendar day. */
  | { type: "active_day" }
  | { type: "found_via"; answer: FoundViaChoice }
  /** Once per step: how far setup got. */
  | { type: "setup_step"; step: SetupStep }
  /** The nth message sent in the install's first 24 hours (n ≤ DAY1_MESSAGE_CAP). */
  | { type: "day1_message"; n: number; engine: AnonymousCountEngine }
  /** A reply that failed or could not start (at most TURN_ERRORS_PER_DAY a day). */
  | { type: "turn_error"; kind: TurnErrorKind; engine: AnonymousCountEngine };

export type AnonymousCountEventType = AnonymousCountEvent["type"];

/** What the renderer may ask the main process to record; main fills in the engine. */
export type AnonymousCountRequest =
  | { type: "engine_chosen" }
  | { type: "first_reply" }
  | { type: "found_via"; answer: FoundViaChoice }
  | { type: "setup_step"; step: SetupStep }
  | { type: "message_sent" }
  | { type: "turn_error"; kind: TurnErrorKind };

export type AnonymousCountItem = {
  eventId: string;
  occurredAtMs: number;
  event: AnonymousCountEvent;
};

export type AnonymousCountsBatch = {
  schemaVersion: typeof ANONYMOUS_COUNTS_SCHEMA_VERSION;
  environment: "development" | "production";
  installId: string;
  release: string;
  platform: AnonymousCountPlatform;
  events: AnonymousCountItem[];
};

export const ANONYMOUS_COUNTS_MAX_EVENTS = 20;
export const ANONYMOUS_COUNTS_MAX_BODY_BYTES = 8 * 1024;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RELEASE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const isOneOf = <T extends string>(
  value: unknown,
  options: readonly T[],
): value is T => typeof value === "string" && options.includes(value as T);

export const isAnonymousCountsInstallId = (value: unknown): value is string =>
  typeof value === "string" && UUID_V4.test(value);

export const isFoundViaChoice = (value: unknown): value is FoundViaChoice =>
  value === "skipped" || isOneOf(value, FOUND_VIA_ANSWERS);

export const isSetupStep = (value: unknown): value is SetupStep =>
  isOneOf(value, SETUP_STEPS);

export const isTurnErrorKind = (value: unknown): value is TurnErrorKind =>
  isOneOf(value, TURN_ERROR_KINDS);

const isEvent = (value: unknown): value is AnonymousCountEvent => {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "first_run":
      return (
        hasOnlyKeys(value, ["type", "existingInstall"]) &&
        typeof value.existingInstall === "boolean"
      );
    case "engine_chosen":
    case "first_reply":
      return (
        hasOnlyKeys(value, ["type", "engine"]) &&
        isOneOf(value.engine, ANONYMOUS_COUNT_ENGINES)
      );
    case "active_day":
      return hasOnlyKeys(value, ["type"]);
    case "found_via":
      return hasOnlyKeys(value, ["type", "answer"]) && isFoundViaChoice(value.answer);
    case "setup_step":
      return hasOnlyKeys(value, ["type", "step"]) && isSetupStep(value.step);
    case "day1_message":
      return (
        hasOnlyKeys(value, ["type", "n", "engine"]) &&
        typeof value.n === "number" &&
        Number.isInteger(value.n) &&
        value.n >= 1 &&
        value.n <= DAY1_MESSAGE_CAP &&
        isOneOf(value.engine, ANONYMOUS_COUNT_ENGINES)
      );
    case "turn_error":
      return (
        hasOnlyKeys(value, ["type", "kind", "engine"]) &&
        isTurnErrorKind(value.kind) &&
        isOneOf(value.engine, ANONYMOUS_COUNT_ENGINES)
      );
    default:
      return false;
  }
};

const isItem = (value: unknown): value is AnonymousCountItem =>
  isRecord(value) &&
  hasOnlyKeys(value, ["eventId", "occurredAtMs", "event"]) &&
  isAnonymousCountsInstallId(value.eventId) &&
  typeof value.occurredAtMs === "number" &&
  Number.isSafeInteger(value.occurredAtMs) &&
  value.occurredAtMs > 0 &&
  isEvent(value.event);

/** Strict: unknown keys, extra fields or out-of-set values reject the whole batch. */
export const isAnonymousCountsBatch = (
  value: unknown,
): value is AnonymousCountsBatch =>
  isRecord(value) &&
  hasOnlyKeys(value, [
    "schemaVersion",
    "environment",
    "installId",
    "release",
    "platform",
    "events",
  ]) &&
  value.schemaVersion === ANONYMOUS_COUNTS_SCHEMA_VERSION &&
  (value.environment === "development" || value.environment === "production") &&
  isAnonymousCountsInstallId(value.installId) &&
  typeof value.release === "string" &&
  RELEASE.test(value.release) &&
  isOneOf(value.platform, ANONYMOUS_COUNT_PLATFORMS) &&
  Array.isArray(value.events) &&
  value.events.length > 0 &&
  value.events.length <= ANONYMOUS_COUNTS_MAX_EVENTS &&
  value.events.every(isItem);

/** The value written in the dimension column: the engine, the answer, the step, the count, the error kind, or "". */
export const anonymousCountDetail = (event: AnonymousCountEvent): string => {
  switch (event.type) {
    case "engine_chosen":
    case "first_reply":
      return event.engine;
    case "found_via":
      return event.answer;
    case "first_run":
      return event.existingInstall ? "existing" : "new";
    case "active_day":
      return "";
    case "setup_step":
      return event.step;
    case "day1_message":
      return String(event.n);
    case "turn_error":
      return event.kind;
  }
};

/** The second dimension column: the engine for day-1 messages and failed replies, else "". */
export const anonymousCountEngineDetail = (event: AnonymousCountEvent): string =>
  event.type === "day1_message" || event.type === "turn_error" ? event.engine : "";
