import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

import {
  COMPUTER_USE_PROTOCOL_VERSION,
  COMPUTER_USE_SCHEMA_VERSION,
  assertComputerUseRequest,
  type ComputerUseActionCommand,
  type ComputerUseActionReceipt,
  type ComputerUseAppState,
  type ComputerUsePoint,
  type ComputerUseRequest,
  type ComputerUseResponse,
  type ComputerUseTarget,
  type ComputerUseWaitProvenance,
  type JsonObject,
} from "./contract.js";
import type { ComputerUseSession } from "./session.js";
import {
  ComputerUseResourceArbiter,
  ComputerUseResourceStaleError,
} from "./resource-arbiter.js";
import {
  computeStateDiff,
  formatStateDiffBlock,
  shouldUseDiffOnly,
} from "../cli/stella-computer-state-diff.js";
import { computerSessionsDir } from "./session-fs.js";
import {
  AtspiClient,
  ATSPI_SCROLL,
  type AtspiApp,
  type AtspiNode,
  type AtspiRef,
} from "./linux/atspi.js";
import {
  elementAtPoint,
  formatTree,
  isInternalAction,
  primaryAction,
  type LinuxElement,
} from "./linux/format.js";
import {
  LinuxDesktopUnavailableError,
  type LinuxCapture,
  type LinuxDesktop,
  type LinuxFocusSnapshot,
  type LinuxKeyChord,
  type LinuxWindow,
} from "./linux/desktop.js";
import { HyprlandDesktop } from "./linux/hyprland.js";

/**
 * Computer use on Linux. Background by default, like macOS and Windows:
 * apps are read and driven through AT-SPI (GTK, Qt, accessibility-enabled
 * Chromium/Electron), single windows are captured even when covered or on
 * another workspace, and the user's pointer and focused window are never
 * touched. Raw pointer/keyboard input exists only for delivery:
 * "foreground", which gives the user's window and pointer back afterwards.
 *
 * Built on Cua's Linux approach (MIT, trycua/cua; see linux/LICENSE-cua).
 */

export const linuxComputerUseResourceArbiter = new ComputerUseResourceArbiter();

type LinuxSnapshot = {
  window: LinuxWindow;
  appName: string;
  /** Accessibility tree lines (empty when the app exposes none). */
  treeLines: string[];
  elements: LinuxElement[];
  focused: LinuxElement | null;
  selectedText: string | null;
  notes: string[];
  accessibility: "ok" | "none" | "empty" | "error";
  screenshot: {
    rgba: Uint8Array;
    width: number;
    height: number;
    png: Uint8Array;
    method: string;
  } | null;
  captureWarning: string | null;
  timings: Record<string, number>;
};

class LinuxInputError extends Error {
  readonly retryable = false;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LinuxInputError";
  }
}

class LinuxWaitTimeoutError extends Error {
  readonly code = "wait_timeout";
  readonly retryable = true;
  constructor(
    readonly timeoutMs: number,
    readonly elapsedMs: number,
    readonly pollCount: number,
    readonly afterStateId: string,
    readonly afterVisualStateId?: string,
  ) {
    super(
      `Linux app state did not change within ${timeoutMs}ms (after_state_id=${afterStateId}, polls=${pollCount}).`,
    );
    this.name = "LinuxWaitTimeoutError";
  }
}

const BACKGROUND_OPTIONS =
  'Nothing was sent and Stella did not take over the screen. What you can do: act on an element instead (click, set_value, select_text, scroll or perform_secondary_action with an element_index go through accessibility, which works in the background), click the text field first and then type_text, or tell the user what you could not do. Only if the user asked Stella to take over the screen for this task, retry with delivery: "foreground": the window comes to the front for the action, then the user gets their window and pointer back.';

const backgroundUnavailable = (reason: string) =>
  new LinuxInputError(
    "background_unavailable",
    `${reason} ${BACKGROUND_OPTIONS}`,
  );

const COORDINATE_STALE_HINT =
  'Take a fresh get_app_state with screenshot_policy: "always" and pick the point again from that screenshot. If this window never stops animating, pass stale_check: "window" on the click or drag.';

const SETTLE_CHANGE_MS = 700;
/** How long a document scroll may take to show in element positions. */
const SCROLL_SETTLE_MS = 400;
const SETTLE_STABLE_MAX_MS = 400;
const SETTLE_POLL_MS = 60;

const PIXEL_CHANGE_THRESHOLD = 48;
const POINT_AREA_CHANGE_LIMIT = 0.4;
const WINDOW_CHANGE_LIMIT = 0.75;

const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex").slice(0, 20);

const responseEnvelope = (request: ComputerUseRequest) => ({
  schemaVersion: COMPUTER_USE_SCHEMA_VERSION,
  protocolVersion: COMPUTER_USE_PROTOCOL_VERSION,
  requestId: request.requestId,
  sessionId: request.sessionId,
});

const errorResponse = (
  request: ComputerUseRequest,
  code: string,
  message: string,
  retryable = false,
  details?: JsonObject,
): Extract<ComputerUseResponse, { type: "error" }> => ({
  ...responseEnvelope(request),
  type: "error",
  error: { code, message, retryable, ...(details ? { details } : {}) },
});

const jsonObject = (value: unknown): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;

/** Fast PNG for screenshots: Sub filter, light compression. */
const encodeScreenshotPng = (
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array => {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOut = y * (stride + 1);
    raw[rowOut] = 1; // Sub
    let source = y * width * 4;
    let prevR = 0;
    let prevG = 0;
    let prevB = 0;
    for (
      let x = 0, out = rowOut + 1;
      x < width;
      x += 1, source += 4, out += 3
    ) {
      const r = rgba[source]!;
      const g = rgba[source + 1]!;
      const b = rgba[source + 2]!;
      raw[out] = (r - prevR) & 0xff;
      raw[out + 1] = (g - prevG) & 0xff;
      raw[out + 2] = (b - prevB) & 0xff;
      prevR = r;
      prevG = g;
      prevB = b;
    }
  }
  const crcTable = encodeScreenshotPng.crcTable;
  const crc32 = (bytes: Uint8Array) => {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = crcTable[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let index = 0; index < 4; index += 1)
      out[4 + index] = type.charCodeAt(index);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 3 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
};
encodeScreenshotPng.crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const changedPixelShare = (
  before: { rgba: Uint8Array; width: number },
  after: { rgba: Uint8Array },
  left: number,
  top: number,
  right: number,
  bottom: number,
  step: number,
) => {
  let total = 0;
  let changed = 0;
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const offset = (y * before.width + x) * 4;
      total += 1;
      if (
        Math.abs(before.rgba[offset]! - after.rgba[offset]!) >
          PIXEL_CHANGE_THRESHOLD ||
        Math.abs(before.rgba[offset + 1]! - after.rgba[offset + 1]!) >
          PIXEL_CHANGE_THRESHOLD ||
        Math.abs(before.rgba[offset + 2]! - after.rgba[offset + 2]!) >
          PIXEL_CHANGE_THRESHOLD
      ) {
        changed += 1;
      }
    }
  }
  return total === 0 ? 0 : changed / total;
};

const coordinatePixelChange = (
  observed: NonNullable<LinuxSnapshot["screenshot"]>,
  current: NonNullable<LinuxSnapshot["screenshot"]>,
  points: readonly ComputerUsePoint[],
): string | null => {
  if (observed.width !== current.width || observed.height !== current.height) {
    return `the screenshot size changed from ${observed.width}x${observed.height} to ${current.width}x${current.height}`;
  }
  const radius = Math.max(
    12,
    Math.round(Math.max(observed.width, observed.height) * 0.035),
  );
  for (const point of points) {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    if (x < 0 || y < 0 || x >= observed.width || y >= observed.height) {
      return `the point (${x}, ${y}) is outside the ${observed.width}x${observed.height} screenshot`;
    }
    const share = changedPixelShare(
      observed,
      current,
      Math.max(0, x - radius),
      Math.max(0, y - radius),
      Math.min(observed.width, x + radius + 1),
      Math.min(observed.height, y + radius + 1),
      1,
    );
    if (share > POINT_AREA_CHANGE_LIMIT) {
      return `the area around (${x}, ${y}) changed (${Math.round(share * 100)}% of its pixels)`;
    }
  }
  const windowShare = changedPixelShare(
    observed,
    current,
    0,
    0,
    observed.width,
    observed.height,
    4,
  );
  if (windowShare > WINDOW_CHANGE_LIMIT) {
    return `most of the window changed (${Math.round(windowShare * 100)}% of its pixels)`;
  }
  return null;
};

const isCoordinateAction = (command: ComputerUseActionCommand) =>
  command.action.type === "click_point" || command.action.type === "drag";

const actionPoints = (
  command: ComputerUseActionCommand,
): readonly ComputerUsePoint[] => {
  const action = command.action;
  if (action.type === "click_point") return [action.point];
  if (action.type === "drag") return [action.from, action.to];
  return [];
};

const MODIFIERS: Record<string, string> = {
  ctrl: "CTRL",
  control: "CTRL",
  shift: "SHIFT",
  alt: "ALT",
  option: "ALT",
  opt: "ALT",
  super: "SUPER",
  cmd: "SUPER",
  command: "SUPER",
  meta: "SUPER",
  win: "SUPER",
  logo: "SUPER",
};

