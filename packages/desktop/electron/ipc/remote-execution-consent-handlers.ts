import type { IpcMainInvokeEvent } from "electron";
import {
  IPC_EXECUTION_ANSWER_REMOTE_REQUEST,
  IPC_EXECUTION_PENDING_REMOTE_REQUEST,
} from "@stella/contracts/desktop/ipc-channels";
import { handleIpc } from "./typed-ipc.js";

type RemoteExecutionConsentOptions = {
  getStellaHostRunner: () => {
    answerRemoteExecutionRequest: (params: {
      allow: boolean;
    }) => Promise<{ allow: boolean }>;
  } | null;
  getPendingRequest: () => {
    requestedAt: number;
    requesterLabel?: string;
  } | null;
  clearPendingRequest: () => void;
  assertPrivilegedSender: (
    event: IpcMainInvokeEvent,
    channel: string,
  ) => boolean;
};

export const registerRemoteExecutionConsentHandlers = (
  options: RemoteExecutionConsentOptions,
): void => {
  handleIpc(
    IPC_EXECUTION_ANSWER_REMOTE_REQUEST,
    async (event, payload: unknown) => {
      if (
        !options.assertPrivilegedSender(
          event,
          IPC_EXECUTION_ANSWER_REMOTE_REQUEST,
        )
      ) {
        throw new Error("Blocked untrusted request.");
      }
      const allow = Boolean(
        payload &&
          typeof payload === "object" &&
          (payload as { allow?: unknown }).allow === true,
      );
      const runner = options.getStellaHostRunner();
      if (!runner) {
        throw new Error("Stella's runtime is not running on this computer.");
      }
      const answered = await runner.answerRemoteExecutionRequest({ allow });
      options.clearPendingRequest();
      return answered;
    },
  );
  handleIpc(IPC_EXECUTION_PENDING_REMOTE_REQUEST, async (event) => {
    if (
      !options.assertPrivilegedSender(
        event,
        IPC_EXECUTION_PENDING_REMOTE_REQUEST,
      )
    ) {
      throw new Error("Blocked untrusted request.");
    }
    return options.getPendingRequest();
  });
};
