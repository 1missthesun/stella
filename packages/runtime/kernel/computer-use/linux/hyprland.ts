import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import { WaylandVirtualPointer } from "./virtual-pointer.js";
import {
  LinuxDesktopUnavailableError,
  type LinuxCapture,
  type LinuxDesktop,
  type LinuxFocusSnapshot,
  type LinuxKeyChord,
  type LinuxWindow,
} from "./desktop.js";

/**
 * Hyprland: window list, focus and pointer over its control socket, single
 * window capture with `grim -T` (ext-image-copy-capture of one toplevel,
 * which works for covered windows and windows on other workspaces), and
 * foreground input through Hyprland's own dispatchers (focus, cursor move,
 * send_shortcut / send_key_state).
 *
 * Stock Hyprland cannot deliver pointer input to a window that does not
 * have the pointer, and only delivers keys to an unfocused window by
 * handing it the keyboard focus for the duration of the key, which the
 * user's window notices (it gets a focus-out/in). So the background routes
 * are AT-SPI only; this file is used for raw input only when an action asks
 * for delivery: "foreground".
 */

type HyprClient = {
  address: string;
  mapped: boolean;
  hidden: boolean;
  at: [number, number];
  size: [number, number];
  workspace: { id: number; name: string };
  floating: boolean;
  monitor: number;
  class: string;
  title: string;
  pid: number;
  xwayland: boolean;
  fullscreen: number | boolean;
  focusHistoryID: number;
  stableId?: string;
};

type HyprMonitor = {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  activeWorkspace: { id: number; name: string };
  specialWorkspace: { id: number; name: string };
  focused: boolean;
};

type Dispatch = { lua: string; legacy: string };

const REQUEST_TIMEOUT_MS = 1_500;
const CAPTURE_TIMEOUT_MS = 5_000;
const HIDDEN_CATCH_UP_MS = 300;
/** Tag Stella toggles to make Hyprland re-evaluate a window's rules. */
const RULE_REFRESH_TAG = "stella-computer-use";

const luaString = (value: string) =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export type HyprlandInstance = { socket: string; waylandDisplay: string };

const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * The Hyprland session Stella runs in: from HYPRLAND_INSTANCE_SIGNATURE, or,
 * when Stella was started without the session's environment, the one live
 * instance in the user's runtime directory (none when there are several).
 * Hyprland's lock file names its pid and Wayland socket.
 */
