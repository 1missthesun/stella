import { computerOnlyInCloudMessage, isComputerOnlyProviderId } from "@stella/contracts/backend/providers";
import { CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE } from "@stella/contracts/backend/billing";
import { BILLING_UNAVAILABLE_MESSAGE } from "@stella/contracts/stella-usage-limit";
import type { CloudTurnLane } from "@stella/contracts/turn-plane/turn-start";
import type { OwnerCaller } from "../owner-store/registry.js";
import {
  HEADER_IDENTITY_LEVEL,
  HEADER_OWNER,
  HEADER_SESSION,
  HEADER_SUBJECT,
  HEADER_TOKEN_EXP,
  HEADER_TOKEN_IAT,
} from "../conversation-types.js";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import type {
  DispatchError,
  DispatchSummary,
  ExecutionIngress,
  ExecutionKind,
  ExecutionSubject,
  ExecutionTargetMode,
} from "@stella/contracts/turn-plane/placement";
import { dispatchError } from "../dispatch-policy.js";
import type {
  OwnerGateRefusalCode,
  OwnerGateRefusal,
  DispatchRow,
} from "./types.js";

export const withTimeout = <T>(
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
};

export class OwnerGateSnapshotError extends Error {
  constructor(
    readonly code: "owner_purged" | "internal",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OwnerGateSnapshotError";
  }
}

export const log = (
  level: "info" | "error",
  event: string,
  fields: Record<string, unknown> = {},
) => {
  console[level](
    JSON.stringify({
      service: "stella-v2-cloud-builder",
      component: "owner-gate",
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    }),
  );
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const snapshotAllowsExecution = (
  snapshot: Pick<OwnerSnapshot, "connectedEngines" | "connectedProviders">,
  execution: OwnerSnapshot["execution"],
): boolean =>
  execution.engine === "stella" ||
  (execution.engine === "provider"
    ? (snapshot.connectedProviders ?? []).includes(execution.provider)
    : (snapshot.connectedEngines ?? []).includes(execution.engine));

export const executionUnavailableMessage = (
  execution: OwnerSnapshot["execution"],
): string =>
  execution.engine === "anthropic"
    ? "Connect Claude before using that cloud execution route."
    : execution.engine === "chatgpt"
      ? "Connect ChatGPT before using that cloud execution route."
      : isComputerOnlyProviderId(execution.provider)
        ? computerOnlyInCloudMessage(execution.provider)
        : `Add a key for ${execution.provider} in the model picker (Models on a computer, the chat settings on the phone) before using that cloud model.`;

export const snapshotAllowsCloudSandbox = (
  snapshot: Pick<OwnerSnapshot, "cloudSandbox">,
): boolean => snapshot.cloudSandbox?.enabled !== false;

export const snapshotAdmissionRefusal = (
  snapshot: Pick<OwnerSnapshot, "enforcement" | "writable">,
): OwnerGateRefusal | null => {
  if (snapshot.enforcement?.status === "suspended") {
    return refuse(
      "owner_suspended",
      "This account can't use Stella's cloud right now.",
      false,
    );
  }
  if (!snapshot.writable) {
    return refuse(
      "owner_purged",
      "This account's cloud data is being reset or deleted.",
      false,
    );
  }
  return null;
};

export type CloudTurnRefusal = {
  code:
    | "subscription_required"
    | "usage_limit"
    | "execution_unavailable"
    | "billing_unavailable";
  message: string;
  retryable: boolean;
};

export const cloudTurnRefusal = (
  snapshot: Pick<
    OwnerSnapshot,
    | "cloudSandbox"
    | "usageLimit"
    | "billingUnavailable"
    | "connectedEngines"
    | "connectedProviders"
  >,
  execution: OwnerSnapshot["execution"],
  lane: CloudTurnLane,
): CloudTurnRefusal | null => {
  if (execution.engine === "anthropic" && !snapshotAllowsCloudSandbox(snapshot)) {
    return {
      code: "subscription_required",
      message: CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE,
      retryable: false,
    };
  }
  if (execution.engine === "anthropic" && lane !== "wake" && snapshot.usageLimit) {
    return { code: "usage_limit", message: snapshot.usageLimit.message, retryable: false };
  }
  if (!snapshotAllowsExecution(snapshot, execution)) {
    return {
      code: "execution_unavailable",
      message: executionUnavailableMessage(execution),
      retryable: false,
    };
  }
  if (execution.engine === "stella" && lane !== "wake") {
    if (snapshot.billingUnavailable) {
      return { code: "billing_unavailable", message: BILLING_UNAVAILABLE_MESSAGE, retryable: true };
    }
    if (snapshot.usageLimit) {
      return { code: "usage_limit", message: snapshot.usageLimit.message, retryable: false };
    }
  }
  return null;
};

export const refuse = (
  code: OwnerGateRefusalCode,
  message: string,
  retryable: boolean,
  retryAfterMs?: number,
): OwnerGateRefusal => ({
  ok: false,
  code,
  message,
  retryable,
  ...(retryAfterMs !== undefined
    ? { retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)) }
    : {}),
});

