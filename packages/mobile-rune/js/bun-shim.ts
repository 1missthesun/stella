/// <reference path="./natives.d.ts" />
// The slice of Bun the desktop host's bridge and shared code reach: the engine → TS event stream
// (`Bun.stdin.stream()` in host/bridge.ts listen) is the app's `__runeEvent` lines, and files are
// the app sandbox's.

const g = globalThis as any;

type Waiter = (r: IteratorResult<string>) => void;
const lines: string[] = [];
let waiter: Waiter | null = null;

/** Engine → TS: one JSON line, called by the app on the JS thread. */
g.__runeEvent = (line: string) => {
  const chunk = line + "\n";
  if (waiter) {
    const w = waiter;
    waiter = null;
    w({ value: chunk, done: false });
  } else lines.push(chunk);
};

const eventStream = {
  [Symbol.asyncIterator]() {
    return {
      next(): Promise<IteratorResult<string>> {
        if (lines.length) return Promise.resolve({ value: lines.length > 1 ? lines.splice(0).join("") : lines.shift()!, done: false });
        return new Promise<IteratorResult<string>>((r) => (waiter = r));
      },
    };
  },
};

// The bridge decodes each chunk with a streaming TextDecoder; chunks here are already strings.
const Decoder = g.TextDecoder;
g.TextDecoder = class extends Decoder {
  decode(input?: any, opts?: any) {
    return typeof input === "string" ? input : super.decode(input, opts);
  }
};

const file = (p: string | number | URL) => {
  if (typeof p === "number") return { stream: () => eventStream };
  const path = String(p).replace(/^file:\/\//, "");
  const read = () => __native.readFile(path);
  return {
    name: path,
    get size() { return read()?.length ?? 0; },
    type: "",
    exists: async () => read() !== null,
    bytes: async () => read() ?? new Uint8Array(),
    arrayBuffer: async () => (read() ?? new Uint8Array()).slice().buffer,
    text: async () => new TextDecoder().decode(read() ?? new Uint8Array()),
    json: async () => JSON.parse(new TextDecoder().decode(read() ?? new Uint8Array())),
    stream: () => new ReadableStream({ start(c: any) { c.enqueue(read() ?? new Uint8Array()); c.close(); } }),
  };
};

g.Bun = {
  env: g.process?.env ?? {},
  version: "phone",
  stdin: { stream: () => eventStream },
  file,
  async write(p: string, data: any) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(await new Response(data).arrayBuffer());
    __native.writeFile(String(p), bytes);
    return bytes.length;
  },
  hash(data: string | ArrayBufferView | ArrayBuffer) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 16777619);
    return h >>> 0;
  },
  sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  gc: () => {},
  shrink: () => {},
  nanoseconds: () => Math.round(__native.now() * 1e6),
  resolveSync: () => "",
  spawn() { throw new Error("Bun.spawn is not available on the phone"); },
  spawnSync() { throw new Error("Bun.spawnSync is not available on the phone"); },
};

export {};
