import { app } from "electron";
import net from "node:net";
import path from "node:path";

// Native Wayland gives clients no way to place their own windows, read the
// global cursor position or (in Electron) shape their input region. Hyprland,
// the compositor Stella targets on Linux, exposes all of that on its control
// socket, so floating overlays steer themselves through it there.

export type HyprlandClient = {
  address: string;
  pid: number;
  title: string;
  at: [number, number];
  size: [number, number];
  floating: boolean;
  pinned: boolean;
  mapped: boolean;
};

export type HyprlandMonitor = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  transform: number;
  reserved: [number, number, number, number];
};

export type HyprlandDispatch = { lua: string; legacy: string };

const REQUEST_TIMEOUT_MS = 1_000;

export const isNativeWayland = (): boolean => {
  if (process.platform !== "linux") return false;
  const forced =
    app.commandLine.getSwitchValue("ozone-platform") ||
    process.env.ELECTRON_OZONE_PLATFORM_HINT ||
    "";
  if (forced) return forced === "wayland";
  return Boolean(process.env.WAYLAND_DISPLAY);
};

const socketPath = (): string | null => {
  const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE?.trim();
  const runtimeDir = process.env.XDG_RUNTIME_DIR?.trim();
  if (!signature || !runtimeDir) return null;
  return path.join(runtimeDir, "hypr", signature, ".socket.sock");
};

export class HyprlandIpc {
  private readonly socket: string;
  // Hyprland 0.56+ with a Lua config takes Lua dispatches; older/legacy
  // configs take the classic `dispatcher args` form.
  private luaDispatch: boolean | null = null;

  private constructor(socket: string) {
    this.socket = socket;
  }

  static connectIfAvailable(): HyprlandIpc | null {
    if (!isNativeWayland()) return null;
    const socket = socketPath();
    return socket ? new HyprlandIpc(socket) : null;
  }

  request(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const conn = net.createConnection(this.socket);
      const timer = setTimeout(() => {
        conn.destroy();
        reject(new Error(`hyprland: ${command.split(" ")[0]} timed out`));
      }, REQUEST_TIMEOUT_MS);
      conn.on("connect", () => conn.write(command));
      conn.on("data", (chunk) =>
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
      );
      conn.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      conn.on("close", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
  }

  private async json<T>(command: string): Promise<T> {
    return JSON.parse(await this.request(`j/${command}`)) as T;
  }

  clients(): Promise<HyprlandClient[]> {
    return this.json<HyprlandClient[]>("clients");
  }

  monitors(): Promise<HyprlandMonitor[]> {
    return this.json<HyprlandMonitor[]>("monitors");
  }

  async cursorPos(): Promise<{ x: number; y: number }> {
    return this.json<{ x: number; y: number }>("cursorpos");
  }

  /**
   * Runs dispatches, each given in both syntaxes, in one batch. The first
   * call finds out which syntax this Hyprland accepts.
   */
  async dispatch(
    calls: ReadonlyArray<HyprlandDispatch>,
  ): Promise<void> {
    if (calls.length === 0) return;
    const run = (lua: boolean) =>
      this.request(
        `[[BATCH]]${calls
          .map((call) => `dispatch ${lua ? call.lua : call.legacy}`)
          .join(";")}`,
      );
    if (this.luaDispatch !== null) {
      await run(this.luaDispatch);
      return;
    }
    const luaReply = await run(true);
    if (/^(ok\s*)+$/.test(luaReply.trim())) {
      this.luaDispatch = true;
      return;
    }
    const legacyReply = await run(false);
    if (/^(ok\s*)+$/.test(legacyReply.trim())) this.luaDispatch = false;
  }

  static move(address: string, x: number, y: number): HyprlandDispatch {
    const ix = Math.round(x);
    const iy = Math.round(y);
    return {
      lua: `hl.dsp.window.move({ x = ${ix}, y = ${iy}, window = 'address:${address}' })`,
      legacy: `movewindowpixel exact ${ix} ${iy},address:${address}`,
    };
  }

  static raise(address: string): HyprlandDispatch {
    return {
      lua: `hl.dsp.window.alter_zorder({ mode = 'top', window = 'address:${address}' })`,
      legacy: `alterzorder top,address:${address}`,
    };
  }

  static pin(address: string): HyprlandDispatch {
    return {
      lua: `hl.dsp.window.pin({ window = 'address:${address}' })`,
      legacy: `pin address:${address}`,
    };
  }

  static focus(address: string): HyprlandDispatch {
    return {
      lua: `hl.dsp.focus({ window = 'address:${address}' })`,
      legacy: `focuswindow address:${address}`,
    };
  }
}
