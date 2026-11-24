import type { BackendLiveTransport } from "@stella/contracts/backend/client";
import { configurePiRuntime } from "@/platform/electron/device";
import { getStellaInteriorBridge } from "@/platform/interior/interior-bridge";

type Handlers = Parameters<BackendLiveTransport["watch"]>[2];

const documentId = crypto.randomUUID();
let nextSubscriptionId = 1;

export const createMainLiveTransport = (
  baseUrl: string,
  getSubject: () => string | null,
): BackendLiveTransport | undefined => {
  if (typeof window === "undefined" || getStellaInteriorBridge()) return undefined;
  const bridge = window.electronAPI?.backendLive;
  if (!bridge) return undefined;
  const open = new Map<string, Handlers>();

  bridge.onEvent((event) => {
    if (event.documentId !== documentId) return;
    const handlers = open.get(event.subscriptionId);
    if (!handlers) return;
    if (event.kind === "value") handlers.onValue(event.value);
    else if (event.kind === "error") handlers.onError(event.error);
  });

  return {
    watch(view, args, handlers) {
      const subscriptionId = String(nextSubscriptionId++);
      open.set(subscriptionId, handlers);
      void configurePiRuntime()
        .then(() =>
          open.has(subscriptionId)
            ? bridge.watch({ documentId, subscriptionId, baseUrl, view, args })
            : true,
        )
        .catch(() => false)
        .then((carried) => {
          if (!carried && open.has(subscriptionId)) handlers.onUnavailable();
        });
      return () => {
        if (open.delete(subscriptionId)) {
          bridge.unwatch({ documentId, subscriptionId });
        }
      };
    },
    reconnect: () => bridge.setAccount(getSubject()),
    nudge: () => bridge.nudge(),
  };
};
