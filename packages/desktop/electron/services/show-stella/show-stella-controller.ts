import { execFile } from "node:child_process";
import { createWriteStream, promises as fs, type WriteStream } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  nativeImage,
  screen,
  type Display,
  type WebContents,
} from "electron";
import type { ShowCaptureAttachment } from "@stella/contracts";
import type {
  ShowStellaCardStrings,
  ShowStellaInk,
  ShowStellaOverlayInfo,
  ShowStellaOverlayState,
  ShowStellaRecorded,
  ShowStellaRecorderResult,
  ShowStellaReviewAction,
  ShowStellaReviewState,
  ShowStellaSendRequest,
  ShowStellaStatus,
  ShowStellaTranscript,
  ShowStellaBuildResult,
} from "@stella/contracts/desktop/show-stella";
import {
  IPC_SHOW_STELLA_RECORDED,
  IPC_SHOW_STELLA_SEND,
} from "@stella/contracts/desktop/ipc-channels";
import { resolveNativeHelperPath } from "../../native-helper-path.js";
import { hasMacPermission, requestMacPermission } from "../../utils/macos-permissions.js";
import { openMacPermissionSettings } from "../../utils/macos-permission-settings.js";
import { applyShortcutRegistration } from "../../ipc/shortcut-registration.js";
import { ShowStellaInput, type CaptureTimeline, type HookEvent } from "./show-stella-input.js";
import { ShowPanel, type PanelEvent } from "./show-panel.js";

const HELPER = "stella_show";
const SHORTCUT = "Alt+Shift+S";
const FALLBACK_SHORTCUT = "Control+Alt+S";
const UNDO_SHORTCUT = "CommandOrControl+Z";
const DISCARD_SHORTCUT = "Escape";
/** A second press this soon after the start is the same press. */
const RESTART_GUARD_MS = 400;
const MAX_DURATION_MS = 10 * 60_000;
const RECORDER_STOP_TIMEOUT_MS = 15_000;
const BUILD_TIMEOUT_MS = 180_000;
const FRAME_EDGE = 1600;
const FRAME_INTERVAL_MS = 200;
const PREVIEW_WIDTH = 720;
const RECORDING_KEEP_MS = 7 * 24 * 60 * 60_000;
const CAPTURE_KEEP_MS = 30 * 24 * 60 * 60_000;
const CAPTURES_DIR = "captures";
const SAID_PREVIEW_CHARS = 140;
/** A finish card nobody answers goes to the composer after this, at the latest. */
const REVIEW_SAFETY_MS = 3 * 60_000;
/** An untouched finish card goes to the composer this long after it's ready. */
const KEEP_AFTER_MS = 20_000;
const CARD_TOP = 14;
/** A send the main window hasn't taken by then goes to the composer instead. */
const SEND_TIMEOUT_MS = 2 * 60_000;

type OverlayApi = {
  startShowStella: (state: ShowStellaOverlayState) => Promise<boolean>;
  sendShowStellaInk: (ink: ShowStellaInk) => void;
  stopShowStellaRecorder: (captureId: string) => void;
  showStellaFinishing: (captureId: string) => void;
  endShowStella: () => void;
  setShowStellaFocusable: (focusable: boolean) => void;
  getOverlayOrigin: () => { x: number; y: number };
  getWebContents: () => WebContents | null;
};

type InputHook = {
  subscribeCapture: (listener: (type: string, event: HookEvent) => void) => boolean;
  unsubscribeCapture: () => void;
};

type CaptureService = {
  upsertShowCapture: (capture: ShowCaptureAttachment, options?: { add?: boolean }) => boolean;
};

export type ShowStellaControllerOptions = {
  getStellaDataDir: () => string | null;
  getOverlay: () => OverlayApi | null;
  getFullWindow: () => BrowserWindow | null;
  /** The main window, made hidden if it was closed: it transcribes and sends captures. */
  ensureFullWindow: () => BrowserWindow | null;
  showFullWindow: () => void;
  input: InputHook;
  captureService: CaptureService;
};

