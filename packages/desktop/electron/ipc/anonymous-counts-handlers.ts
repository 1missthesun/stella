import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import {
  IPC_ANONYMOUS_COUNTS_GET,
  IPC_ANONYMOUS_COUNTS_RECORD,
  IPC_ANONYMOUS_COUNTS_SET,
  IPC_APP_RELEASE_INFO,
} from "@stella/contracts/desktop/ipc-channels";
import type { AnonymousCounts } from "../observability/anonymous-counts.js";
import { osLabel, releaseLabel } from "../observability/release-info.js";
import { registerPrivilegedHandle } from "./privileged-ipc.js";

export type AnonymousCountsHandlersOptions = {
  counts: AnonymousCounts;
  getStellaAppDir: () => string | null | undefined;
  assertPrivilegedSender: (
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: string,
  ) => boolean;
};

export const registerAnonymousCountsHandlers = (
  options: AnonymousCountsHandlersOptions,
) => {
  registerPrivilegedHandle(options, IPC_ANONYMOUS_COUNTS_GET, () =>
    options.counts.status(),
  );
  registerPrivilegedHandle(options, IPC_ANONYMOUS_COUNTS_SET, (_event, enabled) =>
    options.counts.setEnabled(enabled === true),
  );
  registerPrivilegedHandle(options, IPC_ANONYMOUS_COUNTS_RECORD, (_event, request) =>
    options.counts.record(request),
  );
  registerPrivilegedHandle(options, IPC_APP_RELEASE_INFO, async () => ({
    appVersion: await releaseLabel(options.getStellaAppDir()),
    platform: osLabel(),
  }));
};
