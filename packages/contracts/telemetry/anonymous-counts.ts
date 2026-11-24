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

export const SETUP_STEPS = ["signin", "extras", "chat"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const DAY1_MESSAGE_CAP = 30;
export const TURN_ERRORS_PER_DAY = 10;

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
  | { type: "first_run"; existingInstall: boolean }
  | { type: "engine_chosen"; engine: AnonymousCountEngine }
  | { type: "first_reply"; engine: AnonymousCountEngine }
  | { type: "active_day" }
  | { type: "found_via"; answer: FoundViaChoice }
  | { type: "setup_step"; step: SetupStep }
  | { type: "day1_message"; n: number; engine: AnonymousCountEngine }
  | { type: "turn_error"; kind: TurnErrorKind; engine: AnonymousCountEngine };

export type AnonymousCountEventType = AnonymousCountEvent["type"];

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

export const anonymousCountEngineDetail = (event: AnonymousCountEvent): string =>
  event.type === "day1_message" || event.type === "turn_error" ? event.engine : "";
