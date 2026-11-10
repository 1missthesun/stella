import type { Api, Model } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createProvider, type Provider } from "@earendil-works/pi-ai/models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { siblingModel } from "@stella/contracts/provider-live-models";

export const CHATGPT_PROVIDER_ID = "chatgpt";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
/** The adapter's bearer when the transport sets the real one; not an `sk-` key, so the plan's limits apply. */
const TRANSPORT_PLACEHOLDER_KEY = "stella-chatgpt-plan";

export type ChatGptTransport = {
  baseUrl: string;
  fetch(request: Request, route: { sessionId?: string }): Promise<Response>;
};

/**
 * A plan model by its ChatGPT slug: pi-ai's entry for the OpenAI model, or,
 * for one pi-ai doesn't know yet, one shaped like its nearest sibling, else
 * like OpenAI's newest reasoning model.
 */
export const chatGptModel = (modelId: string): Model<"openai-responses"> | undefined => {
  const openai = (Object.values(OPENAI_MODELS) as Model<Api>[]).filter(
    (model): model is Model<"openai-responses"> => model.api === "openai-responses",
  );
  const known = openai.find((model) => model.id === modelId || model.id === modelId.replace(/\./g, "-"));
  const template = known ?? siblingModel(openai, modelId) ?? openai.filter((model) => model.reasoning).at(-1);
  if (!template) return undefined;
  return {
    ...template,
    id: modelId,
    name: known?.name ?? modelId,
    provider: CHATGPT_PROVIDER_ID,
    baseUrl: OPENAI_BASE_URL,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
};

type PayloadHook = (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;

/**
 * The plan's own `web_search` tool stands in for Stella's `web`: OpenAI runs
 * the search and page reads on the user's ChatGPT plan, so the turn never
 * reaches Stella's paid search.
 */
const isStellaWeb = (tool: unknown): boolean =>
  Boolean(tool) &&
  typeof tool === "object" &&
  (tool as { type?: unknown }).type === "function" &&
  (tool as { name?: unknown }).name === "web";

const withPlanWebSearch = (payload: unknown): unknown => {
  if (!payload || typeof payload !== "object") return payload;
  const body = payload as { tools?: unknown; input?: unknown };
  let offered = false;
  const withoutWeb = (tools: unknown): unknown => {
    if (!Array.isArray(tools) || !tools.some(isStellaWeb)) return tools;
    offered = true;
    return tools.filter((tool) => !isStellaWeb(tool));
  };
  const tools = withoutWeb(body.tools);
  const input = Array.isArray(body.input)
    ? body.input.map((item: unknown) =>
        item && typeof item === "object" && Array.isArray((item as { tools?: unknown }).tools)
          ? { ...(item as object), tools: withoutWeb((item as { tools: unknown }).tools) }
          : item,
      )
    : body.input;
  if (!offered) return payload;
  return { ...body, input, tools: [...(Array.isArray(tools) ? tools : []), { type: "web_search" }] };
};

export function chatGptProvider(options: {
  models: readonly Model<"openai-responses">[];
  transport?: ChatGptTransport;
}): Provider {
  const responses = openAIResponsesApi();
  const { transport } = options;
  const asOpenAI = <M extends Model<Api>>(model: M): M => ({ ...model, provider: "openai", baseUrl: OPENAI_BASE_URL });
  const routed = (sessionId: string | undefined): typeof fetch | undefined =>
    transport
      ? (((input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
          const url = transport.baseUrl.replace(/\/+$/, "") + request.url.slice(OPENAI_BASE_URL.length);
          return transport.fetch(new Request(url, request), sessionId ? { sessionId } : {});
        }) as typeof fetch)
      : undefined;
  const sent = <O extends { sessionId?: string; fetch?: typeof fetch; onPayload?: PayloadHook }>(
    options: O | undefined,
  ): O => {
    const fetch = routed(options?.sessionId);
    const given = options?.onPayload;
    const onPayload: PayloadHook = async (payload, model) => {
      const next = given ? ((await given(payload, model)) ?? payload) : payload;
      return withPlanWebSearch(next);
    };
    return { ...options, ...(fetch ? { fetch } : {}), onPayload } as O;
  };
  return createProvider({
    id: CHATGPT_PROVIDER_ID,
    name: "ChatGPT",
    baseUrl: OPENAI_BASE_URL,
    auth: {
      apiKey: {
        name: "ChatGPT plan",
        resolve: async ({ credential }) => {
          const key = credential?.key?.trim() || (transport ? TRANSPORT_PLACEHOLDER_KEY : undefined);
          return key ? { auth: { apiKey: key }, source: transport ? "Stella cloud" : "Stella" } : undefined;
        },
      },
    },
    models: [...options.models],
    api: {
      "openai-responses": {
        stream: (model, context, streamOptions) => responses.stream(asOpenAI(model), context, sent(streamOptions)),
        streamSimple: (model, context, streamOptions) =>
          responses.streamSimple(asOpenAI(model), context, sent(streamOptions)),
      },
    },
  });
}