export const findHyprlandInstance = (): HyprlandInstance | null => {
  const runtimeDir = process.env.XDG_RUNTIME_DIR?.trim();
  if (!runtimeDir) return null;
  const root = path.join(runtimeDir, "hypr");
  const read = (signature: string) => {
    const dir = path.join(root, signature);
    const socket = path.join(dir, ".socket.sock");
    if (!existsSync(socket)) return null;
    let lock: string[] = [];
    try {
      lock = readFileSync(path.join(dir, "hyprland.lock"), "utf8")
        .split("\n")
        .map((line) => line.trim());
    } catch {
      // older Hyprland: no lock file
    }
    const pid = Number(lock[0]);
    return {
      socket,
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
      wlSocket: lock[1] || null,
    };
  };
  const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE?.trim();
  if (signature) {
    const instance = read(signature);
    const waylandDisplay =
      process.env.WAYLAND_DISPLAY?.trim() || instance?.wlSocket;
    return instance && waylandDisplay
      ? { socket: instance.socket, waylandDisplay }
      : null;
  }
  let candidates: string[] = [];
  try {
    candidates = readdirSync(root);
  } catch {
    return null;
  }
  const live = candidates
    .map(read)
    .filter((instance): instance is NonNullable<typeof instance> =>
      Boolean(instance?.pid && instance.wlSocket && processAlive(instance.pid)),
    );
  if (live.length !== 1) return null;
  return { socket: live[0]!.socket, waylandDisplay: live[0]!.wlSocket! };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Decodes grim's binary PPM (P6, maxval 255). */
const decodePpm = (bytes: Buffer) => {
  let offset = 0;
  const tokens: string[] = [];
  while (tokens.length < 4) {
    while (
      offset < bytes.length &&
      /\s/.test(String.fromCharCode(bytes[offset]!))
    )
      offset += 1;
    if (bytes[offset] === 0x23) {
      while (offset < bytes.length && bytes[offset] !== 0x0a) offset += 1;
      continue;
    }
    const start = offset;
    while (
      offset < bytes.length &&
      !/\s/.test(String.fromCharCode(bytes[offset]!))
    )
      offset += 1;
    tokens.push(bytes.toString("latin1", start, offset));
  }
  offset += 1;
  const [magic, w, h, max] = tokens;
  const width = Number(w);
  const height = Number(h);
  if (magic !== "P6" || Number(max) !== 255 || !(width > 0) || !(height > 0)) {
    throw new Error("grim returned an image Stella cannot read.");
  }
  return {
    width,
    height,
    rgb: bytes.subarray(offset, offset + width * height * 3),
  };
};

/** Area-averaged resize of packed RGB to RGBA. */
const resizeRgbToRgba = (
  rgb: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Uint8Array => {
  const out = new Uint8Array(width * height * 4);
  if (width === sourceWidth && height === sourceHeight) {
    for (
      let source = 0, target = 0;
      target < out.length;
      source += 3, target += 4
    ) {
      out[target] = rgb[source]!;
      out[target + 1] = rgb[source + 1]!;
      out[target + 2] = rgb[source + 2]!;
      out[target + 3] = 255;
    }
    return out;
  }
  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(
      y0 + 1,
      Math.min(sourceHeight, Math.floor((y + 1) * scaleY)),
    );
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(
        x0 + 1,
        Math.min(sourceWidth, Math.floor((x + 1) * scaleX)),
      );
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        let index = (sy * sourceWidth + x0) * 3;
        for (let sx = x0; sx < x1; sx += 1, index += 3) {
          r += rgb[index]!;
          g += rgb[index + 1]!;
          b += rgb[index + 2]!;
          count += 1;
        }
      }
      const target = (y * width + x) * 4;
      out[target] = r / count;
      out[target + 1] = g / count;
      out[target + 2] = b / count;
      out[target + 3] = 255;
    }
  }
  return out;
};

const runCapture = (args: string[], waylandDisplay: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const child = spawn("grim", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WAYLAND_DISPLAY: waylandDisplay },
    });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `grim did not return a frame within ${CAPTURE_TIMEOUT_MS}ms.`,
        ),
      );
    }, CAPTURE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code === "ENOENT"
          ? new LinuxDesktopUnavailableError(
              "Window screenshots on Hyprland need grim 1.5 or newer (Omarchy ships it; install the grim package).",
            )
          : error,
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else
        reject(
          new Error(
            `grim could not capture the window: ${Buffer.concat(errors).toString("utf8").trim() || `exit ${code}`}`,
          ),
        );
    });
  });

/** US-layout characters that need Shift on their base key. */
const SHIFTED: Record<string, string> = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "minus",
  "+": "equal",
  "{": "bracketleft",
  "}": "bracketright",
  "|": "backslash",
  ":": "semicolon",
  '"': "apostrophe",
  "<": "comma",
  ">": "period",
  "?": "slash",
  "~": "grave",
};

const UNSHIFTED: Record<string, string> = {
  " ": "space",
  "-": "minus",
  "=": "equal",
  "[": "bracketleft",
  "]": "bracketright",
  "\\": "backslash",
  ";": "semicolon",
  "'": "apostrophe",
  ",": "comma",
  ".": "period",
  "/": "slash",
  "`": "grave",
  "\n": "Return",
  "\t": "Tab",
};

export class HyprlandDesktop implements LinuxDesktop {
  readonly name = "hyprland";
  private luaDispatch: boolean | null = null;

  private readonly socket: string;
  private readonly waylandDisplay: string;

  constructor(instance: HyprlandInstance) {
    this.socket = instance.socket;
    this.waylandDisplay = instance.waylandDisplay;
  }

  static connectIfAvailable(): HyprlandDesktop | null {
    const instance = findHyprlandInstance();
    return instance ? new HyprlandDesktop(instance) : null;
  }

