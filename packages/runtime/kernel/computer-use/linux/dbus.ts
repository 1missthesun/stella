import net from "node:net";
import os from "node:os";

/**
 * A small D-Bus client for the session and accessibility buses: EXTERNAL
 * auth, method calls with pipelined replies, and the marshalling AT-SPI
 * needs. Stella owns it so Linux computer use has no native dependency for
 * reading and acting on app UI.
 */

type DBusType =
  | { kind: "basic"; code: string }
  | { kind: "variant" }
  | { kind: "array"; element: DBusType }
  | { kind: "struct"; fields: DBusType[] }
  | { kind: "dict"; key: DBusType; value: DBusType };

/** A value marshalled as a variant with the given signature. */
export type DBusVariant = {
  readonly signature: string;
  readonly value: unknown;
};

export const variant = (signature: string, value: unknown): DBusVariant => ({
  signature,
  value,
});

const isVariant = (value: unknown): value is DBusVariant =>
  typeof value === "object" &&
  value !== null &&
  "signature" in value &&
  "value" in value;

const parseSignature = (signature: string): DBusType[] => {
  const types: DBusType[] = [];
  let index = 0;
  const parseOne = (): DBusType => {
    const code = signature[index++];
    if (code === undefined)
      throw new Error(`Truncated D-Bus signature ${signature}`);
    if (code === "a") {
      if (signature[index] === "{") {
        index += 1;
        const key = parseOne();
        const value = parseOne();
        if (signature[index++] !== "}") {
          throw new Error(`Bad dict in D-Bus signature ${signature}`);
        }
        return { kind: "array", element: { kind: "dict", key, value } };
      }
      return { kind: "array", element: parseOne() };
    }
    if (code === "(") {
      const fields: DBusType[] = [];
      while (signature[index] !== ")") {
        if (index >= signature.length) {
          throw new Error(`Unclosed struct in D-Bus signature ${signature}`);
        }
        fields.push(parseOne());
      }
      index += 1;
      return { kind: "struct", fields };
    }
    if (code === "v") return { kind: "variant" };
    if ("ybnqiuxtdsogh".includes(code)) return { kind: "basic", code };
    throw new Error(`Unsupported D-Bus type ${code} in ${signature}`);
  };
  while (index < signature.length) types.push(parseOne());
  return types;
};

const signatureCache = new Map<string, DBusType[]>();
const typesOf = (signature: string) => {
  let types = signatureCache.get(signature);
  if (!types) {
    types = parseSignature(signature);
    signatureCache.set(signature, types);
  }
  return types;
};

const alignmentOf = (type: DBusType): number => {
  switch (type.kind) {
    case "variant":
      return 1;
    case "array":
      return 4;
    case "struct":
    case "dict":
      return 8;
    case "basic":
      switch (type.code) {
        case "y":
        case "g":
          return 1;
        case "n":
        case "q":
          return 2;
        case "x":
        case "t":
        case "d":
          return 8;
        default:
          return 4;
      }
  }
};

class Writer {
  private buffer = Buffer.alloc(256);
  length = 0;

  private ensure(extra: number) {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = Buffer.alloc(size);
    this.buffer.copy(next, 0, 0, this.length);
    this.buffer = next;
  }

  align(boundary: number) {
    const padding = (boundary - (this.length % boundary)) % boundary;
    this.ensure(padding);
    this.buffer.fill(0, this.length, this.length + padding);
    this.length += padding;
  }

  byte(value: number) {
    this.ensure(1);
    this.buffer.writeUInt8(value & 0xff, this.length);
    this.length += 1;
  }

  uint32(value: number) {
    this.align(4);
    this.ensure(4);
    this.buffer.writeUInt32LE(value >>> 0, this.length);
    this.length += 4;
  }

  setUint32(offset: number, value: number) {
    this.buffer.writeUInt32LE(value >>> 0, offset);
  }

