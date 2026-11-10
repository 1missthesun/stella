import { execFile } from "node:child_process";
import { createWriteStream, promises as fs, type WriteStream } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  desktopCapturer,
  globalShortcut,
  nativeImage,
  screen,
  type BrowserWindow,
  type Display,
} from "electron";
import type { ShowCaptureAttachment } from "@stella/contracts";
import type {
  ShowStellaInk,
  ShowStellaOverlayState,
  ShowStellaRecorderResult,
  ShowStellaStatus,
  ShowStellaTranscript,
  ShowStellaBuildResult,
} from "@stella/contracts/desktop/show-stella";
import { IPC_SHOW_STELLA_RECORDED } from "@stella/contracts/desktop/ipc-channels";
import { resolveNativeHelperPath } from "../../native-helper-path.js";
import { hasMacPermission, requestMacPermission } from "../../utils/macos-permissions.js";
import { openMacPermissionSettings } from "../../utils/macos-permission-settings.js";
import { applyShortcutRegistration } from "../../ipc/shortcut-registration.js";
import { ShowStellaInput, type CaptureTimeline, type HookEvent } from "./show-stella-input.js";

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

type OverlayApi = {
  startShowStella: (state: ShowStellaOverlayState) => Promise<boolean>;
  sendShowStellaInk: (ink: ShowStellaInk) => void;
  stopShowStellaRecorder: (captureId: string) => void;
  showStellaFinishing: (captureId: string) => void;
  endShowStella: () => void;
  getOverlayOrigin: () => { x: number; y: number };
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

  constructor(private readonly options: ShowStellaControllerOptions) {}

  registerShortcut(): string {
    // Without the builder there is nothing to make a capture with; leave the keys to other apps.
    if (!supportedPlatform() || !resolveNativeHelperPath(HELPER)) return "";
    for (const shortcut of [SHORTCUT, FALLBACK_SHORTCUT]) {
      const result = applyShortcutRegistration({
        label: "Show Stella",
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
      onInk: (ink) => overlay.sendShowStellaInk(ink),
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
        label: "Show Stella",
        requestedShortcut: shortcut,
        currentShortcut: "",
        callback: () => void this.toggle(),
        onActiveShortcutChange: (active) => {
          this.activeShortcut = active;
        },
      });
    }
    this.options.input.unsubscribeCapture();
    return recording.input?.finish() ?? { strokes: [], events: [], cursor: [] };
  }

  /** Stops the recording; `discard` throws it away (Esc). */
  async stop(discard: boolean): Promise<void> {
    const recording = this.recording;
    if (!recording || recording.phase === "stopping") return;
    recording.phase = "stopping";
    recording.discard = discard;
    const durationMs = Date.now() - recording.startedAtMs;
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
    overlay?.endShowStella();
    this.recording = null;

    if (discard) {
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
    this.options.captureService.upsertShowCapture(
      { id: recording.id, status: "preparing", durationMs, dir: recording.dir },
      { add: true },
    );
    this.options.showFullWindow();
    const full = this.options.getFullWindow();
    if (full && !full.isDestroyed()) {
      full.webContents.send(IPC_SHOW_STELLA_RECORDED, {
        captureId: recording.id,
        durationMs,
        hasAudio,
      });
    } else {
      void this.build(recording.id, {
        source: "none",
        text: "",
        segments: [],
        words: [],
        missing: { reason: "Stella's window was closed while the capture was prepared." },
      });
    }
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
    const helper = resolveNativeHelperPath(HELPER);
    try {
      if (!helper) throw new Error("Show Stella isn't installed on this computer.");
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
      this.options.captureService.upsertShowCapture({
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
      this.options.captureService.upsertShowCapture({
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
