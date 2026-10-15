import { session, type IpcMainInvokeEvent } from "electron";
import {
  IPC_SELF_HOST_CANCEL_PAIRING,
  IPC_SELF_HOST_CONNECT,
  IPC_SELF_HOST_GET_STATE,
  IPC_SELF_HOST_INSPECT_LINK,
  IPC_SELF_HOST_PAIRING_STATUS,
  IPC_SELF_HOST_START_PAIRING,
  IPC_SELF_HOST_TAKE_PENDING_LINK,
  IPC_SELF_HOST_USE_DEFAULT,
  IPC_SELF_HOST_LIST_SERVERS,
  IPC_SELF_HOST_SWITCH_SERVER,
  IPC_SELF_HOST_REMOVE_SERVER,
} from "@stella/contracts/desktop/ipc-channels";
import type { SelfHostService } from "../services/self-host-service.js";
import {
  registerPrivilegedHandle,
  type PrivilegedIpcOptions,
} from "./privileged-ipc.js";

const refused = { ok: false as const, error: "Not available here." };

export const registerSelfHostHandlers = (
  options: PrivilegedIpcOptions & {
    service: SelfHostService;
    appPartition: string;
  },
) => {
  const { service } = options;
  const fromApp = (event: IpcMainInvokeEvent) =>
    event.sender.session === session.fromPartition(options.appPartition);

  registerPrivilegedHandle(options, IPC_SELF_HOST_GET_STATE, () => service.getState());
  registerPrivilegedHandle(options, IPC_SELF_HOST_TAKE_PENDING_LINK, (event) =>
    fromApp(event) ? service.takePendingLink() : null,
  );
  registerPrivilegedHandle(options, IPC_SELF_HOST_INSPECT_LINK, (_event, text) =>
    service.inspectLink(String(text ?? "")),
  );
  registerPrivilegedHandle(options, IPC_SELF_HOST_CONNECT, (event, text) =>
    fromApp(event) ? service.connect(String(text ?? "")) : refused,
  );
  registerPrivilegedHandle(options, IPC_SELF_HOST_USE_DEFAULT, (event) =>
    fromApp(event) ? service.useDefault() : refused,
  );
  registerPrivilegedHandle(options, IPC_SELF_HOST_LIST_SERVERS, (event) =>
    fromApp(event) ? service.listServers() : [],
  );
  registerPrivilegedHandle(options, IPC_SELF_HOST_SWITCH_SERVER, (event, serverId) =>
    fromApp(event)
      ? service.switchServer(String(serverId ?? ""))
      : { ok: false as const, reason: "error" as const, error: refused.error },
  );
  registerPrivilegedHandle(options, IPC_SELF_HOST_REMOVE_SERVER, (event, serverId) =>
    fromApp(event) ? service.removeServer(String(serverId ?? "")) : { ok: false },
  );
  registerPrivilegedHandle(options, IPC_SELF_HOST_START_PAIRING, (event) =>
    fromApp(event) ? service.startPairing() : refused,
  );
  registerPrivilegedHandle(options, IPC_SELF_HOST_PAIRING_STATUS, (event, pairingId) =>
    fromApp(event) ? service.pairingStatus(String(pairingId ?? "")) : refused,
  );
  registerPrivilegedHandle(options, IPC_SELF_HOST_CANCEL_PAIRING, (event, pairingId) =>
    fromApp(event) ? service.cancelPairing(String(pairingId ?? "")) : { ok: false },
  );
};
