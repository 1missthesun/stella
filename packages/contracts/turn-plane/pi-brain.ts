/**
 * Where a cloud-stored conversation's brain runs: Stella herself, the
 * orchestrator that takes the conversation's turns, on pi or on Claude Code.
 * Every host shares the conversation through its journal, so the brain can
 * move between the conversation's object in the cloud and one of the owner's
 * computers, and the new host carries on from the journal.
 *
 * The conversation's object keeps the record, the one place every device
 * reads (`GET|POST /conversations/:id/pi-brain`). The record is a run lease:
 * the host it names holds the brain under its epoch, and only that host
 * journals the conversation's turns.
 *
 * - The account's home computer (`brainHome` in the owner's devices list,
 *   set by the user picking a computer in "Run on"): while it is up and
 *   ready, the lease is on it. Any host weighing the lease moves it there
 *   (`homePiBrain`) unless the holder is in the middle of a turn, so it comes
 *   back to the home computer as soon as that one is online and the holder
 *   idle. While it is offline the rules below hold.
 * - No record: the first computer to answer a message its user typed there
 *   claims the lease (`claimFreePiBrain`), so Stella has one home from then on.
 *   Until a computer has, the sender's host answers: the object the phone's
 *   messages, a computer the hidden ones (its agents' reports and notes),
 *   which never claim it.
 * - A message the user typed is never dropped: a computer refused because
 *   another host holds the lease sends it on to the conversation's object,
 *   which places it on the holder or, when the holder can't take it,
 *   answers it.
 * - A record: its holder takes the conversation's turns. A host that would
 *   have answered a message while the holder is gone (a computer offline or
 *   no longer the owner's) or its lease expired takes the lease over under
 *   the next epoch and answers it; the brain stays there until it moves
 *   again. Two hosts never answer side by side. A holder that is up keeps
 *   the brain even when it takes no work from other devices (their messages
 *   are answered once without the lease where they were sent, and its
 *   agents' reports reach it all the same): only a move, Stella's or the
 *   user's, takes the brain from it.
 *
 * A computer's lease is renewed while it is up and ready: by its presence
 * heartbeat to the owner gate, which the object reads whenever it weighs the
 * lease, and by the turns it journals. One that stays not ready lets it lapse. The cloud's never lapses. A computer claims the
 * lease with the epoch it last read (`PiBrainClaim`, on `local-turns/begin`):
 * the object refuses a turn claimed under an older epoch than the record's
 * while another host holds it, so a holder that comes back after a
 * takeover can't journal turns, and keeps what it holds only as a cache.
 *
 * While it is available, the host a record names:
 *
 * - `cloud`: the object runs every turn. A computer sends its user's
 *   messages there as placed chats, and what its agents tell Stella (their
 *   reports and notes) as hidden ones; its own harness only imports.
 * - `device`: that computer runs every turn. The object places a message
 *   sent to it (from the phone) on that computer, and another computer
 *   places its user's messages and its agents' reports there too.
 *
 * A hand-off brief placed after a move goes to the new host as it stands:
 * the move is refused while that host can't take work, and a brief that
 * finds it gone is answered where the owner gate falls back to.
 *
 * Agents' reports and notes go through the owner's agent ledger
 * (`@stella/contracts/backend/agent-reports`), which hands them to whichever
 * host holds the lease when they arrive, so the brain moves while they run.
 */

export type PiBrainHost =
  | { host: "cloud" }
  | {
      host: "device";
      deviceId: string;
      /** The computer's name, for what Stella and the user are told. */
      label?: string;
    };

export type PiBrainRecord = PiBrainHost & {
  /** Counts the moves and takeovers, so a host can tell a newer record from the one it read. */
  epoch: number;
  updatedAt: number;
  /** A computer's lease lapses here unless it is renewed; absent for the cloud, whose lease never lapses. */
  leaseExpiresAt?: number;
  /** How the holder got the brain: claimed with none held, moved there, back home, or taken over from a holder that was unavailable. */
  acquired?: "claimed" | "moved" | "home" | "takeover";
  /** The holder before this epoch. */
  previous?: PiBrainHost & { epoch: number };
};

/** How long a computer's lease lasts past the last sign that it is up. */
export const PI_BRAIN_LEASE_MS = 2 * 60_000;

/** The 409 code of a turn refused because another host holds the brain. */
export const PI_BRAIN_ELSEWHERE_CODE = "brain_elsewhere";

/**
 * A computer's claim on the lease as it begins a turn: the epoch of the
 * record it last read, or null when it has read none. A begin without a
 * claim (a computer from before the lease) is journaled as it always was.
 */
export type PiBrainClaim = { epoch: number | null };

/** A begin's answer about the lease, beside the turn's. */
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

/** The holder as Stella and the user are told it. */
export const piBrainHostName = (host: PiBrainHost): string =>
  host.host === "cloud" ? "the cloud" : host.label?.trim() || host.deviceId;

