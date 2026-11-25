import { BrowserWindow, session, type WebContents } from "electron";
import { isAssetDocumentPath } from "@stella/contracts/html-relative-assets";
import {
  PAGE_PREVIEW_IMAGE,
  PAGE_PREVIEW_JPEG_QUALITY,
  PAGE_PREVIEW_SETTLE_MS,
  PAGE_PREVIEW_TIMEOUT_MS,
  PAGE_PREVIEW_VIEWPORT,
} from "@stella/contracts/page-preview";
import {
  canvasUrlForLocalFile,
  registerCanvasHtml,
  serveCanvasProtocol,
} from "../source/canvas-protocol.js";

const PARTITION = "stella-page-snapshots";
const IDLE_CLOSE_MS = 20_000;
const FONTS_WAIT_MS = 2_500;
const EMULATION_WAIT_MS = 2_000;
const JOB_DEADLINE_MS = 30_000;

export type PageSnapshotSource =
  | { kind: "file"; filePath: string }
  | { kind: "html"; html: string; drivePath?: string; devicePath?: string };

let sessionReady = false;
let host: BrowserWindow | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const prepareSession = () => {
  if (sessionReady) return;
  sessionReady = true;
  serveCanvasProtocol(PARTITION);
  const snapshots = session.fromPartition(PARTITION);
  snapshots.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  snapshots.setPermissionCheckHandler(() => false);
  snapshots.on("will-download", (event) => event.preventDefault());
};

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });

const emulateStillPage = async (contents: WebContents) => {
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    await contents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-reduced-motion", value: "reduce" },
        { name: "prefers-color-scheme", value: "light" },
      ],
    });
  } catch {}
};

const ensureHost = (): BrowserWindow => {
  if (host && !host.isDestroyed()) return host;
  prepareSession();
  const created = new BrowserWindow({
    show: false,
    width: PAGE_PREVIEW_VIEWPORT.width,
    height: PAGE_PREVIEW_VIEWPORT.height,
    useContentSize: true,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      partition: PARTITION,
      offscreen: { deviceScaleFactor: 1 },
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: false,
      disableDialogs: true,
      navigateOnDragDrop: false,
      autoplayPolicy: "user-gesture-required",
    },
  });
  const contents = created.webContents;
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  created.on("closed", () => {
    if (host === created) host = null;
  });
  host = created;
  return created;
};

const scheduleClose = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    const idle = host;
    host = null;
    if (idle && !idle.isDestroyed()) idle.destroy();
  }, IDLE_CLOSE_MS);
};

const urlFor = async (source: PageSnapshotSource): Promise<string | null> => {
  if (source.kind === "file") return await canvasUrlForLocalFile(source.filePath);
  if (source.drivePath) {
    const drivePath = source.drivePath.replace(/^\/+/u, "");
    return isAssetDocumentPath(drivePath)
      ? registerCanvasHtml(source.html, `/${drivePath}`, "drive")
      : registerCanvasHtml(source.html);
  }
  return registerCanvasHtml(source.html, source.devicePath ?? null);
};

const capture = async (url: string): Promise<Buffer | null> => {
  const window = ensureHost();
  const contents = window.webContents;
  if (!contents.getURL()) {
    await withTimeout(contents.loadURL("about:blank"), EMULATION_WAIT_MS);
  }
  await withTimeout(emulateStillPage(contents), EMULATION_WAIT_MS);
  try {
    const loaded = await withTimeout(
      contents.loadURL(url).then(
        () => "loaded" as const,
        () => "failed" as const,
      ),
      PAGE_PREVIEW_TIMEOUT_MS,
    );
    if (loaded === "failed") return null;
    await withTimeout(
      contents.executeJavaScript(
        "document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true",
        true,
      ),
      FONTS_WAIT_MS,
    );
    await new Promise((resolve) => setTimeout(resolve, PAGE_PREVIEW_SETTLE_MS));
    const image = await withTimeout(contents.capturePage(), PAGE_PREVIEW_TIMEOUT_MS);
    if (!image || image.isEmpty()) return null;
    const jpeg = image
      .resize({ ...PAGE_PREVIEW_IMAGE, quality: "best" })
      .toJPEG(PAGE_PREVIEW_JPEG_QUALITY);
    return jpeg.byteLength > 0 ? jpeg : null;
  } finally {
    if (!contents.isDestroyed()) void contents.loadURL("about:blank").catch(() => undefined);
  }
};

const discardHost = () => {
  const stuck = host;
  host = null;
  if (stuck && !stuck.isDestroyed()) stuck.destroy();
};

export const snapshotPage = (source: PageSnapshotSource): Promise<Buffer | null> => {
  const work = queue.then(async () => {
    if (idleTimer) clearTimeout(idleTimer);
    let stuck = false;
    try {
      const url = await urlFor(source);
      if (!url) return null;
      const outcome = await withTimeout(
        capture(url).then((jpeg) => ({ jpeg })),
        JOB_DEADLINE_MS,
      );
      stuck = outcome === null;
      return outcome?.jpeg ?? null;
    } catch {
      return null;
    } finally {
      if (stuck) discardHost();
      else scheduleClose();
    }
  });
  queue = work.catch(() => undefined);
  return work;
};

export const snapshotPageDataUrl = async (
  source: PageSnapshotSource,
): Promise<string | null> => {
  const jpeg = await snapshotPage(source);
  return jpeg ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : null;
};
