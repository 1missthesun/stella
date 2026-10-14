import { log } from "../build-session/shared/keys.js";
import { RpcError } from "../owner-store/errors.js";
import type { MapsAdmission } from "./google-resolve.js";

export const ownerMapsAdmission =
  (ownerInternal: (name: string, args: unknown) => Promise<unknown>): MapsAdmission =>
  async ({ places, route }) => {
    const requestId = crypto.randomUUID();
    try {
      await ownerInternal("maps.admit", { requestId, places, route });
    } catch (error) {
      if (error instanceof RpcError && (error.code === "RATE_LIMITED" || error.code === "FORBIDDEN")) {
        return { ok: false, status: error.code === "RATE_LIMITED" ? 429 : 403, error: error.message };
      }
      throw error;
    }
    return {
      ok: true,
      settle: async (usage) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await ownerInternal("maps.settle", { requestId, ...usage });
            return;
          } catch (error) {
            log("error", "maps_settle_failed", { attempt, message: error instanceof Error ? error.message : String(error) });
          }
        }
      },
    };
  };
