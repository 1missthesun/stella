import type { AgentLineage } from "../agent-depth.js";
import type { CloudExecutionSelection } from "../agent-engine.js";
import type { CloudTurnContext } from "./turn-start.js";
import type {
  DeviceRequestDeviceFrame,
  DeviceRequestServerFrame,
} from "./device-requests.js";

export const PLACEMENT_PROTOCOL = 1 as const;

export const DISPATCH_SUBMIT_PATH = "/owners/me/dispatches" as const;
export const dispatchPath = (dispatchId: string): string =>
  `${DISPATCH_SUBMIT_PATH}/${encodeURIComponent(dispatchId)}`;
export const dispatchCancelPath = (dispatchId: string): string =>
  `${dispatchPath(dispatchId)}/cancel`;
export const devicePresencePath = (deviceId: string): string =>
  `/owners/me/devices/${encodeURIComponent(deviceId)}/presence`;
export const DEVICES_PATH = "/owners/me/devices" as const;

export type DeviceRemoteExecution =
  | "unconfigured"
  | "asking"
  | "enabled"
  | "declined";

export const SELECTED_DEVICE_NEEDS_CONSENT =
  "SELECTED_DEVICE_NEEDS_CONSENT" as const;

export type DeviceDestination = {
  deviceId: string;
  label?: string;
  /**
   * `remoteExecution === "enabled"`. Kept as its own field because every
   * eligibility check reads it, and a boolean is what they mean: the four
   * states exist to explain *why* a device is refusing, not to be re-derived
   * at each call site.
   */
  remoteExecutionEnabled: boolean;
  remoteExecution: DeviceRemoteExecution;
  remoteExecutionAskedAt?: number;
  brainHome?: true;
  online: boolean;
  presenceSessionId?: string;
  availability?: DeviceAvailability;
  lastSeenAt?: number;
};

type ResolvableDevice = Pick<
  DeviceDestination,
  "deviceId" | "label" | "online" | "remoteExecutionEnabled" | "lastSeenAt"
>;

const deviceName = (device: Pick<DeviceDestination, "label">): string =>
  device.label?.trim().toLowerCase() ?? "";

const liveFirst = (a: ResolvableDevice, b: ResolvableDevice): number =>
  Number(b.online) - Number(a.online) ||
  Number(b.remoteExecutionEnabled) - Number(a.remoteExecutionEnabled) ||
  (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0);

export const findDeviceDestination = <T extends ResolvableDevice>(
  devices: readonly T[],
  requested: string,
): T | undefined => {
  const wanted = requested.trim();
  if (!wanted) return undefined;
  const exact = devices.find((device) => device.deviceId === wanted);
  if (exact) return exact;
  const name = wanted.toLowerCase();
  return devices
    .filter((device) => deviceName(device) === name)
    .sort(liveFirst)[0];
};

export const currentDeviceDestinations = <T extends ResolvableDevice>(
  devices: readonly T[],
): T[] => {
  const kept = new Map<string, T>();
  const result: T[] = [];
  for (const device of [...devices].sort(liveFirst)) {
    const name = deviceName(device);
    if (!name) {
      result.push(device);
      continue;
    }
    const prior = kept.get(name);
    if (prior && !(prior.online && device.online)) continue;
    if (!prior) kept.set(name, device);
    result.push(device);
  }
  return devices.filter((device) => result.includes(device));
};

export type DevicesResponse = {
  protocol: typeof PLACEMENT_PROTOCOL;
  devices: DeviceDestination[];
  cloud: { capabilities: ExecutionCapability[] };
};

export type ExecutionIngress =
  | "desktop"
  | "mobile"
  | "browser"
  | "cloud"
  | "schedule";
export type ExecutionSubject = "portable" | "computer" | "cloud";
export type ExecutionTargetMode = "automatic" | "cloud" | "device";
export type ExecutionKind = "chat" | "agent";
export const EXECUTION_CAPABILITIES = [
  "chat",
  "agent",
  "computer-use",
  "local-files",
  "local-apps",
  "attachments",
  "claude-code",
] as const;
export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];

export const knownExecutionCapabilities = (values: readonly unknown[]): ExecutionCapability[] => [
  ...new Set(
    values.filter((value): value is ExecutionCapability =>
      (EXECUTION_CAPABILITIES as readonly unknown[]).includes(value),
    ),
  ),
];

