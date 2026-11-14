import net from "node:net";
import path from "node:path";

/**
 * A minimal Wayland client for zwlr_virtual_pointer_v1: real pointer input
 * (move, buttons, wheel) on wlroots-family compositors (Hyprland, Sway,
 * river, labwc). Used only for delivery: "foreground", which moves the
 * user's real cursor; the caller puts it back afterwards. Stella speaks the
 * wire protocol itself, so it ships no native helper for this.
 */

const BUTTON_CODES = { left: 0x110, right: 0x111, middle: 0x112 } as const;
const AXIS_VERTICAL = 0;
const AXIS_HORIZONTAL = 1;
const TIMEOUT_MS = 2_000;

class WireWriter {
  private parts: Buffer[] = [];

  uint(value: number) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value >>> 0);
    this.parts.push(buffer);
    return this;
  }

  int(value: number) {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(Math.trunc(value));
    this.parts.push(buffer);
    return this;
  }

  fixed(value: number) {
    return this.int(Math.round(value * 256));
  }

  string(value: string) {
    const bytes = Buffer.from(`${value}\0`, "utf8");
    const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
    bytes.copy(padded);
    this.uint(bytes.length);
    this.parts.push(padded);
    return this;
  }

  message(objectId: number, opcode: number) {
    const body = Buffer.concat(this.parts);
    const header = Buffer.alloc(8);
    header.writeUInt32LE(objectId);
    header.writeUInt32LE(((body.length + 8) << 16) | opcode, 4);
    return Buffer.concat([header, body]);
  }
}

const now = () => Math.round(performance.now()) >>> 0;

export class WaylandVirtualPointer {
  private nextId = 2;
  private incoming: Buffer = Buffer.alloc(0);
  private readonly globals = new Map<
    string,
    { name: number; version: number }
  >();
  private readonly callbacks = new Map<number, () => void>();
  private error: Error | null = null;
  private registryId = 0;
  private pointerId = 0;

  private constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (error) => {
      this.error = error;
    });
  }

  static async connect(
    waylandDisplay?: string,
  ): Promise<WaylandVirtualPointer> {
    const display =
      waylandDisplay?.trim() || process.env.WAYLAND_DISPLAY?.trim();
    const runtimeDir = process.env.XDG_RUNTIME_DIR?.trim();
    if (!display || !runtimeDir)
      throw new Error("No Wayland display to send pointer input to.");
    const socketPath = display.startsWith("/")
      ? display
      : path.join(runtimeDir, display);
    const socket = net.createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const client = new WaylandVirtualPointer(socket);
    await client.setUp();
    return client;
  }

  private send(message: Buffer) {
    if (this.error) throw this.error;
    this.socket.write(message);
  }

  private allocate() {
    return this.nextId++;
  }

  /** wl_display.sync: resolves once the compositor processed everything sent. */
  roundtrip(): Promise<void> {
    const id = this.allocate();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.callbacks.delete(id);
        reject(
          new Error(
            "The compositor did not answer the virtual pointer in time.",
          ),
        );
      }, TIMEOUT_MS);
      this.callbacks.set(id, () => {
        clearTimeout(timer);
        if (this.error) reject(this.error);
        else resolve();
      });
      this.send(new WireWriter().uint(id).message(1, 0));
    });
  }

  private async setUp() {
    this.registryId = this.allocate();
    this.send(new WireWriter().uint(this.registryId).message(1, 1));
    await this.roundtrip();
    const manager = this.globals.get("zwlr_virtual_pointer_manager_v1");
    if (!manager) {
      throw new Error(
        "This compositor has no wlr virtual pointer (zwlr_virtual_pointer_manager_v1), so Stella cannot send pointer input to it.",
      );
    }
    const managerId = this.allocate();
    this.send(
      new WireWriter()
        .uint(manager.name)
        .string("zwlr_virtual_pointer_manager_v1")
        .uint(1)
        .uint(managerId)
        .message(this.registryId, 0),
    );
    const seat = this.globals.get("wl_seat");
    let seatId = 0;
    if (seat) {
      seatId = this.allocate();
      this.send(
        new WireWriter()
          .uint(seat.name)
          .string("wl_seat")
          .uint(1)
          .uint(seatId)
          .message(this.registryId, 0),
      );
    }
    this.pointerId = this.allocate();
    this.send(
      new WireWriter().uint(seatId).uint(this.pointerId).message(managerId, 0),
    );
    await this.roundtrip();
  }

  private onData(chunk: Buffer) {
    this.incoming = this.incoming.length
      ? Buffer.concat([this.incoming, chunk])
      : chunk;
    while (this.incoming.length >= 8) {
      const objectId = this.incoming.readUInt32LE(0);
      const word = this.incoming.readUInt32LE(4);
      const size = word >>> 16;
      const opcode = word & 0xffff;
      if (size < 8 || this.incoming.length < size) return;
      const body = this.incoming.subarray(8, size);
      this.incoming = this.incoming.subarray(size);
      if (objectId === 1 && opcode === 0) {
        const length = body.readUInt32LE(8);
        this.error = new Error(
          `Wayland error: ${body.toString("utf8", 12, 12 + Math.max(0, length - 1))}`,
        );
        for (const callback of this.callbacks.values()) callback();
        this.callbacks.clear();
      } else if (objectId === this.registryId && opcode === 0) {
        const name = body.readUInt32LE(0);
        const length = body.readUInt32LE(4);
        const iface = body.toString("utf8", 8, 8 + length - 1);
        const version = body.readUInt32LE(8 + Math.ceil(length / 4) * 4);
        if (!this.globals.has(iface))
          this.globals.set(iface, { name, version });
      } else if (this.callbacks.has(objectId) && opcode === 0) {
        const callback = this.callbacks.get(objectId)!;
        this.callbacks.delete(objectId);
        callback();
      }
    }
  }

  private frame() {
    this.send(new WireWriter().message(this.pointerId, 4));
  }

  /** Absolute position within an extent (the output layout, in logical px). */
  moveTo(x: number, y: number, extentWidth: number, extentHeight: number) {
    this.send(
      new WireWriter()
        .uint(now())
        .uint(Math.max(0, Math.round(x)))
        .uint(Math.max(0, Math.round(y)))
        .uint(Math.round(extentWidth))
        .uint(Math.round(extentHeight))
        .message(this.pointerId, 1),
    );
    this.frame();
  }

  button(button: keyof typeof BUTTON_CODES, pressed: boolean) {
    this.send(
      new WireWriter()
        .uint(now())
        .uint(BUTTON_CODES[button])
        .uint(pressed ? 1 : 0)
        .message(this.pointerId, 2),
    );
    this.frame();
  }

  /** Wheel scroll in pixels (positive = down/right). */
  scroll(dx: number, dy: number) {
    if (dy)
      this.send(
        new WireWriter()
          .uint(now())
          .uint(AXIS_VERTICAL)
          .fixed(dy)
          .message(this.pointerId, 3),
      );
    if (dx)
      this.send(
        new WireWriter()
          .uint(now())
          .uint(AXIS_HORIZONTAL)
          .fixed(dx)
          .message(this.pointerId, 3),
      );
    this.frame();
  }

  async close() {
    try {
      this.send(new WireWriter().message(this.pointerId, 8));
      await this.roundtrip();
    } catch {
      // closing anyway
    }
    this.socket.destroy();
  }
}
