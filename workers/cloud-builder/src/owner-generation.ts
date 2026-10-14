export const normalizeOwnerGeneration = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
};

export const ownerGenerationMatches = (
  expected: string | undefined,
  incoming: unknown,
): boolean => {
  const normalized = normalizeOwnerGeneration(incoming);
  return Boolean(expected && normalized === expected);
};

export type OwnerPurgeBeginDisposition =
  | {
      action: "start";
      mode: "temporary" | "permanent";
      rejoined: boolean;
    }
  | {
      action: "resume";
      upgradeToPermanent: boolean;
      rejoined: boolean;
    }
  | { action: "reject" };

export const ownerPurgeBeginDisposition = (args: {
  state: "open" | "blocked";
  mode?: "temporary" | "permanent";
  generation: string;
  beginRequestId?: string;
  lastReleasedGeneration?: string;
  rejoinedFromGeneration?: string;
  requestId: unknown;
  expectedGeneration: unknown;
  requestedMode: "temporary" | "permanent";
}): OwnerPurgeBeginDisposition => {
  const requestId = normalizeOwnerGeneration(args.requestId);
  const hasExpectedGeneration = args.expectedGeneration !== undefined;
  const expectedGeneration = normalizeOwnerGeneration(args.expectedGeneration);
  if (!requestId || (hasExpectedGeneration && !expectedGeneration)) {
    return { action: "reject" };
  }

  if (args.state === "open") {
    if (!hasExpectedGeneration) {
      return {
        action: "start",
        mode: args.requestedMode,
        rejoined: false,
      };
    }
    return expectedGeneration === args.lastReleasedGeneration
      ? { action: "start", mode: "temporary", rejoined: true }
      : { action: "reject" };
  }

  if (!expectedGeneration) {
    return requestId === args.beginRequestId
      ? {
          action: "resume",
          upgradeToPermanent: args.requestedMode === "permanent",
          rejoined: false,
        }
      : { action: "reject" };
  }
  if (expectedGeneration === args.generation) {
    return {
      action: "resume",
      upgradeToPermanent: args.requestedMode === "permanent",
      rejoined: false,
    };
  }
  if (expectedGeneration === args.rejoinedFromGeneration) {
    return {
      action: "resume",
      upgradeToPermanent: false,
      rejoined: true,
    };
  }
  return { action: "reject" };
};

export const ownerPurgeReleaseDisposition = (args: {
  state: "open" | "blocked";
  mode?: "temporary" | "permanent";
  generation: string;
  lastReleasedGeneration?: string;
  requestedGeneration: unknown;
  activeLeaseCount: number;
}): "release" | "already-released" | "reject" => {
  const requestedGeneration = normalizeOwnerGeneration(
    args.requestedGeneration,
  );
  if (!requestedGeneration) return "reject";
  if (
    args.state === "open" &&
    args.lastReleasedGeneration === requestedGeneration
  ) {
    return "already-released";
  }
  return args.state === "blocked" &&
    args.mode === "temporary" &&
    requestedGeneration === args.generation &&
    args.activeLeaseCount === 0
    ? "release"
    : "reject";
};
