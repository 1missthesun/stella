export const CLOUD_CODE_CONNECT_PATH = "/api/cloud/code/connect";

export const CLOUD_CODE_CONNECT_METHODS = [
  "discover",
  "connectors",
  "addMcp",
  "remove",
  "tools",
  "callTool",
] as const;

export type CloudCodeConnectMethod = (typeof CLOUD_CODE_CONNECT_METHODS)[number];

export type CloudCodeConnectRequest = {
  turnId: string;
  method: CloudCodeConnectMethod;
  args: unknown[];
};

export type CloudCodeConnectResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: string };
