/**
 * Show Stella: a screen recording with the user's voice, clicks and ink that
 * becomes a capture tasks can read (numbered moments, a contact sheet, and
 * what was said at each moment).
 */

import type { ShowCaptureAttachment } from "../index.js";

export type ShowStellaUnavailableReason =
  | "platform"
  | "missing-helper"
  | "busy";

export type ShowStellaStatus =
  | { available: true; recording: boolean; shortcut: string; inkAvailable: boolean }
  | { available: false; reason: ShowStellaUnavailableReason; shortcut: string };

/** A rectangle in the overlay window's own coordinates (CSS pixels). */
export type ShowStellaRect = { x: number; y: number; width: number; height: number };

export type ShowStellaRecorderStart = {
  captureId: string;
  /** desktopCapturer source of the recorded display. */
  sourceId: string;
  /** Epoch ms of the capture's clock zero, in the main process. */
  startedAtMs: number;
  /** The recorded display, so frames come out at its size. */
  display: { width: number; height: number; scaleFactor: number };
  /** Longest edge of the frame stream. */
  frameEdge: number;
  frameIntervalMs: number;
  /** Record the microphone (for the transcript and the video's sound). */
  microphone: boolean;
};

export type ShowStellaOverlayState =
  | { phase: "idle" }
  | {
      phase: "recording";
      captureId: string;
      startedAtMs: number;
      /** The recorded display inside the overlay window. */
      display: ShowStellaRect;
      inkAvailable: boolean;
      shortcut: string;
      recorder: ShowStellaRecorderStart;
      /**
       * macOS: clicks on the bar and the finish card are taken by native
       * panels (Electron windows activate Stella on any click), so the bar
       * only draws and reports where its Done button is.
       */
      nativeControls: boolean;
    }
  | { phase: "finishing"; captureId: string }
  | ShowStellaReviewState;

/**
 * A capture that ended while another app was in front: a small card near
 * where the bar was, so Stella stays in the background.
 */
export type ShowStellaReviewState = {
  phase: "review";
  captureId: string;
  durationMs: number;
  /** The recorded display inside the overlay window. */
  display: ShowStellaRect;
  status: "preparing" | "ready" | "failed";
  /** Contact sheet thumbnail (data URL) once it's ready. */
  preview?: string;
  previewWidth?: number;
  previewHeight?: number;
};

/** The finish card's words, in the user's language, for the native card. */
export type ShowStellaCardStrings = {
  /** Contains "{duration}". */
  title: string;
  preparing: string;
  failed: string;
  note: string;
  send: string;
  open: string;
  discard: string;
};

/** What the overlay tells the main process for the native controls. */
export type ShowStellaOverlayInfo = {
  captureId: string;
  /** The Done button, in screen points. */
  done: ShowStellaRect | null;
  strings: ShowStellaCardStrings;
};

export type ShowStellaReviewAction =
  | { captureId: string; action: "send"; note: string }
  | { captureId: string; action: "open" | "discard" | "keep" };

/** Live ink for the overlay, in overlay coordinates. */
export type ShowStellaInk =
  | { kind: "stroke"; id: number; points: Array<[number, number]>; done: boolean }
  | { kind: "pin"; id: number; number: number; x: number; y: number }
  | { kind: "click"; x: number; y: number }
  | { kind: "undo"; id: number }
  /** ⇧ is held: the overlay takes the mouse so pins and ink don't reach the app below. */
  | { kind: "catch"; on: boolean }
  | { kind: "clear" };

export type ShowStellaRecorderResult = {
  captureId: string;
  /** 16 kHz mono PCM WAV of the microphone, when it was recorded. */
  wav: ArrayBuffer | null;
  /** The recording's container, e.g. "video/mp4". */
  videoMimeType: string | null;
  error?: string;
};

/** A word with its start and end (ms) on the capture's clock. */
export type ShowStellaWord = { text: string; t0: number; t1: number };

export type ShowStellaTranscript = {
  /** The dictation engine: "on-device", "managed", "openrouter", or "none". */
  source: string;
  text: string;
  segments: Array<{ t0: number; t1: number; text: string }>;
  words: Array<{ t0: number; t1: number; text: string }>;
  /** Word times were spread over each stretch of speech, not measured. */
  estimated?: boolean;
  missing?: { reason: string; retry?: boolean };
};

/** Sent to the main window when a recording has stopped and needs its words. */
export type ShowStellaRecorded = {
  captureId: string;
  durationMs: number;
  hasAudio: boolean;
};

export type ShowStellaBuildResult =
  | { ok: true; captureId: string }
  | { ok: false; captureId: string; error: string };

/** Asks the main window to send a capture, with a note, as a message. */
export type ShowStellaSendRequest = {
  requestId: string;
  capture: ShowCaptureAttachment;
  note: string;
};
