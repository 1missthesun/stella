import {
  GATEWAY_USAGE_EVENT_VERSION,
  type GatewayUsageBatch,
  type GatewayUsageEvent,
} from "@stella/contracts/gateway/usage";
import type { BillingControlRpc } from "@stella/contracts/gateway/usage";
import { billingControl } from "./billing-control.js";
import { logUnreconciled } from "./usage-outbox.js";

const RETRY_DELAY_SECONDS = [5, 15, 60, 180, 600] as const;

export const isUsageEvent = (value: unknown): value is GatewayUsageEvent => {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    event.v === GATEWAY_USAGE_EVENT_VERSION &&
    typeof event.requestId === "string" &&
    typeof event.capabilityId === "string" &&
    typeof event.ownerId === "string" &&
    typeof event.usage === "object" &&
    event.usage !== null &&
    typeof event.chargedMicroCents === "number"
  );
};

// Matches max_retries of the dead-letter consumers in wrangler.jsonc.
const DEAD_LETTER_MAX_ATTEMPTS = 10;
const PERMANENT_REJECTIONS = new Set(["owner_mismatch"]);

const isDeadLetterQueue = (queue: string): boolean => /-dlq(-|$)/u.test(queue);

/**
 * Usage events the gateway could not hold in its ledger outbox, and the
 * dead letters of this queue. A message is acknowledged only once billing
 * accepted it or already had it; the dead-letter consumer re-ingests, and
 * logs `billing_usage_unreconciled` for anything that still cannot land.
 */
export const handleUsageBatch = async (
  batch: MessageBatch<unknown>,
  env: Pick<Env, "BILLING">,
  billing: BillingControlRpc = billingControl(env),
): Promise<void> => {
  const deadLetters = isDeadLetterQueue(batch.queue);
  const pending: Array<{ message: Message<unknown>; event: GatewayUsageEvent }> = [];
  for (const message of batch.messages) {
    if (isUsageEvent(message.body)) {
      pending.push({ message, event: message.body });
    } else {
      console.error(
        `[model-gateway:usage] dropping malformed message id=${message.id}`,
      );
      message.ack();
    }
  }
  if (pending.length === 0) return;

  const payload: GatewayUsageBatch = {
    v: GATEWAY_USAGE_EVENT_VERSION,
    events: pending.map((entry) => entry.event),
  };
  let landed = new Set<string>();
  let rejected = new Map<string, string>();
  let failure: string | null = null;
  try {
    const settled = await billing.ingestUsage(payload);
    landed = new Set([...settled.accepted, ...settled.duplicate]);
    rejected = new Map(settled.rejected.map((entry) => [entry.requestId, entry.reason]));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  for (const { message, event } of pending) {
    const reason = failure ?? rejected.get(event.requestId) ?? null;
    if (!failure && landed.has(event.requestId) && !rejected.has(event.requestId)) {
      message.ack();
      continue;
    }
    if (reason && PERMANENT_REJECTIONS.has(reason)) {
      logUnreconciled(event, reason, { permanent: true, queue: batch.queue });
      message.ack();
      continue;
    }
    if (deadLetters && message.attempts >= DEAD_LETTER_MAX_ATTEMPTS) {
      logUnreconciled(event, reason ?? "not_acknowledged", {
        queue: batch.queue,
        attempts: message.attempts,
      });
      message.ack();
      continue;
    }
    const delaySeconds =
      RETRY_DELAY_SECONDS[Math.min(message.attempts, RETRY_DELAY_SECONDS.length) - 1] ??
      RETRY_DELAY_SECONDS[RETRY_DELAY_SECONDS.length - 1];
    console.warn(
      `[model-gateway:usage] queue=${batch.queue} request=${event.requestId} attempt=${event.attempt ?? 1} not landed (${reason ?? "not_acknowledged"}); retrying in ${delaySeconds}s`,
    );
    message.retry({ delaySeconds });
  }
};