  request(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const connection = net.createConnection(this.socket);
      const timer = setTimeout(() => {
        connection.destroy();
        reject(
          new Error(
            `Hyprland did not answer ${command.split(" ")[0]} in time.`,
          ),
        );
      }, REQUEST_TIMEOUT_MS);
      connection.on("connect", () => connection.write(command));
      connection.on("data", (chunk: Buffer) => chunks.push(chunk));
      connection.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      connection.on("close", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
  }

  private async json<T>(command: string): Promise<T> {
    return JSON.parse(await this.request(`j/${command}`)) as T;
  }

  /** Runs dispatches in one batch, in whichever syntax this Hyprland takes. */
  async dispatch(calls: readonly Dispatch[]): Promise<void> {
    if (calls.length === 0) return;
    const run = (lua: boolean) =>
      this.request(
        `[[BATCH]]${calls.map((call) => `dispatch ${lua ? call.lua : call.legacy}`).join(";")}`,
      );
    const okReply = (reply: string) => /^(ok\s*)+$/.test(reply.trim());
    if (this.luaDispatch !== null) {
      const reply = await run(this.luaDispatch);
      if (!okReply(reply)) throw new Error(`Hyprland refused: ${reply.trim()}`);
      return;
    }
    const luaReply = await run(true);
    if (okReply(luaReply)) {
      this.luaDispatch = true;
      return;
    }
    const legacyReply = await run(false);
    if (okReply(legacyReply)) {
      this.luaDispatch = false;
      return;
    }
    throw new Error(
      `Hyprland refused: ${luaReply.trim()} / ${legacyReply.trim()}`,
    );
  }

  private async rawClients() {
    return await this.json<HyprClient[]>("clients");
  }

  private async monitors() {
    return await this.json<HyprMonitor[]>("monitors");
  }

  async listWindows(): Promise<LinuxWindow[]> {
    const [clients, monitors] = await Promise.all([
      this.rawClients(),
      this.monitors(),
    ]);
    const shown = new Set<string>();
    for (const monitor of monitors) {
      shown.add(monitor.activeWorkspace.name);
      if (monitor.specialWorkspace?.name)
        shown.add(monitor.specialWorkspace.name);
    }
    return clients
      .filter(
        (client) => client.mapped && client.size[0] > 0 && client.size[1] > 0,
      )
      .map((client) => ({
        id: client.address.replace(/^0x/, ""),
        pid: client.pid,
        appId: client.class || client.title,
        title: client.title,
        x: client.at[0],
        y: client.at[1],
        width: client.size[0],
        height: client.size[1],
        workspace: client.workspace.name,
        offscreen: !shown.has(client.workspace.name),
        minimized: client.hidden,
        fullscreen: Boolean(client.fullscreen),
        xwayland: client.xwayland,
        focusOrder: client.focusHistoryID,
        ...(client.stableId ? { captureId: client.stableId } : {}),
        scale:
          monitors.find((monitor) => monitor.id === client.monitor)?.scale ?? 1,
      }));
  }

  async focusedWindowId(): Promise<string | null> {
    const active = await this.json<Partial<HyprClient>>("activewindow");
    return active.address ? active.address.replace(/^0x/, "") : null;
  }

  async pointer(): Promise<{ x: number; y: number } | null> {
    try {
      return await this.json<{ x: number; y: number }>("cursorpos");
    } catch {
      return null;
    }
  }

  private async stableIdOf(window: LinuxWindow): Promise<string> {
    if (window.captureId) return window.captureId;
    const client = (await this.rawClients()).find(
      (candidate) => candidate.address.replace(/^0x/, "") === window.id,
    );
    if (!client?.stableId) {
      throw new LinuxDesktopUnavailableError(
        "This Hyprland does not report window identifiers (stableId); window screenshots need Hyprland 0.50 or newer.",
      );
    }
    return client.stableId;
  }

  /** Window properties Stella set, to unset on release. */
  private readonly propsSet = new Map<string, Set<string>>();

  private async setWindowProp(
    window: LinuxWindow,
    prop: string,
    value: string,
  ) {
    const set = this.propsSet.get(window.id) ?? new Set<string>();
    if (set.has(prop)) return false;
    await this.dispatch([
      {
        lua: `hl.dsp.window.set_prop({ prop = '${prop}', value = '${value}', window = 'address:0x${window.id}' })`,
        legacy: `setprop address:0x${window.id} ${prop} ${value}`,
      },
    ]);
    set.add(prop);
    this.propsSet.set(window.id, set);
    return true;
  }

  /** When each window was last asked to keep drawing while hidden. */
  private readonly renderingSince = new Map<string, number>();

  /**
   * Omarchy turns misc:focus_on_activate on, so an app that activates its
   * own window after an accessibility action (Chromium does) would take the
   * user's focus and pull their screen to its workspace; per window, that
   * request now only marks it urgent. Hyprland also stops sending frame
   * callbacks to windows nobody can see, so a window on another workspace
   * stops drawing (Chromium keeps an old picture); render_unfocused keeps it
   * drawing at misc:render_unfocused_fps.
   */
  async prepareWindow(window: LinuxWindow): Promise<void> {
    await this.setWindowProp(window, "focus_on_activate", "0");
    if (
      (window.offscreen || window.minimized) &&
      (await this.setWindowProp(window, "render_unfocused", "1"))
    ) {
      this.renderingSince.set(window.id, Date.now());
      // Hyprland only starts the hidden-window frame timer when a window's
      // rules are re-evaluated, which setprop does not do; a tag change does.
      await this.dispatch([
        this.tagDispatch(window.id, `+${RULE_REFRESH_TAG}`),
      ]).catch(() => undefined);
    }
  }

  private tagDispatch(windowId: string, tag: string): Dispatch {
    return {
      lua: `hl.dsp.window.tag({ tag = '${tag}', window = 'address:0x${windowId}' })`,
      legacy: `tagwindow ${tag} address:0x${windowId}`,
    };
  }

  async captureWindow(window: LinuxWindow): Promise<LinuxCapture> {
    if (window.offscreen || window.minimized) {
      await this.prepareWindow(window).catch(() => undefined);
      // A hidden app needs a few frames (15 a second) to catch up once
      // Hyprland lets it draw again.
      const since = this.renderingSince.get(window.id);
      if (since !== undefined) {
        const wait = since + HIDDEN_CATCH_UP_MS - Date.now();
        if (wait > 0) await sleep(wait);
      }
    }
    const stableId = await this.stableIdOf(window);
    const ppm = decodePpm(
      await runCapture(["-t", "ppm", "-T", stableId, "-"], this.waylandDisplay),
    );
    const width = Math.max(1, Math.round(window.width));
    const height = Math.max(1, Math.round(window.height));
    // grim returns the window's buffer; scale it to layout pixels so
    // screenshot coordinates and accessibility extents agree.
    const targetWidth = Math.min(width, ppm.width);
    const targetHeight =
      Math.round((ppm.height * targetWidth) / ppm.width) || height;
    return {
      rgba: resizeRgbToRgba(
        ppm.rgb,
        ppm.width,
        ppm.height,
        targetWidth,
        targetHeight,
      ),
      width: targetWidth,
      height: targetHeight,
      scale: ppm.width / targetWidth,
      method: "hyprland.ext-image-copy-capture",
    };
  }

  /** Unsets every window property Stella set (the user's own rules stay). */
  async release(windowIds: readonly string[]): Promise<void> {
    await Promise.all(
      windowIds.map(async (id) => {
        const props = this.propsSet.get(id) ?? new Set<string>();
        this.propsSet.delete(id);
        this.renderingSince.delete(id);
        const calls: Dispatch[] = [...props].map((prop) => ({
          lua: `hl.dsp.window.set_prop({ prop = '${prop}', value = 'unset', window = 'address:0x${id}' })`,
          legacy: `setprop address:0x${id} ${prop} unset`,
        }));
        // Hyprland keeps a released window on its hidden-frame timer until
        // some window on that timer closes; idle apps draw nothing then.
        if (props.has("render_unfocused"))
          calls.push(this.tagDispatch(id, `-${RULE_REFRESH_TAG}`));
        // A window that closed meanwhile refuses these; nothing to undo then.
        await this.dispatch(calls).catch(() => undefined);
      }),
    );
  }

  /** Keys go to the given window (it has the keyboard focus by then). */
  private chordDispatch(chord: LinuxKeyChord, windowId: string): Dispatch {
    const mods = chord.mods.join(" ");
    return {
      lua: `hl.dsp.send_shortcut({ mods = ${luaString(mods)}, key = ${luaString(chord.key)}, window = 'address:0x${windowId}' })`,
      legacy: `sendshortcut ${mods}, ${chord.key}, address:0x${windowId}`,
    };
  }

  /** The output layout's bounding box in logical pixels (virtual pointer extent). */
  private async layoutBox() {
    const monitors = await this.monitors();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const monitor of monitors) {
      const rotated = (monitor as HyprMonitor & { transform?: number })
        .transform;
      const swap = rotated !== undefined && rotated % 2 === 1;
      const width =
        (swap ? monitor.height : monitor.width) / (monitor.scale || 1);
      const height =
        (swap ? monitor.width : monitor.height) / (monitor.scale || 1);
      left = Math.min(left, monitor.x);
      top = Math.min(top, monitor.y);
      right = Math.max(right, monitor.x + width);
      bottom = Math.max(bottom, monitor.y + height);
    }
    if (!Number.isFinite(left))
      throw new Error("Hyprland reports no monitors.");
    return { left, top, width: right - left, height: bottom - top };
  }

