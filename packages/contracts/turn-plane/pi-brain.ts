export type PiBrainHost =
  | { host: "cloud" }
  | {
      host: "device";
      deviceId: string;
      label?: string;
    };

export type PiBrainRecord = PiBrainHost & {
  epoch: number;
  updatedAt: number;
  leaseExpiresAt?: number;
  acquired?: "claimed" | "moved" | "home" | "takeover";
  previous?: PiBrainHost & { epoch: number };
};

export const PI_BRAIN_LEASE_MS = 2 * 60_000;

export const PI_BRAIN_ELSEWHERE_CODE = "brain_elsewhere";

export type PiBrainClaim = { epoch: number | null };

export type PiBrainClaimAck = { record: PiBrainRecord | null; takenOver?: true };

export const parsePiBrainClaim = (value: unknown): PiBrainClaim | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const epoch = (value as { epoch?: unknown }).epoch;
  if (epoch === null) return { epoch: null };
  return typeof epoch === "number" && Number.isSafeInteger(epoch) && epoch >= 0 ? { epoch } : undefined;
};

export const parsePiBrainRecord = (value: unknown): PiBrainRecord | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const host = parsePiBrainHost(record);
  if (!host || typeof record.epoch !== "number" || !Number.isSafeInteger(record.epoch)) return null;
  const previous =
    record.previous && typeof record.previous === "object"
      ? (() => {
          const prior = record.previous as Record<string, unknown>;
          const priorHost = parsePiBrainHost(prior);
          return priorHost && typeof prior.epoch === "number" && Number.isSafeInteger(prior.epoch)
            ? { ...priorHost, epoch: prior.epoch }
            : undefined;
        })()
      : undefined;
  return {
    ...host,
    epoch: record.epoch,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
    ...(typeof record.leaseExpiresAt === "number" ? { leaseExpiresAt: record.leaseExpiresAt } : {}),
    ...(record.acquired === "claimed" ||
    record.acquired === "moved" ||
    record.acquired === "home" ||
    record.acquired === "takeover"
      ? { acquired: record.acquired }
      : {}),
    ...(previous ? { previous } : {}),
  };
};

export const samePiBrainHost = (left: PiBrainHost, right: PiBrainHost): boolean =>
  left.host === right.host && (left.host === "cloud" || (right.host === "device" && left.deviceId === right.deviceId));

export const piBrainHostName = (host: PiBrainHost): string =>
  host.host === "cloud" ? "the cloud" : host.label?.trim() || host.deviceId;

const hostOnly = (host: PiBrainHost): PiBrainHost =>
  host.host === "cloud"
    ? { host: "cloud" }
    : { host: "device", deviceId: host.deviceId, ...(host.label ? { label: host.label } : {}) };

export const movePiBrain = (prior: PiBrainRecord | null | undefined, host: PiBrainHost, now: number): PiBrainRecord => ({
  ...hostOnly(host),
  epoch: (prior?.epoch ?? 0) + 1,
  updatedAt: now,
  ...(host.host === "device" ? { leaseExpiresAt: now + PI_BRAIN_LEASE_MS } : {}),
  acquired: "moved",
  ...(prior ? { previous: { ...hostOnly(prior), epoch: prior.epoch } } : {}),
});

export const claimFreePiBrain = (
  claimant: Extract<PiBrainHost, { host: "device" }>,
  now: number,
): PiBrainRecord => ({
  ...movePiBrain(null, claimant, now),
  acquired: "claimed",
});

export const homePiBrain = (
  prior: PiBrainRecord | null | undefined,
  home: Extract<PiBrainHost, { host: "device" }>,
  now: number,
): PiBrainRecord => ({
  ...movePiBrain(prior, home, now),
  acquired: "home",
});

export const takeOverPiBrain = (prior: PiBrainRecord, claimant: PiBrainHost, now: number): PiBrainRecord => ({
  ...movePiBrain(prior, claimant, now),
  acquired: "takeover",
});

export const renewPiBrainLease = (record: PiBrainRecord, seenAt: number): PiBrainRecord | undefined => {
  if (record.host !== "device") return undefined;
  const expiresAt = seenAt + PI_BRAIN_LEASE_MS;
  if (record.leaseExpiresAt !== undefined && record.leaseExpiresAt >= expiresAt - PI_BRAIN_LEASE_MS / 4) return undefined;
  return { ...record, leaseExpiresAt: Math.max(record.leaseExpiresAt ?? 0, expiresAt) };
};

export type PiBrainClaimDecision =
  | { kind: "free" }
  | { kind: "holder" }
  | { kind: "takeover"; reason: "unavailable" | "expired" }
  | { kind: "elsewhere"; reason: "holder_live" | "stale_epoch" };

export const decidePiBrainClaim = (args: {
  record: PiBrainRecord | null | undefined;
  claimant: PiBrainHost;
  claimEpoch: number | null;
  holderGone?: boolean;
  now: number;
}): PiBrainClaimDecision => {
  const { record, claimant, claimEpoch } = args;
  if (!record) return { kind: "free" };
  if (samePiBrainHost(record, claimant)) return { kind: "holder" };
  if (claimEpoch !== null && claimEpoch !== record.epoch) return { kind: "elsewhere", reason: "stale_epoch" };
  if (record.host === "cloud") return { kind: "elsewhere", reason: "holder_live" };
  if (args.holderGone) return { kind: "takeover", reason: "unavailable" };
  if (record.leaseExpiresAt !== undefined && record.leaseExpiresAt <= args.now) {
    return { kind: "takeover", reason: "expired" };
  }
  return { kind: "elsewhere", reason: "holder_live" };
};

export type PiBrainResponse = { record: PiBrainRecord | null };

export const piBrainPath = (conversationId: string): string =>
  `/conversations/${encodeURIComponent(conversationId)}/pi-brain`;

export const parsePiBrainHost = (value: unknown): PiBrainHost | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.host === "cloud") return { host: "cloud" };
  if (record.host !== "device" || typeof record.deviceId !== "string") return undefined;
  const deviceId = record.deviceId.trim();
  if (!deviceId || deviceId.length > 256) return undefined;
  const label = typeof record.label === "string" ? record.label.trim().slice(0, 200) : "";
  return { host: "device", deviceId, ...(label ? { label } : {}) };
};

export const piBrainHandoffPrompt = (from: string, brief: string): string =>
  `[You moved this chat here from ${from} with switch_destination, and you run here now: do not move again for this brief. This is your brief, not a new message from the user.]\n\n${brief}`;