type Recording = {
  id: string;
  dir: string;
  startedAtMs: number;
  display: Display;
  input: ShowStellaInput | null;
  phase: "starting" | "recording" | "stopping";
  discard: boolean;
  recorderStartedAtMs: number | null;
  video: WriteStream | null;
  videoName: string | null;
  writes: Set<Promise<unknown>>;
  stopped: ((result: ShowStellaRecorderResult | null) => void) | null;
  maxTimer: NodeJS.Timeout | null;
  undoRegistered: boolean;
};

type Pending = { id: string; dir: string; durationMs: number; hasAudio: boolean };

/** The finish card shown while another app is in front. */
type Review = {
  id: string;
  dir: string;
  durationMs: number;
  /** The recorded display, in screen points. */
  display: { x: number; y: number; width: number; height: number };
  /** Top of the usable area (below the menu bar), in screen points. */
  top: number;
  capture: ShowCaptureAttachment | null;
  timer: NodeJS.Timeout | null;
  /** The native card: someone is hovering, typing, or has a note. */
  engaged: boolean;
  keepTimer: NodeJS.Timeout | null;
};

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const supportedPlatform = () => process.platform === "darwin" || process.platform === "win32";

const pad = (n: number) => String(n).padStart(2, "0");

const captureId = (now: Date) =>
  `show-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${randomBytes(2).toString("hex")}`;

const dayFolder = (now: Date) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const ID_PATTERN = /^show-\d{8}-\d{6}-[0-9a-f]{4}$/;

const runBuilder = (helper: string, dir: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      helper,
      ["build", dir],
      { timeout: BUILD_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message).trim()));
          return;
        }
        resolve(stdout);
      },
    );
  });

export class ShowStellaController {
  private recording: Recording | null = null;
  private readonly pending = new Map<string, Pending>();
  private activeShortcut = "";
  private lastStartAt = 0;
  private pruned = false;
  private askedForInk = false;
  private reviewing: Review | null = null;
  private panel: ShowPanel | null = null;
  private cardStrings: ShowStellaCardStrings | null = null;
  /** Captures sent from the finish card before they were ready, with their notes. */
  private readonly sendWhenReady = new Map<string, string>();
  private readonly discarded = new Set<string>();
  /** Sends waiting for the main window to take them. */
  private readonly outbox = new Map<
    string,
    { request: ShowStellaSendRequest; timer: NodeJS.Timeout; handedOver: boolean }
  >();

  constructor(private readonly options: ShowStellaControllerOptions) {}

  /**
   * A capture is recording or its finish card is open. Updates wait: a
   * reload would end the overlay's recording or close the card.
   */
  isActive(): boolean {
    return Boolean(this.recording || this.reviewing);
  }

  registerShortcut(): string {
    // Without the builder there is nothing to make a capture with; leave the keys to other apps.
    if (!supportedPlatform() || !resolveNativeHelperPath(HELPER)) return "";
    for (const shortcut of [SHORTCUT, FALLBACK_SHORTCUT]) {
      const result = applyShortcutRegistration({
        label: "Record screen",
        requestedShortcut: shortcut,
        currentShortcut: this.activeShortcut,
        callback: () => void this.toggle(),
        onActiveShortcutChange: (active) => {
          this.activeShortcut = active;
        },
      });
      if (result.ok) break;
      console.warn("[show-stella]", result.error);
    }
    return this.activeShortcut;
  }

  status(): ShowStellaStatus {
    const shortcut = this.activeShortcut;
    if (!supportedPlatform()) return { available: false, reason: "platform", shortcut };
    if (!resolveNativeHelperPath(HELPER)) return { available: false, reason: "missing-helper", shortcut };
    return {
      available: true,
      recording: Boolean(this.recording),
      shortcut,
      inkAvailable: this.inkAvailable(),
    };
  }

  private inkAvailable(): boolean {
    return process.platform === "win32" || hasMacPermission("accessibility", false);
  }