const KEY_ALIASES: Record<string, string> = {
  enter: "Return",
  return: "Return",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  backspace: "BackSpace",
  delete: "Delete",
  del: "Delete",
  home: "Home",
  end: "End",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  arrowup: "Up",
  arrowdown: "Down",
  pageup: "Prior",
  page_up: "Prior",
  pagedown: "Next",
  page_down: "Next",
  space: "space",
  " ": "space",
  insert: "Insert",
  menu: "Menu",
};

export const parseKeyChord = (input: string): LinuxKeyChord => {
  const parts = input.split("+").map((part) => part.trim());
  // "ctrl++" means ctrl and the plus key.
  if (input.endsWith("++")) parts.splice(parts.length - 2, 2, "plus");
  const mods: string[] = [];
  let key = "";
  for (const part of parts) {
    const lowered = part.toLowerCase();
    if (MODIFIERS[lowered] && part !== parts[parts.length - 1]) {
      if (!mods.includes(MODIFIERS[lowered]!)) mods.push(MODIFIERS[lowered]!);
      continue;
    }
    key = part;
  }
  if (!key)
    throw new Error(`press_key needs a key, got ${JSON.stringify(input)}.`);
  const aliased = KEY_ALIASES[key.toLowerCase()];
  if (aliased) key = aliased;
  else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) key = key.toUpperCase();
  else if (key.length === 1 && /[A-Z]/.test(key)) {
    if (!mods.includes("SHIFT")) mods.push("SHIFT");
    key = key.toLowerCase();
  }
  return { mods, key };
};

/**
 * Chromium (and Electron) report web content extents in device pixels while
 * its own toolbar and the window use logical ones. Bring the page back to
 * logical pixels so screenshots, hit tests and clicks line up.
 */
const scaleWebContent = (root: AtspiNode, scale: number) => {
  if (!(scale > 1.01)) return;
  const scaleNode = (node: AtspiNode) => {
    if (node.bounds) {
      node.bounds = {
        x: Math.round(node.bounds.x / scale),
        y: Math.round(node.bounds.y / scale),
        width: Math.round(node.bounds.width / scale),
        height: Math.round(node.bounds.height / scale),
      };
    }
    node.children.forEach(scaleNode);
  };
  const find = (node: AtspiNode) => {
    if (node.role === "document web" || node.role === "document frame") {
      scaleNode(node);
      return;
    }
    node.children.forEach(find);
  };
  find(root);
};

const sameRef = (
  left: AtspiRef | null | undefined,
  right: AtspiRef | null | undefined,
) =>
  Boolean(left && right && left.bus === right.bus && left.path === right.path);

const normalized = (value: string) => value.trim().toLowerCase();

const readProcessName = (pid: number) => {
  try {
    return readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return "";
  }
};

const STELLA_APP_IDS = /^(stella|stella-v2|stella-dev|stella-verify.*)$/i;
/** Apps that hold passwords or system security settings. */
const SECURITY_APP_IDS =
  /(keepass|1password|bitwarden|enpass|seahorse|gcr-prompter|polkit|pinentry|org\.gnome\.seahorse|kwalletmanager|proton.?pass)/i;

const protectedKind = (window: LinuxWindow): "stella" | "security" | null => {
  if (STELLA_APP_IDS.test(window.appId)) return "stella";
  try {
    const exe = readlinkSync(`/proc/${window.pid}/exe`);
    if (
      /\/stella(-v2)?\/(app\/)?.*electron/i.test(exe) ||
      /\/share\/stella\//.test(exe)
    ) {
      return "stella";
    }
  } catch {
    // unknown process
  }
  if (
    SECURITY_APP_IDS.test(window.appId) ||
    SECURITY_APP_IDS.test(readProcessName(window.pid))
  ) {
    return "security";
  }
  return null;
};

export type LinuxComputerUseSessionOptions = Readonly<{
  desktop?: LinuxDesktop | null;
  resourceArbiter?: ComputerUseResourceArbiter;
}>;

type SessionState = {
  snapshots: Map<string, LinuxSnapshot>;
  committed: Set<string>;
  /** The element Stella last focused or edited in each window. */
  focusTargets: Map<string, AtspiRef>;
  windows: Set<string>;
  /** Per window: when Stella last acted and the state it acted on. */
  recentActions: Map<string, { at: number; stateId: string }>;
  tail: Promise<void>;
};

const sessions = new Map<string, SessionState>();
let sharedAtspi: Promise<AtspiClient> | null = null;
let sharedDesktop: LinuxDesktop | null | undefined;

const atspiClient = async () => {
  if (sharedAtspi) {
    const client = await sharedAtspi.catch(() => null);
    if (client && !client.closed) return client;
  }
  sharedAtspi = AtspiClient.connect();
  return await sharedAtspi;
};

const defaultDesktop = (): LinuxDesktop | null => {
  if (sharedDesktop === undefined)
    sharedDesktop = HyprlandDesktop.connectIfAvailable();
  return sharedDesktop;
};

const sessionState = (sessionId: string) => {
  let state = sessions.get(sessionId);
  if (!state) {
    state = {
      snapshots: new Map(),
      committed: new Set(),
      focusTargets: new Map(),
      windows: new Set(),
      recentActions: new Map(),
      tail: Promise.resolve(),
    };
    sessions.set(sessionId, state);
  }
  return state;
};

const linuxSessionDir = (sessionId: string) =>
  path.join(computerSessionsDir(), sessionId, "linux");

const screenshotPath = (sessionId: string, alias: string) =>
  path.join(
    linuxSessionDir(sessionId),
    alias.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "default",
    "last-screenshot.png",
  );

/** Called when an agent run ends: drops its states and screenshots. */
export const releaseLinuxComputerSession = async (sessionId: string) => {
  const state = sessions.get(sessionId);
  sessions.delete(sessionId);
  const desktop = sharedDesktop;
  if (state && desktop) {
    const stillUsed = new Set(
      [...sessions.values()].flatMap((other) => [...other.windows]),
    );
    await desktop.release(
      [...state.windows].filter((id) => !stillUsed.has(id)),
    );
    if (sessions.size === 0)
      await desktop.closeInput?.().catch(() => undefined);
  }
  try {
    rmSync(linuxSessionDir(sessionId), { recursive: true, force: true });
  } catch {
    // best effort
  }
};

const windowIdOf = (target: Extract<ComputerUseTarget, { type: "window" }>) =>
  target.windowId
    .trim()
    .replace(/^(0x|window:)/i, "")
    .toLowerCase();

const aliasOf = (target: ComputerUseTarget) =>
  target.type === "app"
    ? `app:${normalized(target.app)}`
    : `window:${windowIdOf(target)}`;

