export type BackendIntegrationProbeResult =
  | "connected"
  | "not_connected"
  | "unsupported"
  | "error";

export type BackendIntegrationWaitResult =
  | "connected"
  | "timeout"
  | "cancelled"
  | "unsupported"
  | "auth_unavailable";

const readConnected = (
  payload: unknown,
  minConnectedAccounts?: number,
): boolean => {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as { connected?: unknown; accounts?: unknown };
  if (record.connected !== true) return false;
  if (minConnectedAccounts === undefined) return true;
  const accounts = Array.isArray(record.accounts) ? record.accounts : [];
  return (
    accounts.filter(
      (account) =>
        account &&
        typeof account === "object" &&
        (account as { connected?: unknown }).connected === true,
    ).length >= minConnectedAccounts
  );
};

export const connectedAccountCountOf = (payload: unknown): number => {
  const accounts =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { accounts?: unknown }).accounts)
      ? (payload as { accounts: unknown[] }).accounts
      : [];
  return accounts.filter(
    (account) =>
      account &&
      typeof account === "object" &&
      (account as { connected?: unknown }).connected === true,
  ).length;
};

const DEFAULT_PROBE_TIMEOUT_MS = 25_000;

const probeSignal = (probeTimeoutMs: number, signal?: AbortSignal) => {
  const timeout = AbortSignal.timeout(probeTimeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
};

export const probeBackendIntegrationConnection = async (options: {
  backendUrl: string;
  authToken: string;
  id: string;
  probeTimeoutMs?: number;
  minConnectedAccounts?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<BackendIntegrationProbeResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.backendUrl.trim().replace(/\/+$/u, "");
  const response = await fetchImpl(
    `${base}/api/native-integrations/status?id=${encodeURIComponent(options.id)}`,
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.authToken}`,
      },
      signal: probeSignal(
        options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
        options.signal,
      ),
    },
  ).catch(() => null);
  if (!response) return "error";
  if (response.status === 404 || response.status === 405) return "unsupported";
  if (!response.ok) return "error";
  const payload = (await response.json().catch(() => null)) as unknown;
  return readConnected(payload, options.minConnectedAccounts)
    ? "connected"
    : "not_connected";
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });

export const waitForBackendIntegrationConnection = async (options: {
  backendUrl: string;
  authToken: string;
  id: string;
  timeoutMs?: number;
  intervalMs?: number;
  probeTimeoutMs?: number;
  minConnectedAccounts?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<BackendIntegrationWaitResult> => {
  if (!options.backendUrl.trim() || !options.authToken.trim()) {
    return "auth_unavailable";
  }
  const timeoutMs = options.timeoutMs ?? 4 * 60 * 1000;
  const intervalMs = options.intervalMs ?? 2_500;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;
  for (;;) {
    if (options.signal?.aborted) return "cancelled";
    const result = await probeBackendIntegrationConnection(options);
    if (result === "connected") return "connected";
    if (result === "unsupported") return "unsupported";
    if (options.signal?.aborted) return "cancelled";
    if (now() >= deadline) return "timeout";
    await sleep(intervalMs, options.signal);
  }
};
