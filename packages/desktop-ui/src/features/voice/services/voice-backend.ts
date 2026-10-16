import { getAuthToken } from "@/global/auth/services/auth-token";
import { backendUrl } from "@/platform/backend/backend-client";
import {
  fetchWithInactivity,
  REQUEST_BUDGET_MS,
} from "@stella/contracts/request-deadline";

export const voiceBackendFetch = async (
  path: string,
  init: { body: BodyInit; contentType: string; headers?: Record<string, string>; signal?: AbortSignal },
): Promise<Response> => {
  if (!backendUrl) throw new Error("VITE_STELLA_BACKEND_URL is not set.");
  const token = await getAuthToken();
  if (!token) throw new Error("Sign in to Stella to use voice.");
  const response = await fetchWithInactivity(
    fetch,
    `${backendUrl}${path}`,
    {
      method: "POST",
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        "Content-Type": init.contentType,
      },
      body: init.body,
    },
    { label: "voice", idleMs: REQUEST_BUDGET_MS.transferIdle, signal: init.signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let message = detail.trim();
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: unknown } };
      if (typeof parsed.error?.message === "string") message = parsed.error.message;
    } catch {
      // Not JSON; keep the text.
    }
    throw new Error(`Voice request failed (${response.status})${message ? `: ${message}` : ""}`);
  }
  return response;
};
