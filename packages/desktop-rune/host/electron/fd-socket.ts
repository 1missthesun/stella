// Bun's `new net.Socket({ fd })` closes at once instead of adopting the descriptor, and the native
// launchers hand Stella their channel as an inherited socket on fd 3 (launcher-client.ts). When
// that channel is present, sockets built on a descriptor read and write it directly.

import { fstatSync, writeSync } from "node:fs";
import net from "node:net";
import { Duplex } from "node:stream";

class FdSocket extends Duplex {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private pumping = false;

  constructor(private readonly fd: number) {
    super({ allowHalfOpen: false });
  }

  override _read() {
    if (this.pumping) return;
    this.pumping = true;
    this.reader ??= Bun.file(this.fd).stream().getReader();
    void this.pump();
  }

  private async pump() {
    try {
      while (true) {
        const { value, done } = await this.reader!.read();
        if (done) {
          this.push(null);
          return;
        }
        if (!this.push(Buffer.from(value))) break;
      }
    } catch (error) {
      this.destroy(error as Error);
    }
    this.pumping = false;
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    try {
      let offset = 0;
      while (offset < chunk.length) {
        try {
          offset += writeSync(this.fd, chunk, offset);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
          Bun.sleepSync(1);
        }
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    void this.reader?.cancel().catch(() => {});
    callback(error);
  }

  ref() { return this; }
  unref() { return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  setTimeout() { return this; }
}

const launcherChannelPresent = () => {
  if (process.platform === "win32" || process.env.STELLA_LAUNCHER !== "1") return false;
  try {
    return fstatSync(3).isSocket();
  } catch {
    return false;
  }
};

let installed = false;

export function installFdSockets() {
  if (installed || !launcherChannelPresent()) return;
  installed = true;
  const NativeSocket = net.Socket;
  function Socket(this: unknown, ...args: ConstructorParameters<typeof net.Socket>) {
    const options = args[0];
    if (options && typeof options.fd === "number") return new FdSocket(options.fd);
    return Reflect.construct(NativeSocket, args, new.target ?? NativeSocket);
  }
  Socket.prototype = NativeSocket.prototype;
  Object.setPrototypeOf(Socket, NativeSocket);
  (net as { Socket: unknown }).Socket = Socket;
}
