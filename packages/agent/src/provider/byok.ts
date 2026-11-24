import type { Api, AuthContext, Credential, CredentialStore, Model } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createProvider, type MutableModels, type Provider } from "@earendil-works/pi-ai/models";
import type { ModelRef } from "@earendil-works/pi-durable";
import { modelForUnlistedId } from "@stella/contracts/provider-live-models";
import { loadUpstreamProvider } from "./lazy-upstream.ts";
import { STELLA_PROVIDER_ID } from "./stella.ts";

export const CHATGPT_PROVIDER_ID = "chatgpt";

export type ModelPick =
  | { kind: "stella"; alias: string }
  | { kind: "direct"; provider: string; modelId: string }
  | { kind: "local"; raw: string; modelId: string; baseUrl: string }
  | { kind: "engine"; engine: string; modelId: string };

export const LOCAL_PROVIDER_ID = "local";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
/** A local server often takes no key, but the OpenAI client always sends one. */
const LOCAL_PLACEHOLDER_KEY = "stella-local";
/** The same for a models.json proxy whose auth travels in its configured headers. */
const CREDENTIALLESS_PLACEHOLDER_KEY = "stella-credentialless";

export type DirectModelRoute = {
  model: Model<Api>;
  getApiKey(): Promise<string | undefined> | string | undefined;
  credentialless?: boolean;
};
export type DirectModelResolver = (reference: string) => DirectModelRoute | { error: string };

const PROVIDER_ALIASES: Record<string, string> = {
  "codex-cli": CHATGPT_PROVIDER_ID,
  codex: CHATGPT_PROVIDER_ID,
};
const PROVIDER_FAMILIES: Record<string, string[]> = { moonshotai: ["moonshotai", "kimi-coding"] };
const ENGINE_PROVIDERS = new Set(["claude-code", "antigravity"]);

const parseLocal = (raw: string): ModelPick | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    let baseUrl = "";
    try {
      baseUrl = decodeURIComponent(trimmed.slice(0, slash));
    } catch {
      baseUrl = "";
    }
    const modelId = trimmed.slice(slash + 1).trim();
    if (/^https?:\/\//i.test(baseUrl) && modelId) return { kind: "local", raw: trimmed, modelId, baseUrl };
  }
  return { kind: "local", raw: trimmed, modelId: trimmed, baseUrl: DEFAULT_LOCAL_BASE_URL };
};

export const parseModelPick = (pick: string | undefined): ModelPick | undefined => {
  const trimmed = pick?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("stella/")) return { kind: "stella", alias: trimmed };
  if (ENGINE_PROVIDERS.has(trimmed.toLowerCase())) return { kind: "engine", engine: trimmed.toLowerCase(), modelId: "default" };
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return undefined;
  const provider = trimmed.slice(0, slash);
  const modelId = trimmed.slice(slash + 1).trim();
  if (ENGINE_PROVIDERS.has(provider.toLowerCase())) {
    return { kind: "engine", engine: provider.toLowerCase(), modelId: modelId || "default" };
  }
  if (!modelId) return undefined;
  if (provider === LOCAL_PROVIDER_ID) return parseLocal(modelId);
  return { kind: "direct", provider: PROVIDER_ALIASES[provider] ?? provider, modelId };
};

export type StellaCredentialAccess = {
  apiKey(provider: string): Promise<string | null | undefined>;
  oauthToken(provider: string): Promise<string | null | undefined>;
};

export const stellaCredentialStore = (access: StellaCredentialAccess): CredentialStore => {
  const read = async (providerId: string): Promise<Credential | undefined> => {
    if (providerId === STELLA_PROVIDER_ID) return undefined;
    const key = (await access.apiKey(providerId))?.trim() || (await access.oauthToken(providerId))?.trim();
    return key ? { type: "api_key", key } : undefined;
  };
  return {
    read,
    list: async () => [],
    modify: async (providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>) =>
      (await fn(await read(providerId))) ?? (await read(providerId)),
    delete: async () => {},
  };
};

export const storeOnlyAuthContext: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

const RESERVED_UPSTREAM_IDS = new Set([STELLA_PROVIDER_ID, LOCAL_PROVIDER_ID, CHATGPT_PROVIDER_ID]);

