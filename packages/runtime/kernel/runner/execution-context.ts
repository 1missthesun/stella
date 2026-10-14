import { hostname } from "node:os";
import { Effect } from "effect";
import type { BackendClient } from "@stella/contracts/backend/client";
import type { ViewArgs, ViewName, ViewResult } from "@stella/contracts/backend/api";
import {
  createExecutionContextSnapshot,
  mediaAccessForAudience,
  readExecutionContextSnapshot,
  type ExecutionContextSnapshot,
  type MediaAccess,
} from "@stella/contracts/execution-context";
import { getImageGenerationPreferences } from "../preferences/local-preferences.js";
import { hasAccessibleLocalLlmApiKey } from "../storage/local-llm-credential-access.js";
import { DEVICES_PATH, type DeviceDestination } from "@stella/contracts/turn-plane/placement";

const MAX_CATALOG_BYTES = 128 * 1024;
const FALLBACK_READ_TIMEOUT_MS = 1_000;

type HeldView<T> = { client: BackendClient; value?: T; failed: boolean; stop(): void };
const heldViews = new Map<string, HeldView<unknown>>();

const holdView = <K extends ViewName>(client: BackendClient, view: K, args: ViewArgs<K>): HeldView<ViewResult<K>> => {
  const existing = heldViews.get(view) as HeldView<ViewResult<K>> | undefined;
  if (existing?.client === client) return existing;
  existing?.stop();
  const held: HeldView<ViewResult<K>> = { client, failed: false, stop: () => {} };
  heldViews.set(view, held as HeldView<unknown>);
  held.stop = client.watch(
    view,
    args,
    (value) => {
      held.value = value;
      held.failed = false;
    },
    () => {
      held.failed = true;
    },
  );
  return held;
};

export const pushedDevices = (client: BackendClient | null): DeviceDestination[] | undefined => {
  if (!client) return undefined;
  const held = holdView(client, "devices.list", {});
  return held.failed ? undefined : held.value?.devices;
};

const readCatalog = async (response: Response): Promise<unknown> => {
  if (Number(response.headers.get("content-length")) > MAX_CATALOG_BYTES) {
    await response.body?.cancel();
    return undefined;
  }
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_CATALOG_BYTES) {
        await reader.cancel();
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
};

const readMediaPlan = async (
  client: BackendClient | null,
): Promise<MediaAccess["stella"] | null> => {
  if (!client) return null;
  const held = holdView(client, "billing.status", {});
  if (held.value) {
    if (!held.value.authenticated) return null;
    return held.value.isAnonymous ? "sign_in" : mediaAccessForAudience(held.value.plan);
  }
  return await Effect.runPromise(
    Effect.callback<MediaAccess["stella"] | null>((resume) => {
      let stop: (() => void) | null = null;
      let settled = false;
      const settle = (value: MediaAccess["stella"] | null) => {
        if (settled) return;
        settled = true;
        resume(Effect.succeed(value));
        queueMicrotask(() => stop?.());
      };
      stop = client.watch(
        "billing.status",
        {},
        (status) => {
          if (!status.authenticated) return settle(null);
          settle(status.isAnonymous ? "sign_in" : mediaAccessForAudience(status.plan));
        },
        () => settle(null),
      );
      return Effect.sync(() => {
        settled = true;
        stop?.();
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: FALLBACK_READ_TIMEOUT_MS,
        orElse: () => Effect.succeed(null),
      }),
    ),
  );
};

export const loadMediaAccess = async (args: {
  stellaDataDir: string;
  hasConnectedAccount: boolean;
  client: BackendClient | null;
}): Promise<MediaAccess | undefined> => {
  const stella = args.hasConnectedAccount ? await readMediaPlan(args.client) : "sign_in";
  if (!stella) return undefined;
  const preference = getImageGenerationPreferences(args.stellaDataDir).provider;
  return {
    stella,
    ...(preference !== "stella"
      ? {
          ownImageKey: {
            provider: preference,
            saved: hasAccessibleLocalLlmApiKey(args.stellaDataDir, preference),
          },
        }
      : {}),
  };
};

export const loadDeviceExecutionContext = async (args: {
  deviceId: string;
  baseUrl: string | null;
  authToken: string | null;
  client?: BackendClient | null;
  fetchImpl?: typeof fetch;
  loadMedia?: () => Promise<MediaAccess | undefined>;
}): Promise<ExecutionContextSnapshot> => {
  const [snapshot, media] = await Promise.all([
    loadDevices(args),
    args.loadMedia?.().catch(() => undefined),
  ]);
  return media ? { ...snapshot, media } : snapshot;
};

const fetchDevices = async (args: {
  baseUrl: string;
  authToken: string;
  fetchImpl?: typeof fetch;
}): Promise<unknown> => {
  try {
    const response = await (args.fetchImpl ?? fetch)(
      `${args.baseUrl.replace(/\/+$/, "")}${DEVICES_PATH}`,
      {
        headers: { Authorization: `Bearer ${args.authToken}` },
        signal: AbortSignal.timeout(FALLBACK_READ_TIMEOUT_MS),
      },
    );
    if (!response.ok) return undefined;
    const body = await readCatalog(response);
    return body && typeof body === "object" && "devices" in body ? body.devices : undefined;
  } catch {
    return undefined;
  }
};

type FetchedDevices = { devices?: unknown; pending?: Promise<void> };
const fetchedDevices = new WeakMap<BackendClient, FetchedDevices>();

const loadDevices = async (args: {
  deviceId: string;
  baseUrl: string | null;
  authToken: string | null;
  client?: BackendClient | null;
  fetchImpl?: typeof fetch;
}): Promise<ExecutionContextSnapshot> => {
  const destination = {
    kind: "device",
    deviceId: args.deviceId,
    label: hostname() || args.deviceId,
  } as const;
  const known = (devices: unknown) =>
    devices === undefined
      ? undefined
      : readExecutionContextSnapshot({ executionContext: { devices, destination, devicesKnown: true } });
  const held = args.client ? holdView(args.client, "devices.list", {}) : undefined;
  const pushed = known(held?.value?.devices);
  if (pushed) return pushed;
  if (args.baseUrl && args.authToken) {
    const http = { baseUrl: args.baseUrl, authToken: args.authToken, fetchImpl: args.fetchImpl };
    if (!args.client) return known(await fetchDevices(http)) ?? createExecutionContextSnapshot({ devices: null, destination });
    let fallback = fetchedDevices.get(args.client);
    if (!fallback) fetchedDevices.set(args.client, (fallback = {}));
    const state = fallback;
    const refresh = () =>
      (state.pending ??= fetchDevices(http)
        .then((devices) => {
          if (devices !== undefined) state.devices = devices;
        })
        .finally(() => {
          state.pending = undefined;
        }));
    if (state.devices === undefined) await refresh();
    else void refresh();
    const last = known(state.devices);
    if (last) return last;
  }
  return createExecutionContextSnapshot({ devices: null, destination });
};
