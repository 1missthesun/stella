/**
 * Models on a provider credential saved to the owner's account
 * (`@stella/contracts/backend/providers`), run through the model gateway's
 * BYOK lane. The key never reaches this process: requests carry
 * `GATEWAY_BYOK_PLACEHOLDER_KEY`, the gateway puts the owner's key in its
 * place. The cloud's agents use this for an `engine: "provider"` turn, and a
 * computer with no key of its own for a provider uses it with its session
 * capability.
 */
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

export { ACCOUNT_PROVIDER_IDS, isAccountProviderId } from "@stella/contracts/backend/providers";

/** Google's OpenAI-compatible endpoint: its own adapter can't be routed through the gateway. */
const GOOGLE_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const ROUTABLE_APIS = new Set<string>(["anthropic-messages", "openai-completions", "openai-responses"]);

const isChat = (model: Model<Api>): boolean => {
  const type = (model as { type?: string }).type;
  return type === undefined || type === "chat";
};

/** A catalog model as the BYOK lane can run it, or undefined when it can't. */
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

/** Every model of an account provider the BYOK lane can run. */
export const accountProviderModels = (providerId: string): Model<Api>[] =>
  Object.values(CATALOGS[providerId] ?? {}).flatMap((model) => {
    const ready = routable(model);
    return ready ? [ready] : [];
  });

/**
 * The model an `engine: "provider"` selection names: the provider's catalog
 * entry, or, for a model the catalog doesn't list, one shaped like the
 * provider's newest model on the same API family.
 */
export const accountProviderModel = (providerId: string, modelId: string): Model<Api> | undefined => {
  const models = accountProviderModels(providerId);
  const known = models.find((model) => model.id === modelId);
  if (known) return known;
  const template = models.at(-1);
  return template ? { ...template, id: modelId, name: modelId } : undefined;
};

/** Every URL prefix an account provider's models are served at. */
export const accountProviderBaseUrls = (providerId: string): string[] => [
  ...new Set(accountProviderModels(providerId).map((model) => model.baseUrl.replace(/\/+$/, ""))),
];

export type AccountByokTransport = {
  /** The gateway's origin. */
  gatewayOrigin: string;
  /** Sends a request to the gateway with the caller's capability on it. */
  fetch(request: Request, route: { sessionId?: string }): Promise<Response>;
};

/** The request for the gateway's BYOK lane: placeholder headers moved, upstream URL named. */
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

/** One account provider's models as a pi-ai provider whose requests go through the BYOK lane. */
export function accountByokProvider(options: {
  providerId: string;
  models: readonly Model<Api>[];
  transport: AccountByokTransport;
}): Provider {
  const { providerId, transport } = options;
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
      streams.stream(model, context, { ...streamOptions, fetch: routed(streamOptions?.sessionId) }),
    streamSimple: (model, context, streamOptions) =>
      streams.streamSimple(model, context, { ...streamOptions, fetch: routed(streamOptions?.sessionId) }),
  });
  return createProvider({
    id: providerId,
    name: providerId,
    auth: {
      apiKey: {
        name: "Account key",
        resolve: async () => ({ auth: { apiKey: GATEWAY_BYOK_PLACEHOLDER_KEY }, source: "Stella account" }),
      },
    },
    models: [...options.models],
    api: {
      "anthropic-messages": withFetch(anthropicMessagesApi()),
      "openai-completions": withFetch(openAICompletionsApi()),
      "openai-responses": withFetch(openAIResponsesApi()),
    },
  });
}