export const CLOUD_CAPABILITIES: readonly ExecutionCapability[] = [
  "chat",
  "agent",
  "attachments",
];

export type ExecutionDeviceRegistration = {
  deviceId: string;
  devicePublicKey: string;
  deviceName?: string;
  platform?: string;
  capabilities: ExecutionCapability[];
};

export const executionDeviceRegistration = (input: {
  deviceId: string;
  devicePublicKey: string;
  deviceName?: string | undefined;
  platform?: string | undefined;
  capabilities: readonly ExecutionCapability[];
}): ExecutionDeviceRegistration => ({
  deviceId: input.deviceId,
  devicePublicKey: input.devicePublicKey,
  ...(input.deviceName?.trim() ? { deviceName: input.deviceName.trim() } : {}),
  ...(input.platform?.trim() ? { platform: input.platform.trim() } : {}),
  capabilities: [...new Set(input.capabilities)].sort(),
});

export type DispatchState =
  | "offering"
  | "computer_claimed"
  | "computer_accepted"
  | "computer_running"
  | "cloud_committed"
  | "cloud_running"
  | "cancel_pending"
  | "reconciliation_required"
  | "blocked"
  | "completed"
  | "failed"
  | "canceled";

export const TERMINAL_DISPATCH_STATES: readonly DispatchState[] = [
  "completed",
  "failed",
  "canceled",
  "blocked",
];

export const DISPATCH_OFFER_WINDOW_MS = 4_000;
export const DISPATCH_RECONNECT_GRACE_MS = 20_000;
export const DISPATCH_CLAIM_LEASE_MS = 30_000;
export const DISPATCH_ACCEPTED_LEASE_MS = 120_000;
export const DISPATCH_PAYLOAD_TTL_MS = 900_000;
export const DEVICE_PRESENCE_PING_INTERVAL_MS = 10_000;
export const DEVICE_PRESENCE_STALE_AFTER_MS = 60_000;

export type DispatchPayload = {
  schemaVersion: 1;
  prompt: string;
  conversationId: string;
  clientMsgId: string;
  userMessageEventId?: string;
  locale?: string;
  attachments?: string[];
  context?: CloudTurnContext;
  execution?: CloudExecutionSelection | null;
  description?: string;
  threadId?: string;
  model?: string;
  lineage?: AgentLineage;
  handoff?: true;
  scheduledAgent?: { description: string };
};

export type DispatchSubmitRequest = {
  protocol: typeof PLACEMENT_PROTOCOL;
  idempotencyKey: string;
  kind: ExecutionKind;
  ingress: ExecutionIngress;
  subject: ExecutionSubject;
  targetMode?: ExecutionTargetMode;
  targetDeviceId?: string;
  requestingDeviceId?: string;
  conversationId: string;
  parentTurnId?: string;
  threadId?: string;
  requiredCapabilities: ExecutionCapability[];
  payload: DispatchPayload;
};

export type DispatchSummary = {
  dispatchId: string;
  idempotencyKey: string;
  kind: ExecutionKind;
  ingress: ExecutionIngress;
  subject: ExecutionSubject;
  requestedTargetMode?: ExecutionTargetMode;
  requestedExecutorDeviceId?: string;
  conversationId: string;
  parentTurnId?: string;
  threadId?: string;
  state: DispatchState;
  placement?: "computer" | "cloud";
  executorDeviceId?: string;
  executorPresenceSessionId?: string;
  revision: number;
  fallbackReason?: string;
  cancelRequestId?: string;
  cancelReason?: string;
  errorCode?: string;
  errorMessage?: string;
  cloudTurnId?: string;
  cloudThreadId?: string;
  resultJson?: string;
  createdAt: number;
  updatedAt: number;
};

export type DispatchSubmitResponse = {
  protocol: typeof PLACEMENT_PROTOCOL;
  dispatch: DispatchSummary;
  replayed: boolean;
};

export type DispatchStatusResponse = {
  protocol: typeof PLACEMENT_PROTOCOL;
  dispatch: DispatchSummary;
};

export type DispatchCancelRequest = {
  protocol: typeof PLACEMENT_PROTOCOL;
  cancelRequestId: string;
  reason?: string;
};

