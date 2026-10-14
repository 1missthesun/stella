import type {
  CloudBrowserEncryptedSessionTransfer,
  CloudBrowserInteractionDecision,
  CloudBrowserInteractionDetail,
  CloudBrowserInteractionSummary,
  CloudBrowserLiveViewCapability,
  CloudBrowserSessionTransferCapability,
} from "../cloud-browser.js";

export type BrowserCalls = {
  "browser.detail": {
    args: { interactionId: string };
    result: CloudBrowserInteractionDetail | null;
  };
  "browser.liveView": {
    args: { interactionId: string; expectedRevision: number };
    result: CloudBrowserLiveViewCapability;
  };
  "browser.sessionTransferKey": {
    args: { interactionId: string; expectedRevision: number };
    result: CloudBrowserSessionTransferCapability;
  };
  "browser.importSessionTransfer": {
    args: {
      interactionId: string;
      expectedRevision: number;
      transfer: CloudBrowserEncryptedSessionTransfer;
    };
    result: { schemaVersion: 1; interactionId: string; revision: number; verified: true };
  };
  "browser.decide": {
    args: {
      interactionId: string;
      expectedRevision: number;
      requestId: string;
      decision: CloudBrowserInteractionDecision;
    };
    result: CloudBrowserInteractionSummary;
  };
  "browser.resetProfile": {
    args: { requestId: string };
    result: { schemaVersion: 1; profileId: "default"; profileEpoch: number; reset: true };
  };
};

export type BrowserViews = {
  "browser.pending": {
    args: Record<string, never>;
    result: CloudBrowserInteractionSummary[];
  };
};
