// The UI bundler process. Bun.build keeps part of every build's native memory for the life of the
// process, so builds run here and the host recycles this process instead of growing. Once builds
// settle it also writes the boot bundle (ui-cache.ts).

import path from "node:path";
import { viteCompat } from "../vite-compat";
import { writeUiCache, type UiCacheSpec } from "./ui-cache";

export type UiBuildRequest = { id: number; entry: string; tsconfig: string; external: string[]; cache?: boolean };
export type UiBuildReply =
  | { id: number; ok: true; code: string; rssMb: number }
  | { id: number; ok: false; error: string; rssMb: number };

const CACHE_SETTLE_MS = 1500;

const send = (reply: UiBuildReply) => process.send!(reply);

const bundle = (spec: UiCacheSpec, extra: Record<string, unknown>) => Bun.build({
  entrypoints: [spec.entry],
  external: spec.external,
  target: "bun",
  format: "cjs",
  tsconfig: spec.tsconfig,
  plugins: [viteCompat],
  metafile: true,
  ...extra,
} as Parameters<typeof Bun.build>[0]);

const inputsOf = (result: Awaited<ReturnType<typeof Bun.build>>) =>
  Object.keys((result as { metafile?: { inputs: Record<string, unknown> } }).metafile?.inputs ?? {}).map((f) => path.resolve(f));

let cacheTimer: ReturnType<typeof setTimeout> | null = null;
let building = 0;
const scheduleCache = (spec: UiCacheSpec, inputs: string[]) => {
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    if (building > 0) return scheduleCache(spec, inputs);
    void writeUiCache(spec, inputs, async (outdir, footer) => {
      const result = await bundle(spec, { bytecode: true, outdir, footer });
      const file = result.outputs.find((o) => o.path.endsWith(".js"))?.path;
      return result.success && file ? { inputs: inputsOf(result), file } : null;
    }).catch((error) => console.error("[ui] boot bundle not written:", error));
  }, CACHE_SETTLE_MS);
};

process.on("message", async (request: UiBuildRequest) => {
  const spec: UiCacheSpec = { entry: request.entry, tsconfig: request.tsconfig, external: request.external };
  building++;
  try {
    const result = await bundle(spec, {});
    const rssMb = process.memoryUsage().rss / 1048576;
    if (!result.success) return send({ id: request.id, ok: false, error: result.logs.map(String).join("\n"), rssMb });
    send({ id: request.id, ok: true, code: await result.outputs[0]!.text(), rssMb });
    if (request.cache) scheduleCache(spec, inputsOf(result));
  } catch (error) {
    const inner = (error as { errors?: Array<{ message?: string; position?: { file?: string; line?: number } }> }).errors ?? [];
    const detail = inner.map((e) => `${e.message ?? String(e)}${e.position?.file ? ` (${e.position.file}:${e.position.line})` : ""}`).join("\n");
    const message = detail || (error instanceof Error ? error.stack ?? error.message : String(error));
    send({ id: request.id, ok: false, error: message, rssMb: process.memoryUsage().rss / 1048576 });
  } finally {
    building--;
  }
});

process.send!({ id: 0, ok: true, code: "", rssMb: process.memoryUsage().rss / 1048576 } satisfies UiBuildReply);
