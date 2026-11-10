import type { Api, Model, ProviderStreams } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createProvider, type Provider } from "@earendil-works/pi-ai/models";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { CEREBRAS_MODELS } from "@earendil-works/pi-ai/providers/cerebras.models";
import { GITHUB_COPILOT_MODELS } from "@earendil-works/pi-ai/providers/github-copilot.models";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { KIMI_CODING_MODELS } from "@earendil-works/pi-ai/providers/kimi-coding.models";
import { META_MODELS } from "@earendil-works/pi-ai/providers/meta.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENCODE_MODELS } from "@earendil-works/pi-ai/providers/opencode.models";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import { VERCEL_AI_GATEWAY_MODELS } from "@earendil-works/pi-ai/providers/vercel-ai-gateway.models";
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models";
import { ZAI_MODELS } from "@earendil-works/pi-ai/providers/zai.models";
import {
  fetchLiveProviderModels,
  fetchPublishedProviderModels,
  liveProviderModelListNeedsKey,
  modelForUnlistedId,
  type LiveProviderModel,
} from "@stella/contracts/provider-live-models";
import {
  GATEWAY_BYOK_HEADER_PREFIX,
  GATEWAY_BYOK_PLACEHOLDER_KEY,
  GATEWAY_BYOK_UPSTREAM_HEADER,
  gatewayByokRelayPath,
} from "@stella/contracts/gateway/api";

type Catalog = Record<string, Model<Api>>;

const CATALOGS: Record<string, Catalog> = {
  anthropic: ANTHROPIC_MODELS as unknown as Catalog,
  openai: OPENAI_MODELS as unknown as Catalog,
  google: GOOGLE_MODELS as unknown as Catalog,
  meta: META_MODELS as unknown as Catalog,
  "kimi-coding": KIMI_CODING_MODELS as unknown as Catalog,
  zai: ZAI_MODELS as unknown as Catalog,
  xai: XAI_MODELS as unknown as Catalog,
  cerebras: CEREBRAS_MODELS as unknown as Catalog,
  openrouter: OPENROUTER_MODELS as unknown as Catalog,
  "vercel-ai-gateway": VERCEL_AI_GATEWAY_MODELS as unknown as Catalog,
  opencode: OPENCODE_MODELS as unknown as Catalog,
  "github-copilot": GITHUB_COPILOT_MODELS as unknown as Catalog,
};

export { isAccountProviderId } from "@stella/contracts/backend/providers";

const GOOGLE_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const ROUTABLE_APIS = new Set<string>(["anthropic-messages", "openai-completions", "openai-responses"]);

const isChat = (model: Model<Api>): boolean => {
  const type = (model as { type?: string }).type;
  return type === undefined || type === "chat";
};

const routable = (model: Model<Api>): Model<Api> | undefined => {
  if (!isChat(model)) return undefined;
  if (ROUTABLE_APIS.has(model.api)) return model;
  if (model.provider === "google" && model.api === "google-generative-ai") {
    return {
      ...model,
      api: "openai-completions",
      baseUrl: GOOGLE_OPENAI_BASE_URL,
      compat: { supportsDeveloperRole: false, supportsStore: false },
    } as Model<Api>;
  }
  return undefined;
};

export const accountProviderModels = (providerId: string): Model<Api>[] =>
  Object.values(CATALOGS[providerId] ?? {}).flatMap((model) => {
    const ready = routable(model);
    return ready ? [ready] : [];
  });

/**
 * The model an account key runs `modelId` as. One this build doesn't list
 * (released since, or typed by hand) is shaped like its nearest sibling, with
 * the limits and price in `listed` when the provider published them.
 */
export const accountProviderModel = (
  providerId: string,
  modelId: string,
  listed?: LiveProviderModel,
): Model<Api> | undefined => {
  const models = accountProviderModels(providerId);
  return models.find((model) => model.id === modelId) ?? modelForUnlistedId(models, modelId, listed);
};

const LISTED_MODELS_TTL_MS = 60 * 60_000;
const listedModels = new Map<string, { at: number; models: Promise<LiveProviderModel[]> }>();

const settled = (models: Promise<LiveProviderModel[] | undefined>): Promise<LiveProviderModel[]> =>
  models.then(
    (found) => found ?? [],
    () => [],
  );

