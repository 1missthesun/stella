import { sha256Hex } from "./pairing-proof.js";

export const DEVICE_REQUEST_METHODS = [
  "file.read",
  "file.stat",
  "file.list",
  "officePreview.render",
  "voice.config",
  "voice.executeTool",
  "mcp.listTools",
  "mcp.callTool",
  "claude.login.start",
  "claude.login.finish",
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
  paramsBytes: 32 * 1024,
  responseBytes: 32 * 1024 * 1024,
  chunkBytes: 32 * 1024,
  concurrentPerDevice: 4,
} as const;

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

export const DEVICE_REQUEST_IDLE_TIMEOUT_MS = 30_000;

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

export const DEVICE_MCP_REQUEST_METHODS = [
  "mcp.listTools",
  "mcp.callTool",
] as const satisfies readonly DeviceRequestMethod[];

export const isDeviceMcpRequestMethod = (
  value: unknown,
): value is (typeof DEVICE_MCP_REQUEST_METHODS)[number] =>
  typeof value === "string" &&
  (DEVICE_MCP_REQUEST_METHODS as readonly string[]).includes(value);

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

export const DEVICE_REQUEST_CLOUD_ASKER = "cloud";

export type DeviceRequestBody = {
  requestId: string;
  method: DeviceRequestMethod;
  params: Record<string, unknown>;
};

export const DEVICE_REQUEST_CHALLENGE_VERSION = "device-request-v1" as const;

export const buildDeviceRequestChallenge = (input: {
  requestId: string;
  method: DeviceRequestMethod;
  paramsHash: string;
  targetDeviceId?: string;
}): string =>
  [
    DEVICE_REQUEST_CHALLENGE_VERSION,
    input.requestId,
    input.method,
    input.paramsHash,
    ...(input.targetDeviceId ? [input.targetDeviceId] : []),
  ].join(":");

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

export const deviceRequesterLabel = (deviceId: string): string =>
  `device:${deviceId}`;

export const deviceRequestParamsHash = (paramsJson: string): Promise<string> =>
  sha256Hex(paramsJson);

export type DeviceRequestErrorCode =
  | "device_offline"
  | "device_busy"
  | "timeout"
  | "forbidden"
  | "not_found"
  | "too_large"
  | "bad_request"
  | "unauthorized"
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

export type DeviceRequestServerFrame =
  | {
      type: "request";
      requestId: string;
      method: DeviceRequestMethod;
      paramsJson: string;
      mobileDeviceId: string;
    }
  | { type: "request.cancel"; requestId: string };

export type DeviceRequestDeviceFrame =
  | {
      type: "response.start";
      requestId: string;
      contentType: string;
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