  write(type: DBusType, value: unknown) {
    switch (type.kind) {
      case "basic":
        return this.writeBasic(type.code, value);
      case "variant": {
        const item = isVariant(value) ? value : inferVariant(value);
        this.writeBasic("g", item.signature);
        const [inner] = typesOf(item.signature);
        if (!inner) throw new Error("Empty variant signature");
        this.write(inner, item.value);
        return;
      }
      case "array": {
        this.uint32(0);
        const lengthOffset = this.length - 4;
        this.align(alignmentOf(type.element));
        const start = this.length;
        if (type.element.kind === "dict") {
          const entries =
            value instanceof Map
              ? [...value.entries()]
              : Array.isArray(value)
                ? (value as [unknown, unknown][])
                : Object.entries(value as Record<string, unknown>);
          for (const entry of entries) this.write(type.element, entry);
        } else {
          for (const item of value as unknown[]) this.write(type.element, item);
        }
        this.setUint32(lengthOffset, this.length - start);
        return;
      }
      case "struct": {
        this.align(8);
        const items = value as unknown[];
        type.fields.forEach((field, index) => this.write(field, items[index]));
        return;
      }
      case "dict": {
        this.align(8);
        const [key, item] = value as [unknown, unknown];
        this.write(type.key, key);
        this.write(type.value, item);
        return;
      }
    }
  }

  private writeBasic(code: string, value: unknown) {
    switch (code) {
      case "y":
        return this.byte(Number(value));
      case "b":
        return this.uint32(value ? 1 : 0);
      case "n":
      case "q":
        this.align(2);
        this.ensure(2);
        if (code === "n") this.buffer.writeInt16LE(Number(value), this.length);
        else this.buffer.writeUInt16LE(Number(value), this.length);
        this.length += 2;
        return;
      case "i":
        this.align(4);
        this.ensure(4);
        this.buffer.writeInt32LE(Number(value), this.length);
        this.length += 4;
        return;
      case "u":
      case "h":
        return this.uint32(Number(value));
      case "x":
      case "t":
        this.align(8);
        this.ensure(8);
        if (code === "x")
          this.buffer.writeBigInt64LE(BigInt(value as number), this.length);
        else this.buffer.writeBigUInt64LE(BigInt(value as number), this.length);
        this.length += 8;
        return;
      case "d":
        this.align(8);
        this.ensure(8);
        this.buffer.writeDoubleLE(Number(value), this.length);
        this.length += 8;
        return;
      case "s":
      case "o": {
        const bytes = Buffer.from(String(value), "utf8");
        this.uint32(bytes.length);
        this.ensure(bytes.length + 1);
        bytes.copy(this.buffer, this.length);
        this.length += bytes.length;
        this.byte(0);
        return;
      }
      case "g": {
        const bytes = Buffer.from(String(value), "utf8");
        this.byte(bytes.length);
        this.ensure(bytes.length + 1);
        bytes.copy(this.buffer, this.length);
        this.length += bytes.length;
        this.byte(0);
        return;
      }
    }
    throw new Error(`Cannot marshal D-Bus type ${code}`);
  }

  bytes() {
    return this.buffer.subarray(0, this.length);
  }
}

const inferVariant = (value: unknown): DBusVariant => {
  if (typeof value === "string") return variant("s", value);
  if (typeof value === "boolean") return variant("b", value);
  if (typeof value === "number") {
    return Number.isInteger(value) ? variant("i", value) : variant("d", value);
  }
  throw new Error("Cannot infer a D-Bus variant type; use variant()");
};

class Reader {
  offset: number;

  constructor(
    private readonly buffer: Buffer,
    offset = 0,
  ) {
    this.offset = offset;
  }

  align(boundary: number) {
    this.offset += (boundary - (this.offset % boundary)) % boundary;
  }

  read(type: DBusType): unknown {
    switch (type.kind) {
      case "basic":
        return this.readBasic(type.code);
      case "variant": {
        const signature = this.readBasic("g") as string;
        const [inner] = typesOf(signature);
        return inner ? this.read(inner) : null;
      }
      case "array": {
        const length = this.readBasic("u") as number;
        this.align(alignmentOf(type.element));
        const end = this.offset + length;
        if (type.element.kind === "dict") {
          const result: Record<string, unknown> = {};
          while (this.offset < end) {
            this.align(8);
            const key = this.read(type.element.key);
            result[String(key)] = this.read(type.element.value);
          }
          return result;
        }
        const items: unknown[] = [];
        while (this.offset < end) items.push(this.read(type.element));
        this.offset = end;
        return items;
      }
      case "struct": {
        this.align(8);
        return type.fields.map((field) => this.read(field));
      }
      case "dict": {
        this.align(8);
        return [this.read(type.key), this.read(type.value)];
      }
    }
  }

