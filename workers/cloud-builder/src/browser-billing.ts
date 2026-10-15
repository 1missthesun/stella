import {
  BROWSER_TARIFF,
  TARIFF_VERSION,
  browserCostMicroCents,
  usdToMicroCents,
  type CostBasis,
  type CostOutcome,
} from "@stella/contracts/billing-tariffs";
import { ownerGateStub } from "./rpc-release.js";

const HOLD_SECONDS = 15 * 60;
const MINIMUM_HOLD_SECONDS = 2 * 60;
const HOLD_TTL_MS = 20 * 60_000;

export const BROWSER_BUDGET_MESSAGE =
  "Your Stella budget doesn't have enough left for the cloud browser. Add credit or upgrade to keep going, or wait until it resets.";

export type BrowserHoldResult = { ok: true } | { ok: false; message: string };

type OwnerEnv = { OWNER_GATES: Cloudflare.Env["OWNER_GATES"] };

const reservationId = (run: string): string => `browser:${run}`;

const hold = async (env: OwnerEnv, ownerId: string, run: string): Promise<BrowserHoldResult> => {
  const now = Date.now();
  const reservation = await ownerGateStub(env.OWNER_GATES, ownerId).reserveSpend({
    id: reservationId(run),
    microCents: browserCostMicroCents(HOLD_SECONDS),
    minimumMicroCents: browserCostMicroCents(MINIMUM_HOLD_SECONDS),
    expiresAt: now + HOLD_TTL_MS,
    category: "browser",
  });
  return reservation.reserved
    ? { ok: true }
    : { ok: false, message: reservation.usageLimit?.message || reservation.message || BROWSER_BUDGET_MESSAGE };
};

// A browser session is held for 15 minutes of Browser Run time before it is
// acquired, and the hold is extended at every settlement while it runs.
export const holdBrowser = (env: OwnerEnv, input: { ownerId: string; run: string }): Promise<BrowserHoldResult> =>
  hold(env, input.ownerId, input.run);

// Charge one interval of a browser session. The first interval of a session
// carries Browser Run's per-session minimum; later ones are linear.
export const settleBrowser = async (
  env: OwnerEnv,
  input: {
    ownerId: string;
    run: string;
    seq: number;
    seconds: number;
    basis: CostBasis;
    final: boolean;
    outcome?: CostOutcome;
    sku?: string;
  },
): Promise<BrowserHoldResult> => {
  const seconds = Math.max(0, input.seconds);
  const microCents =
    input.seq === 0
      ? browserCostMicroCents(seconds)
      : usdToMicroCents((seconds / 3_600) * BROWSER_TARIFF.usdPerBrowserHour);
  const receiptId = `${reservationId(input.run)}:${input.seq}`;
  await ownerGateStub(env.OWNER_GATES, input.ownerId).settleSpend({
    receiptId,
    chargeMicroCents: microCents,
    reservationId: reservationId(input.run),
    release: input.final,
    cost: {
      id: receiptId,
      category: "browser",
      provider: "cloudflare",
      sku: input.sku ?? "browser",
      quantity: { seconds: Math.round(seconds * 1000) / 1000 },
      providerCostMicroCents: microCents,
      basis: input.basis,
      outcome: input.outcome ?? "succeeded",
      tariffVersion: TARIFF_VERSION,
    },
  });
  if (input.final) return { ok: true };
  return await hold(env, input.ownerId, input.run);
};

export const releaseBrowser = async (env: OwnerEnv, input: { ownerId: string; run: string }): Promise<void> => {
  await ownerGateStub(env.OWNER_GATES, input.ownerId).releaseSpend(reservationId(input.run));
};

// One short-lived capture browser (app preview, site screenshot): hold before
// the gateway launches it, charge its lifetime after. The gateway reports the
// browser's launch-to-close time in `x-stella-browser-ms`; a successful
// answer without it is charged the call's wall time as an estimate, and a
// failed one without it launched nothing to charge.
export const meteredCapture = async (
  env: OwnerEnv,
  ownerId: string,
  sku: string,
  upstream: () => Promise<Response>,
): Promise<{ ok: true; response: Response } | { ok: false; message: string }> => {
  const run = crypto.randomUUID();
  const held = await hold(env, ownerId, run);
  if (!held.ok) return held;
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await upstream();
  } catch (error) {
    await releaseBrowser(env, { ownerId, run }).catch(() => undefined);
    throw error;
  }
  const reported = Number(response.headers.get("x-stella-browser-ms"));
  const measured = Number.isFinite(reported) && reported > 0;
  if (!measured && !response.ok) {
    await releaseBrowser(env, { ownerId, run }).catch(() => undefined);
    return { ok: true, response };
  }
  await settleBrowser(env, {
    ownerId,
    run,
    seq: 0,
    seconds: (measured ? reported : Date.now() - startedAt) / 1000,
    basis: measured ? "actual" : "estimated",
    final: true,
    outcome: response.ok ? "succeeded" : "failed",
    sku,
  }).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "browser_capture_settle_failed",
        sku,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  return { ok: true, response };
};
