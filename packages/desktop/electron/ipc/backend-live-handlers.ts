import { powerMonitor, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import type { ViewName } from "@stella/contracts/backend/api";
import type { TokenProvider } from "@stella/contracts/backend/client";
import {
  leaseBackendClient,
  type BackendClientLease,
} from "@stella/contracts/backend/shared-client";
import type { BackendLiveEvent } from "@stella/contracts/desktop/backend-live";
import {
  IPC_BACKEND_LIVE_ACCOUNT,
  IPC_BACKEND_LIVE_EVENT,
  IPC_BACKEND_LIVE_NUDGE,
  IPC_BACKEND_LIVE_UNWATCH,
  IPC_BACKEND_LIVE_WATCH,
} from "@stella/contracts/desktop/ipc-channels";
import { handleIpc, offIpc, onIpc } from "./typed-ipc.js";

type BackendLiveHandlersOptions = {
  getBackendUrl: () => string | null;
  getToken: TokenProvider;
  assertPrivilegedSender: (
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: string,
  ) => boolean;
};

type WindowViews = {
  documentId: string;
  views: Map<string, () => void>;
  release: () => void;
};

const normalizeUrl = (value: string | null | undefined): string =>
  (value ?? "").trim().replace(/\/+$/, "");

export const registerBackendLiveHandlers = (
  options: BackendLiveHandlersOptions,
): (() => void) => {
  const windows = new Map<number, WindowViews>();
  let held: { baseUrl: string; lease: BackendClientLease } | null = null;

  const stopViews = (window: WindowViews) => {
    for (const stop of window.views.values()) stop();
    window.views.clear();
  };

  const windowFor = (contents: WebContents, documentId: string): WindowViews => {
    const existing = windows.get(contents.id);
    if (existing) {
      if (existing.documentId !== documentId) {
        stopViews(existing);
        existing.documentId = documentId;
      }
      return existing;
    }
    const id = contents.id;
    const drop = () => {
      const window = windows.get(id);
      if (!window) return;
      windows.delete(id);
      window.release();
      stopViews(window);
    };
    contents.once("destroyed", drop);
    contents.on("render-process-gone", drop);
    const window: WindowViews = {
      documentId,
      views: new Map(),
      release: () => {
        contents.removeListener("destroyed", drop);
        contents.removeListener("render-process-gone", drop);
      },
    };
    windows.set(id, window);
    return window;
  };

  const send = (contents: WebContents, event: BackendLiveEvent) => {
    if (!contents.isDestroyed()) contents.send(IPC_BACKEND_LIVE_EVENT, event);
  };

  const clientFor = (requestedUrl: string) => {
    const baseUrl = normalizeUrl(options.getBackendUrl());
    if (!baseUrl || baseUrl !== normalizeUrl(requestedUrl)) return null;
    if (held?.baseUrl === baseUrl) return held.lease.client;
    held?.lease.release();
    held = {
      baseUrl,
      lease: leaseBackendClient({ baseUrl, getToken: options.getToken }),
    };
    return held.lease.client;
  };

  handleIpc(IPC_BACKEND_LIVE_WATCH, (event, request) => {
    if (!options.assertPrivilegedSender(event, IPC_BACKEND_LIVE_WATCH)) {
      return false;
    }
    const client = clientFor(request.baseUrl);
    if (!client) return false;
    const contents = event.sender;
    const { documentId, subscriptionId } = request;
    const window = windowFor(contents, documentId);
    window.views.get(subscriptionId)?.();
    window.views.set(
      subscriptionId,
      client.watch(
        request.view as ViewName,
        request.args as never,
        (value) =>
          send(contents, { documentId, subscriptionId, kind: "value", value }),
        ({ code, message, retryable, retryAfterMs, reason }) =>
          send(contents, {
            documentId,
            subscriptionId,
            kind: "error",
            error: {
              code,
              message,
              retryable,
              ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
              ...(reason !== undefined ? { reason } : {}),
            },
          }),
      ),
    );
    return true;
  });

  const onUnwatch = (
    event: IpcMainEvent,
    request: { documentId: string; subscriptionId: string },
  ) => {
    const window = windows.get(event.sender.id);
    if (window?.documentId !== request.documentId) return;
    window.views.get(request.subscriptionId)?.();
    window.views.delete(request.subscriptionId);
  };

  const onAccount = (event: IpcMainEvent, subject: string | null) => {
    if (!options.assertPrivilegedSender(event, IPC_BACKEND_LIVE_ACCOUNT)) return;
    const client = held?.lease.client;
    if (!client || (subject !== null && client.servesSubject(subject))) return;
    client.reconnect();
  };

  const nudge = () => held?.lease.client.nudge();
  const onNudge = (event: IpcMainEvent) => {
    if (options.assertPrivilegedSender(event, IPC_BACKEND_LIVE_NUDGE)) nudge();
  };

  onIpc(IPC_BACKEND_LIVE_UNWATCH, onUnwatch);
  onIpc(IPC_BACKEND_LIVE_ACCOUNT, onAccount);
  onIpc(IPC_BACKEND_LIVE_NUDGE, onNudge);
  powerMonitor.on("resume", nudge);

  return () => {
    powerMonitor.removeListener("resume", nudge);
    offIpc(IPC_BACKEND_LIVE_UNWATCH, onUnwatch);
    offIpc(IPC_BACKEND_LIVE_ACCOUNT, onAccount);
    offIpc(IPC_BACKEND_LIVE_NUDGE, onNudge);
    for (const window of windows.values()) {
      window.release();
      stopViews(window);
    }
    windows.clear();
    held?.lease.release();
    held = null;
  };
};
