import {
  PREVIEW_SESSION_CAPABILITY_PATH,
  type GatewaySessionCapabilityResponse,
} from "@stella/contracts/gateway/api";
import { isDpopAlgorithm, verifyDeviceKeyProof } from "@stella/contracts/gateway/dpop";
import type { BillingControlResult } from "@stella/contracts/gateway/usage";
import { bearerCredential } from "../../../shared/bearer.js";
import { parseNetworkClass } from "../../../shared/network-class.js";
import { verifyUserToken } from "../auth-jwt.js";
import { ownerGateStub } from "../rpc-release.js";

/**
 * `POST /api/gateway/preview-session-capability` (contracts gateway/api.ts):
 * the dev model gateway's session exchange for a desktop signed in to this
 * Preview. Served only by a Worker that signs with the Preview key, which
 * only the dev gateway trusts, so dev and production never answer it.
 */
const PREVIEW_SIGNING_KID = "builder-preview-1";
const IP_HASH_PATTERN = /^[0-9a-f]{32}$/u;

type Result = BillingControlResult<GatewaySessionCapabilityResponse>;

const reply = (status: number, body: Result): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const refuse = (status: number, code: "unauthorized" | "bad_request" | "dpop_invalid"): Response =>
  reply(status, { ok: false, status, code, retryable: false });

export async function handlePreviewSessionCapabilityRoute(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== PREVIEW_SESSION_CAPABILITY_PATH) return null;
  if (String(env.CAPABILITY_SIGNING_KID ?? "").trim() !== PREVIEW_SIGNING_KID) {
    return new Response("Not found", { status: 404 });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = bearerCredential(request.headers.get("authorization"));
  if (!token) return refuse(401, "unauthorized");
  const verified = await verifyUserToken(token, env);
  if (!verified.ok) {
    return verified.retryable
      ? reply(503, { ok: false, status: null, code: null, retryable: true })
      : refuse(401, "unauthorized");
  }

  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return refuse(400, "bad_request");
    body = parsed as Record<string, unknown>;
  } catch {
    return refuse(400, "bad_request");
  }
  const proof = body.deviceKey as Record<string, unknown> | undefined;
  if (
    !proof ||
    typeof proof !== "object" ||
    typeof proof.alg !== "string" ||
    !isDpopAlgorithm(proof.alg) ||
    typeof proof.publicKey !== "string" ||
    typeof proof.signature !== "string" ||
    typeof proof.timestamp !== "number"
  ) {
    return refuse(400, "dpop_invalid");
  }
  const networkClass = parseNetworkClass(typeof body.networkClass === "string" ? body.networkClass : null);
  const ipHash = typeof body.ipHash === "string" && IP_HASH_PATTERN.test(body.ipHash) ? body.ipHash : null;
  const turnstileToken = body.turnstileToken;
  if (
    !networkClass ||
    !ipHash ||
    (turnstileToken !== undefined && (typeof turnstileToken !== "string" || turnstileToken.length > 4_096))
  ) {
    return refuse(400, "bad_request");
  }

  const ownerId = verified.token.ownerId;
  const deviceProof = await verifyDeviceKeyProof({
    proof: {
      alg: proof.alg,
      publicKey: proof.publicKey,
      signature: proof.signature,
      timestamp: proof.timestamp,
    },
    ownerId,
    gatewayOrigin: new URL(env.MODEL_GATEWAY_URL).origin,
    now: Date.now(),
  });
  if (!deviceProof.ok) return refuse(400, "dpop_invalid");

  try {
    const result = await ownerGateStub(env.OWNER_GATES, ownerId).issueSessionCapability({
      ownerId,
      ipHash,
      networkClass,
      deviceKeyHash: deviceProof.deviceKeyHash,
      ...(turnstileToken !== undefined ? { turnstileToken } : {}),
    });
    return reply(200, result);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "preview_session_capability_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return reply(503, { ok: false, status: null, code: null, retryable: true });
  }
}
