import { BackendClient } from "@stella/contracts/backend/client";
import { getAuthToken } from "@/global/auth/services/auth-token";
import { backendUrl } from "./backend-url";
import { createMainLiveTransport } from "./main-live-transport";

export { backendUrl };

if (!backendUrl) {
  console.warn(
    "VITE_STELLA_BACKEND_URL is not set; cloud-backed features remain unavailable until this build is configured.",
  );
}

export const backendSocketUrl = backendUrl.replace(/^http/, "ws");

const baseUrl = backendUrl || "http://127.0.0.1:8787";

let accountEpoch = 0;
let accountKey: string | null = null;
let accountSubject: string | null = null;

const liveTransport = createMainLiveTransport(baseUrl, () => accountSubject);

export const backendClient = new BackendClient({
  baseUrl,
  getToken: (options) =>
    getAuthToken(options?.force ? { forceRefresh: true } : {}),
  ...(liveTransport ? { liveTransport } : {}),
});

if (liveTransport) {
  window.addEventListener("online", () => backendClient.nudge());
}

const epochListeners = new Set<() => void>();

export const setBackendAccount = (
  key: string | null,
  subject: string | null,
): void => {
  if (key === accountKey) return;
  accountKey = key;
  accountSubject = subject;
  accountEpoch += 1;
  backendClient.reconnect();
  for (const listener of epochListeners) listener();
};

export const subscribeBackendAccount = (listener: () => void): (() => void) => {
  epochListeners.add(listener);
  return () => epochListeners.delete(listener);
};

export const readBackendAccountEpoch = (): number => accountEpoch;