export function byokModels(models: MutableModels, resolveDirect?: DirectModelResolver) {
  const registeredUpstream = new Set<string>();
  const ensureUpstream = async (id: string): Promise<Provider | undefined> => {
    if (RESERVED_UPSTREAM_IDS.has(id)) return undefined;
    const provider = await loadUpstreamProvider(id);
    if (!provider) return undefined;
    if (!registeredUpstream.has(provider.id)) {
      registeredUpstream.add(provider.id);
      models.setProvider(provider);
    }
    return provider;
  };

  let chatGptModule: Promise<typeof import("./chatgpt.ts")> | undefined;
  const loadChatGpt = () => (chatGptModule ??= import("./chatgpt.ts"));

  const chatgpt = new Map<string, Model<"openai-responses">>();
  const ensureChatGpt = async (modelId: string): Promise<ModelRef | { error: string }> => {
    if (!chatgpt.has(modelId)) {
      const { chatGptModel, chatGptProvider } = await loadChatGpt();
      const model = chatGptModel(modelId);
      if (!model) return { error: `chatgpt/${modelId} isn't a model Stella can run on your ChatGPT plan.` };
      chatgpt.set(modelId, model);
      models.setProvider(chatGptProvider({ models: [...chatgpt.values()] }));
    }
    return { provider: CHATGPT_PROVIDER_ID, modelId };
  };

  const local = new Map<string, Model<"openai-completions">>();
  const localNames = new Map<string, string>();
  const completions = openAICompletionsApi();
  const asNamed = <M extends Model<Api>>(model: M): M => ({ ...model, id: localNames.get(model.id) ?? model.id });
  const registerLocal = () =>
    models.setProvider(
      createProvider({
        id: LOCAL_PROVIDER_ID,
        name: "Local",
        baseUrl: DEFAULT_LOCAL_BASE_URL,
        auth: {
          apiKey: {
            name: "Local model key",
            resolve: async ({ credential }) => ({
              auth: { apiKey: credential?.key?.trim() || LOCAL_PLACEHOLDER_KEY },
              source: credential?.key ? "Stella" : "none",
            }),
          },
        },
        models: [...local.values()],
        api: {
          "openai-completions": {
            stream: (model, context, options) => completions.stream(asNamed(model), context, options),
            streamSimple: (model, context, options) => completions.streamSimple(asNamed(model), context, options),
          },
        },
      }),
    );

  const ensureLocal = (pick: Extract<ModelPick, { kind: "local" }>): ModelRef => {
    if (!local.has(pick.raw)) {
      localNames.set(pick.raw, pick.modelId);
      local.set(pick.raw, {
        id: pick.raw,
        name: pick.modelId,
        api: "openai-completions",
        provider: LOCAL_PROVIDER_ID,
        baseUrl: pick.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: NO_COST,
        contextWindow: 128_000,
        maxTokens: 8_192,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
          supportsStrictMode: false,
          supportsLongCacheRetention: false,
        },
      } as Model<"openai-completions">);
      registerLocal();
    }
    return { provider: LOCAL_PROVIDER_ID, modelId: pick.raw };
  };

  const unlisted = new Map<string, Model<Api>[]>();
  const ensureDirect = async (pick: Extract<ModelPick, { kind: "direct" }>): Promise<ModelRef | { error: string }> => {
    const family = PROVIDER_FAMILIES[pick.provider] ?? [pick.provider];
    const familyProviders = await Promise.all(family.map((id) => ensureUpstream(id)));
    // The picker writes some ids with dots where the provider uses dashes.
    for (const provider of family) {
      for (const candidate of [pick.modelId, pick.modelId.replace(/\./g, "-")]) {
        if (models.getModel(provider, candidate)) return { provider, modelId: candidate };
      }
    }
    const provider = familyProviders[0];
    const unlistedModel = provider ? modelForUnlistedId(provider.getModels(), pick.modelId) : undefined;
    if (!provider || !unlistedModel) {
      return { error: `${pick.provider}/${pick.modelId} isn't a model Stella can run with your key.` };
    }
    const extra = [...(unlisted.get(provider.id) ?? []), unlistedModel];
    unlisted.set(provider.id, extra);
    models.setProvider({
      ...provider,
      getModels: () => [...provider.getModels(), ...extra],
      getAllModels: () => [...(provider.getAllModels?.() ?? provider.getModels()), ...extra],
    });
    return { provider: provider.id, modelId: pick.modelId };
  };

  const routed = new Map<string, Map<string, DirectModelRoute>>();
  let generic: Provider | undefined;
  const genericProvider = () =>
    (generic ??= createProvider({
      id: "stella-direct",
      auth: { apiKey: { name: "Key", resolve: async () => undefined } },
      models: [],
      api: {
        "anthropic-messages": anthropicMessagesApi(),
        "openai-completions": openAICompletionsApi(),
        "openai-responses": openAIResponsesApi(),
        "google-generative-ai": googleGenerativeAIApi(),
      },
    }));
  const routedProvider = (id: string, base: Provider | undefined): Provider => {
    const own = () => routed.get(id) ?? new Map<string, DirectModelRoute>();
    const target = (model: Model<Api>): { provider: Provider; model: Model<Api> } => {
      const route = own().get(model.id);
      const headers = route?.model.headers ? { ...model.headers, ...route.model.headers } : model.headers;
      const request = headers ? { ...model, headers } : model;
      const known = base?.getModels().find((entry) => entry.id === model.id);
      const native = base && (!route || (known && known.baseUrl === model.baseUrl && known.api === model.api));
      return { provider: native ? base : genericProvider(), model: request };
    };
    const chatModels = (): Model<Api>[] => {
      const overrides = own();
      return [
        ...(base?.getModels() ?? []).filter((model) => !overrides.has(model.id)),
        ...[...overrides.values()].map((route) => route.model),
      ];
    };
    return {
      id,
      name: base?.name ?? id,
      ...(base?.baseUrl ? { baseUrl: base.baseUrl } : {}),
      ...(base?.headers ? { headers: base.headers } : {}),
      auth: {
        apiKey: {
          name: `${id} key`,
          resolve: async ({ credential }) => {
            let key: string | undefined;
            let credentialless = false;
            for (const route of own().values()) {
              key ||= (await route.getApiKey())?.trim() || undefined;
              credentialless ||= route.credentialless === true;
            }
            key ||= credential?.key?.trim() || (credentialless ? CREDENTIALLESS_PLACEHOLDER_KEY : undefined);
            return key ? { auth: { apiKey: key }, source: "Stella" } : undefined;
          },
        },
      },
      getModels: chatModels,
      getAllModels: () => [
        ...chatModels(),
        ...(base?.getAllModels?.() ?? []).filter((model) => "type" in model && model.type !== undefined && model.type !== "chat"),
      ],
      stream: (model, context, options) => {
        const { provider, model: request } = target(model);
        return provider.stream(request, context, options);
      },
      streamSimple: (model, context, options) => {
        const { provider, model: request } = target(model);
        return provider.streamSimple(request, context, options);
      },
    } as Provider;
  };
  const ensureRouted = async (
    resolve: DirectModelResolver,
    pick: { provider: string; modelId: string },
  ): Promise<ModelRef | { error: string }> => {
    const route = resolve(`${pick.provider}/${pick.modelId}`);
    if ("error" in route) return route;
    const { provider, id } = route.model;
    let own = routed.get(provider);
    if (!own) {
      own = new Map();
      routed.set(provider, own);
      const base = await loadUpstreamProvider(provider);
      models.setProvider(routedProvider(provider, base));
    }
    own.set(id, route);
    return { provider, modelId: id };
  };

  return {
    async ensure(pick: Exclude<ModelPick, { kind: "stella" | "engine" }>): Promise<ModelRef | { error: string }> {
      if (pick.kind === "local") return ensureLocal(pick);
      if (pick.provider === CHATGPT_PROVIDER_ID) return await ensureChatGpt(pick.modelId);
      return resolveDirect ? await ensureRouted(resolveDirect, pick) : await ensureDirect(pick);
    },
    async restore(ref: ModelRef): Promise<void> {
      if (ref.provider === LOCAL_PROVIDER_ID) {
        const pick = parseLocal(ref.modelId);
        if (pick?.kind === "local") ensureLocal(pick);
      } else if (ref.provider === CHATGPT_PROVIDER_ID) {
        await ensureChatGpt(ref.modelId);
      } else if (ref.provider !== STELLA_PROVIDER_ID && resolveDirect) {
        await ensureRouted(resolveDirect, ref);
      } else if (ref.provider !== STELLA_PROVIDER_ID) {
        await ensureUpstream(ref.provider);
        if (!models.getModel(ref.provider, ref.modelId)) await ensureDirect({ kind: "direct", ...ref });
      }
    },
  };
}
