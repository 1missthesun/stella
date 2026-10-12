import type { GatewayUsageEvent } from "@stella/contracts/gateway/usage";
import type { TelemetryEventV1 } from "@stella/contracts/telemetry";

export const reportCharges = async (
  env: { TELEMETRY?: unknown; TELEMETRY_ENVIRONMENT?: string },
  ownerId: string,
  events: GatewayUsageEvent[],
): Promise<void> => {
  const telemetry = env.TELEMETRY as
    | {
        ingestForOwner(
          ownerId: string,
          events: TelemetryEventV1[],
        ): Promise<void>;
      }
    | undefined;
  const charged = events.filter(
    (event) => event.billable && event.outcome !== "failed",
  );
  if (!telemetry || charged.length === 0) return;
  const environment =
    env.TELEMETRY_ENVIRONMENT === "production"
      ? "production"
      : "development";
  await telemetry
    .ingestForOwner(
      ownerId,
      charged.map((event) => ({
        schemaVersion: 1,
        eventId: crypto.randomUUID(),
        occurredAtMs: event.finishedAt,
        project: "stella",
        environment,
        source: "cloud-builder",
        event: {
          type: "inference.completed",
          provider: event.provider,
          model: event.resolvedModel,
          agentType: event.agentType,
          durationMs: Math.max(0, event.finishedAt - event.startedAt),
          success: event.outcome === "succeeded",
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          ...(event.usage.cachedInputTokens !== undefined
            ? { cachedInputTokens: event.usage.cachedInputTokens }
            : {}),
          ...(event.usage.cacheWriteTokens !== undefined
            ? { cacheWriteInputTokens: event.usage.cacheWriteTokens }
            : {}),
          ...(event.usage.reasoningTokens !== undefined
            ? { reasoningTokens: event.usage.reasoningTokens }
            : {}),
          totalTokens: event.usage.inputTokens + event.usage.outputTokens,
          costMicroCents: event.chargedMicroCents,
        },
      })),
    )
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: "billing_telemetry_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
};
