/**
 * Show Stella: a screen recording with the user's voice, clicks and ink that
 * becomes a capture tasks can read (numbered moments, a contact sheet, and
 * what was said at each moment).
 */

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
    }
  | { phase: "finishing"; captureId: string };

/** Live ink for the overlay, in overlay coordinates. */
export type ShowStellaInk =
  | { kind: "stroke"; id: number; points: Array<[number, number]>; done: boolean }
  | { kind: "pin"; id: number; number: number; x: number; y: number }
  | { kind: "click"; x: number; y: number }
  | { kind: "undo"; id: number }
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
