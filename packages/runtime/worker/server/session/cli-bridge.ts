import { REQUEST_BUDGET_MS } from "@stella/contracts/request-deadline";
import {
  METHOD_NAMES,
  type HostRuntimeAuthRefreshResult,
} from "@stella/contracts/protocol";
import { sweepStaleConnectorBridgeProcesses } from "../../../kernel/connectors/process-registry.js";
import { setConnectorTokenStoreBroker } from "../../../kernel/connectors/token-store-broker.js";
import type {
  ConnectorTokenStoreRequest,
  ConnectorTokenStoreResult,
} from "../../../kernel/connectors/cli-broker-client.js";
import {
  startCliBridgeServer,
  type CliBridgeServer,
} from "../../cli-bridge-server.js";
import {
  createSecureCliBridgeEndpoint,
  isWindowsNamedPipePath,
  resolveRuntimePaths,
} from "@stella/node-shared/worker/runtime-paths.js";
import { parseCliBridgeEndpoint } from "@stella/node-shared/connectors/cli-bridge-endpoint.js";
import {
  createBackendAccountMcpBroker,
  createBackendMediaBroker,
  createBackendXApiBroker,
} from "../../backend-session-broker.js";
import type * as HostBus from "../host-bus.js";
import type * as SessionConfig from "./config.js";
import type * as RunnerCell from "./runner-cell.js";
import type { SessionFinalizer } from "./storage.js";

type ConnectorBrokers =
  typeof import("../../backend-connector-action-broker.js");

let connectorBrokers: Promise<ConnectorBrokers> | undefined;

const lazyConnectorBroker = <Args extends unknown[], Result>(
  make: (brokers: ConnectorBrokers) => (...args: Args) => Promise<Result>,
): ((...args: Args) => Promise<Result>) => {
  let broker: ((...args: Args) => Promise<Result>) | undefined;
  return async (...args) => {
    if (!broker) {
      connectorBrokers ??=
        import("../../backend-connector-action-broker.js").catch(
          (error: unknown) => {
            connectorBrokers = undefined;
            throw error;
          },
        );
      broker = make(await connectorBrokers);
    }
    return await broker(...args);
  };
};

export interface Interface {
  readonly socketPath: string | undefined;
}