export type DispatchErrorCode =
  | "unauthorized"
  | "forbidden"
  | "bad_request"
  | "conflict"
  | "not_found"
  | "owner_purged"
  | "generation_stale"
  | "capability_unavailable"
  | "sign_in_required"
  | "subscription_required"
  | "owner_suspended"
  | "internal";

export type DispatchError = {
  error: {
    code: DispatchErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  };
};

export const DEVICE_PRESENCE_SUBPROTOCOL = "stella.v1" as const;
export const DEVICE_PRESENCE_PROTOCOL_VERSION = 1 as const;
export const DISPATCH_PAYLOAD_MAX_BYTES = 1024 * 1024;
export const DEVICE_PRESENCE_MAX_FRAME_BYTES = 1536 * 1024;
export const DEVICE_TERMINAL_RESULT_MAX_BYTES = 1_000_000;

export type DeviceAvailability = {
  ready: boolean;
  capabilities: ExecutionCapability[];
};

export type AgentMessageDeviceOutcome =
  | "steered"
  | "queued"
  | "resumed"
  | "not_found"
  | "refused";

export type AgentStopDeviceOutcome =
  | "stopped"
  | "paused"
  | "not_running"
  | "not_found"
  | "refused";

export type DevicePresenceServerFrame =
  | {
      type: "challenge";
      connectionId: string;
      nonce: string;
      pingIntervalMs: number;
      staleAfterMs: number;
    }
  | { type: "connected"; presenceSessionId: string; serverTimeMs: number }
  | {
      type: "offer";
      dispatch: DispatchSummary;
      payloadJson: string;
      payloadHash: string;
      offerExpiresAt: number;
    }
  | { type: "offer.withdrawn"; dispatchId: string; reason: string }
  | {
      type: "claimed";
      dispatchId: string;
      claimExpiresAt: number;
      replayed: boolean;
    }
  | {
      type: "cancel";
      dispatchId: string;
      cancelRequestId: string;
      reason: string;
    }
  | {
      type: "steer";
      dispatchId: string;
      messageId: string;
      text: string;
    }
  | { type: "dispatch"; dispatch: DispatchSummary }
  | {
      type: "agent-message";
      messageId: string;
      threadId: string;
      ownerGeneration: string;
      text: string;
    }
  | {
      type: "agent-pause";
      commandId: string;
      threadId: string;
      ownerGeneration: string;
    }
  | {
      type: "consent.request";
      requestedAt: number;
      requesterLabel?: string;
    }
  | { type: "pong"; serverTimeMs: number }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | DeviceRequestServerFrame;

export type DevicePresenceDeviceFrame =
  | {
      type: "begin";
      presenceSessionId: string;
      protocolVersion: typeof DEVICE_PRESENCE_PROTOCOL_VERSION;
      availability: DeviceAvailability;
    }
  | {
      type: "proof";
      signature: string;
    }
  | { type: "availability"; availability: DeviceAvailability }
  | { type: "claim"; dispatchId: string; claimRequestId: string }
  | { type: "release"; dispatchId: string; reason?: string }
  | { type: "ack"; dispatchId: string }
  | {
      type: "steer.ack";
      dispatchId: string;
      messageId: string;
      delivered: boolean;
    }
  | {
      type: "agent-message.ack";
      messageId: string;
      threadId: string;
      outcome: AgentMessageDeviceOutcome;
    }
  | {
      type: "agent-pause.ack";
      commandId: string;
      threadId: string;
      outcome: AgentStopDeviceOutcome;
    }
  | {
      type: "consent";
      allow: boolean;
    }
  | { type: "running"; dispatchId: string }
  | { type: "renew"; dispatchId: string }
  | {
      type: "complete";
      dispatchId: string;
      outcome: "completed" | "failed" | "canceled";
      resultJson?: string;
      errorCode?: string;
      errorMessage?: string;
    }
  | { type: "ping" }
  | DeviceRequestDeviceFrame;

export const DEVICE_PRESENCE_PROOF_PREFIX = "stella-device-presence" as const;

export const DEVICE_PRESENCE_CLOSE = {
  replaced: 4001,
  stale: 4002,
  proofRejected: 4403,
  unauthorized: 4401,
  protocol: 4000,
  internal: 4500,
} as const;
