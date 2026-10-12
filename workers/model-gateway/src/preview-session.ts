import {
  PREVIEW_SESSION_CAPABILITY_PATH,
  type GatewaySessionCapabilityResponse,
  type PreviewSessionCapabilityRequest,
} from "@stella/contracts/gateway/api";
import type { BillingControlResult } from "@stella/contracts/gateway/usage";

const PREVIEW_EXCHANGE_TIMEOUT_MS = 15_000;

type Result = BillingControlResult<GatewaySessionCapabilityResponse>;

const unavailable: Result = {
  ok: false,
  status: null,
  code: null,
  retryable: true,
};

const isResult = (value: unknown): value is Result => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.ok === true) {
    const body = candidate.body as Record<string, unknown> | undefined;
    return (
      typeof body?.capability === "string" &&
      typeof body.expiresAt === "number"
    );
  }
  return (
    candidate.ok === false &&
    (candidate.status === null || typeof candidate.status === "number") &&
    (candidate.code === null || typeof candidate.code === "string") &&
    typeof candidate.retryable === "boolean"
  );
};

/**
 * The billing step of a session exchange for a desktop signed in to a
 * cloud-builder Preview (dev only). The Preview holds the owner's billing
 * and signs with `builder-preview-1`, which this gateway's CAPABILITY_JWKS
 * already trusts for the Preview's cloud turns.
 */
export const issuePreviewSessionCapability = async (args: {
  issuer: string;
  token: string;
  request: PreviewSessionCapabilityRequest;
  fetch: typeof fetch;
  traceId: string;
}): Promise<Result> => {
  try {
    const response = await args.fetch(
      `${args.issuer}${PREVIEW_SESSION_CAPABILITY_PATH}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${args.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(args.request),
        signal: AbortSignal.timeout(PREVIEW_EXCHANGE_TIMEOUT_MS),
      },
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    if (isResult(payload)) return payload;
    console.warn(
      `[model-gateway] trace=${args.traceId} preview session exchange at ${args.issuer} answered HTTP ${response.status}`,
    );
  } catch (error) {
    console.warn(
      `[model-gateway] trace=${args.traceId} preview session exchange at ${args.issuer} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return unavailable;
};
