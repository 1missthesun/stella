// Connector work (the catalog, which integrations are on, their accounts and
// sign-ins) runs in the runtime. A sign-in step that needs a window (an
// approval card, a device code, the browser) comes back to main as the
// requestConnectorSignIn host handler, which routes it to the UI handlers the
// caller registered for that flow.
import { randomUUID } from "node:crypto";
import { callRuntimeAppService } from "./runtime-app-services.js";

type SignInOutcome = { ok: true } | { ok: false; reason: string };
type SignInRequest = (payload: any) => Promise<SignInOutcome>;

export type IntegrationFlowUi = {
  requestPreregisteredOAuth?: SignInRequest;
  requestDeviceOAuth?: SignInRequest;
  requestExternalOAuthApproval?: SignInRequest;
};

export type IntegrationFlowAuth = {
  getAuthToken?: () => Promise<string | null>;
  getBackendUrl?: () => string | null;
};

const flows = new Map<string, IntegrationFlowUi>();

export const runIntegrationFlow = async <T>(
  method: string,
  ui: IntegrationFlowUi & IntegrationFlowAuth,
  request: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> => {
  const flowId = randomUUID();
  flows.set(flowId, ui);
  const cancel = () =>
    void callRuntimeAppService("cancelIntegrationFlow", { flowId }).catch(() => undefined);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) throw signal.reason ?? new Error("Connection cancelled.");
    const authToken = (await ui.getAuthToken?.())?.trim() || null;
    const backendUrl = ui.getBackendUrl?.()?.trim() || null;
    return await callRuntimeAppService<T>(method, {
      ...request,
      flowId,
      auth: { backendUrl, authToken },
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
    flows.delete(flowId);
  }
};

/** The requestConnectorSignIn host handler. */
export const deliverConnectorSignIn = async (request: unknown): Promise<SignInOutcome> => {
  const { flowId, kind, payload } = (request ?? {}) as {
    flowId?: unknown;
    kind?: unknown;
    payload?: unknown;
  };
  const ui = typeof flowId === "string" ? flows.get(flowId) : undefined;
  const handler =
    kind === "preregistered"
      ? ui?.requestPreregisteredOAuth
      : kind === "device"
        ? ui?.requestDeviceOAuth
        : kind === "external"
          ? ui?.requestExternalOAuthApproval
          : undefined;
  if (!handler) return { ok: false, reason: "unsupported" };
  return await handler(payload);
};