export const createLinuxComputerUseSession = (
  options: LinuxComputerUseSessionOptions = {},
): ComputerUseSession => {
  const arbiter = options.resourceArbiter ?? linuxComputerUseResourceArbiter;
  const desktopOrNull = () =>
    options.desktop === undefined ? defaultDesktop() : options.desktop;
  const requireDesktop = () => {
    const desktop = desktopOrNull();
    if (!desktop) {
      throw new LinuxDesktopUnavailableError(
        "Computer use on Linux currently needs Hyprland (it reads windows and captures them through Hyprland). This desktop is not supported yet.",
      );
    }
    return desktop;
  };

  const findWindow = async (
    target: ComputerUseTarget,
  ): Promise<LinuxWindow> => {
    const windows = await requireDesktop().listWindows();
    if (target.type === "window") {
      const id = windowIdOf(target);
      const found = windows.find((window) => window.id === id);
      if (!found) {
        throw new Error(
          `No window with window_id ${target.windowId} is open. Call list_windows for current ids.`,
        );
      }
      return found;
    }
    const wanted = normalized(target.app);
    const byFocus = (left: LinuxWindow, right: LinuxWindow) =>
      (left.focusOrder ?? 1e9) - (right.focusOrder ?? 1e9);
    const exact = windows.filter(
      (window) =>
        normalized(window.appId) === wanted ||
        normalized(window.appId.split(".").pop() ?? "") === wanted ||
        normalized(readProcessName(window.pid)) === wanted ||
        normalized(window.title) === wanted,
    );
    const matches =
      exact.length > 0
        ? exact
        : windows.filter(
            (window) =>
              normalized(window.appId).includes(wanted) ||
              normalized(window.title).includes(wanted),
          );
    const [best] = matches.sort(byFocus);
    if (!best) {
      throw new Error(
        `No open window belongs to "${target.app}". Call list_apps or list_windows to see what is open; to start an app, launch it from the shell first.`,
      );
    }
    return best;
  };

  /** The accessibility root of one window: its app's frame with that title or size. */
  const findFrame = async (
    atspi: AtspiClient,
    window: LinuxWindow,
  ): Promise<{ app: AtspiApp; frame: AtspiRef } | null> => {
    const apps = (await atspi.apps()).filter(
      (app) => app.pid === window.pid && app.childCount > 0,
    );
    let fallback: { app: AtspiApp; frame: AtspiRef; score: number } | null =
      null;
    for (const app of apps) {
      const frames = await atspi
        .children(app.ref)
        .catch(() => [] as AtspiRef[]);
      for (const frame of frames) {
        const [name, extents] = await Promise.all([
          atspi.name(frame).catch(() => ""),
          atspi.extents(frame).catch(() => null),
        ]);
        if (name && name === window.title) return { app, frame };
        const sizeGap = extents
          ? Math.abs(extents.width - window.width) +
            Math.abs(extents.height - window.height)
          : 1e6;
        const titleScore = name && window.title.includes(name) ? 0 : 1;
        const score = sizeGap + titleScore * 10_000;
        if (!fallback || score < fallback.score)
          fallback = { app, frame, score };
      }
    }
    return fallback ? { app: fallback.app, frame: fallback.frame } : null;
  };

  const readSnapshot = async (
    sessionId: string,
    target: ComputerUseTarget,
    screenshotPolicy: "auto" | "always" | "never",
  ): Promise<LinuxSnapshot> => {
    const timings: Record<string, number> = {};
    const started = performance.now();
    const desktop = requireDesktop();
    const window = await findWindow(target);
    timings.window_ms = Math.round(performance.now() - started);
    sessionState(sessionId).windows.add(window.id);
    const prepared = desktop.prepareWindow(window).catch(() => undefined);
    const notes: string[] = [];
    const read: {
      treeLines: string[];
      elements: LinuxElement[];
      focused: LinuxElement | null;
      accessibility: LinuxSnapshot["accessibility"];
      appName: string;
      toolkit: string;
      screenshot: LinuxSnapshot["screenshot"];
      captureWarning: string | null;
    } = {
      treeLines: [],
      elements: [],
      focused: null,
      accessibility: "ok",
      appName: window.appId,
      toolkit: "",
      screenshot: null,
      captureWarning: null,
    };

    const treeStarted = performance.now();
    const treeTask = (async () => {
      try {
        const atspi = await atspiClient();
        const found = await findFrame(atspi, window);
        if (!found) {
          read.accessibility = "none";
          return;
        }
        if (found.app.name) read.appName = found.app.name;
        read.toolkit = found.app.toolkit;
        const tree: AtspiNode = await atspi.readTree(found.frame);
        if (
          /chrom|electron/i.test(found.app.toolkit) ||
          /chrom|electron/i.test(window.appId)
        ) {
          scaleWebContent(tree, window.scale ?? 1);
        }
        const formatted = formatTree(tree);
        read.treeLines = formatted.lines;
        read.elements = formatted.elements;
        read.focused = formatted.focused;
        if (read.elements.length <= 1) read.accessibility = "empty";
      } catch (error) {
        read.accessibility = "error";
        notes.push(
          `Reading this window's accessibility tree failed (${error instanceof Error ? error.message : String(error)}).`,
        );
      } finally {
        timings.tree_ms = Math.round(performance.now() - treeStarted);
      }
    })();

    const capture = async () => {
      const captureStarted = performance.now();
      try {
        const shot: LinuxCapture = await desktop.captureWindow(window);
        const encodeStarted = performance.now();
        const png = encodeScreenshotPng(shot.rgba, shot.width, shot.height);
        timings.encode_ms = Math.round(performance.now() - encodeStarted);
        read.screenshot = { ...shot, png };
        const file = screenshotPath(sessionId, aliasOf(target));
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, png);
      } catch (error) {
        read.captureWarning =
          error instanceof Error ? error.message : String(error);
      } finally {
        timings.capture_ms = Math.round(performance.now() - captureStarted);
      }
    };
    await prepared;
    if (screenshotPolicy === "always") {
      await Promise.all([treeTask, capture()]);
    } else {
      await treeTask;
      // "auto": a picture only when the tree cannot describe the window.
      if (screenshotPolicy === "auto" && read.accessibility !== "ok")
        await capture();
    }

    if (read.accessibility === "none") {
      notes.push(
        window.xwayland
          ? "This is an X11 (XWayland) window and its app exposes no accessibility tree on the desktop's accessibility bus. Work from the screenshot; input to it is foreground-only."
          : 'This app exposes no accessibility tree. Qt apps publish one when started with QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1, Chromium/Electron apps with --force-renderer-accessibility; GTK apps always do. Without it, work from the screenshot: clicks and keys then need delivery: "foreground" (only when the user asked Stella to take over the screen).',
      );
    } else if (read.accessibility === "empty") {
      notes.push(
        'This window\'s accessibility tree is empty. Chromium/Electron apps fill it only when started with --force-renderer-accessibility (or when a screen reader is on). Work from the screenshot meanwhile; clicks and keys then need delivery: "foreground" (only when the user asked Stella to take over the screen).',
      );
    }
    // Hyprland marks windows on hidden workspaces suspended (even with
    // render_unfocused), and Qt and Chromium stop drawing while suspended.
    if ((window.offscreen || window.minimized) && read.screenshot) {
      notes.push(
        read.accessibility === "ok"
          ? "Apps can stop drawing while their workspace is not on screen (Qt and Chromium apps do), so this screenshot can be older than the element list. Trust the elements; the picture catches up when the window is shown."
          : "Apps can stop drawing while their workspace is not on screen (Qt and Chromium apps do), so this screenshot can be older than the app's real state, and this window has no element list to check it against. If the answer depends on the picture, tell the user it may be out of date.",
      );
    }
    if (window.offscreen) {
      notes.push(
        `The window is on workspace ${window.workspace}, which is not on screen; Stella reads and acts on it there without switching workspaces.`,
      );
    }
    // GTK reports no focus inside an inactive window; the field Stella last
    // clicked or edited there is where typing goes.
    const remembered = sessionState(sessionId).focusTargets.get(window.id);
    const keyboardElement =
      read.focused ??
      (remembered
        ? (read.elements.find((element) => sameRef(element.ref, remembered)) ??
          null)
        : null);
    const focusedElement = keyboardElement;
    let selectedText: string | null = null;
    if (focusedElement?.interfaces.has("Text") && focusedElement.text) {
      try {
        const atspi = await atspiClient();
        const selection = await atspi.selection(focusedElement.ref);
        if (selection && selection.end > selection.start) {
          selectedText =
            [...focusedElement.text]
              .slice(selection.start, selection.end)
              .join("") || null;
        }
      } catch {
        // no selection info
      }
    }
    timings.total_ms = Math.round(performance.now() - started);
    return {
      window,
      appName: read.appName,
      treeLines: read.treeLines,
      elements: read.elements,
      focused: focusedElement,
      selectedText,
      notes,
      accessibility: read.accessibility,
      screenshot: read.screenshot,
      captureWarning: read.captureWarning,
      timings,
    };
  };

  const semanticLines = (snapshot: LinuxSnapshot) => {
    const lines = ["<app_state>"];
    lines.push(`App=${snapshot.window.appId} (pid ${snapshot.window.pid})`);
    lines.push(
      `Window: "${snapshot.window.title || snapshot.appName}", App: ${snapshot.appName}.`,
    );
    lines.push(
      `Window size: ${snapshot.window.width}x${snapshot.window.height}.`,
    );
    lines.push(...snapshot.treeLines);
    if (snapshot.selectedText)
      lines.push("", `Selected text: [${snapshot.selectedText}]`);
    else if (snapshot.focused) {
      lines.push(
        "",
        snapshot.focused.states.has("focused")
          ? `The focused UI element is ${snapshot.focused.index} ${snapshot.focused.role}.`
          : `Typing and keys go to ${snapshot.focused.index} ${snapshot.focused.role} (the field Stella last used in this window).`,
      );
    }
    lines.push("</app_state>");
    return lines;
  };

  const stateIdOf = (snapshot: LinuxSnapshot) =>
    `state_${sha(semanticLines(snapshot).join("\n"))}`;

  const visualStateIdOf = (snapshot: LinuxSnapshot) =>
    snapshot.screenshot ? `visual_${sha(snapshot.screenshot.png)}` : undefined;

  const displayLines = (snapshot: LinuxSnapshot) => {
    const lines = semanticLines(snapshot);
    const extra: string[] = [];
    extra.push(
      `Window id: ${snapshot.window.id} (workspace ${snapshot.window.workspace}${snapshot.window.offscreen ? ", not on screen" : ""}).`,
    );
    if (snapshot.screenshot) {
      extra.push(
        `Screenshot: ${snapshot.screenshot.width}x${snapshot.screenshot.height} window pixels (${snapshot.screenshot.method}); click x/y are in these pixels.`,
      );
    } else if (snapshot.captureWarning) {
      extra.push(`Screenshot unavailable: ${snapshot.captureWarning}`);
    }
    for (const note of snapshot.notes) extra.push(`Note: ${note}`);
    if (process.env.STELLA_COMPUTER_TIMINGS === "1") {
      extra.push(`Timings: ${JSON.stringify(snapshot.timings)}`);
    }
    lines.splice(3, 0, ...extra);
    return lines;
  };

  const diffTarget = (snapshot: LinuxSnapshot) => ({
    appName: snapshot.appName,
    bundleId: snapshot.window.appId,
    pid: snapshot.window.pid,
    windowTitle: snapshot.window.title,
    windowId: null,
    nodeCount: snapshot.elements.length,
    lineCount: semanticLines(snapshot).length,
  });

  const appState = (
    sessionId: string,
    target: ComputerUseTarget,
    snapshot: LinuxSnapshot,
    options: {
      previous?: LinuxSnapshot | null;
      disableDiff?: boolean;
      wait?: ComputerUseWaitProvenance;
      notes?: readonly string[];
    } = {},
  ): ComputerUseAppState => {
    const diff = options.previous
      ? computeStateDiff({
          previousLines: semanticLines(options.previous),
          currentLines: semanticLines(snapshot),
          previousTarget: diffTarget(options.previous),
          currentTarget: diffTarget(snapshot),
        })
      : null;
    const useDiff =
      options.disableDiff !== true && Boolean(diff && shouldUseDiffOnly(diff));
    const stateId = stateIdOf(snapshot);
    const visualStateId = visualStateIdOf(snapshot);
    const screenshot = snapshot.screenshot
      ? {
          type: "image" as const,
          url: pathToFileURL(screenshotPath(sessionId, aliasOf(target))).href,
          mimeType: "image/png",
          width: snapshot.screenshot.width,
          height: snapshot.screenshot.height,
        }
      : null;
    return {
      app: snapshot.window.appId,
      text: [
        useDiff
          ? formatStateDiffBlock(diff!).trim()
          : displayLines(snapshot).join("\n"),
        ...(options.notes ?? []).map((note) => `Note: ${note}`),
      ].join("\n"),
      stateId,
      semanticStateId: stateId,
      ...(visualStateId ? { visualStateId } : {}),
      ...(useDiff && options.previous
        ? {
            baseStateId: stateIdOf(options.previous),
            ...(visualStateIdOf(options.previous)
              ? { baseVisualStateId: visualStateIdOf(options.previous)! }
              : {}),
          }
        : {}),
      representation: useDiff ? "diff" : "full",
      ...(options.wait ? { wait: options.wait } : {}),
      screenshot,
    };
  };

  // ---------------------------------------------------------------- actions

  type Route = {
    route: string;
    delivery: "background" | "foreground";
    detail?: Record<string, unknown>;
    /** The action changes nothing the tree shows (focus, caret, selection). */
    quiet?: boolean;
  };

  const elementFor = (
    snapshot: LinuxSnapshot,
    elementId: string,
  ): LinuxElement => {
    const index = Number(elementId);
    const element = Number.isInteger(index)
      ? snapshot.elements.find((candidate) => candidate.index === index)
      : undefined;
    if (!element)
      throw new Error(`unknown element_index ${JSON.stringify(elementId)}`);
    return element;
  };

  const ancestors = (snapshot: LinuxSnapshot, element: LinuxElement) => {
    const chain: LinuxElement[] = [];
    let parent = element.parentIndex;
    while (parent !== null) {
      const next = snapshot.elements.find(
        (candidate) => candidate.index === parent,
      );
      if (!next) break;
      chain.push(next);
      parent = next.parentIndex;
    }
    return chain;
  };

  const actionIndex = async (
    atspi: AtspiClient,
    element: LinuxElement,
    wanted: string[],
  ) => {
    const live = await atspi
      .actionNames(element.ref)
      .catch(() => [...element.actions]);
    const lowered = live.map((name) => name.toLowerCase());
    for (const name of wanted) {
      const at = lowered.indexOf(name.toLowerCase());
      if (at >= 0) return { index: at, name: live[at]! };
    }
    return null;
  };

  const clickElement = async (
    sessionId: string,
    snapshot: LinuxSnapshot,
    element: LinuxElement,
    button: "left" | "right" | "middle",
    count: number,
  ): Promise<Route | null> => {
    const atspi = await atspiClient();
    const state = sessionState(sessionId);
    if (button === "right") {
      const menu = await actionIndex(atspi, element, [
        "showcontextmenu",
        "menu",
        "showmenu",
        "show menu",
        "menu.popup",
        "context menu",
        "contextmenu",
      ]);
      if (!menu) return null;
      await atspi.doAction(element.ref, menu.index);
      return { route: `atspi.action:${menu.name}`, delivery: "background" };
    }
    if (button === "middle") return null;
    const wanted =
      count >= 2
        ? [
            "activate",
            "listitem.activate",
            "open",
            "default",
            "click",
            "press",
            "jump",
          ]
        : [
            "click",
            "press",
            "check",
            "uncheck",
            "toggle",
            "jump",
            "activate",
            "listitem.activate",
            "open",
            "select",
            "invoke",
            "default",
          ];
    // A click on a text field makes it the one typing goes to. Stella does
    // not move the app's focus there (AT-SPI GrabFocus makes Chromium and
    // others activate their window, taking the user's focus); it remembers
    // the field and sends later typing and keys to it.
    if (element.states.has("editable") && count === 1) {
      state.focusTargets.set(snapshot.window.id, element.ref);
      return {
        route: "stella.keyboard_target",
        delivery: "background",
        detail: { keyboard_target: element.index },
        quiet: true,
      };
    }
    let action = await actionIndex(atspi, element, wanted);
    if (!action) {
      const visible = element.actions.filter((name) => !isInternalAction(name));
      const fallback = primaryAction(visible);
      if (fallback)
        action = {
          index: element.actions.indexOf(fallback.name),
          name: fallback.name,
        };
    }
    if (action) {
      const repeats =
        count >= 2 && !/activate|open|default/i.test(action.name) ? count : 1;
      for (let index = 0; index < repeats; index += 1) {
        await atspi.doAction(element.ref, action.index);
      }
      return { route: `atspi.action:${action.name}`, delivery: "background" };
    }
    // List items and table cells: select them through their container.
    if (element.states.has("selectable")) {
      const container = ancestors(snapshot, element).find((candidate) =>
        candidate.interfaces.has("Selection"),
      );
      if (container) {
        const at = await atspi.indexInParent(element.ref);
        const parent = await atspi.parent(element.ref);
        if (parent && sameRef(parent, container.ref) && at >= 0) {
          await atspi.selectChild(container.ref, at);
          return { route: "atspi.selection", delivery: "background" };
        }
      }
    }
    return null;
  };

  /** The element keyboard input should go to: focused, or the one Stella last used. */
  const keyboardTarget = async (sessionId: string, snapshot: LinuxSnapshot) => {
    if (snapshot.focused) return snapshot.focused;
    const remembered = sessionState(sessionId).focusTargets.get(
      snapshot.window.id,
    );
    if (!remembered) return null;
    return (
      snapshot.elements.find((element) => sameRef(element.ref, remembered)) ??
      null
    );
  };

  const typeIntoElement = async (element: LinuxElement, text: string) => {
    const atspi = await atspiClient();
    if (!element.interfaces.has("EditableText")) return false;
    const selection = await atspi.selection(element.ref).catch(() => null);
    let caret = await atspi.caretOffset(element.ref).catch(() => -1);
    if (selection && selection.end > selection.start) {
      await atspi.deleteText(element.ref, selection.start, selection.end);
      caret = selection.start;
    }
    if (caret < 0) caret = await atspi.textLength(element.ref).catch(() => 0);
    const ok = await atspi.insertText(element.ref, caret, text);
    if (ok)
      await atspi
        .setCaretOffset(element.ref, caret + [...text].length)
        .catch(() => false);
    return ok;
  };

  const pressKeyOnElement = async (
    element: LinuxElement,
    chord: LinuxKeyChord,
  ): Promise<string | null> => {
    const atspi = await atspiClient();
    const mods = new Set(chord.mods);
    const plain = mods.size === 0;
    const isText = element.interfaces.has("Text");
    const editable =
      element.interfaces.has("EditableText") && element.states.has("editable");
    if (isText) {
      const length = await atspi.textLength(element.ref);
      const caret = Math.max(
        0,
        Math.min(
          length,
          await atspi.caretOffset(element.ref).catch(() => length),
        ),
      );
      const selection = await atspi.selection(element.ref).catch(() => null);
      const hasSelection = selection && selection.end > selection.start;
      const text = async () => await atspi.text(element.ref, 0, length);
      if (mods.has("CTRL") && mods.size === 1 && chord.key === "a") {
        await atspi.setSelection(element.ref, 0, length);
        return "atspi.text.select_all";
      }
      if (
        plain &&
        (chord.key === "BackSpace" || chord.key === "Delete") &&
        editable
      ) {
        if (hasSelection)
          await atspi.deleteText(element.ref, selection.start, selection.end);
        else if (chord.key === "BackSpace" && caret > 0)
          await atspi.deleteText(element.ref, caret - 1, caret);
        else if (chord.key === "Delete" && caret < length)
          await atspi.deleteText(element.ref, caret, caret + 1);
        return `atspi.text.${chord.key.toLowerCase()}`;
      }
      if (plain && (chord.key === "Left" || chord.key === "Right")) {
        await atspi.setCaretOffset(
          element.ref,
          Math.max(
            0,
            Math.min(length, caret + (chord.key === "Left" ? -1 : 1)),
          ),
        );
        return "atspi.text.caret";
      }
      if (
        (plain || (mods.has("CTRL") && mods.size === 1)) &&
        (chord.key === "Home" || chord.key === "End")
      ) {
        let offset = chord.key === "Home" ? 0 : length;
        if (plain) {
          const value = await text();
          offset =
            chord.key === "Home"
              ? value.lastIndexOf("\n", caret - 1) + 1
              : value.indexOf("\n", caret) === -1
                ? length
                : value.indexOf("\n", caret);
        }
        await atspi.setCaretOffset(element.ref, offset);
        return "atspi.text.caret";
      }
      if (plain && chord.key === "Return") {
        if (element.states.has("multi-line") && editable) {
          await typeIntoElement(element, "\n");
          return "atspi.text.insert";
        }
        const activate = await actionIndex(atspi, element, ["activate"]);
        if (activate) {
          await atspi.doAction(element.ref, activate.index);
          return `atspi.action:${activate.name}`;
        }
        return null;
      }
      if (editable && (plain || (mods.size === 1 && mods.has("SHIFT")))) {
        const character =
          chord.key === "space"
            ? " "
            : chord.key.length === 1
              ? chord.key
              : null;
        if (character) {
          await typeIntoElement(
            element,
            mods.has("SHIFT") ? character.toUpperCase() : character,
          );
          return "atspi.text.insert";
        }
      }
      return null;
    }
    if (plain && (chord.key === "Return" || chord.key === "space")) {
      const action = await actionIndex(atspi, element, [
        "click",
        "press",
        "activate",
        "toggle",
      ]);
      if (action) {
        await atspi.doAction(element.ref, action.index);
        return `atspi.action:${action.name}`;
      }
    }
    return null;
  };

  const scrollElement = async (
    snapshot: LinuxSnapshot,
    element: LinuxElement,
    direction: "up" | "down" | "left" | "right",
    pages: number,
  ): Promise<Route | null> => {
    const atspi = await atspiClient();
    const vertical = direction === "up" || direction === "down";
    const sign = direction === "down" || direction === "right" ? 1 : -1;
    // The scroll bar for this element: in its subtree, or next to it under
    // the nearest ancestor that holds one.
    const scopes = [element, ...ancestors(snapshot, element)];
    for (const scope of scopes) {
      const bars = snapshot.elements.filter((candidate) => {
        if (candidate.role !== "scroll bar" || !candidate.value) return false;
        const orientationOk = vertical
          ? !candidate.states.has("horizontal")
          : !candidate.states.has("vertical");
        if (!orientationOk) return false;
        let parent = candidate.parentIndex;
        while (parent !== null) {
          if (parent === scope.index) return true;
          parent =
            snapshot.elements.find((other) => other.index === parent)
              ?.parentIndex ?? null;
        }
        return false;
      });
      const bar = bars[0];
      if (!bar?.value) continue;
      const viewport = scope.bounds ?? element.bounds;
      const span = bar.value.max - bar.value.min;
      const page =
        viewport && span > (vertical ? viewport.height : viewport.width)
          ? (vertical ? viewport.height : viewport.width) * 0.9
          : Math.max(bar.value.step || 0, span / 10);
      const current = await atspi
        .value(bar.ref)
        .catch(() => bar.value!.current);
      const next = Math.max(
        bar.value.min,
        Math.min(bar.value.max, current + sign * page * pages),
      );
      await atspi.setValue(bar.ref, next);
      const after = await atspi.value(bar.ref).catch(() => next);
      if (Math.abs(after - current) > 0.5 || Math.abs(next - current) < 0.5) {
        return {
          route: "atspi.scrollbar_value",
          delivery: "background",
          detail: { from: current, to: after },
        };
      }
    }
    // No settable scroll bar (web documents): bring the nearest child past
    // the edge into view. Off-screen children are not in the observation,
    // so read them live.
    const viewport = element.bounds;
    if (viewport && viewport.height > 0) {
      const children = (
        await atspi.children(element.ref).catch(() => [] as AtspiRef[])
      ).slice(0, 400);
      const placed = (
        await Promise.all(
          children.map(async (ref) => ({
            ref,
            bounds: await atspi.extents(ref).catch(() => null),
          })),
        )
      ).filter(
        (
          child,
        ): child is {
          ref: AtspiRef;
          bounds: NonNullable<typeof child.bounds>;
        } =>
          Boolean(
            child.bounds && (child.bounds.width > 0 || child.bounds.height > 0),
          ),
      );
      // Exact pages first: move a child by the viewport's size (ScrollToPoint
      // scrolls its ancestors and stops at the document's edges).
      const live =
        (await atspi.extents(element.ref).catch(() => null)) ?? viewport;
      // Live extents can be in device pixels (Chromium web content), the
      // observation's in layout pixels.
      const rawScale =
        viewport.height > 0 && live.height > 0
          ? live.height / viewport.height
          : 1;
      const anchor = placed.find(
        ({ bounds }) => bounds.width > 0 && bounds.height > 0,
      );
      if (anchor) {
        const windowHeight = snapshot.window.height * rawScale;
        const windowWidth = snapshot.window.width * rawScale;
        const visible = vertical
          ? Math.min(live.height, Math.max(0, windowHeight - live.y))
          : Math.min(live.width, Math.max(0, windowWidth - live.x));
        const distance = Math.round(visible * 0.9 * pages) * sign;
        const before =
          (await atspi.extents(anchor.ref).catch(() => null)) ?? anchor.bounds;
        const scrolled =
          distance !== 0 &&
          (await atspi
            .scrollToPoint(
              anchor.ref,
              before.x - (vertical ? 0 : distance),
              before.y - (vertical ? distance : 0),
            )
            .catch(() => false));
        if (scrolled) {
          // Chromium scrolls in its renderer and reports new positions a
          // moment later.
          let moved = 0;
          const deadline = Date.now() + SCROLL_SETTLE_MS;
          do {
            const after =
              (await atspi.extents(anchor.ref).catch(() => null)) ?? before;
            moved = vertical ? before.y - after.y : before.x - after.x;
            if (Math.abs(moved) > 1) break;
            await new Promise((resolve) => setTimeout(resolve, 30));
          } while (Date.now() < deadline);
          if (Math.abs(moved) > 1) {
            return {
              route: "atspi.scroll_to_point",
              delivery: "background",
              detail: { pixels: Math.round(moved / rawScale) },
            };
          }
          // Nothing moved and nothing lies past that edge: already there.
          const past = placed.some(({ bounds }) =>
            direction === "down"
              ? bounds.y + bounds.height > live.y + live.height + 2
              : direction === "up"
                ? bounds.y < live.y - 2
                : direction === "right"
                  ? bounds.x + bounds.width > live.x + live.width + 2
                  : bounds.x < live.x - 2,
          );
          if (!past) {
            return {
              route: "atspi.scroll_to_point",
              delivery: "background",
              detail: { pixels: 0, at_edge: true },
            };
          }
        }
      }
      let moved = 0;
      for (let page = 0; page < pages; page += 1) {
        const live =
          (await atspi.extents(element.ref).catch(() => viewport)) ?? viewport;
        const current = await Promise.all(
          placed.map(async (child) => ({
            ...child,
            bounds:
              (await atspi.extents(child.ref).catch(() => null)) ??
              child.bounds,
          })),
        );
        const candidates = current.filter(({ bounds }) =>
          direction === "down"
            ? bounds.y >= live.y + live.height - 2
            : direction === "up"
              ? bounds.y + bounds.height <= live.y + 2
              : direction === "right"
                ? bounds.x >= live.x + live.width - 2
                : bounds.x + bounds.width <= live.x + 2,
        );
        const next =
          direction === "down" || direction === "right"
            ? candidates.sort((a, b) =>
                vertical ? a.bounds.y - b.bounds.y : a.bounds.x - b.bounds.x,
              )[0]
            : candidates.sort((a, b) =>
                vertical ? b.bounds.y - a.bounds.y : b.bounds.x - a.bounds.x,
              )[0];
        if (!next) break;
        const ok = await atspi
          // Down: the next child's top goes to the top (about one page);
          // up: the previous child's bottom goes to the bottom.
          .scrollTo(
            next.ref,
            sign > 0
              ? vertical
                ? ATSPI_SCROLL.topEdge
                : ATSPI_SCROLL.leftEdge
              : vertical
                ? ATSPI_SCROLL.bottomEdge
                : ATSPI_SCROLL.rightEdge,
          )
          .catch(() => false);
        if (!ok) break;
        moved += 1;
      }
      if (moved > 0)
        return {
          route: "atspi.scroll_to",
          delivery: "background",
          detail: { steps: moved },
        };
    }
    return null;
  };

  const selectText = async (
    element: LinuxElement,
    action: Extract<
      ComputerUseActionCommand["action"],
      { type: "select_text" }
    >,
  ): Promise<Route> => {
    const atspi = await atspiClient();
    if (!element.interfaces.has("Text")) {
      throw new Error(
        `Element ${element.index} (${element.role}) has no text to select.`,
      );
    }
    const value = await atspi.text(element.ref);
    const needle = `${action.prefix ?? ""}${action.text}${action.suffix ?? ""}`;
    const at = value.indexOf(needle);
    if (at < 0)
      throw new Error(
        `"${action.text}" was not found in element ${element.index}.`,
      );
    // Offsets are in characters, not UTF-16 units.
    const start = [...value.slice(0, at + (action.prefix ?? "").length)].length;
    const end = start + [...action.text].length;
    if (action.selectionType === "cursor-before")
      await atspi.setCaretOffset(element.ref, start);
    else if (action.selectionType === "cursor-after")
      await atspi.setCaretOffset(element.ref, end);
    else await atspi.setSelection(element.ref, start, end);
    return {
      route: "atspi.text.selection",
      delivery: "background",
      detail: { start, end },
      quiet: true,
    };
  };

  const setValue = async (
    element: LinuxElement,
    value: string,
  ): Promise<Route | null> => {
    const atspi = await atspiClient();
    if (element.interfaces.has("EditableText")) {
      if (await atspi.setTextContents(element.ref, value)) {
        await atspi
          .setCaretOffset(element.ref, [...value].length)
          .catch(() => false);
        return { route: "atspi.editable_text", delivery: "background" };
      }
    }
    if (element.interfaces.has("Value")) {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw new Error(
          `Element ${element.index} takes a number; got ${JSON.stringify(value)}.`,
        );
      }
      await atspi.setValue(element.ref, number);
      return { route: "atspi.value", delivery: "background" };
    }
    return null;
  };

  const withForeground = async <T>(
    window: LinuxWindow,
    run: (desktop: LinuxDesktop) => Promise<T>,
  ): Promise<{ result: T; restored: Record<string, unknown> }> => {
    const desktop = requireDesktop();
    const before = await desktop.foreground.snapshot();
    let result: T;
    try {
      await desktop.foreground.focus(window);
      result = await run(desktop);
    } finally {
      // Give the app a moment to take the input before focus moves away.
      await new Promise((resolve) => setTimeout(resolve, 60));
      await desktop.foreground.restore(before).catch(() => undefined);
    }
    const [windowNow, pointerNow] = await Promise.all([
      desktop.focusedWindowId().catch(() => null),
      desktop.pointer(),
    ]);
    return {
      result,
      restored: {
        window: before.windowId === windowNow,
        pointer:
          !before.pointer ||
          !pointerNow ||
          (Math.abs(before.pointer.x - pointerNow.x) <= 1 &&
            Math.abs(before.pointer.y - pointerNow.y) <= 1),
      },
    };
  };

  const executeAction = async (
    sessionId: string,
    command: ComputerUseActionCommand,
    snapshot: LinuxSnapshot,
  ): Promise<Route> => {
    const delivery = command.delivery ?? "background";
    const window = snapshot.window;
    const action = command.action;
    const toScreen = (point: ComputerUsePoint) => ({
      x: window.x + point.x,
      y: window.y + point.y,
    });
    const foregroundRoute = async (
      name: string,
      run: (desktop: LinuxDesktop) => Promise<void>,
    ) => {
      const { restored } = await withForeground(window, run);
      return {
        route: name,
        delivery: "foreground" as const,
        detail: { restored },
      };
    };

    switch (action.type) {
      case "click_element": {
        const element = elementFor(snapshot, action.elementId);
        const route = await clickElement(
          sessionId,
          snapshot,
          element,
          action.mouseButton,
          action.clickCount,
        );
        if (route) return route;
        if (
          delivery === "foreground" &&
          element.bounds &&
          element.bounds.width > 0
        ) {
          const center = {
            x: element.bounds.x + element.bounds.width / 2,
            y: element.bounds.y + element.bounds.height / 2,
          };
          return await foregroundRoute(
            "wayland.virtual_pointer",
            async (desktop) => {
              const point = toScreen(center);
              await desktop.foreground.movePointer(point.x, point.y);
              await desktop.foreground.click(
                action.mouseButton,
                action.clickCount,
              );
            },
          );
        }
        throw backgroundUnavailable(
          `Element ${element.index} (${element.role}${element.name ? ` "${element.name}"` : ""}) exposes no accessibility action for a ${action.mouseButton} click, and Hyprland cannot send a pointer click to a window in the background.`,
        );
      }
      case "click_point": {
        if (delivery !== "foreground") {
          const hit = elementAtPoint(
            snapshot.elements,
            action.point.x,
            action.point.y,
          );
          const target =
            hit &&
            [hit, ...ancestors(snapshot, hit)].find(
              (candidate) =>
                candidate.actions.some((name) => !isInternalAction(name)) ||
                candidate.states.has("editable") ||
                candidate.states.has("selectable"),
            );
          if (target) {
            const route = await clickElement(
              sessionId,
              snapshot,
              target,
              action.mouseButton,
              action.clickCount,
            );
            if (route) {
              return {
                ...route,
                route: `${route.route} (hit ${target.index} ${target.role})`,
                detail: { hit_element: target.index },
              };
            }
          }
          throw backgroundUnavailable(
            `Hyprland cannot send a pointer click to a window in the background, and nothing at (${Math.round(action.point.x)}, ${Math.round(action.point.y)}) exposes an accessibility action${hit ? ` (the point is on ${hit.index} ${hit.role})` : ""}.`,
          );
        }
        return await foregroundRoute(
          "wayland.virtual_pointer",
          async (desktop) => {
            const point = toScreen(action.point);
            await desktop.foreground.movePointer(point.x, point.y);
            await desktop.foreground.click(
              action.mouseButton,
              action.clickCount,
            );
          },
        );
      }
      case "drag": {
        if (delivery !== "foreground") {
          throw backgroundUnavailable(
            "Hyprland cannot send a pointer drag to a window in the background. For a slider, use set_value on it.",
          );
        }
        return await foregroundRoute(
          "wayland.virtual_pointer.drag",
          async (desktop) => {
            await desktop.foreground.drag([
              toScreen(action.from),
              toScreen(action.to),
            ]);
          },
        );
      }
      case "perform_secondary_action": {
        const element = elementFor(snapshot, action.elementId);
        const atspi = await atspiClient();
        const wanted = action.action.trim();
        if (/^(focus|grab_?focus|set ?focus)$/i.test(wanted)) {
          sessionState(sessionId).focusTargets.set(window.id, element.ref);
          return {
            route: "stella.keyboard_target",
            delivery: "background",
            detail: { keyboard_target: element.index },
            quiet: true,
          };
        }
        if (/^(scroll_?to|scroll into view|show)$/i.test(wanted)) {
          if (await atspi.scrollTo(element.ref, ATSPI_SCROLL.anywhere)) {
            return { route: "atspi.scroll_to", delivery: "background" };
          }
        }
        const found = await actionIndex(atspi, element, [wanted]);
        if (!found) {
          const available = element.actions.filter(
            (name) => !isInternalAction(name),
          );
          throw new Error(
            `Element ${element.index} has no action "${wanted}". Its actions: ${available.length > 0 ? available.join(", ") : "none"} (plus focus and scroll_to).`,
          );
        }
        await atspi.doAction(element.ref, found.index);
        return { route: `atspi.action:${found.name}`, delivery: "background" };
      }
      case "set_value": {
        const element = elementFor(snapshot, action.elementId);
        const route = await setValue(element, action.value);
        if (route) {
          sessionState(sessionId).focusTargets.set(window.id, element.ref);
          return route;
        }
        if (element.states.has("editable")) {
          if (
            delivery === "foreground" &&
            element.bounds &&
            element.bounds.width > 0
          ) {
            const center = toScreen({
              x: element.bounds.x + Math.min(element.bounds.width / 2, 40),
              y: element.bounds.y + element.bounds.height / 2,
            });
            return await foregroundRoute(
              "wayland.virtual_pointer+hyprland.keys",
              async (desktop) => {
                await desktop.foreground.movePointer(center.x, center.y);
                await desktop.foreground.click("left", 1);
                await desktop.foreground.pressKey(window, {
                  mods: ["CTRL"],
                  key: "a",
                });
                if (action.value)
                  await desktop.foreground.typeText(window, action.value);
                else
                  await desktop.foreground.pressKey(window, {
                    mods: [],
                    key: "BackSpace",
                  });
              },
            );
          }
          throw backgroundUnavailable(
            `Element ${element.index} (${element.role}) is a text field this app does not let accessibility edit (Chromium and Electron publish no editable-text interface on Linux), and Hyprland only delivers keystrokes to the focused window. For a web page, Stella's browser tools can fill it.`,
          );
        }
        throw new Error(
          `Element ${element.index} (${element.role}) has no editable text or value. Click it and use type_text, or pick a text field.`,
        );
      }
      case "select_text": {
        const element = elementFor(snapshot, action.elementId);
        const route = await selectText(element, action);
        sessionState(sessionId).focusTargets.set(window.id, element.ref);
        return route;
      }
      case "scroll": {
        const element = elementFor(snapshot, action.elementId);
        const route = await scrollElement(
          snapshot,
          element,
          action.direction,
          action.pages,
        );
        if (route) return route;
        if (delivery === "foreground") {
          const bounds = element.bounds ?? {
            x: 0,
            y: 0,
            width: window.width,
            height: window.height,
          };
          const distance =
            (action.direction === "up" || action.direction === "down"
              ? bounds.height
              : bounds.width) *
            0.9 *
            action.pages;
          const dx =
            action.direction === "left"
              ? -distance
              : action.direction === "right"
                ? distance
                : 0;
          const dy =
            action.direction === "up"
              ? -distance
              : action.direction === "down"
                ? distance
                : 0;
          return await foregroundRoute(
            "wayland.virtual_pointer.wheel",
            async (desktop) => {
              const center = toScreen({
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2,
              });
              await desktop.foreground.movePointer(center.x, center.y);
              await desktop.foreground.scroll(dx, dy);
            },
          );
        }
        throw backgroundUnavailable(
          `Element ${element.index} (${element.role}) has no scroll bar Stella can move through accessibility, and Hyprland cannot send scroll input to a window in the background.`,
        );
      }
      case "type_text": {
        const element = await keyboardTarget(sessionId, snapshot);
        if (
          element?.interfaces.has("EditableText") &&
          (await typeIntoElement(element, action.text))
        ) {
          return {
            route: "atspi.editable_text.insert",
            delivery: "background",
            detail: { element: element.index },
          };
        }
        if (delivery === "foreground") {
          return await foregroundRoute("hyprland.keys", async (desktop) => {
            await desktop.foreground.typeText(window, action.text);
          });
        }
        throw backgroundUnavailable(
          element
            ? `The element taking keyboard input (${element.index} ${element.role}) cannot be edited through accessibility${element.states.has("editable") ? " (Chromium and Electron publish no editable-text interface on Linux)" : ""}, and Hyprland only delivers keystrokes to the focused window.`
            : "Stella does not know which text field in this window takes the typing (click a text field by element_index first, or use set_value), and Hyprland only delivers keystrokes to the focused window.",
        );
      }
      case "press_key": {
        const chord = parseKeyChord(action.key);
        const element = await keyboardTarget(sessionId, snapshot);
        if (element) {
          const route = await pressKeyOnElement(element, chord);
          if (route)
            return {
              route,
              delivery: "background",
              detail: { element: element.index },
            };
        }
        if (delivery === "foreground") {
          return await foregroundRoute("hyprland.keys", async (desktop) => {
            await desktop.foreground.pressKey(window, chord);
          });
        }
        throw backgroundUnavailable(
          `Hyprland only delivers key presses to the focused window, and ${element ? `the element taking keyboard input (${element.index} ${element.role}) has no accessibility equivalent for ${action.key}` : `Stella knows no element in this window to apply ${action.key} to`}. In the background Stella can edit text (Backspace, Delete, arrows, Home/End, Ctrl+A, Enter in a field) and press buttons with Return/space; shortcuts like Ctrl+S need the menu item (element_index) instead.`,
        );
      }
    }
  };

  // --------------------------------------------------------------- requests

  const withSessionLock = async <T>(
    sessionId: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    const state = sessionState(sessionId);
    const previous = state.tail;
    let release!: () => void;
    state.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      release();
    }
  };

  const validateLive = async (
    sessionId: string,
    command: ComputerUseActionCommand,
  ): Promise<LinuxSnapshot> => {
    const observedStateId = command.observedStateId;
    if (!observedStateId) {
      throw new Error(
        `${command.action.type} requires observedStateId before dispatch.`,
      );
    }
    const alias = aliasOf(command.target);
    const state = sessionState(sessionId);
    const observed = state.committed.has(alias)
      ? (state.snapshots.get(alias) ?? null)
      : null;
    if (!observed) {
      throw new Error(
        `No app state is available for ${alias}. Call get_app_state before sending actions.`,
      );
    }
    const coordinates = isCoordinateAction(command);
    const windowOnly = command.staleCheck === "window";
    if (coordinates) {
      const latestVisual = visualStateIdOf(observed);
      if (
        command.observedVisualStateId &&
        latestVisual !== command.observedVisualStateId
      ) {
        throw new ComputerUseResourceStaleError(
          command.observedVisualStateId,
          latestVisual ?? "visual_state_unavailable",
          {
            nativeReason: "a newer observation of this window exists",
            hint: "Use the observation_id and coordinates from the latest get_app_state of this window.",
          },
        );
      }
      if (!observed.screenshot && !windowOnly) {
        throw new Error(
          'Coordinates need a screenshot: call get_app_state with screenshot_policy: "always" first and pick the point from that screenshot.',
        );
      }
    } else if (stateIdOf(observed) !== observedStateId) {
      throw new ComputerUseResourceStaleError(
        observedStateId,
        stateIdOf(observed),
      );
    }
    const live = await readSnapshot(
      sessionId,
      command.target,
      coordinates && !windowOnly ? "always" : "never",
    );
    if (
      live.window.id !== observed.window.id ||
      live.window.pid !== observed.window.pid
    ) {
      throw new ComputerUseResourceStaleError(
        observedStateId,
        stateIdOf(live),
        {
          nativeReason: "the target window was replaced",
          hint: "Call get_app_state again and act on the new window.",
        },
      );
    }
    if (!coordinates) {
      if (windowOnly) return live;
      if (stateIdOf(live) !== observedStateId) {
        throw new ComputerUseResourceStaleError(
          observedStateId,
          stateIdOf(live),
        );
      }
      return live;
    }
    if (
      Math.abs(observed.window.width - live.window.width) > 1 ||
      Math.abs(observed.window.height - live.window.height) > 1
    ) {
      throw new ComputerUseResourceStaleError(
        command.observedVisualStateId ?? observedStateId,
        stateIdOf(live),
        {
          nativeReason: `the window was resized from ${observed.window.width}x${observed.window.height} to ${live.window.width}x${live.window.height}`,
          hint: COORDINATE_STALE_HINT,
        },
      );
    }
    if (windowOnly) return live;
    if (!live.screenshot || !observed.screenshot) {
      throw new Error(
        `Stella could not take the screenshot needed to check the window before this ${command.action.type}: ${live.captureWarning ?? "no pixels"}. Pass stale_check: "window" to act without that check.`,
      );
    }
    const change = coordinatePixelChange(
      observed.screenshot,
      live.screenshot,
      actionPoints(command),
    );
    if (change) {
      throw new ComputerUseResourceStaleError(
        command.observedVisualStateId ?? observedStateId,
        visualStateIdOf(live) ?? "visual_state_unavailable",
        { nativeReason: change, hint: COORDINATE_STALE_HINT },
      );
    }
    return live;
  };

  const receiptFor = (
    command: ComputerUseActionCommand,
    route: Route,
    timings: Record<string, number>,
  ): ComputerUseActionReceipt => ({
    type: "action",
    action: command.action.type,
    target: command.target,
    status: "completed",
    deferred: false,
    details: jsonObject({
      receipt: {
        route: route.route,
        delivery: route.delivery,
        ...(route.detail ?? {}),
      },
      delivery: route.delivery,
      timings,
    }),
  });

  /**
   * Safety net for background actions: if the target window took the user's
   * focus anyway (an app activating itself), give it straight back. Only a
   * move to the target window counts, so the user's own clicks are never
   * undone.
   */
  const guardUserFocus = async (
    desktop: LinuxDesktop,
    before: LinuxFocusSnapshot,
    target: LinuxWindow,
  ): Promise<string | null> => {
    for (const delay of [0, 30]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const now = await desktop.focusedWindowId().catch(() => before.windowId);
      if (now === target.id && before.windowId !== target.id) {
        await desktop.foreground.restore(before).catch(() => undefined);
        return "restored_user_focus";
      }
    }
    return null;
  };

  const runAction = async (
    sessionId: string,
    command: ComputerUseActionCommand,
    live?: LinuxSnapshot,
  ) => {
    const started = performance.now();
    const snapshot = live ?? (await validateLive(sessionId, command));
    const validated = performance.now();
    const desktop = requireDesktop();
    const background = (command.delivery ?? "background") === "background";
    if (background)
      await desktop.prepareWindow(snapshot.window).catch(() => undefined);
    const userBefore = background
      ? await desktop.foreground.snapshot().catch(() => null)
      : null;
    const route = await executeAction(sessionId, command, snapshot);
    if (userBefore && route.delivery === "background") {
      const guard = await guardUserFocus(desktop, userBefore, snapshot.window);
      if (guard) route.detail = { ...(route.detail ?? {}), focus_guard: guard };
    }
    if (route.quiet)
      sessionState(sessionId).recentActions.delete(snapshot.window.id);
    else
      sessionState(sessionId).recentActions.set(snapshot.window.id, {
        at: Date.now(),
        stateId: stateIdOf(snapshot),
      });
    const done = performance.now();
    return receiptFor(command, route, {
      validate_ms: Math.round(validated - started),
      dispatch_ms: Math.round(done - validated),
    });
  };

  /**
   * Apps apply an action's effect to their accessibility tree a little later
   * (a GTK button reports its click when its 250 ms press animation ends).
   * Right after an action, an observation waits
   * until the tree moves off the acted-on state and holds still, so agents
   * see the result without sleeping.
   */
  const settle = async (
    sessionId: string,
    target: ComputerUseTarget,
    policy: "auto" | "always" | "never",
    first: LinuxSnapshot,
  ): Promise<LinuxSnapshot> => {
    const state = sessionState(sessionId);
    const recent = state.recentActions.get(first.window.id);
    if (!recent) return first;
    state.recentActions.delete(first.window.id);
    const started = Date.now();
    const changeDeadline = recent.at + SETTLE_CHANGE_MS;
    let current = first;
    let reread = false;
    while (
      Date.now() < changeDeadline &&
      stateIdOf(current) === recent.stateId
    ) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
      current = await readSnapshot(sessionId, target, "never");
      reread = true;
    }
    if (stateIdOf(current) !== recent.stateId) {
      const stableDeadline = Date.now() + SETTLE_STABLE_MAX_MS;
      while (Date.now() < stableDeadline) {
        await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
        const next = await readSnapshot(sessionId, target, "never");
        reread = true;
        const same = stateIdOf(next) === stateIdOf(current);
        current = next;
        if (same) break;
      }
    }
    if (reread && policy !== "never")
      current = await readSnapshot(sessionId, target, policy);
    current.timings.settle_ms = Date.now() - started;
    return current;
  };

  const handle = async (
    request: ComputerUseRequest,
    signal?: AbortSignal,
  ): Promise<ComputerUseResponse> => {
    const sessionId = request.sessionId;
    const state = sessionState(sessionId);
    if (request.type === "list_apps" || request.type === "list_windows") {
      const desktop = requireDesktop();
      const [windows, focusedId] = await Promise.all([
        desktop.listWindows(),
        desktop.focusedWindowId().catch(() => null),
      ]);
      const atspi = await atspiClient().catch(() => null);
      const accessiblePids = new Set(
        ((await atspi?.apps().catch(() => [])) ?? [])
          .filter((app) => app.childCount > 0)
          .map((app) => app.pid),
      );
      if (request.type === "list_windows") {
        const lines = windows.map(
          (window) =>
            `window_id=${window.id} app=${window.appId} pid=${window.pid} title=${JSON.stringify(window.title)} size=${window.width}x${window.height} workspace=${window.workspace}${window.offscreen ? " (not on screen)" : ""}${window.id === focusedId ? " [user's focused window]" : ""}${accessiblePids.has(window.pid) ? "" : " [no accessibility tree]"}`,
        );
        return {
          ...responseEnvelope(request),
          type: "list_windows",
          text: lines.length > 0 ? lines.join("\n") : "No windows are open.",
        };
      }
      const apps = new Map<
        string,
        { pid: number; count: number; titles: string[] }
      >();
      for (const window of windows) {
        const entry = apps.get(window.appId) ?? {
          pid: window.pid,
          count: 0,
          titles: [],
        };
        entry.count += 1;
        entry.titles.push(window.title);
        apps.set(window.appId, entry);
      }
      const lines = [...apps.entries()].map(
        ([appId, entry]) =>
          `${appId} (pid ${entry.pid}, ${readProcessName(entry.pid) || "?"}) — ${entry.count} window${entry.count === 1 ? "" : "s"}: ${entry.titles.map((title) => JSON.stringify(title)).join(", ")}${accessiblePids.has(entry.pid) ? "" : " [no accessibility tree]"}`,
      );
      return {
        ...responseEnvelope(request),
        type: "list_apps",
        text:
          lines.length > 0 ? lines.join("\n") : "No apps have open windows.",
      };
    }

    if (request.type === "resolve_target") {
      const window = await findWindow(request.selector);
      const kind = protectedKind(window);
      return {
        ...responseEnvelope(request),
        type: "target_policy",
        policy: {
          bundleIdentifier:
            kind === "stella" ? `com.stella.${window.appId}` : window.appId,
          displayName:
            kind === "stella"
              ? "Stella"
              : readProcessName(window.pid) || window.appId,
          decision: kind ? "forbidden" : "allowed",
          allowPersistentApproval: !kind,
        },
      };
    }

    if (request.type === "get_app_state") {
      const alias = aliasOf(request.target);
      const previous = state.committed.has(alias)
        ? (state.snapshots.get(alias) ?? null)
        : null;
      const snapshot = await settle(
        sessionId,
        request.target,
        request.screenshotPolicy,
        await readSnapshot(sessionId, request.target, request.screenshotPolicy),
      );
      state.snapshots.set(alias, snapshot);
      state.committed.add(alias);
      return {
        ...responseEnvelope(request),
        type: "app_state",
        state: appState(sessionId, request.target, snapshot, {
          previous,
          disableDiff: request.disableDiff,
        }),
      };
    }

    if (request.type === "wait_for_change") {
      const alias = aliasOf(request.target);
      const baseline = state.committed.has(alias)
        ? (state.snapshots.get(alias) ?? null)
        : null;
      if (!baseline) {
        throw new Error(
          `No baseline state is available for ${alias}. Call get_app_state before wait_for_change.`,
        );
      }
      if (stateIdOf(baseline) !== request.afterStateId) {
        throw new ComputerUseResourceStaleError(
          request.afterStateId,
          stateIdOf(baseline),
        );
      }
      if (
        request.afterVisualStateId &&
        visualStateIdOf(baseline) !== request.afterVisualStateId
      ) {
        throw new ComputerUseResourceStaleError(
          request.afterVisualStateId,
          visualStateIdOf(baseline) ?? "visual_state_unavailable",
        );
      }
      const started = Date.now();
      let polls = 0;
      while (Date.now() - started < request.timeoutMs) {
        if (signal?.aborted)
          throw signal.reason ?? new Error("Computer-use wait aborted.");
        polls += 1;
        const polled = await readSnapshot(
          sessionId,
          request.target,
          request.afterVisualStateId ? "always" : "never",
        );
        const kinds: Array<"semantic" | "visual"> = [];
        if (stateIdOf(polled) !== stateIdOf(baseline)) kinds.push("semantic");
        if (
          request.afterVisualStateId &&
          visualStateIdOf(polled) !== request.afterVisualStateId
        ) {
          kinds.push("visual");
        }
        if (kinds.length > 0) {
          const final =
            request.screenshotPolicy === "always" && !polled.screenshot
              ? await readSnapshot(sessionId, request.target, "always")
              : polled;
          state.snapshots.set(alias, final);
          state.committed.add(alias);
          return {
            ...responseEnvelope(request),
            type: "wait_for_change",
            state: appState(sessionId, request.target, final, {
              previous: baseline,
              disableDiff: request.disableDiff,
              wait: {
                afterStateId: request.afterStateId,
                ...(request.afterVisualStateId
                  ? { afterVisualStateId: request.afterVisualStateId }
                  : {}),
                timeoutMs: request.timeoutMs,
                elapsedMs: Date.now() - started,
                pollCount: polls,
                changeKinds: kinds,
              },
            }),
          };
        }
        const remaining = request.timeoutMs - (Date.now() - started);
        if (remaining > 0)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(150, remaining)),
          );
      }
      throw new LinuxWaitTimeoutError(
        request.timeoutMs,
        Date.now() - started,
        polls,
        request.afterStateId,
        request.afterVisualStateId,
      );
    }

    if (request.type === "action") {
      return {
        ...responseEnvelope(request),
        type: "action",
        receipt: await runAction(sessionId, request.command),
      };
    }

    // batch: every command is checked against the live app before any runs.
    // Elements are AT-SPI objects, so later commands still address what
    // the shared observation showed even after earlier ones changed the UI.
    const lives: LinuxSnapshot[] = [];
    for (const command of request.commands)
      lives.push(await validateLive(sessionId, command));
    const receipts: ComputerUseActionReceipt[] = [];
    // Toolkits ignore a second press of a button while the first one is
    // still running (GTK animates a press for 250 ms), so a repeated click
    // on one element waits for the previous one to show in the tree.
    const repeatsNext = (index: number) => {
      const current = request.commands[index]?.action;
      const next = request.commands[index + 1]?.action;
      return (
        current?.type === "click_element" &&
        next?.type === "click_element" &&
        current.elementId === next.elementId &&
        lives[index]?.window.id === lives[index + 1]?.window.id
      );
    };
    for (const [index, command] of request.commands.entries()) {
      try {
        const base = repeatsNext(index)
          ? stateIdOf(await readSnapshot(sessionId, command.target, "never"))
          : null;
        receipts.push(await runAction(sessionId, command, lives[index]));
        if (base) {
          const deadline = Date.now() + SETTLE_CHANGE_MS;
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
            if (
              stateIdOf(
                await readSnapshot(sessionId, command.target, "never"),
              ) !== base
            )
              break;
          }
        }
      } catch (error) {
        if (index > 0 && error instanceof Error) {
          error.message = `Batch command ${index} of ${request.commands.length} failed; commands 0-${index - 1} were already delivered. ${error.message}`;
        }
        throw error;
      }
    }
    return {
      ...responseEnvelope(request),
      type: "batch",
      receipt: { type: "batch", receipts },
    };
  };

  const request: ComputerUseSession["request"] = async (
    typedRequest,
    requestOptions,
  ) => {
    assertComputerUseRequest(typedRequest);
    const signal = requestOptions?.signal;
    return await arbiter.runRequest(
      typedRequest,
      signal,
      async () =>
        await withSessionLock(typedRequest.sessionId, async () => {
          try {
            // A hung app or compositor must never hang the agent.
            const limitMs =
              typedRequest.type === "wait_for_change"
                ? typedRequest.timeoutMs + 15_000
                : 30_000;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              return await Promise.race([
                handle(typedRequest, signal),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(
                    () =>
                      reject(
                        new Error(
                          `The app or the desktop did not answer within ${Math.round(limitMs / 1000)} s; it may be busy or hung. Observe again, or tell the user the app is not responding.`,
                        ),
                      ),
                    limitMs,
                  );
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
          } catch (error) {
            const aborted =
              signal?.aborted ||
              (error instanceof Error && error.name === "AbortError");
            const stale = error instanceof ComputerUseResourceStaleError;
            const waitTimeout = error instanceof LinuxWaitTimeoutError;
            const inputError = error instanceof LinuxInputError;
            const unavailable = error instanceof LinuxDesktopUnavailableError;
            return errorResponse(
              typedRequest,
              aborted
                ? "request_aborted"
                : stale || waitTimeout || inputError
                  ? error.code
                  : unavailable
                    ? "desktop_unsupported"
                    : "linux_session_failed",
              error instanceof Error ? error.message : String(error),
              stale || waitTimeout,
              stale
                ? jsonObject({
                    observed_state_id: error.observedStateId,
                    current_state_id: error.currentStateId,
                    resource_keys: error.resourceKeys ?? [],
                    observed_resource_generation:
                      error.observedResourceGeneration ?? null,
                    current_resource_generation:
                      error.currentResourceGeneration ?? null,
                  })
                : waitTimeout
                  ? jsonObject({
                      after_state_id: error.afterStateId,
                      after_visual_state_id: error.afterVisualStateId ?? null,
                      timeout_ms: error.timeoutMs,
                      elapsed_ms: error.elapsedMs,
                      poll_count: error.pollCount,
                    })
                  : undefined,
            );
          }
        }),
    );
  };

  return Object.freeze({ request });
};
