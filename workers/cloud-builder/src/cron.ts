import type { Env } from "./build-session/shared/env.js";
import { syncModelPrices } from "./catalog/prices.js";
import { sweepAbuseTables } from "./owner-store/domains/abuse.js";
import { sweepAnonymousUsers, sweepAuthTables } from "./auth/sweeps.js";
import { sweepSlackPreviews } from "./slack/previews.js";

const HOURLY_CRON = "41 * * * *";

export async function runScheduled(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const deletions: [string, () => Promise<unknown>] = [
    "account deletions",
    async () =>
      (await import("./auth/account-deletion.js")).runAccountDeletions(env as unknown as Cloudflare.Env),
  ];
  const sweeps: Array<[string, () => Promise<unknown>]> = controller.cron === HOURLY_CRON ? [deletions] : [
    deletions,
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
