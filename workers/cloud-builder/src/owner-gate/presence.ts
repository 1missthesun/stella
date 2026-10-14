import {
  DEVICE_PRESENCE_PROOF_PREFIX,
  type DeviceAvailability,
  type DeviceDestination,
  knownExecutionCapabilities,
  type ExecutionCapability,
} from "@stella/contracts/turn-plane/placement";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import type { DevicePresenceState } from "../dispatch-policy.js";
import { isRecord } from "./support.js";

/**
 * Everything a presence socket needs to be understood after a hibernation
 * eviction. There is deliberately no in-memory socket map: `getWebSockets()`
 * plus `deserializeAttachment()` is the only thing that survives eviction.
 */
export type PresenceAttachment = {
  v: 1;
  deviceId: string;
  authExpiresAtMs: number;
  connectionId: string;
  nonce: string;
  presenceSessionId?: string;
  availability?: DeviceAvailability;
  phase: "challenged" | "begun" | "connected";
  lastSeenAtMs: number;
  closedAtMs?: number;
};

export const presenceTag = (deviceId: string): string => `device:${deviceId}`;

export const devicePresenceProofMessage = (args: {
  connectionId: string;
  nonce: string;
}): string =>
  `${DEVICE_PRESENCE_PROOF_PREFIX}\0${args.connectionId}\0${args.nonce}`;

const decodeBase64 = (value: string): Uint8Array | null => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const exactBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

export const verifyDevicePresenceProof = async (args: {
  publicKey: string;
  message: string;
  signature: string;
}): Promise<boolean> => {
  const publicKeyBytes = decodeBase64(args.publicKey);
  const signatureBytes = decodeBase64(args.signature);
  if (
    !publicKeyBytes ||
    !signatureBytes ||
    publicKeyBytes.byteLength > 256 ||
    signatureBytes.byteLength !== 64
  ) {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      exactBuffer(publicKeyBytes),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      exactBuffer(signatureBytes),
      new TextEncoder().encode(args.message),
    );
  } catch {
    return false;
  }
};

export const withReleasedClientSelectability = (
  availability: DeviceAvailability,
) => {
  const selectable = availability.ready ? 1 : 0;
  return { ...availability, chatSlots: selectable, agentSlots: selectable };
};

export const parseAvailability = (
  value: unknown,
): DeviceAvailability | null => {
  if (!isRecord(value)) return null;
  if (typeof value.ready !== "boolean") return null;
  if (!Array.isArray(value.capabilities) || value.capabilities.length > 16) {
    return null;
  }
  return {
    ready: value.ready,
    capabilities: knownExecutionCapabilities(value.capabilities),
  };
};

export type PresenceRow = {
  device_id: string;
  presence_session_id: string;
  connection_id: string;
  connected: number;
  ready: number;
  capabilities: string;
  protocol_version: number;
  last_seen_at: number;
};

export const presenceState = (row: PresenceRow): DevicePresenceState => ({
  deviceId: row.device_id,
  presenceSessionId: row.presence_session_id,
  connected: row.connected === 1,
  ready: row.ready === 1,
  capabilities: JSON.parse(row.capabilities) as ExecutionCapability[],
  protocolVersion: row.protocol_version,
  lastSeenAt: row.last_seen_at,
});

export const deviceDestination = (
  device: NonNullable<OwnerSnapshot["devices"]>[number],
  presence: DevicePresenceState | undefined,
  online: boolean,
): DeviceDestination => {
  const remoteExecution = device.remoteExecution;
  return {
    deviceId: device.deviceId,
    ...(device.label ? { label: device.label } : {}),
    remoteExecutionEnabled: remoteExecution === "enabled",
    remoteExecution,
    ...(device.remoteExecutionAskedAt
      ? { remoteExecutionAskedAt: device.remoteExecutionAskedAt }
      : {}),
    ...(device.brainHome ? { brainHome: true as const } : {}),
    online,
    ...(presence
      ? {
          presenceSessionId: presence.presenceSessionId,
          availability: withReleasedClientSelectability({
            ready: online && presence.ready,
            capabilities: presence.capabilities,
          }),
          lastSeenAt: presence.lastSeenAt,
        }
      : {}),
  };
};
