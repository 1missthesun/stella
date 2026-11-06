import {
  BILLING_UNAVAILABLE_MESSAGE,
  STELLA_USAGE_LIMIT_MESSAGES,
} from "@stella/contracts/stella-usage-limit";
import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import {
  CONVERSATION_ID_PATTERN,
  type CloudTurnStartErrorCode,
} from "@stella/contracts/turn-plane/turn-start";
import { CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE } from "@stella/contracts/backend/billing";

export const CLOUD_TURN_SIGN_IN_REQUIRED_MESSAGE =
  "Sign in to Stella to send cloud messages.";

const FALLBACK_MESSAGES: Record<CloudTurnStartErrorCode, string> = {
  unauthorized: CLOUD_TURN_SIGN_IN_REQUIRED_MESSAGE,
  forbidden: "This account can't send to that conversation.",
  owner_mismatch: "That conversation belongs to a different account.",
  bad_request:
    "That message couldn't be sent as written. Edit it and try again.",
  conversation_locked:
    "This conversation is busy. Wait for the current turn to finish, then try again.",
  idempotency_conflict:
    "This message was already sent with different content. Send it again as a new message.",
  owner_purged:
    "This account's cloud data was reset. Start a new conversation.",
  generation_stale: "This request started before the account data was reset.",
  execution_unavailable:
    "That model isn't available for cloud turns right now. Choose another and try again.",
  sign_in_required: "Sign in to Stella to use cloud agents.",
  subscription_required: CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE,
  usage_limit: STELLA_USAGE_LIMIT_MESSAGES.plan_limit,
  billing_unavailable: BILLING_UNAVAILABLE_MESSAGE,
  owner_suspended: "This account can't use Stella's cloud right now.",
  internal: "That didn't send. Try again.",
};

const openBilling = () => planUsageDialog.openPlans();

export const notifyCloudSubscriptionRequired = (message?: string): void => {
  void import("@/ui/toast").then(({ showToast }) => {
    showToast({
      title: message?.trim() || CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE,
      description: "Running on your own computer stays free.",
      variant: "error",
      duration: 10_000,
      action: { label: "Upgrade", onClick: openBilling },
    });
  });
};

export class CloudTurnStartClientError extends Error {
  readonly code: CloudTurnStartErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(args: {
    code: CloudTurnStartErrorCode;
    status: number;
    message?: string;
    retryable?: boolean;
    retryAfterMs?: number | null;
  }) {
    const retryAfterMs =
      typeof args.retryAfterMs === "number" &&
      Number.isFinite(args.retryAfterMs) &&
      args.retryAfterMs > 0
        ? Math.round(args.retryAfterMs)
        : null;
    const base = args.message?.trim() || FALLBACK_MESSAGES[args.code];
    super(
      retryAfterMs !== null
        ? `${base} Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`
        : base,
    );
    this.name = "CloudTurnStartClientError";
    this.code = args.code;
    this.status = args.status;
    this.retryable = args.retryable ?? false;
    this.retryAfterMs = retryAfterMs;
  }

  get isAuth(): boolean {
    return (
      this.code === "unauthorized" ||
      this.code === "forbidden" ||
      this.code === "sign_in_required"
    );
  }

  get isConflict(): boolean {
    return (
      this.code === "conversation_locked" ||
      this.code === "idempotency_conflict"
    );
  }
}

export class CloudTurnStartTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CloudTurnStartTransportError";
  }
}

export const newCloudConversationId = (): string => {
  const id = crypto.randomUUID();
  if (!CONVERSATION_ID_PATTERN.test(id)) {
    throw new Error("Minted conversation id does not satisfy the contract.");
  }
  return id;
};

