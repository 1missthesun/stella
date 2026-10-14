import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
  IpcSendArgs,
  IpcSendChannel,
} from "@stella/contracts/desktop/ipc-contract";

export type IpcInvokeHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeArgs<C>
) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;

export type IpcSendListener<C extends IpcSendChannel> = (
  event: IpcMainEvent,
  ...args: IpcSendArgs<C>
) => void | Promise<void>;

export function handleIpc<C extends IpcInvokeChannel>(
  channel: C,
  handler: IpcInvokeHandler<C>,
): void {
  ipcMain.handle(
    channel,
    handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  );
}

export function onIpc<C extends IpcSendChannel>(
  channel: C,
  listener: IpcSendListener<C>,
): void {
  ipcMain.on(
    channel,
    listener as (event: IpcMainEvent, ...args: unknown[]) => void,
  );
}

export function offIpc<C extends IpcSendChannel>(
  channel: C,
  listener: IpcSendListener<C>,
): void {
  ipcMain.removeListener(
    channel,
    listener as (event: IpcMainEvent, ...args: unknown[]) => void,
  );
}
