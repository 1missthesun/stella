// ipcMain and the renderer side of IPC, in one process. Arguments and results are structured
// clones, as across Electron's process boundary, so a handler never shares objects with the UI.

import { EventEmitter } from "node:events";
import type { WebContents } from "./web-contents";

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export type IpcFrame = { url: string; origin: string; routingId: number; processId: number; frameTreeNodeId: number; name: string; top: IpcFrame | null; parent: null; isDestroyed(): boolean };

export type IpcMainInvokeEvent = {
  type: "frame";
  sender: WebContents;
  senderFrame: IpcFrame;
  frameId: number;
  processId: number;
  preventDefault(): void;
  defaultPrevented: boolean;
};

export type IpcMainEvent = IpcMainInvokeEvent & {
  returnValue: unknown;
  ports: unknown[];
  reply(channel: string, ...args: unknown[]): void;
};

const clone = <T>(value: T): T => {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return structuredClone(value);
};
const cloneArgs = (args: unknown[]) => args.map(clone);

class IpcMainImpl extends EventEmitter {
  private readonly handlers = new Map<string, InvokeHandler>();

  constructor() {
    super();
    this.setMaxListeners(0);
  }

  handle(channel: string, handler: InvokeHandler) {
    if (this.handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
    this.handlers.set(channel, handler);
  }

  handleOnce(channel: string, handler: InvokeHandler) {
    this.handle(channel, (event, ...args) => {
      this.handlers.delete(channel);
      return handler(event, ...args);
    });
  }

  removeHandler(channel: string) {
    this.handlers.delete(channel);
  }

  hasHandler(channel: string) {
    return this.handlers.has(channel);
  }

  async dispatchInvoke(sender: WebContents, channel: string, args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for '${channel}'`);
    const event = baseEvent(sender);
    try {
      return clone(await handler(event, ...cloneArgs(args)));
    } catch (error) {
      throw toRendererError(error);
    }
  }

  dispatchSend(sender: WebContents, channel: string, args: unknown[]) {
    const event = messageEvent(sender);
    this.emit(channel, event, ...cloneArgs(args));
  }

  dispatchSendSync(sender: WebContents, channel: string, args: unknown[]): unknown {
    const event = messageEvent(sender);
    this.emit(channel, event, ...cloneArgs(args));
    return clone(event.returnValue);
  }
}

const toRendererError = (error: unknown): Error => {
  if (error instanceof Error) {
    const copy = new Error(error.message);
    copy.name = error.name;
    const code = (error as { code?: unknown }).code;
    if (code !== undefined) (copy as { code?: unknown }).code = code;
    return copy;
  }
  return new Error(String(error));
};

const frameOf = (sender: WebContents): IpcFrame => {
  const url = sender.getURL();
  let origin = "";
  try { origin = new URL(url).origin; } catch {}
  const frame: IpcFrame = {
    url,
    origin,
    routingId: sender.id,
    processId: process.pid,
    frameTreeNodeId: sender.id,
    name: "",
    top: null,
    parent: null,
    isDestroyed: () => sender.isDestroyed(),
  };
  frame.top = frame;
  return frame;
};

const baseEvent = (sender: WebContents): IpcMainInvokeEvent => {
  const event: IpcMainInvokeEvent = {
    type: "frame",
    sender,
    senderFrame: frameOf(sender),
    frameId: sender.id,
    processId: process.pid,
    defaultPrevented: false,
    preventDefault() { event.defaultPrevented = true; },
  };
  return event;
};

const messageEvent = (sender: WebContents): IpcMainEvent =>
  Object.assign(baseEvent(sender), {
    returnValue: undefined as unknown,
    ports: [],
    reply: (channel: string, ...args: unknown[]) => sender.send(channel, ...args),
  });

export const ipcMain = new IpcMainImpl();

export type RendererListener = (event: { sender: unknown; senderId: number; ports: unknown[] }, ...args: unknown[]) => void;

/** The renderer end of one WebContents: what a preload's `ipcRenderer` would be. */
export class RendererIpc {
  private readonly listeners = new Map<string, Set<RendererListener>>();

  constructor(private readonly contents: WebContents) {}

  invoke(channel: string, ...args: unknown[]) {
    return ipcMain.dispatchInvoke(this.contents, channel, args);
  }

  send(channel: string, ...args: unknown[]) {
    ipcMain.dispatchSend(this.contents, channel, args);
  }

  sendSync(channel: string, ...args: unknown[]) {
    return ipcMain.dispatchSendSync(this.contents, channel, args);
  }

  on(channel: string, listener: RendererListener): () => void {
    let set = this.listeners.get(channel);
    if (!set) this.listeners.set(channel, (set = new Set()));
    set.add(listener);
    return () => this.off(channel, listener);
  }

  once(channel: string, listener: RendererListener): () => void {
    const off = this.on(channel, (event, ...args) => {
      off();
      listener(event, ...args);
    });
    return off;
  }

  off(channel: string, listener: RendererListener) {
    this.listeners.get(channel)?.delete(listener);
  }

  removeAllListeners(channel?: string) {
    if (channel) this.listeners.delete(channel);
    else this.listeners.clear();
  }

  listenerCount(channel: string) {
    return this.listeners.get(channel)?.size ?? 0;
  }

  /** Main → renderer. Delivered on a microtask, in order, as Electron delivers asynchronously. */
  deliver(channel: string, args: unknown[]) {
    const set = this.listeners.get(channel);
    if (!set || set.size === 0) return;
    const payload = cloneArgs(args);
    queueMicrotask(() => {
      const event = { sender: null, senderId: 0, ports: [] };
      for (const listener of [...set]) {
        try {
          listener(event, ...payload);
        } catch (error) {
          console.error(`[ipc] renderer listener for ${channel} failed:`, error);
        }
      }
    });
  }
}
