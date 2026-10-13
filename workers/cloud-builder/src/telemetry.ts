import type { RpcResponse } from "@stella/contracts/backend/protocol";
import type {
  CloudTurnTelemetry,
  TelemetryEventV1,
} from "@stella/contracts/telemetry";
import { ownerGateStub } from "./rpc-release.js";

type TelemetryRpc = {
  ingest(events: TelemetryEventV1[]): Promise<void>;
};

type TelemetryEnv = Pick<Cloudflare.Env, "OWNER_GATES"> & {
  TELEMETRY_ENVIRONMENT: "development" | "production";
  TELEMETRY?: unknown;
};

/** The owner a cloud-side telemetry event is about. */
export type TelemetryOwner = { ownerId: string; ownerGeneration: string };

/**
 * The owner's telemetry preference (Settings, `preferences.telemetryEnabled`)
 * is the one gate every cloud-side telemetry producer passes. Only an explicit
 * `true` reports: an unreadable preference reports nothing.
 */
export const ownerAllowsTelemetry = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES">,
  owner: TelemetryOwner,
): Promise<boolean> => {
  try {
    const response = (await ownerGateStub(
      env.OWNER_GATES,
      owner.ownerId,
    ).ownerInternal({
      name: "preferences.telemetryEnabled",
      args: {},
      ownerGeneration: owner.ownerGeneration,
    })) as unknown as RpcResponse;
    return response.ok && response.value === true;
  } catch {
    return false;
  }
};

/**
 * Best-effort private Worker-to-Worker telemetry. Business delivery never
 * waits on analytics, and no turn/user identifiers or content leave Builder.
 * Nothing is sent for an owner who turned telemetry off.
 */
export const emitCloudTurnTelemetry = (
  ctx: Pick<ExecutionContext, "waitUntil">,
  env: TelemetryEnv,
  owner: TelemetryOwner,
  event: CloudTurnTelemetry,
): void => {
  if (!env.TELEMETRY) return;
  // Wrangler cannot infer another deployed Worker's named-entrypoint RPC
  // shape, so the binding is generated as Service and narrowed at this one
  // reviewed boundary.
  const telemetry = env.TELEMETRY as TelemetryRpc;
  const envelope: TelemetryEventV1 = {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    occurredAtMs: Date.now(),
    project: "stella",
    environment: env.TELEMETRY_ENVIRONMENT,
    source: "cloud-builder",
    event,
  };
  ctx.waitUntil(
    (async () => {
      if (!(await ownerAllowsTelemetry(env, owner))) return;
      await telemetry.ingest([envelope]);
    })().catch(() => undefined),
  );
};