  private root(): string | null {
    const data = this.options.getStellaDataDir();
    return data ? path.join(data, CAPTURES_DIR) : null;
  }

  async toggle(): Promise<boolean> {
    const current = this.recording;
    if (current) {
      if (Date.now() - this.lastStartAt < RESTART_GUARD_MS) return true;
      if (current.phase === "stopping") return true;
      void this.stop(false);
      return true;
    }
    return await this.start();
  }

  private async start(): Promise<boolean> {
    const status = this.status();
    if (!status.available) return false;
    const root = this.root();
    if (!root) return false;
    if (process.platform === "darwin" && !hasMacPermission("screen", false)) {
      const { granted } = await requestMacPermission("screen");
      if (!granted) {
        await openMacPermissionSettings("screen");
        return false;
      }
    }
    if (process.platform === "darwin" && !this.askedForInk && !hasMacPermission("accessibility", false)) {
      // Ink, pins and clicks need Accessibility; the capture still runs without it.
      this.askedForInk = true;
      void requestMacPermission("accessibility");
    }
    const overlay = this.options.getOverlay();
    if (!overlay) return false;
    if (this.reviewing) await this.review({ captureId: this.reviewing.id, action: "keep" });
    const now = new Date();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const sources = await desktopCapturer
      .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
      .catch(() => []);
    const source =
      sources.find((entry) => entry.display_id === String(display.id)) ??
      (sources.length === 1 ? sources[0] : undefined);
    if (!source) {
      console.warn("[show-stella] no capture source for display", display.id);
      return false;
    }
    if (this.recording) return true;

    const id = captureId(now);
    const dir = path.join(root, dayFolder(now), id);
    await fs.mkdir(path.join(dir, "stream"), { recursive: true, mode: 0o700 });
    if (!this.pruned) {
      this.pruned = true;
      void this.prune(root);
    }

    const startedAtMs = Date.now();
    this.lastStartAt = startedAtMs;
    const recording: Recording = {
      id,
      dir,
      startedAtMs,
      display,
      input: null,
      phase: "starting",
      discard: false,
      recorderStartedAtMs: null,
      video: null,
      videoName: null,
      writes: new Set(),
      stopped: null,
      maxTimer: null,
      undoRegistered: false,
    };
    this.recording = recording;

    const inkEnabled = this.inkAvailable();
    const panel = this.nativePanel();
    const input = new ShowStellaInput({
      display: display.bounds,
      now: () => Date.now() - startedAtMs,
      toScreen:
        process.platform === "win32"
          ? (point) => screen.screenToDipPoint(point)
          : (point) => point,
      toOverlay: (point) => {
        const origin = overlay.getOverlayOrigin();
        return { x: point.x - origin.x, y: point.y - origin.y };
      },
      inkEnabled,
      onInk: (ink) => {
        // The native panel catches ⇧-clicks by itself (armed below).
        if (ink.kind === "catch" && panel) return;
        overlay.sendShowStellaInk(ink);
      },
      onInkChanged: (hasInk) => this.setUndo(recording, hasInk),
      isMac: process.platform === "darwin",
    });
    recording.input = this.options.input.subscribeCapture((type, event) => input.handle(type, event))
      ? input
      : null;

    try {
      globalShortcut.register(DISCARD_SHORTCUT, () => void this.stop(true));
    } catch {
      // Esc stays with the app in front; Done and the shortcut still work.
    }

    const bounds = display.bounds;
    const shown = await overlay.startShowStella({
      phase: "recording",
      captureId: id,
      startedAtMs,
      display: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      inkAvailable: Boolean(recording.input) && inkEnabled,
      shortcut: this.activeShortcut,
      nativeControls: Boolean(panel),
      recorder: {
        captureId: id,
        sourceId: source.id,
        startedAtMs,
        display: { width: bounds.width, height: bounds.height, scaleFactor: display.scaleFactor },
        frameEdge: FRAME_EDGE,
        frameIntervalMs: FRAME_INTERVAL_MS,
        microphone: true,
      },
    });
    if (!shown) {
      await this.abandon(recording);
      return false;
    }
    if (panel && recording.input && inkEnabled) panel.arm(display.bounds);
    recording.phase = "recording";
    recording.maxTimer = setTimeout(() => void this.stop(false), MAX_DURATION_MS);
    return true;
  }

