/**
 * Requests a paired phone makes of one of the owner's computers, relayed by
 * the cloud over that computer's presence socket.
 *
 *   phone --HTTP--> worker --> owner gate --presence socket--> computer
 *   phone <-stream-- worker <-- owner gate <--response frames-- computer
 *
 * The owner gate never stores what passes through: the computer's response
 * frames are written straight into the phone's open HTTP response.
 *
 * Authority: the phone's user JWT names the owner, and a pairing proof (the
 * same HMAC scheme as a placement submit, see `pairing-proof.ts`) binds the
 * request to one paired (phone, computer) pair. The challenge commits to the
 * request id, method and params, so a proof cannot be replayed for another
 * file. The computer applies its own file-access policy on top.
 */

import { sha256Hex } from "./pairing-proof.js";

export const DEVICE_REQUEST_METHODS = [
  /**
   * `{ filePath, conversationId, variant? }` -> the file's bytes, typed by
   * extension. `variant: "thumbnail"` asks for a small JPEG of an image
   * instead; a computer that cannot make one sends the file itself.
   */
  "file.read",
  /** `{ filePath, conversationId }` -> JSON `DeviceFileStat`. */
  "file.stat",
  /** `{ filePath, conversationId }` -> JSON `DeviceFolderListing`. */
  "file.list",
  /** `{ filePath, conversationId }` or `{ sessionId, conversationId }` -> HTML. */
  "officePreview.render",
  /** `{ conversationId }` -> the computer's voice instructions and tools. */
  "voice.config",
  /** A realtime voice tool call -> its result. */
  "voice.executeTool",
  /**
   * `{ id }` -> JSON `{ tools }`: the tools of an MCP server this computer
   * runs or holds the credential for. Only the cloud asks this.
   */
  "mcp.listTools",
  /** `{ id, tool, args }` -> JSON `{ result }`. Only the cloud asks this. */
  "mcp.callTool",
  /**
   * `{ email? }` -> JSON `{ loginId, authorizeUrl }`: start this computer's
   * own `claude auth login` for a sign-in finished on another device. Only
   * the cloud asks this (`engines.startClaudeDeviceLogin`).
   */
  "claude.login.start",
  /** `{ loginId, code }` -> JSON `{ email? }`. Only the cloud asks this. */
  "claude.login.finish",
  /** `{ loginId }` -> JSON `null`. Only the cloud asks this. */
  "claude.login.cancel",
] as const;

export type DeviceRequestMethod = (typeof DEVICE_REQUEST_METHODS)[number];

export const isDeviceRequestMethod = (
  value: unknown,
): value is DeviceRequestMethod =>
  typeof value === "string" &&
  (DEVICE_REQUEST_METHODS as readonly string[]).includes(value);

export const deviceRequestPath = (deviceId: string): string =>
  `/owners/me/devices/${encodeURIComponent(deviceId)}/requests`;

export const DEVICE_REQUEST_LIMITS = {
  requestId: 128,
  /** The JSON params a phone may send. */
  paramsBytes: 32 * 1024,
  /** The most bytes one response may carry through the cloud. */
  responseBytes: 32 * 1024 * 1024,
  /** Raw bytes per presence frame; base64 keeps the frame under 64 KiB. */
  chunkBytes: 32 * 1024,
  /** Requests one computer serves at once. */
  concurrentPerDevice: 4,
} as const;

/** How long the gate waits for the computer to start answering. */
export const deviceRequestStartTimeoutMs = (
  method: DeviceRequestMethod,
): number =>
  method === "voice.executeTool" ||
  method === "mcp.callTool" ||
  method === "mcp.listTools" ||
  method === "claude.login.finish"
    ? 120_000
    : method === "claude.login.start"
      ? 60_000
    : method === "officePreview.render"
      ? 45_000
      : 30_000;

/** How long the gate waits between response chunks once one has started. */
export const DEVICE_REQUEST_IDLE_TIMEOUT_MS = 30_000;

/**
 * Read-only file requests. Any phone paired with one of the owner's
 * computers, and any of the owner's computers, may ask any of the owner's
 * computers for these: a linked file lives on whichever computer made it,
 * not necessarily the one the phone was paired with. The computer that has
 * the file still applies its own file-access policy.
 */
export const DEVICE_FILE_REQUEST_METHODS = [
  "file.read",
  "file.stat",
  "file.list",
  "officePreview.render",
] as const satisfies readonly DeviceRequestMethod[];

export const isDeviceFileRequestMethod = (
  value: unknown,
): value is (typeof DEVICE_FILE_REQUEST_METHODS)[number] =>
  typeof value === "string" &&
  (DEVICE_FILE_REQUEST_METHODS as readonly string[]).includes(value);

/**
 * MCP requests the cloud relays to the computer that runs a server (or
 * holds its credential), for an agent anywhere on the account. They never
 * come from a phone's own request.
 */
export const DEVICE_MCP_REQUEST_METHODS = [
  "mcp.listTools",
  "mcp.callTool",
] as const satisfies readonly DeviceRequestMethod[];