  private pointerDevice: Promise<WaylandVirtualPointer> | null = null;

  private async virtualPointer() {
    if (!this.pointerDevice) {
      this.pointerDevice = WaylandVirtualPointer.connect(this.waylandDisplay);
      this.pointerDevice.catch(() => {
        this.pointerDevice = null;
      });
    }
    return await this.pointerDevice;
  }

  private async pointerTo(x: number, y: number) {
    const [device, box] = await Promise.all([
      this.virtualPointer(),
      this.layoutBox(),
    ]);
    device.moveTo(x - box.left, y - box.top, box.width, box.height);
    await device.roundtrip();
  }

  /** Drops the virtual pointer device (it is created again when needed). */
  async closeInput() {
    const device = this.pointerDevice;
    this.pointerDevice = null;
    if (device) await (await device.catch(() => null))?.close();
  }

  readonly foreground = {
    snapshot: async (): Promise<LinuxFocusSnapshot> => {
      const [windowId, pointer, monitors] = await Promise.all([
        this.focusedWindowId().catch(() => null),
        this.pointer(),
        this.monitors().catch(() => [] as HyprMonitor[]),
      ]);
      return {
        windowId,
        pointer,
        workspaces: monitors.map((monitor) => monitor.activeWorkspace.name),
      };
    },
    focus: async (window: LinuxWindow) => {
      await this.dispatch([
        {
          lua: `hl.dsp.focus({ window = 'address:0x${window.id}' })`,
          legacy: `focuswindow address:0x${window.id}`,
        },
      ]);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if ((await this.focusedWindowId()) === window.id) return;
        await sleep(15);
      }
      throw new Error("Hyprland did not give the window focus.");
    },
    movePointer: async (x: number, y: number) => {
      await this.pointerTo(x, y);
      // Let the app see the pointer arrive before buttons.
      await sleep(16);
    },
    click: async (button: "left" | "right" | "middle", count: number) => {
      const device = await this.virtualPointer();
      for (let index = 0; index < Math.max(1, count); index += 1) {
        device.button(button, true);
        await device.roundtrip();
        await sleep(30);
        device.button(button, false);
        await device.roundtrip();
        if (index + 1 < count) await sleep(60);
      }
    },
    drag: async (points: readonly { x: number; y: number }[]) => {
      const [first, ...rest] = points;
      const last = rest[rest.length - 1];
      if (!first || !last) return;
      const device = await this.virtualPointer();
      await this.foreground.movePointer(first.x, first.y);
      device.button("left", true);
      await device.roundtrip();
      try {
        // Move in small steps so apps see a drag, not a jump.
        let from = first;
        for (const point of rest) {
          const steps = Math.max(
            4,
            Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / 24),
          );
          for (let step = 1; step <= steps; step += 1) {
            await sleep(8);
            await this.pointerTo(
              from.x + ((point.x - from.x) * step) / steps,
              from.y + ((point.y - from.y) * step) / steps,
            );
          }
          from = point;
        }
        await sleep(30);
      } finally {
        device.button("left", false);
        await device.roundtrip();
      }
    },
    scroll: async (dx: number, dy: number) => {
      const device = await this.virtualPointer();
      // Wheel notches of 15 px, the size most toolkits expect.
      const notches = Math.max(
        1,
        Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / 15),
      );
      for (let index = 0; index < notches; index += 1) {
        device.scroll(
          (Math.sign(dx) * Math.abs(dx)) / notches,
          (Math.sign(dy) * Math.abs(dy)) / notches,
        );
        await sleep(8);
      }
      await device.roundtrip();
    },
    pressKey: async (window: LinuxWindow, chord: LinuxKeyChord) => {
      await this.dispatch([this.chordDispatch(chord, window.id)]);
    },
    typeText: async (window: LinuxWindow, text: string) => {
      const calls: Dispatch[] = [];
      for (const character of text) {
        if (/^[a-z0-9]$/.test(character))
          calls.push(
            this.chordDispatch({ mods: [], key: character }, window.id),
          );
        else if (/^[A-Z]$/.test(character))
          calls.push(
            this.chordDispatch(
              { mods: ["SHIFT"], key: character.toLowerCase() },
              window.id,
            ),
          );
        else if (UNSHIFTED[character])
          calls.push(
            this.chordDispatch(
              { mods: [], key: UNSHIFTED[character]! },
              window.id,
            ),
          );
        else if (SHIFTED[character])
          calls.push(
            this.chordDispatch(
              { mods: ["SHIFT"], key: SHIFTED[character]! },
              window.id,
            ),
          );
        else
          throw new Error(
            `Hyprland can only type keys on the keyboard layout; ${JSON.stringify(character)} has none. Use set_value on the field instead.`,
          );
      }
      for (let index = 0; index < calls.length; index += 32) {
        await this.dispatch(calls.slice(index, index + 32));
      }
    },
    restore: async (snapshot: LinuxFocusSnapshot) => {
      const calls: Dispatch[] = [];
      // Every monitor back on the workspace it showed, then the user's
      // window (focusing warps the cursor), then the pointer.
      const current = await this.monitors().catch(() => [] as HyprMonitor[]);
      const showing = new Set(
        current.map((monitor) => monitor.activeWorkspace.name),
      );
      for (const workspace of snapshot.workspaces) {
        if (showing.has(workspace)) continue;
        calls.push({
          lua: `hl.dsp.focus({ workspace = ${luaString(workspace)} })`,
          legacy: `workspace name:${workspace}`,
        });
      }
      const focusUser: Dispatch | null = snapshot.windowId
        ? {
            lua: `hl.dsp.focus({ window = 'address:0x${snapshot.windowId}' })`,
            legacy: `focuswindow address:0x${snapshot.windowId}`,
          }
        : null;
      if (focusUser) calls.push(focusUser);
      if (snapshot.pointer) {
        const x = Math.round(snapshot.pointer.x);
        const y = Math.round(snapshot.pointer.y);
        calls.push({
          lua: `hl.dsp.cursor.move({ x = ${x}, y = ${y} })`,
          legacy: `movecursor ${x} ${y}`,
        });
      }
      await this.dispatch(calls);
      // With follow_mouse, putting the pointer back over another window
      // focuses that window. Keyboard focus matters more than where the
      // pointer rests, so the user's window wins then (the pointer ends on it).
      if (
        focusUser &&
        (await this.focusedWindowId().catch(() => null)) !== snapshot.windowId
      ) {
        await this.dispatch([focusUser]);
      }
    },
  };
}