  private setUndo(recording: Recording, hasInk: boolean): void {
    if (this.recording !== recording) return;
    if (hasInk && !recording.undoRegistered) {
      try {
        recording.undoRegistered = globalShortcut.register(UNDO_SHORTCUT, () => {
          recording.input?.undo();
        });
      } catch {
        recording.undoRegistered = false;
      }
    } else if (!hasInk && recording.undoRegistered) {
      globalShortcut.unregister(UNDO_SHORTCUT);
      recording.undoRegistered = false;
    }
  }

  private releaseInput(recording: Recording): CaptureTimeline {
    if (recording.maxTimer) clearTimeout(recording.maxTimer);
    recording.maxTimer = null;
    if (recording.undoRegistered) globalShortcut.unregister(UNDO_SHORTCUT);
    recording.undoRegistered = false;
    globalShortcut.unregister(DISCARD_SHORTCUT);
    // The Show Stella shortcut can be lost while Escape was registered over it.
    if (this.activeShortcut && !globalShortcut.isRegistered(this.activeShortcut)) {
      const shortcut = this.activeShortcut;
      this.activeShortcut = "";
      applyShortcutRegistration({
        label: "Record screen",
        requestedShortcut: shortcut,
        currentShortcut: "",
        callback: () => void this.toggle(),
        onActiveShortcutChange: (active) => {
          this.activeShortcut = active;
        },
      });
    }
    this.options.input.unsubscribeCapture();
    this.panel?.arm(null);
    this.panel?.setHit("done", null);
    return recording.input?.finish() ?? { strokes: [], events: [], cursor: [] };
  }