export const isDeviceMcpRequestMethod = (
  value: unknown,
): value is (typeof DEVICE_MCP_REQUEST_METHODS)[number] =>
  typeof value === "string" &&
  (DEVICE_MCP_REQUEST_METHODS as readonly string[]).includes(value);

/** Claude Code sign-ins the cloud relays to a computer for another device. */
export const DEVICE_CLAUDE_LOGIN_REQUEST_METHODS = [
  "claude.login.start",
  "claude.login.finish",
  "claude.login.cancel",
] as const satisfies readonly DeviceRequestMethod[];

export const isDeviceClaudeLoginRequestMethod = (
  value: unknown,
): value is (typeof DEVICE_CLAUDE_LOGIN_REQUEST_METHODS)[number] =>
  typeof value === "string" &&
  (DEVICE_CLAUDE_LOGIN_REQUEST_METHODS as readonly string[]).includes(value);

/** What a relayed MCP request names as its asker. */
export const DEVICE_REQUEST_CLOUD_ASKER = "cloud";

export type DeviceRequestBody = {
  requestId: string;
  method: DeviceRequestMethod;
  params: Record<string, unknown>;
};

export const DEVICE_REQUEST_CHALLENGE_VERSION = "device-request-v1" as const;

/** The pairing-proof challenge for one device request. */
export const buildDeviceRequestChallenge = (input: {
  requestId: string;
  method: DeviceRequestMethod;
  /** Lowercase hex sha256 of the exact params JSON sent. */
  paramsHash: string;
  /**
   * The computer asked, when it is not the one the proof is scoped to (a
   * phone reading a file another of the owner's computers has). Committing
   * to it keeps a proof from being replayed against a third computer.
   */
  targetDeviceId?: string;
}): string =>
  [
    DEVICE_REQUEST_CHALLENGE_VERSION,
    input.requestId,
    input.method,
    input.paramsHash,
    ...(input.targetDeviceId ? [input.targetDeviceId] : []),
  ].join(":");

/**
 * One of the owner's computers asking another for a file: signed with the
 * asking computer's registered Ed25519 device key, the same key its
 * presence socket proves.
 */
export const DEVICE_REQUEST_DEVICE_PROOF_VERSION =
  "stella-device-request-proof-v1" as const;

export const DEVICE_REQUEST_DEVICE_HEADERS = {
  deviceId: "x-stella-requester-device-id",
  signature: "x-stella-requester-proof",
  issuedAt: "x-stella-requester-proof-issued-at",
} as const;

export const DEVICE_REQUEST_DEVICE_PROOF_MAX_SKEW_MS = 5 * 60_000;

export const buildDeviceRequestDeviceProofMessage = (input: {
  requesterDeviceId: string;
  targetDeviceId: string;
  challenge: string;
  issuedAt: number;
}): string =>
  [
    DEVICE_REQUEST_DEVICE_PROOF_VERSION,
    input.requesterDeviceId,
    input.targetDeviceId,
    input.challenge,
    String(input.issuedAt),
  ].join("\0");

/** What a relayed request names as its asker when a computer asked. */
export const deviceRequesterLabel = (deviceId: string): string =>
  `device:${deviceId}`;

export const deviceRequestParamsHash = (paramsJson: string): Promise<string> =>
  sha256Hex(paramsJson);

/**
 * Error codes a device request can end with. The HTTP status carries the
 * class; the code lets the phone say exactly what happened.
 */
export type DeviceRequestErrorCode =
  /** The computer has no live presence socket. HTTP 503. */
  | "device_offline"
  /** The computer is already serving its share of requests. HTTP 429. */
  | "device_busy"
  /** The computer did not answer in time. HTTP 504. */
  | "timeout"
  /** The computer's policy refused the request. HTTP 403. */
  | "forbidden"
  /** The file is gone. HTTP 404. */
  | "not_found"
  /** The response would exceed `DEVICE_REQUEST_LIMITS.responseBytes`. HTTP 413. */
  | "too_large"
  | "bad_request"
  | "unauthorized"
  /** The computer tried and failed. HTTP 502. */
  | "failed";

export const DEVICE_REQUEST_ERROR_STATUS: Readonly<
  Record<DeviceRequestErrorCode, number>
> = {
  device_offline: 503,
  device_busy: 429,
  timeout: 504,
  forbidden: 403,
  not_found: 404,
  too_large: 413,
  bad_request: 400,
  unauthorized: 401,
  failed: 502,
};

/** Server -> computer, on the presence socket. */
export type DeviceRequestServerFrame =
  | {
      type: "request";
      requestId: string;
      method: DeviceRequestMethod;
      paramsJson: string;
      /** Which paired phone asked, for the computer's logs. */
      mobileDeviceId: string;
    }
  /** The phone went away or the gate gave up; stop sending. */
  | { type: "request.cancel"; requestId: string };

/** Computer -> server, on the presence socket. */
export type DeviceRequestDeviceFrame =
  | {
      type: "response.start";
      requestId: string;
      contentType: string;
      /** Total bytes the body will carry, when known. */
      sizeBytes?: number;
    }
  | { type: "response.chunk"; requestId: string; data: string }
  | { type: "response.end"; requestId: string }
  | {
      type: "response.error";
      requestId: string;
      code: DeviceRequestErrorCode;
      message: string;
    };
