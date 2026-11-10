import {
  ANONYMOUS_COUNTS_MAX_BODY_BYTES,
  anonymousCountDetail,
  isAnonymousCountsBatch,
} from "@stella/contracts/telemetry/anonymous-counts";
import { createPseudonymizer } from "./pseudonym.js";

export type CountsEnv = Pick<
  Env,
  | "ENVIRONMENT"
  | "TELEMETRY_PSEUDONYM_KEY"
  | "COUNTS"
  | "COUNTS_INSTALL_RATE_LIMITER"
  | "COUNTS_IP_RATE_LIMITER"
>;

const COUNTS_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const COUNTS_MAX_FUTURE_SKEW_MS = 10 * 60_000;

const headers = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};
const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status, headers });

const rateLimited = (): Response => {
  const response = json(429, { error: "rate_limited" });
  response.headers.set("retry-after", "60");
  return response;
};

const readSmallBody = async (request: Request): Promise<string | null> => {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ANONYMOUS_COUNTS_MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > ANONYMOUS_COUNTS_MAX_BODY_BYTES) {
        await reader.cancel("body_too_large");
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);
};

/**
 * `POST /v1/counts`: unauthenticated anonymous install counts.
 *
 * Stored in Workers Analytics Engine, one data point per event:
 * index1 = keyed hash of the install ID; blob1 event type; blob2 engine,
 * answer or new/existing; blob3 platform; blob4 app release; blob5
 * environment; blob6 event ID (random, for de-duplication);
 * double1 = when it happened on the computer (ms). The client IP is used only
 * as a hashed rate-limit key and is never written.
 */
export const handleCounts = async (
  request: Request,
  env: CountsEnv,
): Promise<Response> => {
  if (request.method !== "POST") {
    const response = json(405, { error: "method_not_allowed" });
    response.headers.set("allow", "POST");
    return response;
  }
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json")
    return json(415, { error: "unsupported_media_type" });

  const pseudonymize = await createPseudonymizer(
    env.TELEMETRY_PSEUDONYM_KEY,
    env.ENVIRONMENT,
  );
  const clientIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (clientIp) {
    const ipKey = await pseudonymize("counts-ip", clientIp);
    if (!(await env.COUNTS_IP_RATE_LIMITER.limit({ key: ipKey })).success)
      return rateLimited();
  }

  const text = await readSmallBody(request);
  if (text === null) return json(413, { error: "body_too_large" });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  if (!isAnonymousCountsBatch(body))
    return json(400, { error: "invalid_payload" });
  if (body.environment !== env.ENVIRONMENT)
    return json(400, { error: "environment_mismatch" });

  const install = await pseudonymize("anonymous-install", body.installId);
  if (!(await env.COUNTS_INSTALL_RATE_LIMITER.limit({ key: install })).success)
    return rateLimited();

  const now = Date.now();
  const fresh = body.events.filter(
    (item) =>
      item.occurredAtMs >= now - COUNTS_MAX_AGE_MS &&
      item.occurredAtMs <= now + COUNTS_MAX_FUTURE_SKEW_MS,
  );
  for (const item of fresh) {
    env.COUNTS.writeDataPoint({
      indexes: [install],
      blobs: [
        item.event.type,
        anonymousCountDetail(item.event),
        body.platform,
        body.release,
        body.environment,
        item.eventId,
      ],
      doubles: [item.occurredAtMs],
    });
  }
  console.log({
    event: "telemetry.counts_accepted",
    count: fresh.length,
    dropped: body.events.length - fresh.length,
  });
  return json(202, { accepted: fresh.length });
};