  /** Stops the recording; `discard` throws it away (Esc). */
  async stop(discard: boolean): Promise<void> {
    const recording = this.recording;
    if (!recording || recording.phase === "stopping") return;
    recording.phase = "stopping";
    recording.discard = discard;
    const durationMs = Date.now() - recording.startedAtMs;
    // Finished from another app: Stella stays in the background.
    const quiet = !this.stellaInFront();
    const timeline = this.releaseInput(recording);
    const overlay = this.options.getOverlay();
    overlay?.showStellaFinishing(recording.id);
    const result = await new Promise<ShowStellaRecorderResult | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), RECORDER_STOP_TIMEOUT_MS);
      recording.stopped = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      overlay?.stopShowStellaRecorder(recording.id);
    });
    await Promise.allSettled([...recording.writes]);
    await new Promise<void>((resolve) => {
      if (!recording.video) return resolve();
      recording.video.end(() => resolve());
    });
    this.recording = null;

    if (discard) {
      overlay?.endShowStella();
      await fs.rm(recording.dir, { recursive: true, force: true }).catch(() => undefined);
      return;
    }
    let hasAudio = false;
    if (result?.wav && result.wav.byteLength > 44) {
      await fs.writeFile(path.join(recording.dir, "audio.wav"), Buffer.from(result.wav), { mode: 0o600 });
      hasAudio = true;
    }
    const frames = await fs.readdir(path.join(recording.dir, "stream")).catch(() => []);
    if (frames.length === 0) {
      overlay?.endShowStella();
      console.warn("[show-stella] recording has no frames:", result?.error ?? "recorder did not answer");
      await fs.rm(recording.dir, { recursive: true, force: true }).catch(() => undefined);
      return;
    }
    const bounds = recording.display.bounds;
    const timelineJson = {
      id: recording.id,
      createdAtMs: recording.startedAtMs,
      durationMs,
      target: {
        mode: "display",
        displayId: recording.display.id,
        frame: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          scale: recording.display.scaleFactor,
        },
      },
      ...timeline,
      ...(recording.videoName ? { video: recording.videoName } : {}),
      ...(hasAudio ? { audio: "audio.wav" } : {}),
    };
    await fs.writeFile(path.join(recording.dir, "timeline.json"), JSON.stringify(timelineJson), {
      mode: 0o600,
    });
    const pending: Pending = { id: recording.id, dir: recording.dir, durationMs, hasAudio };
    this.pending.set(recording.id, pending);
    if (quiet && overlay) {
      this.reviewing = {
        id: recording.id,
        dir: recording.dir,
        durationMs,
        display: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        top: recording.display.workArea.y,
        capture: null,
        timer: null,
        engaged: false,
        keepTimer: null,
      };
      if (this.panel && this.cardStrings) overlay.endShowStella();
      await this.showReview();
    } else {
      overlay?.endShowStella();
      this.options.captureService.upsertShowCapture(
        { id: recording.id, status: "preparing", durationMs, dir: recording.dir },
        { add: true },
      );
      this.options.showFullWindow();
    }
    this.requestTranscript(pending);
  }

  /** Whether one of Stella's own windows (not the overlay) has focus. */
  private stellaInFront(): boolean {
    const focused = BrowserWindow.getFocusedWindow();
    if (!focused || focused.isDestroyed()) return false;
    return focused.webContents !== this.options.getOverlay()?.getWebContents();
  }

  /** The main window gets the words from the user's dictation engine, then calls build. */
  private requestTranscript(pending: Pending): void {
    const full = this.options.getFullWindow() ?? this.options.ensureFullWindow();
    if (!full || full.isDestroyed()) {
      void this.build(pending.id, {
        source: "none",
        text: "",
        segments: [],
        words: [],
        missing: { reason: "Stella's window couldn't be opened to prepare the capture." },
      });
      return;
    }
    // A window still loading asks for waiting recordings once it's up.
    if (!full.webContents.isLoading()) {
      full.webContents.send(IPC_SHOW_STELLA_RECORDED, {
        captureId: pending.id,
        durationMs: pending.durationMs,
        hasAudio: pending.hasAudio,
      });
    }
  }

  /** What a main window that just opened still has to do. */
  pendingRecordings(): { recordings: ShowStellaRecorded[]; sends: ShowStellaSendRequest[] } {
    return {
      recordings: [...this.pending.values()]
        .filter((pending) => !this.discarded.has(pending.id))
        .map((pending) => ({
          captureId: pending.id,
          durationMs: pending.durationMs,
          hasAudio: pending.hasAudio,
        })),
      // A send goes to one page once; one a reloaded page lost falls back to
      // the composer at its timeout instead of being sent twice.
      sends: [...this.outbox.values()]
        .filter((entry) => !entry.handedOver)
        .map((entry) => {
          entry.handedOver = true;
          return entry.request;
        }),
    };
  }

  private async showReview(): Promise<void> {
    const review = this.reviewing;
    const overlay = this.options.getOverlay();
    if (!review || !overlay) return;
    const capture = review.capture;
    if (capture && !review.timer) {
      review.timer = setTimeout(() => {
        void this.review({ captureId: review.id, action: "keep" });
      }, REVIEW_SAFETY_MS);
    }
    const strings = this.cardStrings;
    if (this.panel && strings) {
      const failed = capture !== null && capture.status !== "ready";
      this.panel.showCard({
        x: review.display.x + review.display.width / 2,
        y: review.top + CARD_TOP,
        title: strings.title.replace("{duration}", clock(review.durationMs)),
        status: !capture ? strings.preparing : failed ? strings.failed : null,
        image: capture?.contactSheet?.path ?? null,
        sendEnabled: !failed,
        strings: { note: strings.note, send: strings.send, open: strings.open, discard: strings.discard },
      });
      this.scheduleKeep(review);
      return;
    }
    const state: ShowStellaReviewState = {
      phase: "review",
      captureId: review.id,
      durationMs: review.durationMs,
      display: review.display,
      status: capture ? (capture.status === "ready" ? "ready" : "failed") : "preparing",
      ...(capture?.contactSheet
        ? {
            preview: capture.contactSheet.previewUrl,
            previewWidth: capture.contactSheet.width,
            previewHeight: capture.contactSheet.height,
          }
        : {}),
    };
    await overlay.startShowStella(state);
  }

  private nativePanel(): ShowPanel | null {
    if (!ShowPanel.available()) return null;
    this.panel ??= new ShowPanel((event) => this.onPanelEvent(event));
    return this.panel;
  }

  /** The overlay's Done button and the card's words, for the native panels. */
  overlayInfo(info: ShowStellaOverlayInfo): void {
    this.cardStrings = info.strings;
    const recording = this.recording;
    if (recording && recording.id === info.captureId && recording.phase === "recording") {
      this.panel?.setHit("done", info.done);
    }
  }

  private onPanelEvent(event: PanelEvent): void {
    const review = this.reviewing;
    switch (event.event) {
      case "hit":
        if (event.id === "done" && this.recording?.phase === "recording") void this.stop(false);
        return;
      case "card":
        if (!review) return;
        void this.review(
          event.action === "send"
            ? { captureId: review.id, action: "send", note: event.note }
            : { captureId: review.id, action: event.action },
        );
        return;
      case "engaged":
        if (!review) return;
        review.engaged = event.on;
        this.scheduleKeep(review);
        return;
      default:
        return;
    }
  }

  /** An untouched native card goes to the composer a little after it's ready. */
  private scheduleKeep(review: Review): void {
    if (review.keepTimer) clearTimeout(review.keepTimer);
    review.keepTimer = null;
    if (!review.capture || review.engaged) return;
    review.keepTimer = setTimeout(() => {
      void this.review({ captureId: review.id, action: "keep" });
    }, KEEP_AFTER_MS);
  }

  setReviewFocusable(focusable: boolean): void {
    if (this.reviewing) this.options.getOverlay()?.setShowStellaFocusable(focusable);
  }

  /** The finish card's answer: send, open in Stella, keep in the composer, or discard. */
  async review(action: ShowStellaReviewAction): Promise<boolean> {
    const review = this.reviewing;
    if (!review || review.id !== action.captureId) return false;
    if (review.timer) clearTimeout(review.timer);
    if (review.keepTimer) clearTimeout(review.keepTimer);
    this.reviewing = null;
    this.panel?.hideCard();
    this.options.getOverlay()?.endShowStella();
    const capture =
      review.capture ??
      ({ id: review.id, status: "preparing", durationMs: review.durationMs, dir: review.dir } as const);
    switch (action.action) {
      case "discard":
        if (this.pending.has(review.id)) this.discarded.add(review.id);
        await fs.rm(review.dir, { recursive: true, force: true }).catch(() => undefined);
        return true;
      case "send":
        if (review.capture) void this.dispatchSend(review.capture, action.note);
        else this.sendWhenReady.set(review.id, action.note);
        return true;
      case "open":
        this.options.captureService.upsertShowCapture(capture, { add: true });
        this.options.showFullWindow();
        return true;
      case "keep":
        this.options.captureService.upsertShowCapture(capture, { add: true });
        return true;
    }
  }

  /** Sends a capture as a message from the main window, which stays where it is. */
  private dispatchSend(capture: ShowCaptureAttachment, note: string): void {
    if (capture.status !== "ready") {
      this.options.captureService.upsertShowCapture(capture, { add: true });
      return;
    }
    const request: ShowStellaSendRequest = {
      requestId: randomBytes(8).toString("hex"),
      capture,
      note: note.trim(),
    };
    const timer = setTimeout(() => this.sent(request.requestId, false), SEND_TIMEOUT_MS);
    const entry = { request, timer, handedOver: false };
    this.outbox.set(request.requestId, entry);
    const full = this.options.getFullWindow() ?? this.options.ensureFullWindow();
    if (full && !full.isDestroyed() && !full.webContents.isLoading()) {
      entry.handedOver = true;
      full.webContents.send(IPC_SHOW_STELLA_SEND, request);
    }
  }

  /** The main window's answer to a send; one it couldn't make lands in the composer. */
  sent(requestId: string, ok: boolean): void {
    const entry = this.outbox.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.outbox.delete(requestId);
    if (!ok) this.options.captureService.upsertShowCapture(entry.request.capture, { add: true });
  }

  /** A built (or failed) capture goes to its finish card, its send, or the composer. */
  private deliver(capture: ShowCaptureAttachment): void {
    if (this.discarded.delete(capture.id)) {
      void fs.rm(capture.dir, { recursive: true, force: true }).catch(() => undefined);
      return;
    }
    const review = this.reviewing;
    if (review && review.id === capture.id) {
      review.capture = capture;
      void this.showReview();
      return;
    }
    const note = this.sendWhenReady.get(capture.id);
    if (note !== undefined) {
      this.sendWhenReady.delete(capture.id);
      this.dispatchSend(capture, note);
      return;
    }
    this.options.captureService.upsertShowCapture(capture);
  }

  private async abandon(recording: Recording): Promise<void> {
    this.releaseInput(recording);
    this.options.getOverlay()?.endShowStella();
    if (this.recording === recording) this.recording = null;
    await fs.rm(recording.dir, { recursive: true, force: true }).catch(() => undefined);
  }

  private current(captureId: string): Recording | null {
    const recording = this.recording;
    return recording && recording.id === captureId ? recording : null;
  }

  recorderStarted(captureId: string, atMs: number): void {
    const recording = this.current(captureId);
    if (recording) recording.recorderStartedAtMs = atMs;
  }

  recorderFailed(captureId: string, message: string): void {
    const recording = this.current(captureId);
    if (!recording) return;
    console.warn("[show-stella] recorder failed:", message);
    if (recording.phase === "stopping") {
      recording.stopped?.({ captureId, wav: null, videoMimeType: null, error: message });
      return;
    }
    void this.stop(true);
  }

  recorderStopped(result: ShowStellaRecorderResult): void {
    this.current(result.captureId)?.stopped?.(result);
  }

  frame(captureId: string, t: number, jpeg: ArrayBuffer): void {
    const recording = this.current(captureId);
    if (!recording || !Number.isFinite(t) || t < 0 || jpeg.byteLength === 0) return;
    const file = path.join(recording.dir, "stream", `${String(Math.round(t)).padStart(7, "0")}.jpg`);
    const write = fs.writeFile(file, Buffer.from(jpeg), { mode: 0o600 }).catch(() => undefined);
    recording.writes.add(write);
    void write.finally(() => recording.writes.delete(write));
  }

  videoChunk(captureId: string, chunk: ArrayBuffer, mimeType: string | null): void {
    const recording = this.current(captureId);
    if (!recording || chunk.byteLength === 0) return;
    if (!recording.video) {
      const ext = mimeType?.includes("mp4") ? "mp4" : "webm";
      recording.videoName = `recording.${ext}`;
      recording.video = createWriteStream(path.join(recording.dir, recording.videoName), { mode: 0o600 });
    }
    recording.video.write(Buffer.from(chunk));
  }

  async readAudio(captureId: string): Promise<ArrayBuffer | null> {
    const pending = this.pending.get(captureId);
    if (!pending?.hasAudio) return null;
    const bytes = await fs.readFile(path.join(pending.dir, "audio.wav")).catch(() => null);
    return bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : null;
  }

  async build(captureId: string, transcript: ShowStellaTranscript): Promise<ShowStellaBuildResult> {
    const pending = this.pending.get(captureId);
    if (!pending || !ID_PATTERN.test(captureId)) {
      return { ok: false, captureId, error: "This capture is no longer waiting." };
    }
    this.pending.delete(captureId);
    if (this.discarded.delete(captureId)) {
      await fs.rm(pending.dir, { recursive: true, force: true }).catch(() => undefined);
      return { ok: false, captureId, error: "The capture was discarded." };
    }
    const helper = resolveNativeHelperPath(HELPER);
    try {
      if (!helper) throw new Error("Screen recording isn't installed on this computer.");
      await fs.writeFile(path.join(pending.dir, "transcript.json"), JSON.stringify(transcript), {
        mode: 0o600,
      });
      const out = JSON.parse(await runBuilder(helper, pending.dir)) as {
        summary: string;
        contactSheet: string;
        contactSheetWidth: number;
        contactSheetHeight: number;
        frames: string[];
      };
      const image = nativeImage.createFromPath(out.contactSheet);
      const preview = image.isEmpty()
        ? ""
        : `data:image/jpeg;base64,${image.resize({ width: PREVIEW_WIDTH, quality: "good" }).toJPEG(82).toString("base64")}`;
      const video = await this.videoOf(pending.dir);
      const said = transcript.text.trim();
      this.deliver({
        id: captureId,
        status: "ready",
        durationMs: pending.durationMs,
        dir: pending.dir,
        contactSheet: {
          path: out.contactSheet,
          previewUrl: preview,
          width: out.contactSheetWidth,
          height: out.contactSheetHeight,
        },
        summary: out.summary,
        moments: out.frames.length,
        ...(said
          ? { said: said.length > SAID_PREVIEW_CHARS ? `${said.slice(0, SAID_PREVIEW_CHARS - 1)}…` : said }
          : {}),
        ...(video ? { video } : {}),
      });
      return { ok: true, captureId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[show-stella] build failed:", message);
      this.deliver({
        id: captureId,
        status: "failed",
        durationMs: pending.durationMs,
        dir: pending.dir,
        error: message,
      });
      return { ok: false, captureId, error: message };
    }
  }

  private async videoOf(dir: string): Promise<ShowCaptureAttachment["video"] | null> {
    for (const [name, mimeType] of [
      ["recording.mp4", "video/mp4"],
      ["recording.webm", "video/webm"],
    ] as const) {
      const stat = await fs.stat(path.join(dir, name)).catch(() => null);
      if (stat?.isFile() && stat.size > 0) {
        return { path: path.join(dir, name), name, size: stat.size, mimeType };
      }
    }
    return null;
  }

  /**
   * Recordings, sound and the frame stream go after a week; the rest of a
   * capture (moments, contact sheet, summary) after a month.
   */
  private async prune(root: string): Promise<void> {
    const now = Date.now();
    const days = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const day of days) {
      if (!day.isDirectory()) continue;
      const dayDir = path.join(root, day.name);
      const captures = await fs.readdir(dayDir, { withFileTypes: true }).catch(() => []);
      for (const capture of captures) {
        if (!capture.isDirectory() || !ID_PATTERN.test(capture.name)) continue;
        if (capture.name === this.recording?.id || this.pending.has(capture.name)) continue;
        const dir = path.join(dayDir, capture.name);
        const stat = await fs.stat(dir).catch(() => null);
        if (!stat) continue;
        const age = now - stat.birthtimeMs;
        if (age > CAPTURE_KEEP_MS) {
          await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        } else if (age > RECORDING_KEEP_MS) {
          for (const name of ["stream", "recording.mp4", "recording.webm", "audio.wav"]) {
            await fs.rm(path.join(dir, name), { recursive: true, force: true }).catch(() => undefined);
          }
        }
      }
      const left = await fs.readdir(dayDir).catch(() => ["?"]);
      if (left.length === 0) await fs.rmdir(dayDir).catch(() => undefined);
    }
  }

  dispose(): void {
    if (this.reviewing?.timer) clearTimeout(this.reviewing.timer);
    if (this.reviewing?.keepTimer) clearTimeout(this.reviewing.keepTimer);
    this.panel?.dispose();
    for (const entry of this.outbox.values()) clearTimeout(entry.timer);
    const recording = this.recording;
    if (recording) {
      this.releaseInput(recording);
      recording.video?.end();
      this.options.getOverlay()?.endShowStella();
      this.recording = null;
    }
    if (this.activeShortcut) globalShortcut.unregister(this.activeShortcut);
    this.activeShortcut = "";
  }
}