const hostOnly = (host: PiBrainHost): PiBrainHost =>
  host.host === "cloud"
    ? { host: "cloud" }
    : { host: "device", deviceId: host.deviceId, ...(host.label ? { label: host.label } : {}) };

/** The lease a host gets by a move: a new epoch, renewed from now. */
export const movePiBrain = (prior: PiBrainRecord | null | undefined, host: PiBrainHost, now: number): PiBrainRecord => ({
  ...hostOnly(host),
  epoch: (prior?.epoch ?? 0) + 1,
  updatedAt: now,
  ...(host.host === "device" ? { leaseExpiresAt: now + PI_BRAIN_LEASE_MS } : {}),
  acquired: "moved",
  ...(prior ? { previous: { ...hostOnly(prior), epoch: prior.epoch } } : {}),
});

/** The lease a computer claims by answering its user's message while no host holds one. */
export const claimFreePiBrain = (
  claimant: Extract<PiBrainHost, { host: "device" }>,
  now: number,
): PiBrainRecord => ({
  ...movePiBrain(null, claimant, now),
  acquired: "claimed",
});

/** The lease the account's home computer gets back while it is up (`brainHome`). */
export const homePiBrain = (
  prior: PiBrainRecord | null | undefined,
  home: Extract<PiBrainHost, { host: "device" }>,
  now: number,
): PiBrainRecord => ({
  ...movePiBrain(prior, home, now),
  acquired: "home",
});

/** The lease a host takes over from a holder that was unavailable or lapsed. */
export const takeOverPiBrain = (prior: PiBrainRecord, claimant: PiBrainHost, now: number): PiBrainRecord => ({
  ...movePiBrain(prior, claimant, now),
  acquired: "takeover",
});

/**
 * The lease renewed by a sign that its holder is up at `seenAt`: its own
 * turn, or its presence heartbeat. Undefined when it changes nothing.
 */
export const renewPiBrainLease = (record: PiBrainRecord, seenAt: number): PiBrainRecord | undefined => {
  if (record.host !== "device") return undefined;
  const expiresAt = seenAt + PI_BRAIN_LEASE_MS;
  if (record.leaseExpiresAt !== undefined && record.leaseExpiresAt >= expiresAt - PI_BRAIN_LEASE_MS / 4) return undefined;
  return { ...record, leaseExpiresAt: Math.max(record.leaseExpiresAt ?? 0, expiresAt) };
};

export type PiBrainClaimDecision =
  /** No record: the sender's host answers, and nothing is held. */
  | { kind: "free" }
  /** The claimant holds the lease. */
  | { kind: "holder" }
  /** The holder can't answer: the claimant takes the lease over. */
  | { kind: "takeover"; reason: "unavailable" | "expired" }
  /** Another host holds it, or the claim is older than the record. */
  | { kind: "elsewhere"; reason: "holder_live" | "stale_epoch" };

/**
 * Whether a host may answer a turn of the conversation, the one rule every
 * host's turn passes (the object's own and a computer's begin alike).
 * `holderGone` says the holding computer is offline or no longer the
 * owner's; one that is up but takes no work from other devices still holds
 * it. The cloud is always up.
 */
export const decidePiBrainClaim = (args: {
  record: PiBrainRecord | null | undefined;
  claimant: PiBrainHost;
  claimEpoch: number | null;
  holderGone?: boolean;
  now: number;
}): PiBrainClaimDecision => {
  const { record, claimant, claimEpoch } = args;
  if (!record) return { kind: "free" };
  // The holder answers whatever record it last read: it holds the lease now.
  if (samePiBrainHost(record, claimant)) return { kind: "holder" };
  // A claim read under an older record: the lease moved on since, to a
  // host the claimant has not weighed (or away from it, a holder back after
  // a takeover).
  if (claimEpoch !== null && claimEpoch !== record.epoch) return { kind: "elsewhere", reason: "stale_epoch" };
  if (record.host === "cloud") return { kind: "elsewhere", reason: "holder_live" };
  if (args.holderGone) return { kind: "takeover", reason: "unavailable" };
  if (record.leaseExpiresAt !== undefined && record.leaseExpiresAt <= args.now) {
    return { kind: "takeover", reason: "expired" };
  }
  return { kind: "elsewhere", reason: "holder_live" };
};

/** `GET` answers the record, or `{ record: null }`; `POST` a `PiBrainHost` sets it. */
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

/**
 * The prompt that continues a conversation where its brain moved: Stella's
 * brief to herself. Every host reads it hidden; it is not the user's message.
 */
export const piBrainHandoffPrompt = (from: string, brief: string): string =>
  `[You moved this chat here from ${from} with switch_destination, and you run here now: do not move again for this brief. This is your brief, not a new message from the user.]\n\n${brief}`;
