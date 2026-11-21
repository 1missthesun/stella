// Electron main is the OS and window shell: sign-in flows, model lists,
// prompts and connector logic run in the runtime, and main reaches them with
// a host call (RUNTIME_APP_SERVICE_CALLS). Main keeps what only it can do:
// the OS keychain behind the credential stores, windows, and opening links.
import { waitForConnectedRunner } from "../ipc/runtime-availability.js";

type Runner = {
  callRuntime: (method: string, ...args: unknown[]) => Promise<unknown>;
  getAvailabilitySnapshot: () => { connected: boolean; reason?: string };
  onAvailabilityChange: (listener: (snapshot: unknown) => void) => () => void;
};

type RunnerSource = {
  getRunner: () => Runner | null | undefined;
  onRunnerChanged: (listener: (runner: Runner | null) => void) => () => void;
};

let source: RunnerSource | null = null;

export const configureRuntimeAppServices = (value: RunnerSource): void => {
  source = value;
};

/**
 * Wait for the runtime (it may still be starting, or restarting after an
 * update) and run one of its app services.
 */
export const callRuntimeAppService = async <T = unknown>(
  method: string,
  ...args: unknown[]
): Promise<T> => {
  if (!source) throw new Error("Stella's runtime is not set up yet.");
  // runtime-availability.js is untyped JS whose inferred options omit
  // onRunnerChanged, which it reads.
  const waitOptions = {
    timeoutMs: 20_000,
    unavailableMessage: "Stella's runtime is not ready yet.",
    onRunnerChanged: source.onRunnerChanged,
  };
  const runner = (await waitForConnectedRunner(
    source.getRunner,
    waitOptions as Parameters<typeof waitForConnectedRunner>[1],
  )) as Runner;
  return (await runner.callRuntime(method, ...args)) as T;
};

/**
 * The credential store's refresh step (LlmOAuthKeyResolver): the provider
 * code that refreshes a sign-in and derives its key runs in the runtime.
 */
export const resolveLlmOAuthApiKeyInRuntime = (
  provider: string,
  credentials: { access: string; refresh: string; expires: number },
  options: { forceRefresh: boolean },
) =>
  callRuntimeAppService<{
    credentials: { access: string; refresh: string; expires: number };
    apiKey: string;
  }>("resolveLlmOAuthApiKey", {
    provider,
    credentials,
    forceRefresh: options.forceRefresh,
  });

export type AppServiceNotice =
  | { type: "auth_url"; url: string }
  | { type: "device_code"; verificationUri: string; userCode: string }
  | { type: "registration"; clientId: string }
  | { type: "install_progress"; progress: unknown };

const watchers = new Map<string, (notice: AppServiceNotice) => void>();

/**
 * Follow work the runtime runs for the app (a sign-in, an install): it
 * reports what needs main (a page to open, a device code to show, progress)
 * through the appServiceProgress host handler, keyed by the id the caller
 * chose, and main, which owns the browser and windows, acts on it.
 */
export const watchAppServiceProgress = (
  id: string,
  onNotice: (notice: AppServiceNotice) => void,
): (() => void) => {
  watchers.set(id, onNotice);
  return () => {
    if (watchers.get(id) === onNotice) watchers.delete(id);
  };
};

/** The appServiceProgress host handler. */
export const deliverAppServiceProgress = (payload: unknown): void => {
  const { loginId, notice } = (payload ?? {}) as {
    loginId?: unknown;
    notice?: AppServiceNotice;
  };
  if (typeof loginId !== "string" || !notice || typeof notice !== "object") return;
  watchers.get(loginId)?.(notice);
};
