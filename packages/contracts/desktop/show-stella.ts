import type { ShowCaptureAttachment } from "../index.js";

export type ShowStellaUnavailableReason =
  | "platform"
  | "missing-helper"
  | "busy";

export type ShowStellaStatus =
  | { available: true; recording: boolean; shortcut: string; inkAvailable: boolean }
  | { available: false; reason: ShowStellaUnavailableReason; shortcut: string };

export type ShowStellaRect = { x: number; y: number; width: number; height: number };

export type ShowStellaRecorderStart = {
  captureId: string;
  sourceId: string;
  startedAtMs: number;
  display: { width: number; height: number; scaleFactor: number };
  frameEdge: number;
  frameIntervalMs: number;
  microphone: boolean;
};

export type ShowStellaOverlayState =
  | { phase: "idle" }
  | {
      phase: "recording";
      captureId: string;
      startedAtMs: number;
      display: ShowStellaRect;
      inkAvailable: boolean;
      shortcut: string;
      recorder: ShowStellaRecorderStart;
      /**
       * macOS: Electron windows activate Stella on any click, so native panels take
       * the bar's and finish card's clicks.
       */
      nativeControls: boolean;
    }
  | { phase: "finishing"; captureId: string }
  | ShowStellaReviewState;

export type ShowStellaReviewState = {
  phase: "review";
  captureId: string;
  durationMs: number;
  display: ShowStellaRect;
  status: "preparing" | "ready" | "failed";
  preview?: string;
  previewWidth?: number;
  previewHeight?: number;
};

export type ShowStellaCardStrings = {
  title: string;
  preparing: string;
  failed: string;
  note: string;
  send: string;
  open: string;
  discard: string;
};

export type ShowStellaOverlayInfo = {
  captureId: string;
  done: ShowStellaRect | null;
  strings: ShowStellaCardStrings;
};

export type ShowStellaReviewAction =
  | { captureId: string; action: "send"; note: string }
  | { captureId: string; action: "open" | "discard" | "keep" };

export type ShowStellaInk =
  | { kind: "stroke"; id: number; points: Array<[number, number]>; done: boolean }
  | { kind: "pin"; id: number; number: number; x: number; y: number }
  | { kind: "click"; x: number; y: number }
  | { kind: "undo"; id: number }
  | { kind: "catch"; on: boolean }
  | { kind: "clear" };

export type ShowStellaRecorderResult = {
  captureId: string;
  wav: ArrayBuffer | null;
  videoMimeType: string | null;
  error?: string;
};

export type ShowStellaWord = { text: string; t0: number; t1: number };

export type ShowStellaTranscript = {
  source: string;
  text: string;
  segments: Array<{ t0: number; t1: number; text: string }>;
  words: Array<{ t0: number; t1: number; text: string }>;
  estimated?: boolean;
  missing?: { reason: string; retry?: boolean };
};

export type ShowStellaRecorded = {
  captureId: string;
  durationMs: number;
  hasAudio: boolean;
};

export type ShowStellaBuildResult =
  | { ok: true; captureId: string }
  | { ok: false; captureId: string; error: string };

export type ShowStellaSendRequest = {
  requestId: string;
  capture: ShowCaptureAttachment;
  note: string;
};
