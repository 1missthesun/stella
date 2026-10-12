/**
 * Provider-neutral execution placement protocol.
 *
 * `subject` describes what the work is about. `target` is the independent,
 * user-facing executor choice. Keeping those two concepts separate prevents a
 * portable prompt from silently changing meaning when it is sent elsewhere.
 */

export type ExecutionTarget =
  | { mode: "automatic" }
  | { mode: "cloud" }
  | { mode: "device"; deviceId: string };

