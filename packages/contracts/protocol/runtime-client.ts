import type { RuntimeInitializeParams } from "./index.js";

export const STELLA_RUNTIME_CLIENT_PROTOCOL_VERSION = "client-v1";

export const RUNTIME_CLIENT_METHODS = {
  ATTACH: "runtime.attach",
  CALL: "runtime.call",
  SHUTDOWN: "runtime.shutdown",
  /**
   * The app is relaunching and comes back to this runtime: its work carries on meanwhile. A runtime from before this
   * method answers "method not found", and the app relaunches as before.
   */
  RELAUNCHING: "runtime.relaunching",
  HOST_HANDLER: "runtime.hostHandler",
  EVENT: "runtime.event",
} as const;

export type RuntimeClientAttachParams = {
  initializeParams: Omit<RuntimeInitializeParams, "protocolVersion">;
  disableLocalScheduler?: boolean;
};

