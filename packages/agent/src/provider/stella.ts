import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createProvider, type Provider } from "@earendil-works/pi-ai/models";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  GATEWAY_AGENT_TYPE_HEADER,
  GATEWAY_REQUEST_ID_HEADER,
  type GatewayProtocol,
} from "@stella/contracts/gateway/api";
import { parseReasoningEffortLevel, REASONING_EFFORT_PASSTHROUGH } from "@stella/contracts/reasoning-effort";
import { anthropicMessageToSse, chatCompletionToSse, responseToSse } from "./relay-sse.ts";

export const STELLA_PROVIDER_ID = "stella";

export const STELLA_FALLBACK_CONTEXT_WINDOW = 80_000;
const STELLA_FALLBACK_MAX_TOKENS = 16_384;

export type StellaAgentType = "orchestrator" | "general" | (string & {});

export type StellaModelSpec = {
  agentType: StellaAgentType;
  alias: string;
  protocol: GatewayProtocol;
  reasoning?: boolean;
  supportsImages?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  name?: string;
};

export type StellaRequestRoute = { sessionId?: string };

export type StellaGatewayAccess = {
  relayBaseUrl: string;
  capability(signal: AbortSignal): Promise<string>;
  fetch(input: string | URL | Request, init?: RequestInit, route?: StellaRequestRoute): Promise<Response>;
};

export const stellaModelId = (agentType: StellaAgentType, alias: string): string => `${agentType}:${alias}`;

export const parseStellaModelId = (id: string): { agentType: string; alias: string } | undefined => {
  const separator = id.indexOf(":");
  if (separator <= 0) return undefined;
  return { agentType: id.slice(0, separator), alias: id.slice(separator + 1) };
};

const API_FOR_PROTOCOL: Record<GatewayProtocol, Api | undefined> = {
  "openai-completions": "openai-completions",
  "anthropic-messages": "anthropic-messages",
  "openai-responses": "openai-responses",
  "google-generative-ai": undefined,
};

export function stellaModel(spec: StellaModelSpec, relayBaseUrl: string): Model<Api> {
  const api = API_FOR_PROTOCOL[spec.protocol];
  if (api === undefined) throw new Error(`Stella provider cannot serve ${spec.alias} over ${spec.protocol}.`);
  return {
    id: stellaModelId(spec.agentType, spec.alias),
    name: spec.name ?? spec.alias,
    api,
    provider: STELLA_PROVIDER_ID,
    baseUrl: relayBaseUrl,
    reasoning: spec.reasoning ?? true,
    thinkingLevelMap: { ...REASONING_EFFORT_PASSTHROUGH },
    ...(api === "anthropic-messages" ? { compat: { forceAdaptiveThinking: true } } : {}),
    input: spec.supportsImages === false ? ["text"] : ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: spec.contextWindow ?? STELLA_FALLBACK_CONTEXT_WINDOW,
    maxTokens: spec.maxOutputTokens ?? STELLA_FALLBACK_MAX_TOKENS,
    headers: { [GATEWAY_AGENT_TYPE_HEADER]: spec.agentType },
  } as Model<Api>;
}

const toSse: Record<string, ((body: unknown) => string) | undefined> = {
  "openai-completions": chatCompletionToSse,
  "anthropic-messages": anthropicMessageToSse,
  "openai-responses": responseToSse,
};

const protocolForPath = (pathname: string): string | undefined => {
  if (pathname.endsWith("/chat/completions")) return "openai-completions";
  if (pathname.endsWith("/messages")) return "anthropic-messages";
  if (pathname.endsWith("/responses")) return "openai-responses";
  return undefined;
};

export function managedRelayFetch(host: StellaGatewayAccess["fetch"]) {
  return async (input: string | URL | Request, init?: RequestInit, route?: StellaRequestRoute): Promise<Response> => {
    const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const protocol = protocolForPath(new URL(request.url).pathname);
    if (request.method !== "POST" || protocol === undefined) return host(request, undefined, route);
    const body = (await request.json()) as Record<string, unknown>;
    const headers = new Headers(request.headers);
    const streamed = body.stream === true;
    if (streamed) {
      body.stream = false;
      delete body.stream_options;
    }
    if (typeof body.model === "string") {
      const parsed = parseStellaModelId(body.model);
      if (parsed) {
        body.model = parsed.alias;
        headers.set(GATEWAY_AGENT_TYPE_HEADER, parsed.agentType);
      }
    }
    // The Anthropic adapter sends its key as `x-api-key`; the gateway reads only the bearer.
    const apiKey = headers.get("x-api-key");
    if (apiKey !== null) {
      if (!headers.has("authorization")) headers.set("authorization", `Bearer ${apiKey}`);
      headers.delete("x-api-key");
    }
    if (!headers.has(GATEWAY_REQUEST_ID_HEADER)) headers.set(GATEWAY_REQUEST_ID_HEADER, crypto.randomUUID());
    headers.set("content-type", "application/json");
    headers.delete("content-length");
    const response = await host(
      request.url,
      { method: "POST", headers, body: JSON.stringify(body), signal: request.signal },
      route,
    );
    if (!streamed || !response.ok) return response;
    const convert = toSse[protocol]!;
    const text = convert(await response.json());
    const replayHeaders = new Headers(response.headers);
    replayHeaders.set("content-type", "text/event-stream; charset=utf-8");
    replayHeaders.delete("content-length");
    replayHeaders.delete("content-encoding");
    return new Response(text, { status: 200, statusText: "OK", headers: replayHeaders });
  };
}

