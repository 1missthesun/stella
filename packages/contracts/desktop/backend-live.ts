import type { BackendError } from "../backend/protocol.js";

export type BackendLiveWatchRequest = {
  /** The renderer document, so a reload's subscriptions replace the old page's. */
  documentId: string;
  subscriptionId: string;
  baseUrl: string;
  view: string;
  args: unknown;
};

export type BackendLiveUnwatchRequest = {
  documentId: string;
  subscriptionId: string;
};

export type BackendLiveEvent = {
  documentId: string;
  subscriptionId: string;
} & (
  | { kind: "value"; value: unknown }
  | { kind: "error"; error: BackendError }
);
