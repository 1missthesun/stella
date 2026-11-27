// The UI bundler process. Bun.build keeps part of every build's native memory for the life of the
// process, so builds run here and the host recycles this process instead of growing. The host
// also runs one of these, at low priority, to write the boot bundle (ui-cache.ts) once builds settle.

import path from "node:path";
import { viteCompat } from "../vite-compat";
import { writeUiCache, type UiCacheSpec } from "./ui-cache";
import { uiBuildMode } from "./ui-mode";

export type UiBuildRequest = { id: number; entry: string; tsconfig: string; external: string[]; cache?: boolean; writeCache?: string[] };
export type UiBuildReply =
  | { id: number; ok: true; code: string; inputs?: string[]; rssMb: number }
  | { id: number; ok: false; error: string; rssMb: number };

const send = (reply: UiBuildReply) => process.send!(reply);
const rssMb = () => process.memoryUsage().rss / 1048576;

const bundle = (spec: UiCacheSpec, extra: Record<string, unknown>) => Bun.build({
  entrypoints: [spec.entry],
  external: spec.external,
  target: "bun",
  format: "cjs",
  tsconfig: spec.tsconfig,
  plugins: [viteCompat],
  jsx: { development: uiBuildMode() === "development" },
  metafile: true,
  ...extra,
} as Parameters<typeof Bun.build>[0]);

const inputsOf = (result: Awaited<ReturnType<typeof Bun.build>>) =>
  Object.keys((result as { metafile?: { inputs: Record<string, unknown> } }).metafile?.inputs ?? {}).map((f) => path.resolve(f));

const writeCache = (spec: UiCacheSpec, inputs: string[]) =>
  writeUiCache(spec, inputs, async (outdir, footer) => {
    const result = await bundle(spec, { bytecode: true, outdir, footer });
    const file = result.outputs.find((o) => o.path.endsWith(".js"))?.path;
    return result.success && file ? { inputs: inputsOf(result), file } : null;
  });

process.on("message", async (request: UiBuildRequest) => {
  const spec: UiCacheSpec = { entry: request.entry, tsconfig: request.tsconfig, external: request.external };
  try {
    if (request.writeCache) {
      await writeCache(spec, request.writeCache).catch((error) => console.error("[ui] boot bundle not written:", error));
      return send({ id: request.id, ok: true, code: "", rssMb: rssMb() });
    }
    const result = await bundle(spec, {});
    if (!result.success) return send({ id: request.id, ok: false, error: result.logs.map(String).join("\n"), rssMb: rssMb() });
    send({ id: request.id, ok: true, code: await result.outputs[0]!.text(), inputs: request.cache ? inputsOf(result) : undefined, rssMb: rssMb() });
  } catch (error) {
    const inner = (error as { errors?: Array<{ message?: string; position?: { file?: string; line?: number } }> }).errors ?? [];
    const detail = inner.map((e) => `${e.message ?? String(e)}${e.position?.file ? ` (${e.position.file}:${e.position.line})` : ""}`).join("\n");
    const message = detail || (error instanceof Error ? error.stack ?? error.message : String(error));
    send({ id: request.id, ok: false, error: message, rssMb: rssMb() });
  }
});

process.send!({ id: 0, ok: true, code: "", rssMb: rssMb() } satisfies UiBuildReply);