export const make = async (args: {
  hostBus: HostBus.Interface;
  config: SessionConfig.Interface;
  runnerCell: RunnerCell.Interface;
  addFinalizer: (finalizer: SessionFinalizer) => void;
}): Promise<Interface> => {
  const { hostBus, config, runnerCell, addFinalizer } = args;
  const init = config.get();

  const bridgePaths = resolveRuntimePaths(init.stellaAppDir);
  const socketPath = createSecureCliBridgeEndpoint(bridgePaths);

  const connectorSweep = await sweepStaleConnectorBridgeProcesses(
    init.stellaDataDirPath,
    {
      currentWorkerPid: process.pid,
    },
  ).catch((error) => {
    console.warn(
      "[connector-bridge] Failed to sweep stale connector helpers:",
      (error as Error).message,
    );
    return null;
  });
  if (connectorSweep?.stopped) {
    console.warn(
      `[connector-bridge] Stopped ${connectorSweep.stopped} stale connector helper(s).`,
    );
  }

  const refreshSiteAuth = async () => {
    const result = (await hostBus.request(
      METHOD_NAMES.HOST_RUNTIME_AUTH_REFRESH,
      { source: "connector" },
      { retryOnDisconnect: true, timeoutMs: REQUEST_BUDGET_MS.call },
    )) as HostRuntimeAuthRefreshResult;
    if (!result.authenticated && result.reason === "unavailable") return null;
    config.patch({
      authToken: result.token,
      hasConnectedAccount: result.hasConnectedAccount,
    });
    const runner = runnerCell.get();
    runner?.setAuthToken(result.token);
    runner?.setHasConnectedAccount(result.hasConnectedAccount);
    const baseUrl = config.get().backendUrl?.trim();
    const authToken = result.token?.trim();
    return baseUrl && authToken ? { baseUrl, authToken } : null;
  };

  const runBackendConnectorAction = lazyConnectorBroker((brokers) =>
    brokers.createBackendConnectorActionBroker({
      stellaDataDir: init.stellaDataDirPath,
      getSiteAuth: () => {
        const baseUrl = config.get().backendUrl?.trim();
        const authToken = config.get().authToken?.trim();
        return baseUrl && authToken ? { baseUrl, authToken } : null;
      },
      refreshSiteAuth: async () => {
        try {
          return await refreshSiteAuth();
        } catch {
          return null;
        }
      },
    }),
  );

  const listBackendConnections = lazyConnectorBroker((brokers) =>
    brokers.createBackendConnectionsBroker({
      getSiteAuth: () => {
        const baseUrl = config.get().backendUrl?.trim();
        const authToken = config.get().authToken?.trim();
        return baseUrl && authToken ? { baseUrl, authToken } : null;
      },
      refreshSiteAuth: async () => {
        try {
          return await refreshSiteAuth();
        } catch {
          return null;
        }
      },
    }),
  );

  const listBackendConnectorActions = lazyConnectorBroker((brokers) =>
    brokers.createBackendConnectorActionsBroker({
      stellaDataDir: init.stellaDataDirPath,
      getSiteAuth: () => {
        const baseUrl = config.get().backendUrl?.trim();
        const authToken = config.get().authToken?.trim();
        return baseUrl && authToken ? { baseUrl, authToken } : null;
      },
      refreshSiteAuth: async () => {
        try {
          return await refreshSiteAuth();
        } catch {
          return null;
        }
      },
    }),
  );

  const liveSession = {
    getSiteAuth: () => {
      const baseUrl = config.get().backendUrl?.trim();
      const authToken = config.get().authToken?.trim();
      return baseUrl && authToken ? { baseUrl, authToken } : null;
    },
    refreshSiteAuth: async () => {
      try {
        return await refreshSiteAuth();
      } catch {
        return null;
      }
    },
  };
  const requestMedia = createBackendMediaBroker(liveSession);
  const requestXApi = createBackendXApiBroker(liveSession);
  const requestAccountMcp = createBackendAccountMcpBroker(liveSession);

  const requestHostConnectorTokenStore = async (
    request: ConnectorTokenStoreRequest,
  ): Promise<ConnectorTokenStoreResult> =>
    await hostBus.request<ConnectorTokenStoreResult>(
      METHOD_NAMES.HOST_CONNECTOR_TOKEN_STORE_REQUEST,
      request,
    );

  setConnectorTokenStoreBroker({
    load: async (tokenKey) => {
      const result = await requestHostConnectorTokenStore({
        operation: "load",
        tokenKey,
      });
      if (!result.ok) throw new Error(result.reason ?? "token_load_failed");
      return result.payload ?? null;
    },
    save: async (tokenKey, payload) => {
      const result = await requestHostConnectorTokenStore({
        operation: "save",
        tokenKey,
        payload,
      });
      if (!result.ok) throw new Error(result.reason ?? "token_save_failed");
    },
    delete: async (tokenKeys) => {
      const result = await requestHostConnectorTokenStore({
        operation: "delete",
        tokenKeys,
      });
      if (!result.ok) throw new Error(result.reason ?? "token_delete_failed");
    },
  });

  const startBridge = () =>
    startCliBridgeServer({
      socketPath,
      log: (message, error) => {
        if (error) {
          console.warn(`[cli-bridge] ${message}:`, error);
        } else {
          console.warn(`[cli-bridge] ${message}`);
        }
      },
      handlers: {
        runBackendConnectorAction,
        listBackendConnectorActions,
        listBackendConnections,
        requestMedia,
        requestXApi,
        requestAccountMcp,
        requestConnectorCredential: async (params) => {
          try {
            return await hostBus.request<
              | { ok: true }
              | {
                  ok: false;
                  reason: "cancelled" | "timeout" | "unsupported" | string;
                }
            >(METHOD_NAMES.HOST_CONNECTOR_CREDENTIAL_REQUEST, params, {
              retryOnDisconnect: true,
            });
          } catch (error) {
            return {
              ok: false,
              reason: (error as Error).message || "host_unreachable",
            };
          }
        },
        cancelConnectorCredential: async (params) => {
          await hostBus
            .request(METHOD_NAMES.HOST_ASK_USER_CANCEL, params, {
              retryOnDisconnect: true,
            })
            .catch(() => undefined);
        },
        requestDesktopPermission: async ({ kind }) => {
          try {
            const result = await hostBus.request<{
              granted: boolean;
              alreadyGranted: boolean;
            }>(METHOD_NAMES.HOST_SYSTEM_REQUEST_PERMISSION, kind, {
              retryOnDisconnect: true,
            });
            return { ok: true, ...result };
          } catch (error) {
            return {
              ok: false,
              reason: (error as Error).message || "host_unreachable",
            };
          }
        },
        spawnAutomationDaemon: async (params) => {
          try {
            return await hostBus.request<
              | { ok: true; pid: number; hostPid: number }
              | { ok: false; reason: string }
            >(
              METHOD_NAMES.HOST_COMPUTER_USE_SPAWN_AUTOMATION_DAEMON,
              params,
              { retryOnDisconnect: true },
            );
          } catch (error) {
            return {
              ok: false,
              reason: (error as Error).message || "host_unreachable",
            };
          }
        },
      },
    });

  let cliBridgeServer: CliBridgeServer | null;
  if (isWindowsNamedPipePath(parseCliBridgeEndpoint(socketPath).path)) {
    try {
      cliBridgeServer = await startBridge();
    } catch (error) {
      console.warn(
        "[cli-bridge] The named-pipe bridge could not start; connectors stay local:",
        error instanceof Error ? error.message : String(error),
      );
      cliBridgeServer = null;
    }
  } else {
    cliBridgeServer = await startBridge();
  }
  if (!cliBridgeServer) return { socketPath: undefined };

  addFinalizer(async () => {
    await cliBridgeServer.stop().catch(() => undefined);
  });

  return { socketPath };
};
