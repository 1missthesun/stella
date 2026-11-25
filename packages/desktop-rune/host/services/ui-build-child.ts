// The UI bundler process. Bun.build keeps part of every build's native memory for the life of the
// process, so builds run here and the host recycles this process instead of growing.

import { viteCompat } from "../vite-compat";

export type UiBuildRequest = { id: number; entry: string; tsconfig: string; external: string[] };
export type UiBuildReply =
  | { id: number; ok: true; code: string; rssMb: number }
  | { id: number; ok: false; error: string; rssMb: number };

const send = (reply: UiBuildReply) => process.send!(reply);

process.on("message", async (request: UiBuildRequest) => {
  try {
    const result = await Bun.build({
      entrypoints: [request.entry],
      external: request.external,
      target: "bun",
      format: "cjs",
      tsconfig: request.tsconfig,
      plugins: [viteCompat],
    } as Parameters<typeof Bun.build>[0]);
    const rssMb = process.memoryUsage().rss / 1048576;
    if (!result.success) return send({ id: request.id, ok: false, error: result.logs.map(String).join("\n"), rssMb });
    send({ id: request.id, ok: true, code: await result.outputs[0]!.text(), rssMb });
  } catch (error) {
    send({ id: request.id, ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error), rssMb: process.memoryUsage().rss / 1048576 });
  }
});

process.send!({ id: 0, ok: true, code: "", rssMb: process.memoryUsage().rss / 1048576 } satisfies UiBuildReply);
