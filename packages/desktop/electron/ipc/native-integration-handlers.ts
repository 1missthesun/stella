import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { assertPrivilegedRequest } from "./privileged-ipc.js";
import {
  IPC_NATIVE_INTEGRATIONS_LIST,
  IPC_NATIVE_INTEGRATIONS_ENABLE,
  IPC_NATIVE_INTEGRATIONS_DISABLE,
  IPC_NATIVE_INTEGRATIONS_ADD_ACCOUNT,
  IPC_NATIVE_INTEGRATIONS_SET_PRIMARY_ACCOUNT,
  IPC_NATIVE_INTEGRATIONS_REMOVE_ACCOUNT,
} from "@stella/contracts/desktop/ipc-channels";
import { handleIpc } from "./typed-ipc.js";
import {
  runIntegrationFlow,
  type IntegrationFlowAuth,
  type IntegrationFlowUi,
} from "../services/integration-flows.js";

// Settings → Integrations. The catalog, integration state, accounts and
// sign-ins run in the runtime (host/app-services/native-integrations.ts); main
// supplies Stella's session and the windows a sign-in needs.
export type NativeIntegrationHandlersOptions = IntegrationFlowUi &
  IntegrationFlowAuth & {
    assertPrivilegedSender: (
      event: IpcMainEvent | IpcMainInvokeEvent,
      channel: string,
    ) => boolean;
  };

export const registerNativeIntegrationHandlers = (
  options: NativeIntegrationHandlersOptions,
) => {
  const run = (method: string, payload?: unknown) =>
    runIntegrationFlow<any>(
      method,
      options,
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {},
    );
  handleIpc(IPC_NATIVE_INTEGRATIONS_LIST, async (event) => {
    assertPrivilegedRequest(options, event, IPC_NATIVE_INTEGRATIONS_LIST);
    return await run("listNativeIntegrations");
  });
  handleIpc(IPC_NATIVE_INTEGRATIONS_ADD_ACCOUNT, async (event, payload: unknown) => {
    assertPrivilegedRequest(options, event, IPC_NATIVE_INTEGRATIONS_ADD_ACCOUNT);
    return await run("addNativeIntegrationAccount", payload);
  });
  handleIpc(IPC_NATIVE_INTEGRATIONS_SET_PRIMARY_ACCOUNT, async (event, payload: unknown) => {
    assertPrivilegedRequest(options, event, IPC_NATIVE_INTEGRATIONS_SET_PRIMARY_ACCOUNT);
    return await run("setPrimaryNativeIntegrationAccount", payload);
  });
  handleIpc(IPC_NATIVE_INTEGRATIONS_REMOVE_ACCOUNT, async (event, payload: unknown) => {
    assertPrivilegedRequest(options, event, IPC_NATIVE_INTEGRATIONS_REMOVE_ACCOUNT);
    return await run("removeNativeIntegrationAccount", payload);
  });
  handleIpc(IPC_NATIVE_INTEGRATIONS_ENABLE, async (event, payload: unknown) => {
    assertPrivilegedRequest(options, event, IPC_NATIVE_INTEGRATIONS_ENABLE);
    return await run("enableNativeIntegration", payload);
  });
  handleIpc(IPC_NATIVE_INTEGRATIONS_DISABLE, async (event, payload: unknown) => {
    assertPrivilegedRequest(options, event, IPC_NATIVE_INTEGRATIONS_DISABLE);
    return await run("disableNativeIntegration", payload);
  });
};