const listedProviderModels = (providerId: string): Promise<LiveProviderModel[]> => {
  const cached = listedModels.get(providerId);
  if (cached && Date.now() - cached.at < LISTED_MODELS_TTL_MS) return cached.models;
  const models = Promise.all([
    settled(fetchPublishedProviderModels(providerId)),
    settled(liveProviderModelListNeedsKey(providerId) ? Promise.resolve([]) : fetchLiveProviderModels(providerId)),
  ]).then(([published, live]) => {
    if (published.length + live.length === 0) listedModels.delete(providerId);
    return [...published, ...live];
  });
  listedModels.set(providerId, { at: Date.now(), models });
  return models;
};

/**
 * `accountProviderModel` for a host with no catalog of its own: an unlisted
 * model takes the limits and price pi-ai's published catalog or the
 * provider's public list gives it.
 */
export const listedAccountProviderModel = async (providerId: string, modelId: string): Promise<Model<Api> | undefined> => {
  const known = accountProviderModels(providerId).find((model) => model.id === modelId);
  if (known) return known;
  const listed = (await listedProviderModels(providerId)).find((model) => model.id === modelId);
  return accountProviderModel(providerId, modelId, listed);
};

export const accountProviderBaseUrls = (providerId: string): string[] => [
  ...new Set(accountProviderModels(providerId).map((model) => model.baseUrl.replace(/\/+$/, ""))),
];

export type AccountByokTransport = {
  gatewayOrigin: string;
  fetch(request: Request, route: { sessionId?: string }): Promise<Response>;
};

export const toByokRelayRequest = async (
  providerId: string,
  gatewayOrigin: string,
  request: Request,
): Promise<Request> => {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (value.includes(GATEWAY_BYOK_PLACEHOLDER_KEY)) headers.set(`${GATEWAY_BYOK_HEADER_PREFIX}${name}`, value);
    else headers.set(name, value);
  }
  headers.set(GATEWAY_BYOK_UPSTREAM_HEADER, request.url);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  return new Request(`${gatewayOrigin.replace(/\/+$/, "")}${gatewayByokRelayPath(providerId)}`, {
    method: request.method,
    headers,
    ...(body ? { body } : {}),
    signal: request.signal,
  });
};

export const ACCOUNT_REGISTRY_PREFIX = "account-key:";

export const accountRegistryId = (providerId: string): string => `${ACCOUNT_REGISTRY_PREFIX}${providerId}`;

export const accountProviderOfRegistryId = (registryId: string): string | undefined =>
  registryId.startsWith(ACCOUNT_REGISTRY_PREFIX) ? registryId.slice(ACCOUNT_REGISTRY_PREFIX.length) : undefined;

export function accountByokProvider(options: {
  providerId: string;
  registryId?: string;
  models: readonly Model<Api>[];
  transport: AccountByokTransport;
}): Provider {
  const { providerId, transport } = options;
  const registryId = options.registryId ?? providerId;
  const asProvider = <M extends Model<Api>>(model: M): M =>
    model.provider === providerId ? model : { ...model, provider: providerId };
  const routed = (sessionId: string | undefined): typeof fetch =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      return await transport.fetch(
        await toByokRelayRequest(providerId, transport.gatewayOrigin, request),
        sessionId ? { sessionId } : {},
      );
    }) as typeof fetch;
  const withFetch = (streams: ProviderStreams): ProviderStreams => ({
    stream: (model, context, streamOptions) =>
      streams.stream(asProvider(model), context, { ...streamOptions, fetch: routed(streamOptions?.sessionId) }),
    streamSimple: (model, context, streamOptions) =>
      streams.streamSimple(asProvider(model), context, { ...streamOptions, fetch: routed(streamOptions?.sessionId) }),
  });
  return createProvider({
    id: registryId,
    name: providerId,
    auth: {
      apiKey: {
        name: "Account key",
        resolve: async () => ({ auth: { apiKey: GATEWAY_BYOK_PLACEHOLDER_KEY }, source: "Stella account" }),
      },
    },
    models: options.models.map((model) => (model.provider === registryId ? model : { ...model, provider: registryId })),
    api: {
      "anthropic-messages": withFetch(anthropicMessagesApi()),
      "openai-completions": withFetch(openAICompletionsApi()),
      "openai-responses": withFetch(openAIResponsesApi()),
    },
  });
}
