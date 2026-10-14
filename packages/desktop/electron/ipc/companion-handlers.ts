import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import {
  IPC_COMPANION_GET_STATE,
  IPC_COMPANION_GET_VISIBLE,
  IPC_COMPANION_PUBLISH_STATE,
  IPC_COMPANION_SEND,
  IPC_COMPANION_SEND_REQUESTED,
  IPC_COMPANION_SET_VISIBLE,
  IPC_COMPANION_STOP,
  IPC_COMPANION_STOP_REQUESTED,
  IPC_COMPANION_VISIBLE_CHANGED,
} from "@stella/contracts/desktop/ipc-channels";
import type {
  CompanionSendRequest,
  CompanionState,
} from "@stella/contracts/desktop/companion";
import type { CompanionWindowController } from "../windows/companion-window.js";
import { handleIpc, onIpc } from "./typed-ipc.js";

type WindowManagerLike = {
  getFullWindow: () => BrowserWindow | null;
  ensureFullWindow: (options?: { hidden?: boolean }) => BrowserWindow;
};

export type CompanionHandlerOptions = {
  getCompanionController: () => CompanionWindowController | null;
  windowManager: WindowManagerLike;
  assertPrivilegedSender: (
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: string,
  ) => boolean;
};

type PendingRequest =
  | {
      channel: typeof IPC_COMPANION_SEND_REQUESTED;
      payload: CompanionSendRequest;
    }
  | { channel: typeof IPC_COMPANION_STOP_REQUESTED; payload: undefined };

const MAX_PENDING_REQUESTS = 8;
const PENDING_REQUEST_TTL_MS = 20_000;

export const broadcastCompanionVisibility = (visible: boolean): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(IPC_COMPANION_VISIBLE_CHANGED, { visible });
  }
};

export const registerCompanionHandlers = (
  options: CompanionHandlerOptions,
): void => {
  const { windowManager } = options;
  const readyBrains = new Set<number>();
  let pending: Array<PendingRequest & { at: number }> = [];

  const fullWindowBrain = (): BrowserWindow | null => {
    const win = windowManager.getFullWindow();
    return win && !win.isDestroyed() ? win : null;
  };

  const flushPending = (win: BrowserWindow) => {
    const now = Date.now();
    const queue = pending;
    pending = [];
    for (const request of queue) {
      if (now - request.at > PENDING_REQUEST_TTL_MS) continue;
      win.webContents.send(request.channel, request.payload);
    }
  };

  const dispatchToBrain = (request: PendingRequest) => {
    let win = fullWindowBrain();
    if (!win) {
      win = windowManager.ensureFullWindow({ hidden: true });
    }
    if (readyBrains.has(win.webContents.id)) {
      win.webContents.send(request.channel, request.payload);
      return;
    }
    pending.push({ ...request, at: Date.now() });
    if (pending.length > MAX_PENDING_REQUESTS) {
      pending = pending.slice(-MAX_PENDING_REQUESTS);
    }
  };

  onIpc(IPC_COMPANION_PUBLISH_STATE, (event, state: CompanionState) => {
    if (!options.assertPrivilegedSender(event, IPC_COMPANION_PUBLISH_STATE))
      return;
    const controller = options.getCompanionController();
    if (controller?.isSender(event.sender)) return;
    if (!state || typeof state !== "object") return;
    const win = fullWindowBrain();
    if (win && win.webContents.id === event.sender.id) {
      const firstPublish = !readyBrains.has(event.sender.id);
      readyBrains.add(event.sender.id);
      event.sender.once("destroyed", () => readyBrains.delete(event.sender.id));
      if (firstPublish && pending.length > 0) flushPending(win);
    }
    controller?.setState(state);
  });

  handleIpc(IPC_COMPANION_GET_STATE, (event) => {
    if (!options.assertPrivilegedSender(event, IPC_COMPANION_GET_STATE))
      return null;
    return options.getCompanionController()?.getState() ?? null;
  });

  onIpc(IPC_COMPANION_SEND, (event, payload: CompanionSendRequest) => {
    const controller = options.getCompanionController();
    if (!controller?.isSender(event.sender)) return;
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!text) return;
    dispatchToBrain({
      channel: IPC_COMPANION_SEND_REQUESTED,
      payload: { text },
    });
  });

  onIpc(IPC_COMPANION_STOP, (event) => {
    const controller = options.getCompanionController();
    if (!controller?.isSender(event.sender)) return;
    const win = fullWindowBrain();
    if (!win) return;
    dispatchToBrain({
      channel: IPC_COMPANION_STOP_REQUESTED,
      payload: undefined,
    });
  });

  handleIpc(IPC_COMPANION_GET_VISIBLE, (event) => {
    if (!options.assertPrivilegedSender(event, IPC_COMPANION_GET_VISIBLE)) {
      return { visible: false };
    }
    return { visible: options.getCompanionController()?.isVisible() ?? false };
  });

  handleIpc(IPC_COMPANION_SET_VISIBLE, async (event, visible: boolean) => {
    if (!options.assertPrivilegedSender(event, IPC_COMPANION_SET_VISIBLE)) {
      return { visible: false };
    }
    const controller = options.getCompanionController();
    if (!controller) return { visible: false };
    if (visible === true) {
      await controller.show({ focus: false });
    } else {
      controller.hide();
    }
    return { visible: controller.isVisible() };
  });
};
