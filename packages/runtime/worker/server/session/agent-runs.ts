import { Context, Effect, Layer } from "effect";
import {
  METHOD_NAMES,
  type RuntimeAttachmentRef,
  type RuntimeOneShotCompletionRequest,
  type RuntimeOneShotCompletionResult,
} from "@stella/contracts/protocol";
import { materializeFileAttachments } from "../attachments.js";
import * as HostBus from "../host-bus.js";
import * as SessionConfig from "./config.js";
import { HOST_CHALLENGE_TOKEN_METHOD } from "../../../host/challenge-token-method.js";
import {
  createRemoteDeviceSigner,
  HOST_DEVICE_SIGNING_METHOD,
} from "../../../host/device-signing-method.js";

export interface Interface {
  readonly materializeAgentAttachments: (payload: {
    conversationId: string;
    attachments?: RuntimeAttachmentRef[];
  }) => Promise<RuntimeAttachmentRef[]>;
  readonly oneShotCompletion: (
    request: RuntimeOneShotCompletionRequest,
  ) => Promise<RuntimeOneShotCompletionResult>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@stella/runtime/worker/AgentRuns",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hostBus = yield* HostBus.Service;
    const config = yield* SessionConfig.Service;
    let deviceSignerPromise: ReturnType<typeof createRemoteDeviceSigner> | null =
      null;
    const getDeviceSigner = () => {
      const pending =
        deviceSignerPromise ??
        createRemoteDeviceSigner((input) =>
          hostBus.request(
            HOST_DEVICE_SIGNING_METHOD,
            { input },
            { retryOnDisconnect: true },
          ),
        );
      deviceSignerPromise = pending;
      void pending.catch(() => {
        if (deviceSignerPromise === pending) deviceSignerPromise = null;
      });
      return pending;
    };

    let oneShotCompletionModule: Promise<
      typeof import("../../../kernel/agent-runtime/one-shot-completion.js")
    > | null = null;
    const loadOneShotCompletion = () =>
      (oneShotCompletionModule ??=
        import("../../../kernel/agent-runtime/one-shot-completion.js"));

    const materializeAgentAttachments: Interface["materializeAgentAttachments"] =
      async (payload) =>
        payload.attachments?.length
          ? await materializeFileAttachments({
              attachments: payload.attachments,
              stellaDataDirPath: config.get().stellaDataDirPath,
              conversationId: payload.conversationId,
              includeImages: true,
            })
          : [];

    const oneShotCompletion: Interface["oneShotCompletion"] = async (
      request,
    ) => {
      const init = config.get();
      return await (
        await loadOneShotCompletion()
      ).runOneShotCompletion({
        request,
        runtime: {
          stellaAppDir: init.stellaAppDir,
          stellaDataDir: init.stellaDataDirPath,
          siteBaseUrl: init.backendUrl,
          getAuthToken: () => init.authToken,
          hasConnectedAccount: () => config.get().hasConnectedAccount ?? false,
          requestRuntimeAuthRefresh: async () => {
            try {
              return (await hostBus.request(
                METHOD_NAMES.HOST_RUNTIME_AUTH_REFRESH,
                { source: "stella_provider" },
                { retryOnDisconnect: true },
              )) as {
                authenticated: boolean;
                token: string | null;
                hasConnectedAccount: boolean;
              };
            } catch {
              return null;
            }
          },
          requestChallengeToken: async () => {
            const token = await hostBus
              .request(HOST_CHALLENGE_TOKEN_METHOD, undefined, {
                retryOnDisconnect: true,
              })
              .catch(() => null);
            return typeof token === "string" && token.trim()
              ? token.trim()
              : undefined;
          },
          getDeviceSigner,
        },
      });
    };

    return { materializeAgentAttachments, oneShotCompletion };
  }),
);
