import { Context, Effect, Layer } from "effect";
import { METHOD_NAMES, type HostRuntimeAuthRefreshResult } from "@stella/contracts/protocol";
import { sweepStaleConnectorBridgeProcesses } from "../../../kernel/connectors/process-registry.js";
import {
  setConnectorTokenStoreBroker,
} from "../../../kernel/connectors/oauth.js";
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
} from "../../runtime-paths.js";
import { parseCliBridgeEndpoint } from "../../../kernel/connectors/cli-bridge-endpoint.js";
import {
  createBackendConnectorActionBroker,
  createBackendConnectorActionsBroker,
} from "../../backend-connector-action-broker.js";
import {
  createBackendAccountMcpBroker,
  createBackendMediaBroker,
  createBackendXApiBroker,
} from "../../backend-session-broker.js";
import * as HostBus from "../host-bus.js";
import * as SessionConfig from "./config.js";
import * as RunnerCell from "./runner-cell.js";

export interface Interface {
  readonly socketPath: string | undefined;
}

export class Service extends Context.Service<Service, Interface>()(
  "@stella/runtime/worker/CliBridge",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hostBus = yield* HostBus.Service;
    const config = yield* SessionConfig.Service;
    const runnerCell = yield* RunnerCell.Service;
    const init = config.get();

    const bridgePaths = resolveRuntimePaths(init.stellaAppDir);
    const socketPath = createSecureCliBridgeEndpoint(bridgePaths);

    const connectorSweep = yield* Effect.promise(() =>
      sweepStaleConnectorBridgeProcesses(init.stellaDataDirPath, {
        currentWorkerPid: process.pid,
      }).catch((error) => {
        console.warn(
          "[connector-bridge] Failed to sweep stale connector helpers:",
          (error as Error).message,
        );
        return null;
      }),
    );
    if (connectorSweep?.stopped) {
      console.warn(
        `[connector-bridge] Stopped ${connectorSweep.stopped} stale connector helper(s).`,
      );
    }

    const refreshSiteAuth = async () => {
      const result = (await hostBus.request(
        METHOD_NAMES.HOST_RUNTIME_AUTH_REFRESH,
        { source: "connector" },
        { retryOnDisconnect: true },
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

    const runBackendConnectorAction = createBackendConnectorActionBroker({
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
    });

    const listBackendConnectorActions = createBackendConnectorActionsBroker({
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
    });

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

    const startBridge = Effect.tryPromise({
      try: () =>
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
        }),
      catch: (error) => error as Error,
    });

    const cliBridgeServer: CliBridgeServer | null = isWindowsNamedPipePath(
      parseCliBridgeEndpoint(socketPath).path,
    )
      ? yield* startBridge.pipe(
          Effect.catch((error: Error) =>
            Effect.sync(() => {
              console.warn(
                "[cli-bridge] The named-pipe bridge could not start; connectors stay local:",
                error.message,
              );
              return null;
            }),
          ),
        )
      : yield* startBridge;
    if (!cliBridgeServer) return { socketPath: undefined };

    yield* Effect.addFinalizer(() =>
      Effect.promise(() => cliBridgeServer.stop().catch(() => undefined)),
    );

    return { socketPath };
  }),
);