  readBasic(code: string): unknown {
    const buffer = this.buffer;
    switch (code) {
      case "y":
        return buffer.readUInt8(this.offset++);
      case "b":
        this.align(4);
        this.offset += 4;
        return buffer.readUInt32LE(this.offset - 4) !== 0;
      case "n":
        this.align(2);
        this.offset += 2;
        return buffer.readInt16LE(this.offset - 2);
      case "q":
        this.align(2);
        this.offset += 2;
        return buffer.readUInt16LE(this.offset - 2);
      case "i":
        this.align(4);
        this.offset += 4;
        return buffer.readInt32LE(this.offset - 4);
      case "u":
      case "h":
        this.align(4);
        this.offset += 4;
        return buffer.readUInt32LE(this.offset - 4);
      case "x":
        this.align(8);
        this.offset += 8;
        return Number(buffer.readBigInt64LE(this.offset - 8));
      case "t":
        this.align(8);
        this.offset += 8;
        return Number(buffer.readBigUInt64LE(this.offset - 8));
      case "d":
        this.align(8);
        this.offset += 8;
        return buffer.readDoubleLE(this.offset - 8);
      case "s":
      case "o": {
        const length = this.readBasic("u") as number;
        const value = buffer.toString(
          "utf8",
          this.offset,
          this.offset + length,
        );
        this.offset += length + 1;
        return value;
      }
      case "g": {
        const length = buffer.readUInt8(this.offset++);
        const value = buffer.toString(
          "utf8",
          this.offset,
          this.offset + length,
        );
        this.offset += length + 1;
        return value;
      }
    }
    throw new Error(`Cannot read D-Bus type ${code}`);
  }
}

export class DBusError extends Error {
  constructor(
    readonly errorName: string,
    message: string,
  ) {
    super(message || errorName);
    this.name = "DBusError";
  }
}

export class DBusTimeoutError extends Error {
  constructor(
    readonly member: string,
    readonly timeoutMs: number,
  ) {
    super(`D-Bus call ${member} got no reply within ${timeoutMs}ms.`);
    this.name = "DBusTimeoutError";
  }
}

export type DBusCall = Readonly<{
  destination: string;
  path: string;
  interface: string;
  member: string;
  signature?: string;
  body?: readonly unknown[];
  timeoutMs?: number;
}>;

