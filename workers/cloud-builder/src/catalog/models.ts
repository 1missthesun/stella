import { rpcErrorStatus } from "@stella/contracts/backend/protocol";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import { STELLA_MODELS_PATH } from "@stella/contracts/stella-api";
import {
  STELLA_MODEL_CATALOG_UPDATED_AT,
  listStellaCatalogModels,
  listStellaDefaultSelections,
} from "@stella/model-catalog/aliases";
import { bearerCredential } from "../../../shared/bearer.js";
import { sha256Hex } from "../hash.js";
import { verifyCaller, verifySignedCaller } from "../http/caller.js";
import { readManagedModelPrices } from "./prices.js";
import { ownerGateStub } from "../rpc-release.js";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET",
  "access-control-allow-headers": "authorization, if-none-match, x-device-id",
  "access-control-expose-headers": "etag",
  "access-control-max-age": "7200",
};

const renderedCatalogCache = new Map<string, { body: string; etag: string }>();

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...(body === null ? {} : { "content-type": "application/json" }),
      "cache-control": "private, no-cache",
      ...headers,
    },
  });

const audienceFor = async (
  request: Request,
  env: Cloudflare.Env,
): Promise<{ ok: true; audience: ManagedModelAudience } | { ok: false; response: Response }> => {
  const token = bearerCredential(request.headers.get("authorization"));
  if (!token) return { ok: true, audience: "free" };
  const verified = await verifySignedCaller(env, token);
  if (!verified.ok) {
    return { ok: false, response: reply(rpcErrorStatus(verified.error.code), { error: verified.error.message }) };
  }
  try {
    const result = await ownerGateStub(env.OWNER_GATES, verified.caller.ownerId).billingAccessForCaller(
      verified.caller,
    );
    if (!result.ok) {
      return { ok: false, response: reply(401, { error: "Your sign-in expired. Sign in again to continue." }) };
    }
    return { ok: true, audience: result.access.audience };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('does not implement the method "billingAccessForCaller"')
    ) {
      const checked = await verifyCaller(env, token);
      if (!checked.ok) {
        return { ok: false, response: reply(rpcErrorStatus(checked.error.code), { error: checked.error.message }) };
      }
      const access = await ownerGateStub(env.OWNER_GATES, checked.caller.ownerId).billingAccess();
      return { ok: true, audience: access.audience };
    }
    throw error;
  }
};

export async function handleStellaModelsRoute(request: Request, env: Cloudflare.Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== STELLA_MODELS_PATH) return null;
  if (request.method === "OPTIONS") return reply(204, null);
  if (request.method !== "GET") return reply(405, { error: "Method not allowed." });
  const gatewayOrigin = new URL(env.MODEL_GATEWAY_URL).origin;
  try {
    const [resolved, { prices, updatedAt: pricesUpdatedAt }] = await Promise.all([
      audienceFor(request, env),
      readManagedModelPrices(env),
    ]);
    if (!resolved.ok) return resolved.response;
    const { audience } = resolved;
    const cacheKey = `${audience}|${pricesUpdatedAt}|${gatewayOrigin}`;
    let cached = renderedCatalogCache.get(cacheKey);
    if (!cached) {
      const priceByModel = new Map(prices.map((price) => [price.model, price]));
      const body = JSON.stringify({
        data: listStellaCatalogModels(audience).map((model) => {
          const price = priceByModel.get(model.upstreamModel);
          return {
            id: model.id,
            name: model.name,
            provider: model.provider,
            type: model.type,
            upstreamModel: model.upstreamModel,
            api: model.api,
            allowedForAudience: model.allowedForAudience,
            pricing: price
              ? {
                  inputPerMillionUsd: price.inputPerMillionUsd,
                  outputPerMillionUsd: price.outputPerMillionUsd,
                  cacheReadPerMillionUsd: price.cacheReadPerMillionUsd,
                  cacheWritePerMillionUsd: price.cacheWritePerMillionUsd,
                }
              : null,
          };
        }),
        defaults: listStellaDefaultSelections(audience),
        updatedAt: Math.max(STELLA_MODEL_CATALOG_UPDATED_AT, pricesUpdatedAt),
        gateway: { origin: gatewayOrigin },
      });
      const etag = `"${(await sha256Hex(body)).slice(0, 32)}"`;
      if (renderedCatalogCache.size > 16) renderedCatalogCache.clear();
      cached = { body, etag };
      renderedCatalogCache.set(cacheKey, cached);
    }
    const { body, etag } = cached;
    const presented = request.headers.get("if-none-match") ?? "";
    if (presented.split(",").some((value) => value.trim().replace(/^W\//, "") === etag)) {
      return reply(304, null, { etag });
    }
    return new Response(body, {
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/json", "cache-control": "private, no-cache", etag },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "stella_models_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return reply(503, { error: "The model catalog is temporarily unavailable." });
  }
}
