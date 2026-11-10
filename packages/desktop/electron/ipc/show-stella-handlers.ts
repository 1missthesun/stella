import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import {
  IPC_SHOW_STELLA_BUILD,
  IPC_SHOW_STELLA_DONE,
  IPC_SHOW_STELLA_FRAME,
  IPC_SHOW_STELLA_OVERLAY_INFO,
  IPC_SHOW_STELLA_PENDING,
  IPC_SHOW_STELLA_READ_AUDIO,
  IPC_SHOW_STELLA_RECORDER_FAILED,
  IPC_SHOW_STELLA_RECORDER_STARTED,
  IPC_SHOW_STELLA_RECORDER_STOPPED,
  IPC_SHOW_STELLA_REVIEW,
  IPC_SHOW_STELLA_REVIEW_FOCUSABLE,
  IPC_SHOW_STELLA_SENT,
  IPC_SHOW_STELLA_STATUS,
  IPC_SHOW_STELLA_TOGGLE,
  IPC_SHOW_STELLA_VIDEO_CHUNK,
} from "@stella/contracts/desktop/ipc-channels";
import {
  ShowStellaController,
  type ShowStellaControllerOptions,
} from "../services/show-stella/show-stella-controller.js";
import { onPrivilegedIpc, registerPrivilegedHandle } from "./privileged-ipc.js";

type ShowStellaHandlersOptions = ShowStellaControllerOptions & {
  assertPrivilegedSender: (event: IpcMainEvent | IpcMainInvokeEvent, channel: string) => boolean;
  /** Recorder messages only count from the overlay window. */
  isOverlaySender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
};

export const registerShowStellaHandlers = (options: ShowStellaHandlersOptions) => {
  const controller = new ShowStellaController(options);
  const overlayOnly = {
    assertPrivilegedSender: (event: IpcMainEvent | IpcMainInvokeEvent, channel: string) =>
      options.assertPrivilegedSender(event, channel) && options.isOverlaySender(event),
  };

  registerPrivilegedHandle(options, IPC_SHOW_STELLA_STATUS, () => controller.status());
  registerPrivilegedHandle(options, IPC_SHOW_STELLA_TOGGLE, async () => ({
    ok: await controller.toggle(),
  }));
  registerPrivilegedHandle(options, IPC_SHOW_STELLA_READ_AUDIO, async (_event, payload) =>
    controller.readAudio(payload.captureId),
  );
  registerPrivilegedHandle(options, IPC_SHOW_STELLA_BUILD, async (_event, payload) =>
    controller.build(payload.captureId, payload.transcript),
  );
  registerPrivilegedHandle(overlayOnly, IPC_SHOW_STELLA_RECORDER_STOPPED, (_event, result) => {
    controller.recorderStopped(result);
    return { ok: true } as const;
  });
  onPrivilegedIpc(overlayOnly, IPC_SHOW_STELLA_RECORDER_STARTED, (_event, payload) => {
    controller.recorderStarted(payload.captureId, payload.atMs);
  });
  onPrivilegedIpc(overlayOnly, IPC_SHOW_STELLA_RECORDER_FAILED, (_event, payload) => {
    controller.recorderFailed(payload.captureId, payload.message);
  });
  onPrivilegedIpc(overlayOnly, IPC_SHOW_STELLA_FRAME, (_event, payload) => {
    controller.frame(payload.captureId, payload.t, payload.jpeg);
  });
  onPrivilegedIpc(overlayOnly, IPC_SHOW_STELLA_VIDEO_CHUNK, (_event, payload) => {
    controller.videoChunk(payload.captureId, payload.chunk, payload.mimeType);
  });
  onPrivilegedIpc(overlayOnly, IPC_SHOW_STELLA_DONE, () => {
    void controller.stop(false);
  });

  registerPrivilegedHandle(overlayOnly, IPC_SHOW_STELLA_REVIEW, async (_event, payload) => ({
    ok: await controller.review(payload),
  }));
  onPrivilegedIpc(overlayOnly, IPC_SHOW_STELLA_OVERLAY_INFO, (_event, payload) => {
    controller.overlayInfo(payload);
  });
  onPrivilegedIpc(overlayOnly, IPC_SHOW_STELLA_REVIEW_FOCUSABLE, (_event, payload) => {
    controller.setReviewFocusable(Boolean(payload?.focusable));
  });
  registerPrivilegedHandle(options, IPC_SHOW_STELLA_PENDING, () => controller.pendingRecordings());
  registerPrivilegedHandle(options, IPC_SHOW_STELLA_SENT, (_event, payload) => {
    controller.sent(payload.requestId, payload.ok);
    return { ok: true } as const;
  });

  controller.registerShortcut();
  return controller;
};
