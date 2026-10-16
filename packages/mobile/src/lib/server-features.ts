import { useSyncExternalStore } from "react";
import * as Updates from "expo-updates";
import {
  parseServerDiscovery,
  SELF_HOST_DISCOVERY_PATH,
  serverCompatibility,
  type ServerCompatibility,
  type ServerDiscovery,
  type ServerFeatures,
} from "@stella/contracts/self-host";
import { fetchWithinDeadline } from "./cloud-request";
import { showComposerNotice } from "./composer-notice";
import {
  isSelfHostedLaunch,
  launchServer,
  updateServerDiscovery,
} from "./server-registry";

/**
 * What the active server offers. Stella's hosted service offers everything
 * (and its behavior must not change), so it never depends on discovery. A
 * self-hosted server reports its features in `/.well-known/stella`; the app
 * hides what it lacks, and always hides plans and checkout there (App Store
 * 3.1.1: pairing with a server must never unlock paid features).
 */

const HOSTED_FEATURES: ServerFeatures = {
  billing: true,
  push: true,
  cloudAgents: true,
  managedModels: true,
  media: true,
  readAloud: true,
  dictation: true,
  realtimeVoice: true,
  webSearch: true,
  maps: true,
  integrationsStore: true,
  emailSignIn: true,
  socialSignIn: true,
};

const UNKNOWN_SELF_HOSTED_FEATURES: ServerFeatures = {
  billing: false,
  push: false,
  cloudAgents: true,
  managedModels: false,
  media: false,
  readAloud: false,
  dictation: false,
  realtimeVoice: false,
  webSearch: false,
  maps: false,
  integrationsStore: false,
  emailSignIn: false,
  socialSignIn: false,
};

let discovery: ServerDiscovery | null =
  launchServer.kind === "self-hosted" ? launchServer.discovery : null;
let serverBehindNoted = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const featuresOf = (current: ServerDiscovery | null): ServerFeatures => {
  if (!isSelfHostedLaunch) return HOSTED_FEATURES;
  const base = current?.features ?? UNKNOWN_SELF_HOSTED_FEATURES;
  return { ...base, billing: false, push: false };
};

let features = featuresOf(discovery);

export const currentServerFeatures = (): ServerFeatures => features;

export const useServerFeatures = (): ServerFeatures =>
  useSyncExternalStore(subscribe, currentServerFeatures, currentServerFeatures);

export const fetchServerDiscovery = async (
  origin: string,
  timeoutMs = 10_000,
): Promise<ServerDiscovery> => {
  const response = await fetchWithinDeadline(
    `${origin}${SELF_HOST_DISCOVERY_PATH}`,
    { headers: { accept: "application/json" } },
    { label: "Checking your server", timeoutMs },
  );
  if (!response.ok) {
    throw new Error(`no_discovery_${response.status}`);
  }
  const parsed = parseServerDiscovery(await response.json());
  if (!parsed) throw new Error("not_a_stella_server");
  return parsed;
};

const appReleasedAt = (): string | null => {
  try {
    return Updates.createdAt ? Updates.createdAt.toISOString() : null;
  } catch {
    return null;
  }
};

export const compatibilityOf = (server: ServerDiscovery): ServerCompatibility =>
  serverCompatibility(server, appReleasedAt());

export type ActiveServerStatus =
  | { state: "ok" }
  | { state: "checking" }
  | { state: "server_too_old" | "app_too_old"; discovery: ServerDiscovery };

const statusOf = (current: ServerDiscovery | null): ActiveServerStatus => {
  if (!isSelfHostedLaunch) return { state: "ok" };
  if (!current) return { state: "checking" };
  const compatibility = compatibilityOf(current);
  return compatibility === "ok"
    ? { state: "ok" }
    : { state: compatibility, discovery: current };
};

let status = statusOf(discovery);

export const useActiveServerStatus = (): ActiveServerStatus =>
  useSyncExternalStore(subscribe, () => status, () => status);

const setDiscovery = (next: ServerDiscovery) => {
  discovery = next;
  features = featuresOf(next);
  status = statusOf(next);
  emit();
};

let refreshing: Promise<void> | null = null;

export const refreshActiveServerDiscovery = (): Promise<void> => {
  if (launchServer.kind !== "self-hosted") return Promise.resolve();
  const server = launchServer;
  refreshing ??= fetchServerDiscovery(server.origin)
    .then((next) => {
      updateServerDiscovery(server.id, next);
      setDiscovery(next);
    })
    .catch(() => {
      if (!discovery && status.state === "checking") {
        status = { state: "ok" };
        emit();
      }
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
};

export const overrideServerDiscoveryForDev = (next: ServerDiscovery) => {
  if (__DEV__) setDiscovery(next);
};

const UNKNOWN_CALL = /^Unknown (function|view) /;

export const noteBackendError = (error: unknown) => {
  if (!isSelfHostedLaunch || serverBehindNoted) return;
  const code = (error as { code?: unknown } | null)?.code;
  const message = (error as { message?: unknown } | null)?.message;
  if (code === "NOT_FOUND" && typeof message === "string" && UNKNOWN_CALL.test(message)) {
    serverBehindNoted = true;
    showComposerNotice({
      conversationId: null,
      kind: "server",
      title: "Your server needs an update",
      description: "Some features need a newer version of your server.",
    });
  }
};
