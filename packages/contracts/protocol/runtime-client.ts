import type { RuntimeInitializeParams } from "./index.js";

export const STELLA_RUNTIME_CLIENT_PROTOCOL_VERSION = "client-v1";

export const RUNTIME_CLIENT_METHODS = {
  ATTACH: "runtime.attach",
  CALL: "runtime.call",
  SHUTDOWN: "runtime.shutdown",
  HOST_HANDLER: "runtime.hostHandler",
  EVENT: "runtime.event",
} as const;

export type RuntimeClientAttachParams = {
  initializeParams: Omit<RuntimeInitializeParams, "protocolVersion">;
  disableLocalScheduler?: boolean;
};