type Pending = {
  resolve: (value: unknown[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  member: string;
};

const HEADER_FIELDS_TYPE = typesOf("a(yv)")[0]!;
const DEFAULT_CALL_TIMEOUT_MS = 3_000;

const parseAddress = (address: string): string => {
  for (const entry of address.split(";")) {
    const [transport, rest = ""] = entry.split(/:(.*)/s);
    if (transport !== "unix") continue;
    const params = Object.fromEntries(
      rest.split(",").map((pair) => {
        const at = pair.indexOf("=");
        return [pair.slice(0, at), decodeURIComponent(pair.slice(at + 1))];
      }),
    );
    if (params.path) return params.path;
    if (params.abstract) return `\0${params.abstract}`;
  }
  throw new Error(`No usable unix D-Bus address in ${address}`);
};

export class DBusConnection {
  private serial = 1;
  private readonly pending = new Map<number, Pending>();
  private incoming: Buffer = Buffer.alloc(0);
  private closedError: Error | null = null;
  uniqueName = "";

  private constructor(private readonly socket: net.Socket) {}

  static async connect(address: string): Promise<DBusConnection> {
    const socketPath = parseAddress(address);
    const socket = net.createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.setNoDelay?.(true);
    const uid = String(os.userInfo().uid);
    const hexUid = Buffer.from(uid, "ascii").toString("hex");
    await new Promise<void>((resolve, reject) => {
      let text = "";
      const onData = (chunk: Buffer) => {
        text += chunk.toString("latin1");
        if (!text.includes("\r\n")) return;
        socket.off("data", onData);
        if (text.startsWith("OK ")) resolve();
        else reject(new Error(`D-Bus auth refused: ${text.trim()}`));
      };
      socket.on("data", onData);
      socket.write(`\0AUTH EXTERNAL ${hexUid}\r\n`);
    });
    socket.write("BEGIN\r\n");
    const connection = new DBusConnection(socket);
    socket.on("data", (chunk: Buffer) => connection.onData(chunk));
    const fail = (error: Error) => connection.failAll(error);
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("D-Bus connection closed.")));
    const [name] = await connection.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus",
      member: "Hello",
    });
    connection.uniqueName = String(name);
    return connection;
  }

  /**
   * The user's session bus. Chromium sets DBUS_SESSION_BUS_ADDRESS to
   * "disabled:" when it starts without one, and Stella's runtime inherits
   * that, so the standard per-user socket is tried after the given address.
   */
  static async session(): Promise<DBusConnection> {
    const runtimeDir = process.env.XDG_RUNTIME_DIR?.trim();
    const addresses = [
      process.env.DBUS_SESSION_BUS_ADDRESS?.trim(),
      runtimeDir ? `unix:path=${runtimeDir}/bus` : undefined,
    ].filter((address): address is string => Boolean(address));
    if (addresses.length === 0)
      throw new Error("No D-Bus session bus address is set.");
    let lastError: unknown;
    for (const address of new Set(addresses)) {
      try {
        return await DBusConnection.connect(address);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  get closed() {
    return this.closedError !== null;
  }

  close() {
    this.failAll(new Error("D-Bus connection closed."));
    this.socket.destroy();
  }

  /** Lets the process exit while this connection is idle. */
  unref() {
    this.socket.unref();
  }

  call(call: DBusCall): Promise<unknown[]> {
    if (this.closedError) return Promise.reject(this.closedError);
    const serial = this.serial++;
    const signature = call.signature ?? "";
    const body = new Writer();
    if (signature) {
      const types = typesOf(signature);
      types.forEach((type, index) => body.write(type, call.body?.[index]));
    }
    const fields: [number, DBusVariant][] = [
      [1, variant("o", call.path)],
      [2, variant("s", call.interface)],
      [3, variant("s", call.member)],
      [6, variant("s", call.destination)],
    ];
    if (signature) fields.push([8, variant("g", signature)]);
    const header = new Writer();
    header.byte(0x6c); // little endian
    header.byte(1); // method call
    header.byte(0);
    header.byte(1);
    header.uint32(body.length);
    header.uint32(serial);
    header.write(HEADER_FIELDS_TYPE, fields);
    header.align(8);
    const message = Buffer.concat([header.bytes(), body.bytes()]);
    const timeoutMs = call.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    return new Promise<unknown[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(serial);
        reject(new DBusTimeoutError(call.member, timeoutMs));
      }, timeoutMs);
      this.pending.set(serial, { resolve, reject, timer, member: call.member });
      this.socket.write(message);
    });
  }

  private failAll(error: Error) {
    if (!this.closedError) this.closedError = error;
    for (const [serial, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(serial);
    }
  }

  private onData(chunk: Buffer) {
    this.incoming =
      this.incoming.length === 0
        ? chunk
        : Buffer.concat([this.incoming, chunk]);
    while (this.incoming.length >= 16) {
      const buffer = this.incoming;
      if (buffer[0] !== 0x6c) {
        this.failAll(new Error("Big-endian D-Bus messages are not supported."));
        this.socket.destroy();
        return;
      }
      const bodyLength = buffer.readUInt32LE(4);
      const fieldsLength = buffer.readUInt32LE(12);
      const headerEnd = 16 + fieldsLength;
      const bodyStart = headerEnd + ((8 - (headerEnd % 8)) % 8);
      const total = bodyStart + bodyLength;
      if (buffer.length < total) return;
      const message = buffer.subarray(0, total);
      this.incoming = buffer.subarray(total);
      this.handleMessage(message, bodyStart);
    }
  }

  private handleMessage(message: Buffer, bodyStart: number) {
    const type = message[1];
    if (type !== 2 && type !== 3) return; // only replies and errors matter
    const reader = new Reader(message, 12);
    const fields = reader.read(HEADER_FIELDS_TYPE) as [number, unknown][];
    let replySerial = 0;
    let signature = "";
    let errorName = "";
    for (const [code, value] of fields) {
      if (code === 5) replySerial = Number(value);
      else if (code === 8) signature = String(value);
      else if (code === 4) errorName = String(value);
    }
    const pending = this.pending.get(replySerial);
    if (!pending) return;
    this.pending.delete(replySerial);
    clearTimeout(pending.timer);
    try {
      const bodyReader = new Reader(message, bodyStart);
      const values = signature
        ? typesOf(signature).map((fieldType) => bodyReader.read(fieldType))
        : [];
      if (type === 3) {
        pending.reject(
          new DBusError(
            errorName,
            typeof values[0] === "string" ? values[0] : "",
          ),
        );
      } else {
        pending.resolve(values);
      }
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
