import type { Env } from "./build-session/shared/env.js";
import { syncModelPrices } from "./catalog/prices.js";
import { sweepAbuseTables } from "./owner-store/domains/abuse.js";
import { sweepAnonymousUsers, sweepAuthTables } from "./auth/sweeps.js";
import { sweepSlackPreviews } from "./slack/previews.js";

export async function runScheduled(
  _controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const sweeps: Array<[string, () => Promise<unknown>]> = [
    ["model prices", () => syncModelPrices(env)],
    ["abuse tables", () => sweepAbuseTables(env)],
    ["auth tables", () => sweepAuthTables(env)],
    ["anonymous users", () => sweepAnonymousUsers(env)],
    ["slack previews", () => sweepSlackPreviews(env)],
    [
      "device pairings",
      async () => (await import("./selfhost/pairing.js")).sweepDevicePairings(env as unknown as Cloudflare.Env),
    ],
  ];
  for (const [name, sweep] of sweeps) {
    try {
      await sweep();
    } catch (error) {
      console.error(`[cron] ${name} failed`, error);
    }
  }
}
