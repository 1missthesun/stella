import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { CHATGPT_PROVIDER_ID, LOCAL_PROVIDER_ID } from "@stella/agent/provider/byok";
import { loadUpstreamProvider } from "@stella/agent/provider/lazy-upstream";
import { stellaModel, stellaProvider } from "@stella/agent/provider/stella";
import type { ResolvedLlmRoute } from "./model-routing.js";
import { withProcessableImages } from "./shared/image-payload.js";

export type RouteCompletionOptions = Pick<
  SimpleStreamOptions,
  "reasoning" | "maxTokens" | "temperature" | "cacheRetention" | "signal"
> & {
  apiKey?: string;
};

const LOCAL_PLACEHOLDER_KEY = "stella-local";
const CREDENTIALLESS_PLACEHOLDER_KEY = "stella-credentialless";

const keyedProvider = (id: string, model: Model<Api>, fallbackKey?: string): Provider =>
  createProvider({
    id,
    auth: {
      apiKey: {
        name: `${id} key`,
        resolve: async ({ credential }) => {
          const apiKey = credential?.key?.trim() || fallbackKey;
          return apiKey ? { auth: { apiKey } } : undefined;
        },
      },
    },
    models: [model],
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi(),
      "openai-responses": openAIResponsesApi(),
      "google-generative-ai": googleGenerativeAIApi(),
    },
  });

const directTarget = async (
  route: ResolvedLlmRoute,
): Promise<{ provider: Provider; model: Model<Api> }> => {
  const { model } = route;
  if (route.credentialless) {
    return { provider: keyedProvider(model.provider, model, CREDENTIALLESS_PLACEHOLDER_KEY), model };
  }
  if (model.provider === CHATGPT_PROVIDER_ID) {
    const { chatGptModel, chatGptProvider } = await import("@stella/agent/provider/chatgpt");
    const plan = chatGptModel(model.id);
    if (!plan) throw new Error(`chatgpt/${model.id} isn't a model Stella can run on your ChatGPT plan.`);
    return { provider: chatGptProvider({ models: [plan] }), model: plan };
  }
  if (model.provider === LOCAL_PROVIDER_ID) {
    return { provider: keyedProvider(LOCAL_PROVIDER_ID, model, LOCAL_PLACEHOLDER_KEY), model };
  }
  const provider = await loadUpstreamProvider(model.provider);
  if (!provider) return { provider: keyedProvider(model.provider, model), model };
  const known = provider.getModels().find((candidate) => candidate.id === model.id);
  if (known && (known.baseUrl !== model.baseUrl || known.api !== model.api)) {
    return { provider: keyedProvider(model.provider, model), model };
  }
  return { provider, model: known ? { ...known, headers: model.headers ?? known.headers } : model };
};

const UNAUTHORIZED = /(?:^|\b)401(?:\b|$)|\bunauthorized\b|\btoken_(?:expired|revoked)\b|authentication token is expired/i;

export async function completeOnRoute(
  route: ResolvedLlmRoute,
  requested: Context,
  options: RouteCompletionOptions = {},
): Promise<AssistantMessage> {
  const context = { ...requested, messages: [...withProcessableImages(requested.messages)] };
  const { apiKey: givenKey, ...request } = options;
  const models = createModels();
  if (route.stella) {
    const { access, spec } = route.stella;
    models.setProvider(stellaProvider({ access, models: [spec] }));
    return await models.completeSimple(stellaModel(spec, access.relayBaseUrl), context, request);
  }
  const apiKey = givenKey ?? (await route.getApiKey())?.trim();
  const send = async (key: string | undefined) => {
    const { provider, model } = await directTarget(route);
    models.setProvider(provider);
    return models.completeSimple(model, context, {
      ...request,
      ...(key ? { apiKey: key } : {}),
      ...(model.headers ? { headers: model.headers } : {}),
    });
  };
  const message = await send(apiKey);
  if (message.stopReason !== "error" || !route.refreshApiKey || !UNAUTHORIZED.test(message.errorMessage ?? "")) {
    return message;
  }
  const refreshed = (await route.refreshApiKey(apiKey))?.trim();
  return refreshed ? await send(refreshed) : message;
}

export const readAssistantText = (message: AssistantMessage): string =>
  message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
