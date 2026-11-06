import { AutomaticExecutionRequestError } from "./execution-placement";
import { HttpRequestError } from "./http";
import type { ChatMessage } from "../types";

import type { NotSentReason as SharedNotSentReason } from "@stella/contracts/send-state";

export type NotSentReason = Exclude<SharedNotSentReason, "turn_failed">;

export type SendState =
  | { kind: "persisting"; behind: boolean }
  | { kind: "queued" }
  | { kind: "admitting" }
  | { kind: "dispatched"; serverDispatchId: string; cancelRequestId?: string }
  | { kind: "cancelling"; cancelRequestId: string }
  | { kind: "settled"; stopped: boolean }
  | { kind: "not_sent"; reason: NotSentReason };

export type SendEvent =
  | { type: "persisted" }
  | { type: "admit" }
  | { type: "admitted"; serverDispatchId: string }
  | { type: "stop"; cancelRequestId: string; submitAttempted: boolean }
  | { type: "cancel_confirmed" }
  | { type: "settled" }
  | { type: "failed"; reason: NotSentReason }
  | { type: "retry" };

/** The next state, or null when the event does not apply to `state`. */
export const nextSendState = (
  state: SendState,
  event: SendEvent,
): SendState | null => {
  switch (event.type) {
    case "persisted":
      return state.kind === "persisting" ? { kind: "queued" } : null;
    case "admit":
      return state.kind === "queued" ? { kind: "admitting" } : null;
    case "admitted":
      return state.kind === "admitting"
        ? { kind: "dispatched", serverDispatchId: event.serverDispatchId }
        : null;
    case "stop":
      switch (state.kind) {
        case "persisting":
        case "queued":
          return { kind: "settled", stopped: true };
        case "admitting":
          return event.submitAttempted
            ? { kind: "cancelling", cancelRequestId: event.cancelRequestId }
            : { kind: "settled", stopped: true };
        case "dispatched":
          return state.cancelRequestId
            ? null
            : { ...state, cancelRequestId: event.cancelRequestId };
        default:
          return null;
      }
    case "cancel_confirmed":
      return state.kind === "cancelling"
        ? { kind: "settled", stopped: true }
        : null;
    case "settled":
      return state.kind === "admitting" || state.kind === "dispatched"
        ? { kind: "settled", stopped: false }
        : null;
    case "failed":
      return state.kind === "persisting" ||
        state.kind === "queued" ||
        state.kind === "admitting"
        ? { kind: "not_sent", reason: event.reason }
        : null;
    case "retry":
      return state.kind === "not_sent"
        ? { kind: "persisting", behind: true }
        : null;
  }
};

/** Holds the thread's single dispatch slot: one turn is admitted at a time. */
export const occupiesSendSlot = (state: SendState): boolean =>
  state.kind === "admitting" || state.kind === "dispatched";

export const keepsThreadSending = (state: SendState): boolean =>
  occupiesSendSlot(state) || (state.kind === "persisting" && !state.behind);

export const messageSendStatus = (
  state: SendState | undefined,
): ChatMessage["send"] => {
  switch (state?.kind) {
    case "persisting":
      return state.behind ? "queued" : undefined;
    case "queued":
      return "queued";
    case "cancelling":
      return "stopped";
    case "settled":
      return state.stopped ? "stopped" : undefined;
    case "not_sent":
      return "not_sent";
    default:
      return undefined;
  }
};

const PERMANENT_ERROR_CODES = new Set([
  "sign_in_required",
  "subscription_required",
  "usage_limit",
  "owner_suspended",
  "generation_stale",
  "conflict",
  "not_found",
]);

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429]);

/** A send error that retrying the same request cannot fix. */
export const isPermanentSendError = (error: unknown): boolean => {
  if (error instanceof AutomaticExecutionRequestError) return true;
  if (error instanceof HttpRequestError) {
    if (error.code && PERMANENT_ERROR_CODES.has(error.code)) return true;
    return (
      error.status >= 400 &&
      error.status < 500 &&
      !TRANSIENT_HTTP_STATUSES.has(error.status)
    );
  }
  const code =
    error && typeof error === "object" ? Reflect.get(error, "code") : null;
  return typeof code === "string" && PERMANENT_ERROR_CODES.has(code);
};
