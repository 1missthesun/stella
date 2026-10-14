import { BackendRequestError } from "./backend/client.js";
import type { HomeCalls } from "./backend/home.js";
import { OWNER_GENERATION_STALE } from "./backend/protocol.js";
import type { MemoryPolicy } from "./turn-plane/memory-policy.js";

const MAX_OWNER_GENERATION_CHARS = 512;
const MAX_IDENTITY_CHARS = 1_024;
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const OWNER_GENERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const EPOCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/|?-]{0,1023}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const SWITCH_KEYS = new Set([
  "ownerGeneration",
  "memoryEnabled",
  "revision",
  "updatedAt",
]);
const POLICY_KEYS = new Set([...SWITCH_KEYS, "memoryEpoch"]);
const PREFERENCE_KEYS = new Set([
  "subject",
  "state",
  "importDisposition",
  ...POLICY_KEYS,
]);
const PREFERENCE_OPTIONAL_KEYS = new Set(["lastWipedEpoch"]);

export type SetCloudMemoryEnabledArgs = HomeCalls["memory.setEnabled"]["args"];

export type CloudMemorySwitch = Omit<MemoryPolicy, "memoryEpoch">;

export type CloudMemoryPreferenceIssue =
  | { code: "revision_conflict"; retryable: false }
  | {
      code:
        | "owner_generation_changed"
        | "idempotency_conflict"
        | "unauthorized"
        | "invalid_response";
      retryable: false;
    }
  | { code: "unavailable"; retryable: true };

export class CloudMemoryPreferenceError extends Error {
  readonly code: Exclude<
    CloudMemoryPreferenceIssue["code"],
    "revision_conflict"
  >;
  readonly retryable: boolean;

  constructor(
    issue: Exclude<CloudMemoryPreferenceIssue, { code: "revision_conflict" }>,
  ) {
    const message =
      issue.code === "owner_generation_changed"
        ? "Cloud memory changed account generations. Reload this setting."
        : issue.code === "idempotency_conflict"
          ? "This cloud memory update no longer identifies the same change."
          : issue.code === "unauthorized"
            ? "Sign in again to change cloud memory."
            : issue.code === "invalid_response"
              ? "Cloud memory returned an invalid response."
              : "Cloud memory could not be reached. Try again.";
    super(message);
    this.name = "CloudMemoryPreferenceError";
    this.code = issue.code;
    this.retryable = issue.retryable;
  }
}

const invalidResponse = (): never => {
  throw new CloudMemoryPreferenceError({
    code: "invalid_response",
    retryable: false,
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  required: ReadonlySet<string>,
  optional: ReadonlySet<string> = new Set(),
): boolean =>
  [...required].every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => required.has(key) || optional.has(key));

export const isNonNegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isMemoryEpoch = (value: unknown): value is string =>
  typeof value === "string" &&
  value.normalize("NFC") === value &&
  value.trim() === value &&
  !CONTROL_CHARACTER_PATTERN.test(value) &&
  EPOCH_PATTERN.test(value);

const isOwnerGeneration = (value: unknown): value is string =>
  typeof value === "string" &&
  (value === "" ||
    (value.length <= MAX_OWNER_GENERATION_CHARS &&
      value.normalize("NFC") === value &&
      value.trim() === value &&
      OWNER_GENERATION_PATTERN.test(value)));

export const normalizedCloudMemoryIdentity = (
  value: unknown,
  label: string,
): string => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_IDENTITY_CHARS ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new TypeError(`A normalized ${label} is required.`);
  }
  return value;
};

export const followsOwnerGeneration = (
  expected: string,
  observed: string,
): boolean => (expected === "" ? observed !== "" : observed === expected);

const decodeSwitchFields = (
  value: Record<string, unknown>,
): CloudMemorySwitch => {
  if (
    !isOwnerGeneration(value.ownerGeneration) ||
    typeof value.memoryEnabled !== "boolean" ||
    !isNonNegativeSafeInteger(value.revision) ||
    !isNonNegativeSafeInteger(value.updatedAt) ||
    value.updatedAt > MAX_TIMESTAMP_MS
  ) {
    return invalidResponse();
  }
  return {
    ownerGeneration: value.ownerGeneration,
    memoryEnabled: value.memoryEnabled,
    revision: value.revision,
    updatedAt: value.updatedAt,
  };
};

export const decodeCloudMemorySwitch = (value: unknown): CloudMemorySwitch => {
  if (!isRecord(value) || !hasExactKeys(value, SWITCH_KEYS)) {
    return invalidResponse();
  }
  return decodeSwitchFields(value);
};

export const decodeCloudMemoryPolicy = (value: unknown): MemoryPolicy => {
  if (!isRecord(value) || !hasExactKeys(value, POLICY_KEYS)) {
    return invalidResponse();
  }
  const fields = decodeSwitchFields(value);
  if (!isMemoryEpoch(value.memoryEpoch)) return invalidResponse();
  return { ...fields, memoryEpoch: value.memoryEpoch };
};

