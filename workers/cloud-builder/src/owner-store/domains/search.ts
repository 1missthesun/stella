import type { SearchCalls } from "@stella/contracts/backend/search";
import { TARIFF_VERSION } from "@stella/contracts/billing-tariffs";
import { searchWeb, webSearchMaxCostMicroCents } from "../../web-search.js";
import { object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDomain } from "../registry.js";
import { reserveSpend, settleSpend } from "./billing.js";
import { cancelSpendExpiry, expireSpendAt } from "./spend-expiry.js";

type SearchArgs = SearchCalls["search.web"]["args"];
type SearchResult = SearchCalls["search.web"]["result"];

const SEARCH_TIMEOUT_MS = 90_000;
const SEARCH_RESERVATION_MS = SEARCH_TIMEOUT_MS + 60_000;

const parseSearch = object({
  query: string({ max: 2_000 }),
  category: optional(string({ max: 200 })),
});

const webSearch = async (
  ctx: OwnerContext,
  args: SearchArgs,
): Promise<SearchResult> => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "search.web",
    { count: 30, windowMs: 60_000 },
    "Too many web searches. Wait a moment and try again.",
  );
  const id = `search:${crypto.randomUUID()}`;
  const hold = reserveSpend(ctx, {
    id,
    microCents: webSearchMaxCostMicroCents(ctx.env),
    expiresAt: ctx.now + SEARCH_RESERVATION_MS,
    category: "search",
  });
  if (!hold.reserved) {
    throw new RpcError("RATE_LIMITED", hold.message || "Your Stella budget is too low for a web search.", {
      retryAfterMs: hold.retryAfterMs,
      reason: "usage_limit",
    });
  }
  expireSpendAt(ctx, { id, category: "search", provider: "web", sku: "search" }, ctx.now + SEARCH_RESERVATION_MS);
  const outcome = await searchWeb(ctx.env, {
    query: args.query,
    ...(args.category ? { category: args.category } : {}),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  settleSpend(
    { ...ctx, now: Date.now() },
    {
      receiptId: id,
      chargeMicroCents: outcome.costMicroCents,
      reservationId: id,
      release: true,
      ...(outcome.billing
        ? {
            cost: {
              id,
              category: "search",
              provider: outcome.billing.provider,
              sku: outcome.billing.sku,
              quantity: { requests: 1, results: outcome.result.results.length },
              providerCostMicroCents: outcome.costMicroCents,
              basis: outcome.billing.basis,
              outcome: outcome.billing.outcome,
              tariffVersion: TARIFF_VERSION,
            },
          }
        : {}),
    },
  );
  cancelSpendExpiry(ctx, id);
  return outcome.result;
};

export const searchDomain: OwnerDomain = {
  name: "search",
  calls: {
    "search.web": {
      scope: "owner",
      parse: parseSearch,
      handler: webSearch,
    },
  },
  internal: {
    "search.web": (ctx, args) => webSearch(ctx, parseSearch(args)),
  },
};
