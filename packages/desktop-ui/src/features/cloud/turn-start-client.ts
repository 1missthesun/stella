import {
  BILLING_UNAVAILABLE_MESSAGE,
  STELLA_USAGE_LIMIT_MESSAGES,
} from "@stella/contracts/stella-usage-limit";
import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import {
  CONVERSATION_ID_PATTERN,
  TURN_PLANE_PROTOCOL,
  TURN_TITLE_MAX_CHARS,
  turnStartPath,
  type CloudTurnStartError,
  type CloudTurnStartErrorCode,
  type CloudTurnStartRequest,
  type CloudTurnStartResponse,
} from "@stella/contracts/turn-plane/turn-start";
import { CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE } from "@stella/contracts/backend/billing";
import type { PendingCloudTurnSubmission } from "./conversation-outbox";

export const TURN_START_TIMEOUT_MS = 30_000;

export type CloudTurnStartTokenOptions = { forceRefresh?: boolean };
export type CloudTurnStartGetToken = (
  options?: CloudTurnStartTokenOptions,
) => Promise<string | null>;

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

const openBilling = () => planUsageDialog.open();

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

const ERROR_CODES = new Set<string>(Object.keys(FALLBACK_MESSAGES));

const isErrorCode = (value: unknown): value is CloudTurnStartErrorCode =>
  typeof value === "string" && ERROR_CODES.has(value);

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

export const cloudTurnTitleHint = (text: string): string | undefined => {
  const title = text.replace(/\s+/g, " ").trim().slice(0, TURN_TITLE_MAX_CHARS);
  return title || undefined;
};

export const cloudTurnStartRequest = (
  clientMsgId: string,
  submission: PendingCloudTurnSubmission,
  visibleText: string,
): CloudTurnStartRequest => {
  const title = cloudTurnTitleHint(visibleText);
  return {
    protocol: TURN_PLANE_PROTOCOL,
    clientMsgId,
    prompt: submission.prompt,
    ...(submission.execution ? { execution: submission.execution } : {}),
    ...(submission.locale ? { locale: submission.locale } : {}),
    ...(submission.imagePaths.length
      ? { attachments: [...submission.imagePaths] }
      : {}),
    ...(submission.context ? { context: submission.context } : {}),
    source: "desktop",
    ...(title ? { title } : {}),
  };
};

const readErrorBody = async (
  response: Response,
): Promise<CloudTurnStartError["error"] | null> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const error = (payload as Partial<CloudTurnStartError> | null)?.error;
  if (!error || typeof error !== "object") return null;
  const candidate = error as Partial<CloudTurnStartError["error"]>;
  if (!isErrorCode(candidate.code)) return null;
  return {
    code: candidate.code,
    message: typeof candidate.message === "string" ? candidate.message : "",
    retryable: candidate.retryable === true,
    ...(typeof candidate.retryAfterMs === "number"
      ? { retryAfterMs: candidate.retryAfterMs }
      : {}),
  };
};

const codeForStatus = (status: number): CloudTurnStartErrorCode => {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 409:
      return "conversation_locked";
    default:
      return "internal";
  }
};

const retryAfterHeaderMs = (response: Response): number | null => {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
};

const toClientError = async (
  response: Response,
): Promise<CloudTurnStartClientError> => {
  const body = await readErrorBody(response);
  const status = response.status;
  const code = body?.code ?? codeForStatus(status);
  const retryAfterMs =
    body?.retryAfterMs ??
    (status === 429 ? retryAfterHeaderMs(response) : null);
  if (code === "subscription_required") {
    notifyCloudSubscriptionRequired(body?.message);
  }
  return new CloudTurnStartClientError({
    code,
    status,
    message: body?.message,
    retryable:
      body?.retryable ?? (status === 409 || status === 429 || status >= 500),
    retryAfterMs,
  });
};

const isStartResponse = (
  value: unknown,
  conversationId: string,
): value is CloudTurnStartResponse => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CloudTurnStartResponse>;
  return (
    candidate.protocol === TURN_PLANE_PROTOCOL &&
    candidate.accepted === true &&
    candidate.conversationId === conversationId &&
    typeof candidate.turnId === "string" &&
    candidate.turnId.length > 0 &&
    typeof candidate.replayed === "boolean" &&
    typeof candidate.createdConversation === "boolean"
  );
};

export type StartCloudTurnArgs = {
  httpOrigin: string;
  conversationId: string;
  request: CloudTurnStartRequest;
  getToken: CloudTurnStartGetToken;
  fetch?: typeof fetch;
};

const postOnce = async (
  args: StartCloudTurnArgs,
  token: string,
): Promise<Response> => {
  const fetchImpl = args.fetch ?? globalThis.fetch;
  try {
    return await fetchImpl(
      `${args.httpOrigin}${turnStartPath(args.conversationId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(args.request),
        signal: AbortSignal.timeout(TURN_START_TIMEOUT_MS),
      },
    );
  } catch (error) {
    const name = (error as { name?: unknown })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new CloudTurnStartTransportError(
        "The cloud turn request timed out. Try again.",
        { cause: error },
      );
    }
    throw new CloudTurnStartTransportError(
      "Stella's cloud could not be reached. Check the connection and try again.",
      { cause: error },
    );
  }
};

export const startCloudTurn = async (
  args: StartCloudTurnArgs,
): Promise<CloudTurnStartResponse> => {
  if (!CONVERSATION_ID_PATTERN.test(args.conversationId)) {
    throw new CloudTurnStartClientError({
      code: "bad_request",
      status: 0,
      message: "That conversation id is not valid.",
    });
  }
  const token = (await args.getToken())?.trim();
  if (!token) {
    throw new CloudTurnStartClientError({ code: "unauthorized", status: 0 });
  }
  let response = await postOnce(args, token);
  if (response.status === 401) {
    const refreshed = (await args.getToken({ forceRefresh: true }))?.trim();
    if (refreshed && refreshed !== token) {
      response = await postOnce(args, refreshed);
    }
  }
  if (!response.ok) throw await toClientError(response);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!isStartResponse(payload, args.conversationId)) {
    throw new CloudTurnStartClientError({
      code: "internal",
      status: response.status,
      message: "Stella's cloud returned a malformed turn receipt.",
      retryable: true,
    });
  }
  return payload;
};