const optional = <T>(value: T | null | undefined, key: string) =>
  value === null || value === undefined || value === "" ? {} : { [key]: value };

export const dispatchSummary = (row: DispatchRow): DispatchSummary => ({
  dispatchId: row.dispatch_id,
  idempotencyKey: row.idempotency_key,
  kind: row.kind as ExecutionKind,
  ingress: row.ingress as ExecutionIngress,
  subject: row.subject as ExecutionSubject,
  ...(optional(row.requested_target_mode, "requestedTargetMode") as {
    requestedTargetMode?: ExecutionTargetMode;
  }),
  ...optional(row.requested_executor_device_id, "requestedExecutorDeviceId"),
  conversationId: row.conversation_id,
  ...optional(row.parent_turn_id, "parentTurnId"),
  ...optional(row.thread_id, "threadId"),
  state: row.state,
  ...(optional(row.placement, "placement") as {
    placement?: "computer" | "cloud";
  }),
  ...optional(row.executor_device_id, "executorDeviceId"),
  ...optional(row.executor_presence_session_id, "executorPresenceSessionId"),
  revision: row.revision,
  ...optional(row.fallback_reason, "fallbackReason"),
  ...optional(row.cancel_request_id, "cancelRequestId"),
  ...optional(row.cancel_reason, "cancelReason"),
  ...optional(row.error_code, "errorCode"),
  ...optional(row.error_message, "errorMessage"),
  ...optional(row.result_json, "resultJson"),
  ...optional(row.cloud_turn_id, "cloudTurnId"),
  ...optional(row.cloud_thread_id, "cloudThreadId"),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const fail = (
  code: DispatchError["error"]["code"],
  message: string,
  retryable: boolean,
  retryAfterMs?: number,
): { ok: false; error: DispatchError["error"] } => ({
  ok: false,
  error: dispatchError(code, message, retryable, retryAfterMs).error,
});

export const trustedOwnerCaller = (request: Request): OwnerCaller | null => {
  const ownerId = request.headers.get(HEADER_OWNER)?.trim() ?? "";
  const subject = request.headers.get(HEADER_SUBJECT)?.trim() ?? "";
  const sessionId = request.headers.get(HEADER_SESSION)?.trim() ?? "";
  const expiresAtMs = Number(request.headers.get(HEADER_TOKEN_EXP));
  const identityLevel = Number(
    request.headers.get(HEADER_IDENTITY_LEVEL) ?? NaN,
  );
  const issuedAtMs = Number(request.headers.get(HEADER_TOKEN_IAT) ?? NaN);
  if (
    !ownerId ||
    !subject ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now()
  ) {
    return null;
  }
  return {
    ownerId,
    subject,
    sessionId,
    expiresAtMs,
    ...(identityLevel === 0 ||
    identityLevel === 1 ||
    identityLevel === 2 ||
    identityLevel === 3
      ? { identityLevel }
      : {}),
    ...(Number.isSafeInteger(issuedAtMs) ? { issuedAtMs } : {}),
  };
};
