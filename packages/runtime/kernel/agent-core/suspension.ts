import {
  isCloudBrowserSuspension,
  type CloudBrowserSuspension,
} from "@stella/contracts/cloud-browser";

export class AgentToolSuspendedError extends Error {
  readonly suspension: CloudBrowserSuspension;

  constructor(suspension: CloudBrowserSuspension) {
    if (!isCloudBrowserSuspension(suspension)) {
      throw new TypeError("Agent tool suspension descriptor is invalid.");
    }
    super("Agent tool execution is waiting for the user.");
    this.name = "AgentToolSuspendedError";
    this.suspension = Object.freeze({ ...suspension });
  }
}

export const isAgentToolSuspendedError = (
  value: unknown,
): value is AgentToolSuspendedError =>
  value instanceof AgentToolSuspendedError ||
  (typeof value === "object" &&
    value !== null &&
    (value as { name?: unknown }).name === "AgentToolSuspendedError" &&
    isCloudBrowserSuspension((value as { suspension?: unknown }).suspension));
