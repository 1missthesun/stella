import {
  createCloudMemoryPreferenceRequestId,
  decodeCloudMemoryPreferenceForSubject,
  decodeCloudMemorySwitch,
  isNonNegativeSafeInteger,
  normalizedCloudMemoryIdentity as readNormalizedIdentity,
  writeCloudMemoryPreference,
  type CloudMemorySwitch,
  type SetCloudMemoryEnabledArgs,
} from "@stella/contracts/cloud-memory-preference";

export {
  CloudMemoryPreferenceError as MobileCloudMemoryPreferenceError,
  followsOwnerGeneration as followsMobileOwnerGeneration,
} from "@stella/contracts/cloud-memory-preference";

export type MobileCloudMemoryPreference = CloudMemorySwitch;

export type MobileCloudMemoryPreferenceRequestFence = Readonly<{
  accountScope: string;
  identityKey: string;
  identityRevision: number;
  expectedSubject: string;
  requestId: string;
}>;

export type MobileCloudMemoryPreferenceWriteAttempt = Readonly<{
  accountScope: string;
  identityKey: string;
  identityRevision: number;
  expectedSubject: string;
  requestId: string;
  memoryEnabled: boolean;
  expectedOwnerGeneration: string;
  expectedRevision: number;
}>;

export type MobileCloudMemoryPreferenceMutationInput =
  SetCloudMemoryEnabledArgs;

const readIdentityRevision = (value: unknown): number => {
  if (!isNonNegativeSafeInteger(value)) {
    throw new TypeError("A non-negative identity revision is required.");
  }
  return value;
};

export const decodeMobileCloudMemoryPreferenceForSubject = (
  value: unknown,
  expectedSubject: string,
): MobileCloudMemoryPreference => {
  const { memoryEpoch: _memoryEpoch, ...preference } =
    decodeCloudMemoryPreferenceForSubject(value, expectedSubject);
  return preference;
};

export const createMobileCloudMemoryPreferenceRequestId = (
  createEntropy?: () => string,
): string => createCloudMemoryPreferenceRequestId("mobile", createEntropy);

export const createMobileCloudMemoryPreferenceRequestFence = (
  identity: {
    accountScope: string;
    identityKey: string;
    identityRevision: number;
    expectedSubject: string;
  },
  createEntropy?: () => string,
): MobileCloudMemoryPreferenceRequestFence =>
  Object.freeze({
    accountScope: readNormalizedIdentity(
      identity.accountScope,
      "account scope",
    ),
    identityKey: readNormalizedIdentity(identity.identityKey, "identity key"),
    identityRevision: readIdentityRevision(identity.identityRevision),
    expectedSubject: readNormalizedIdentity(
      identity.expectedSubject,
      "owner subject",
    ),
    requestId: createMobileCloudMemoryPreferenceRequestId(createEntropy),
  });

export const beginMobileCloudMemoryPreferenceWrite = (args: {
  accountScope: string;
  identityKey: string;
  identityRevision: number;
  expectedSubject: string;
  preference: MobileCloudMemoryPreference;
  memoryEnabled: boolean;
  createEntropy?: () => string;
}): MobileCloudMemoryPreferenceWriteAttempt => {
  const preference = decodeCloudMemorySwitch(args.preference);
  if (typeof args.memoryEnabled !== "boolean") {
    throw new TypeError("Cloud memory preference must be a boolean.");
  }
  const fence = createMobileCloudMemoryPreferenceRequestFence(
    args,
    args.createEntropy,
  );
  return Object.freeze({
    ...fence,
    memoryEnabled: args.memoryEnabled,
    expectedOwnerGeneration: preference.ownerGeneration,
    expectedRevision: preference.revision,
  });
};

export const isMobileCloudMemoryPreferenceRequestCurrent = (
  originating: MobileCloudMemoryPreferenceRequestFence,
  current: {
    accountScope: string | null | undefined;
    identityKey: string | null | undefined;
    identityRevision: number | null | undefined;
    expectedSubject?: string | null | undefined;
    requestId: string | null | undefined;
  },
): boolean =>
  originating.accountScope === current.accountScope &&
  originating.identityKey === current.identityKey &&
  originating.identityRevision === current.identityRevision &&
  (current.expectedSubject === undefined ||
    originating.expectedSubject === current.expectedSubject) &&
  originating.requestId === current.requestId;

export type MobileCloudMemoryPreferenceFencedResult = {
  fence: MobileCloudMemoryPreferenceRequestFence;
  preference?: MobileCloudMemoryPreference;
};

export const acceptCurrentMobileCloudMemoryPreferenceResult = <
  T extends MobileCloudMemoryPreferenceFencedResult,
>(
  result: T,
  current: {
    accountScope: string | null | undefined;
    identityKey: string | null | undefined;
    identityRevision: number | null | undefined;
    expectedSubject?: string | null | undefined;
    requestId: string | null | undefined;
    ownerGeneration?: string | null | undefined;
  },
): T | null =>
  isMobileCloudMemoryPreferenceRequestCurrent(result.fence, current) &&
  (!current.ownerGeneration ||
    (result.preference
      ? result.preference.ownerGeneration === current.ownerGeneration
      : "expectedOwnerGeneration" in result.fence &&
        result.fence.expectedOwnerGeneration === current.ownerGeneration))
    ? result
    : null;

export type MobileCloudMemoryPreferencePort = {
  setMemoryEnabled: (
    input: MobileCloudMemoryPreferenceMutationInput,
  ) => Promise<unknown>;
};

export type MobileCloudMemoryPreferenceWriteResult =
  | {
      status: "committed";
      fence: MobileCloudMemoryPreferenceWriteAttempt;
      preference: MobileCloudMemoryPreference;
    }
  | {
      status: "conflict";
      fence: MobileCloudMemoryPreferenceWriteAttempt;
    };

export type MobileCloudMemoryPreferenceClient = {
  write: (
    attempt: MobileCloudMemoryPreferenceWriteAttempt,
  ) => Promise<MobileCloudMemoryPreferenceWriteResult>;
};

export const createMobileCloudMemoryPreferenceClient = (
  port: MobileCloudMemoryPreferencePort,
): MobileCloudMemoryPreferenceClient => ({
  write: async (attempt) => {
    const result = await writeCloudMemoryPreference(attempt, (input) =>
      port.setMemoryEnabled(input),
    );
    if (result.status === "conflict") return result;
    const { memoryEpoch: _memoryEpoch, ...preference } = result.preference;
    return { status: "committed", fence: attempt, preference };
  },
});
