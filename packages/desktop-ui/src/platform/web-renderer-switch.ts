import {
  backendClient,
  readBackendAccountEpoch,
  subscribeBackendAccount,
} from "@/platform/backend/backend-client";
import {
  fetchWithDeadline,
  REQUEST_BUDGET_MS,
} from "@stella/contracts/request-deadline";

const STORAGE_KEY = "stella:web-renderer";
const SHARED_BASE = "/chat-app/";

const remember = (base: string | null) => {
  try {
    if (base) window.localStorage.setItem(STORAGE_KEY, base);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the website boots the shared build.
  }
};

const check = async () => {
  let result: { path: string } | null;
  try {
    result = await backendClient.call("appSource.webRenderer", {});
  } catch {
    return;
  }
  const target = result ? `${SHARED_BASE}${result.path}` : SHARED_BASE;
  const current = new URL("./", window.location.href).pathname;
  if (!current.startsWith(SHARED_BASE)) return;
  if (target === current) {
    remember(result ? target : null);
    return;
  }
  const index = `${target}index.html`;
  const available = await fetchWithDeadline(
    fetch,
    index,
    { method: "HEAD", cache: "no-store" },
    { label: "web app version", timeoutMs: REQUEST_BUDGET_MS.lookup },
  )
    .then((response) => response.ok)
    .catch(() => false);
  if (!available) return;
  remember(result ? target : null);
  window.location.replace(index);
};

export const startWebRendererSwitch = (): void => {
  subscribeBackendAccount(() => void check());
  if (readBackendAccountEpoch() > 0) void check();
};
