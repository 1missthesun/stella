import type { GatewayModelResolution } from "@stella/contracts/gateway/api";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import { resolveManagedGatewayProvider } from "./managed-gateway";
import { MANAGED_MODEL_CONTEXT_WINDOWS } from "./model";
import {
  managedModelSupportsImageInput,
  resolveRequestedStellaModel,
} from "./request-estimate";
import { resolveCloudManagedProtocol } from "./request-shaping";

export const resolveManagedModelDescriptor = (args: {
  agentType: string;
  requestedModel: string;
  audience: ManagedModelAudience;
}): GatewayModelResolution => {
  const selection = resolveRequestedStellaModel(
    args.agentType,
    { model: args.requestedModel },
    args.audience,
  );
  const provider = resolveManagedGatewayProvider({
    model: selection.resolvedModel,
    configuredProvider: selection.config.managedGatewayProvider,
  });
  return managedModelDescriptor({
    requestedModel: selection.requestedModel,
    resolvedModel: selection.resolvedModel,
    provider,
    protocol: resolveCloudManagedProtocol({
      relayProvider: provider,
      configuredApi: selection.config.api,
    }),
    config: selection.config,
  });
};

export const managedModelDescriptor = (
  route: Pick<
    GatewayModelResolution,
    "requestedModel" | "resolvedModel" | "provider" | "protocol"
  > & {
    config: { maxOutputTokens?: number };
  },
): GatewayModelResolution => {
  const contextWindow = MANAGED_MODEL_CONTEXT_WINDOWS[route.resolvedModel];
  return {
    requestedModel: route.requestedModel,
    resolvedModel: route.resolvedModel,
    provider: route.provider,
    protocol: route.protocol,
    reasoning: true,
    supportsImages: managedModelSupportsImageInput(route.resolvedModel),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(route.config.maxOutputTokens !== undefined
      ? { maxOutputTokens: route.config.maxOutputTokens }
      : {}),
  };
};
