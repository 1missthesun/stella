/**
 * A cloud watch's check: the watch's own script, run with no model in a
 * Worker isolate of its own (`LOADER`). The script is an ES module whose
 * default export takes `{ state }` and returns `{ found?, state? }`; it may
 * `fetch`, and nothing else of the owner's is in reach. A run is bounded in
 * time, CPU and subrequests, and its state in size.
 */

import { WATCH_STATE_MAX_BYTES } from "@stella/contracts/backend/schedules";
import { sha256Hex } from "../hash.js";

const RUN_TIMEOUT_MS = 30_000;
const CPU_MS = 10_000;
const SUBREQUESTS = 50;
const FOUND_MAX_CHARS = 4_000;
const ERROR_MAX_CHARS = 1_000;

const HARNESS = `import check from "./check.js";
const text = (value) => (typeof value === "string" ? value.trim() : "");
export default {
  async fetch(request) {
    const input = await request.json();
    try {
      if (typeof check !== "function") throw new Error("The watch script must export a default function.");
      const out = (await check({ state: input.state ?? null })) ?? {};
      return Response.json({
        ok: true,
        found: text(out.found),
        state: "state" in out ? (out.state ?? null) : (input.state ?? null),
      });
    } catch (error) {
      const message = error && error.stack ? String(error.stack) : String(error);
      return Response.json({ ok: false, error: message });
    }
  },
};
`;

export type WatchRun =
  | { ok: true; found: string; stateJson: string | null; durationMs: number }
  | { ok: false; error: string; durationMs: number };

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export const runWatchCheck = async (
  env: Cloudflare.Env,
  input: { ownerId: string; scheduleId: string; script: string; stateJson: string | null },
): Promise<WatchRun> => {
  const started = Date.now();
  const failed = (error: string): WatchRun => ({
    ok: false,
    error: clip(error, ERROR_MAX_CHARS),
    durationMs: Date.now() - started,
  });
  try {
    const revision = (await sha256Hex(input.script)).slice(0, 16);
    const worker = env.LOADER.get(`watch:${input.ownerId}:${input.scheduleId}:${revision}`, () => ({
      compatibilityDate: "2026-07-22",
      mainModule: "harness.js",
      modules: { "harness.js": HARNESS, "check.js": input.script },
      limits: { cpuMs: CPU_MS, subRequests: SUBREQUESTS },
    }));
    let state: unknown = null;
    if (input.stateJson) {
      try {
        state = JSON.parse(input.stateJson);
      } catch {
        state = null;
      }
    }
    const response = await worker.getEntrypoint().fetch("https://watch.stella.internal/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      found?: unknown;
      state?: unknown;
      error?: unknown;
    } | null;
    if (!body || typeof body !== "object") return failed(`The check answered ${response.status} without a result.`);
    if (body.ok !== true) return failed(typeof body.error === "string" ? body.error : "The check failed.");
    const stateJson = body.state === null || body.state === undefined ? null : JSON.stringify(body.state);
    if (stateJson && stateJson.length > WATCH_STATE_MAX_BYTES) {
      return failed(`The check's state is larger than ${WATCH_STATE_MAX_BYTES} bytes; keep only what the next check compares against.`);
    }
    const found = typeof body.found === "string" ? clip(body.found.trim(), FOUND_MAX_CHARS) : "";
    return { ok: true, found, stateJson, durationMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failed(
      error instanceof Error && error.name === "TimeoutError"
        ? `The check took longer than ${RUN_TIMEOUT_MS / 1000}s.`
        : message,
    );
  }
};