type RelayFetch = ReturnType<typeof managedRelayFetch>;

const routed = (relay: RelayFetch, sessionId: string | undefined): typeof fetch =>
  ((input: string | URL | Request, init?: RequestInit) => relay(input, init, { ...(sessionId ? { sessionId } : {}) })) as typeof fetch;

/**
 * The window a Stella model reports is what pi compacts against, which can be
 * below what the upstream serves (GPT-6 Luna's price tier). pi-ai would also
 * cap each request's output at that window less a characters/4 estimate of
 * its input, and a summary request carries nearly the whole window, so an
 * overestimate leaves it a single output token. The gateway caps output
 * itself, so the adapter gets no window.
 */
const unwindowed = <T extends { contextWindow: number }>(model: T): T => ({ ...model, contextWindow: 0 });

const ranOutWhileThinking = (message: AssistantMessage): boolean =>
  message.stopReason === "length" &&
  !message.content.some((part) => part.type === "text" && part.text.trim() !== "");

const RAN_OUT_WHILE_THINKING =
  "The model ran out of room while thinking and wrote no answer. Try again, or pick a lower thinking level.";

/**
 * Reasoning shares the output ceiling with the answer, and effort-only APIs
 * take no thinking cap, so a hard problem can end on `length` with nothing
 * written. That response is asked again once at low effort; if that also
 * ends empty, the turn fails with a message instead of ending silently.
 */
const answerAfterRunningOut = (
  attempt: (options: SimpleStreamOptions | undefined) => AssistantMessageEventStream,
  options: SimpleStreamOptions | undefined,
): AssistantMessageEventStream => {
  const requested = parseReasoningEffortLevel(options?.reasoning);
  const retryWith: SimpleStreamOptions | undefined =
    requested !== undefined && requested !== "low" ? { ...options, reasoning: "low" } : undefined;
  const first = attempt(options);
  const out = createAssistantMessageEventStream();
  const ranOut = (message: AssistantMessage, errorMessage = RAN_OUT_WHILE_THINKING) =>
    out.push({ type: "error", reason: "error", error: { ...message, stopReason: "error", errorMessage } });
  const forward = async (events: AssistantMessageEventStream, retry: boolean) => {
    for await (const event of events) {
      if (retry && event.type === "start") continue;
      if (event.type === "done" && ranOutWhileThinking(event.message)) return event.message;
      out.push(event);
    }
    return undefined;
  };
  void (async () => {
    const emptied = await forward(first, false);
    if (emptied === undefined) return;
    if (retryWith === undefined) return ranOut(emptied);
    try {
      const again = await forward(attempt(retryWith), true);
      if (again !== undefined) ranOut(again);
    } catch (error) {
      ranOut(emptied, error instanceof Error ? error.message : String(error));
    }
  })().finally(() => out.end());
  return out;
};

const withFetch = (streams: ProviderStreams, relay: RelayFetch): ProviderStreams => ({
  stream: (model, context, options) =>
    streams.stream(unwindowed(model), context, { ...options, fetch: routed(relay, options?.sessionId) }),
  streamSimple: (model, context, options) =>
    answerAfterRunningOut(
      (attemptOptions) =>
        streams.streamSimple(unwindowed(model), context, {
          ...attemptOptions,
          fetch: routed(relay, attemptOptions?.sessionId),
        }),
      options,
    ),
});

export type StellaProviderOptions = {
  access: StellaGatewayAccess;
  models: readonly StellaModelSpec[];
};

export function stellaProvider(options: StellaProviderOptions): Provider {
  const relay = managedRelayFetch(options.access.fetch);
  const models: Model<Api>[] = [];
  for (const spec of options.models) {
    if (API_FOR_PROTOCOL[spec.protocol] === undefined) continue;
    models.push(stellaModel(spec, options.access.relayBaseUrl));
  }
  return createProvider({
    id: STELLA_PROVIDER_ID,
    name: "Stella",
    baseUrl: options.access.relayBaseUrl,
    auth: {
      apiKey: {
        name: "Stella session capability",
        resolve: async ({ signal }) => ({
          auth: { apiKey: await options.access.capability(signal) },
          source: "Stella account",
        }),
      },
    },
    models,
    api: {
      "openai-completions": withFetch(openAICompletionsApi(), relay),
      "anthropic-messages": withFetch(anthropicMessagesApi(), relay),
      "openai-responses": withFetch(openAIResponsesApi(), relay),
    },
  });
}
