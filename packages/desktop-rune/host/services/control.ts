// A loopback control port for scripted checks of a running host (the Rune counterpart of the
// verify harness's CDP Runtime.evaluate): POST /eval runs an async function body with `api`
// (the main window's electronAPI), `windows` and `electron` in scope and returns its JSON result.

import { hostWindows } from "../electron/browser-window";
import { electronModule } from "../electron";
import type { ElectronApi } from "./renderer-api";

export type ControlContext = { api: ElectronApi; port: number; extra?: Record<string, unknown> };

export function startControlServer(context: ControlContext) {
  if (!context.port) return null;
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
  const server = Bun.serve({
    port: context.port,
    hostname: "127.0.0.1",
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") return Response.json({ ok: true, pid: process.pid });
      if (url.pathname === "/memory") {
        const m = process.memoryUsage();
        return Response.json({ rss_mb: m.rss / 1048576, heap_used_mb: m.heapUsed / 1048576, heap_total_mb: m.heapTotal / 1048576, external_mb: m.external / 1048576 });
      }
      if (url.pathname === "/windows") return Response.json(hostWindows.snapshot());
      if (url.pathname === "/eval" && req.method === "POST") {
        const body = await req.text();
        try {
          const fn = new AsyncFunction("api", "windows", "electron", "extra", body);
          const value = await fn(context.api, hostWindows, electronModule, (context.extra ??= {}));
          return Response.json({ ok: true, value: value ?? null });
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) }, { status: 500 });
        }
      }
      return new Response("not found", { status: 404 });
    },
  });
  console.error(`[host] control on 127.0.0.1:${server.port}`);
  return server;
}
