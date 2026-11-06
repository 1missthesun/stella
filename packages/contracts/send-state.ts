export type NotSentReason =
  | "storage"
  | "network"
  | "rejected"
  | "attachment"
  | "turn_failed";

export type SendState =
  | { kind: "composing" }
  | { kind: "persisting" }
  | { kind: "queued"; cancelRequested: boolean }
  | { kind: "admitting"; cancelRequested: boolean }
  | { kind: "dispatched"; cancelRequested: boolean }
  | { kind: "settled" }
  | { kind: "not_sent"; reason: NotSentReason; message: string };

export type SendEvent =
  | { type: "persisted" }
  | { type: "claimed" }
  | { type: "released" }
  | { type: "dispatched" }
  | { type: "cancel_requested" }
  | { type: "settled" }
  | { type: "failed"; reason: NotSentReason; message: string }
  | { type: "retry" };

export const transitionSend = (state: SendState, event: SendEvent): SendState | null => {
  switch (event.type) {
    case "persisted":
      return state.kind === "composing" || state.kind === "persisting"
        ? { kind: "queued", cancelRequested: false }
        : null;
    case "claimed":
      return state.kind === "queued"
        ? { kind: "admitting", cancelRequested: state.cancelRequested }
        : null;
    case "released":
      return state.kind === "admitting"
        ? { kind: "queued", cancelRequested: state.cancelRequested }
        : null;
    case "dispatched":
      return state.kind === "admitting" || state.kind === "queued"
        ? { kind: "dispatched", cancelRequested: state.cancelRequested }
        : null;
    case "cancel_requested":
      return state.kind === "queued" || state.kind === "admitting" || state.kind === "dispatched"
        ? { ...state, cancelRequested: true }
        : null;
    case "settled":
      return state.kind === "settled" || state.kind === "not_sent" ? null : { kind: "settled" };
    case "failed":
      return { kind: "not_sent", reason: event.reason, message: event.message };
    case "retry":
      return state.kind === "not_sent" ? { kind: "persisting" } : null;
  }
};

export const sendStateInFlight = (state: SendState): boolean =>
  state.kind === "persisting" ||
  state.kind === "queued" ||
  state.kind === "admitting" ||
  state.kind === "dispatched" ||
  state.kind === "settled";
