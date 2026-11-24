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

export const callRuntimeAppService = async <T = unknown>(
  method: string,
  ...args: unknown[]
): Promise<T> => {
  if (!source) throw new Error("Stella's runtime is not set up yet.");
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

export const watchAppServiceProgress = (
  id: string,
  onNotice: (notice: AppServiceNotice) => void,
): (() => void) => {
  watchers.set(id, onNotice);
  return () => {
    if (watchers.get(id) === onNotice) watchers.delete(id);
  };
};

export const deliverAppServiceProgress = (payload: unknown): void => {
  const { loginId, notice } = (payload ?? {}) as {
    loginId?: unknown;
    notice?: AppServiceNotice;
  };
  if (typeof loginId !== "string" || !notice || typeof notice !== "object") return;
  watchers.get(loginId)?.(notice);
};
