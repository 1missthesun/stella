import { ownerGateStub } from "./rpc-release.js";

export type HostingSku = "dynamic-worker" | "static-site";

type Batch = { requests: number; cpuMs: number; flushing: boolean };

const FLUSH_AFTER_MS = 10_000;
const FLUSH_AT_REQUESTS = 1_000;
const PAUSE_RECHECK_MS = 60_000;
const MAX_CPU_MS_PER_REQUEST = 30_000;

// Requests and CPU each isolate served per owner and SKU since its last
// flush. A flush is one owner-gate write per isolate at most every few
// seconds, never one per request; what an evicted isolate held is lost.
const batches = new Map<string, Batch>();
const pausedUntil = new Map<string, { until: number; message: string }>();

type Waiter = { waitUntil(promise: Promise<unknown>): void };
type OwnerEnv = { OWNER_GATES: Cloudflare.Env["OWNER_GATES"] };

const STATUS_CACHE_ORIGIN = "https://hosting-status.stella.internal/";

const remember = async (ownerId: string, status: { serving: boolean; message: string }): Promise<void> => {
  pausedUntil.set(ownerId, { until: Date.now() + PAUSE_RECHECK_MS, message: status.serving ? "" : status.message });
  await caches.default
    .put(
      STATUS_CACHE_ORIGIN + encodeURIComponent(ownerId),
      Response.json(status, { headers: { "cache-control": `max-age=${PAUSE_RECHECK_MS / 1000}` } }),
    )
    .catch(() => undefined);
};

// Whether the owner's hosting is paused, and why. Each isolate learns it at
// most once a minute: from its own last flush, else from the colo cache that
// any isolate's flush or check filled, else from the owner gate.
export const hostingPause = async (env: OwnerEnv, ownerId: string): Promise<string | null> => {
  const known = pausedUntil.get(ownerId);
  if (known && known.until > Date.now()) return known.message || null;
  const cached = await caches.default.match(STATUS_CACHE_ORIGIN + encodeURIComponent(ownerId)).catch(() => undefined);
  let status: { serving: boolean; message: string } | undefined;
  if (cached) {
    status = (await cached.json().catch(() => undefined)) as typeof status;
    if (status) pausedUntil.set(ownerId, { until: Date.now() + PAUSE_RECHECK_MS, message: status.serving ? "" : status.message });
  }
  if (!status) {
    status = await ownerGateStub(env.OWNER_GATES, ownerId)
      .hostingStatus()
      .catch(() => ({ serving: true, message: "" }));
    await remember(ownerId, status);
  }
  return status.serving ? null : status.message;
};

const flush = async (env: OwnerEnv, ownerId: string, sku: HostingSku): Promise<void> => {
  const key = `${ownerId}\n${sku}`;
  const batch = batches.get(key);
  if (!batch || batch.requests === 0) return;
  batches.delete(key);
  try {
    const result = await ownerGateStub(env.OWNER_GATES, ownerId).settleHosting({
      receiptId: `hosting:${crypto.randomUUID()}`,
      sku,
      requests: batch.requests,
      cpuMs: batch.cpuMs,
    });
    await remember(ownerId, result);
  } catch (error) {
    const current = batches.get(key);
    batches.set(key, {
      requests: batch.requests + (current?.requests ?? 0),
      cpuMs: batch.cpuMs + (current?.cpuMs ?? 0),
      flushing: current?.flushing ?? false,
    });
    console.error(
      JSON.stringify({
        level: "error",
        event: "hosting_meter_flush_failed",
        sku,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
};

export const recordHosting = (
  env: OwnerEnv,
  waiter: Waiter,
  ownerId: string,
  sku: HostingSku,
  cpuMs: number,
): void => {
  const key = `${ownerId}\n${sku}`;
  const batch = batches.get(key) ?? { requests: 0, cpuMs: 0, flushing: false };
  batch.requests += 1;
  batch.cpuMs += Math.min(MAX_CPU_MS_PER_REQUEST, Math.max(0, Math.round(cpuMs)));
  batches.set(key, batch);
  if (batch.requests >= FLUSH_AT_REQUESTS) {
    waiter.waitUntil(flush(env, ownerId, sku));
    return;
  }
  if (batch.flushing) return;
  batch.flushing = true;
  waiter.waitUntil(scheduler.wait(FLUSH_AFTER_MS).then(() => flush(env, ownerId, sku)));
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);

export const pausedHostingPage = (message: string): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Paused</title><style>body{font:16px/1.55 system-ui,-apple-system,sans-serif;margin:0;color:#1c1c1e;background:#fafafa}main{max-width:32rem;margin:14vh auto;padding:0 1.5rem}h1{font-size:1.4rem;margin:0 0 .75rem}</style></head><body><main><h1>This is paused for now</h1><p>${escapeHtml(message)}</p></main></body></html>`,
    {
      status: 402,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