export const decodeCloudMemoryPreferenceForSubject = (
  value: unknown,
  expectedSubject: string,
): MemoryPolicy => {
  const expected = normalizedCloudMemoryIdentity(
    expectedSubject,
    "owner subject",
  );
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PREFERENCE_KEYS, PREFERENCE_OPTIONAL_KEYS)
  ) {
    return invalidResponse();
  }
  if (
    value.subject !== expected ||
    (value.state !== "open" && value.state !== "wiping") ||
    (value.importDisposition !== "automatic_allowed" &&
      value.importDisposition !== "explicit_required" &&
      value.importDisposition !== "explicit_allowed") ||
    (value.lastWipedEpoch !== undefined && !isMemoryEpoch(value.lastWipedEpoch))
  ) {
    return invalidResponse();
  }
  return decodeCloudMemoryPolicy({
    ownerGeneration: value.ownerGeneration,
    memoryEpoch: value.memoryEpoch,
    memoryEnabled: value.memoryEnabled,
    revision: value.revision,
    updatedAt: value.updatedAt,
  });
};

let fallbackRequestSequence = 0;

const defaultRequestEntropy = (): string => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  fallbackRequestSequence = (fallbackRequestSequence + 1) % 0x7fffffff;
  return [
    Date.now().toString(36),
    fallbackRequestSequence.toString(36),
    Math.random().toString(36).slice(2, 14),
  ].join("-");
};

export const createCloudMemoryPreferenceRequestId = (
  client: "desktop" | "mobile",
  createEntropy: () => string = defaultRequestEntropy,
): string => {
  const entropy = createEntropy();
  if (
    typeof entropy !== "string" ||
    !entropy ||
    entropy.normalize("NFC") !== entropy ||
    entropy.trim() !== entropy
  ) {
    throw new TypeError("Cloud memory request entropy is invalid.");
  }
  const requestId = `${client}-memory:${entropy}`;
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new TypeError("A valid cloud memory request id is required.");
  }
  return requestId;
};

export const normalizeCloudMemoryPreferenceIssue = (
  error: unknown,
): CloudMemoryPreferenceIssue => {
  if (error instanceof CloudMemoryPreferenceError) {
    return { code: error.code, retryable: error.retryable } as Exclude<
      CloudMemoryPreferenceIssue,
      { code: "revision_conflict" }
    >;
  }
  if (!(error instanceof BackendRequestError)) {
    return { code: "unavailable", retryable: true };
  }
  if (error.reason === "CLOUD_HOME_REVISION_CONFLICT") {
    return { code: "revision_conflict", retryable: false };
  }
  if (error.reason === OWNER_GENERATION_STALE) {
    return { code: "owner_generation_changed", retryable: false };
  }
  if (error.reason === "CLOUD_HOME_IDEMPOTENCY_CONFLICT") {
    return { code: "idempotency_conflict", retryable: false };
  }
  if (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") {
    return { code: "unauthorized", retryable: false };
  }
  return { code: "unavailable", retryable: true };
};

export type CloudMemoryPreferenceWrite = Readonly<
  SetCloudMemoryEnabledArgs & { expectedSubject: string }
>;

export const cloudMemoryPreferenceMutationInput = (
  attempt: CloudMemoryPreferenceWrite,
): SetCloudMemoryEnabledArgs => ({
  requestId: attempt.requestId,
  memoryEnabled: attempt.memoryEnabled,
  expectedRevision: attempt.expectedRevision,
  expectedOwnerGeneration: attempt.expectedOwnerGeneration,
});

export const writeCloudMemoryPreference = async <
  Attempt extends CloudMemoryPreferenceWrite,
>(
  attempt: Attempt,
  send: (input: SetCloudMemoryEnabledArgs) => Promise<unknown>,
): Promise<
  | { status: "committed"; fence: Attempt; preference: MemoryPolicy }
  | { status: "conflict"; fence: Attempt }
> => {
  try {
    const preference = decodeCloudMemoryPreferenceForSubject(
      await send(cloudMemoryPreferenceMutationInput(attempt)),
      attempt.expectedSubject,
    );
    if (
      !followsOwnerGeneration(
        attempt.expectedOwnerGeneration,
        preference.ownerGeneration,
      )
    ) {
      throw new CloudMemoryPreferenceError({
        code: "owner_generation_changed",
        retryable: false,
      });
    }
    if (
      preference.memoryEnabled !== attempt.memoryEnabled ||
      preference.revision !== attempt.expectedRevision + 1
    ) {
      return invalidResponse();
    }
    return { status: "committed", fence: attempt, preference };
  } catch (error) {
    const issue = normalizeCloudMemoryPreferenceIssue(error);
    if (issue.code === "revision_conflict") {
      return { status: "conflict", fence: attempt };
    }
    throw new CloudMemoryPreferenceError(issue);
  }
};
