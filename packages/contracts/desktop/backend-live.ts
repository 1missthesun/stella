import type { BackendError } from "../backend/protocol.js";

export type BackendLiveWatchRequest = {
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
