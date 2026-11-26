import { Buffer } from "buffer";
import { webFile } from "./dom/files";
import { writeDownload } from "./downloads";

const platform = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "darwin" : /Win/.test(navigator.platform) ? "win32" : "linux";

const g = globalThis as Record<string, unknown>;

g.process ??= { platform, env: {}, versions: {}, arch: "", cwd: () => "/", getuid: () => 0, nextTick: (fn: () => void) => queueMicrotask(fn) };
g.Buffer ??= Buffer;

function missing(path: string) {
  const fail = () => Promise.reject(new Error(`${path} is not readable in the browser`));
  return { name: path, size: 0, type: "", exists: async () => false, arrayBuffer: fail, text: fail, bytes: fail, json: fail, stream: () => new ReadableStream() };
}

/** The slice of Bun's API the UI touches, over browser files: picked, dropped and pasted files under their virtual paths, and downloads for saves. */
g.Bun ??= {
  env: {},
  file(path: string | URL) {
    const p = String(path);
    const f = webFile(p);
    if (f) return Object.assign(f, { exists: async () => true, bytes: async () => new Uint8Array(await f.arrayBuffer()) });
    if (/^(https?:|blob:|data:)/.test(p)) {
      const get = () => fetch(p);
      return { name: p, exists: async () => (await get()).ok, arrayBuffer: async () => (await get()).arrayBuffer(), text: async () => (await get()).text(), bytes: async () => new Uint8Array(await (await get()).arrayBuffer()) };
    }
    return missing(p);
  },
  async write(path: string, data: BlobPart) {
    if (!writeDownload(String(path), data)) throw new Error(`${path} is not writable in the browser`);
    return 0;
  },
  hash(data: string | ArrayBufferView | ArrayBuffer) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 16777619);
    return h >>> 0;
  },
  resolveSync: () => "",
  spawn() { throw new Error("Bun.spawn is not available in the browser"); },
  sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};
