export type LiveProviderModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
  reasoning?: boolean;
  /** USD per million tokens, as the provider lists it. */
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

type CatalogShape = {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

type Listing = {
  url: string;
  auth: "none" | "bearer" | "anthropic" | "google";
  /**
   * The list describes each model (limits, modalities, tool use), so an id
   * from a family Stella has never seen is still offered. A bare id list is
   * only trusted for a newer version of a family Stella already runs.
   */
  described: boolean;
};

const LISTINGS: Readonly<Record<string, Listing>> = {
  openrouter: { url: "https://openrouter.ai/api/v1/models", auth: "none", described: true },
  "vercel-ai-gateway": { url: "https://ai-gateway.vercel.sh/v1/models", auth: "none", described: true },
  opencode: { url: "https://opencode.ai/zen/v1/models", auth: "none", described: true },
  anthropic: { url: "https://api.anthropic.com/v1/models?limit=1000", auth: "anthropic", described: true },
  openai: { url: "https://api.openai.com/v1/models", auth: "bearer", described: false },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    auth: "google",
    described: false,
  },
  xai: { url: "https://api.x.ai/v1/models", auth: "bearer", described: false },
  cerebras: { url: "https://api.cerebras.ai/v1/models", auth: "bearer", described: false },
};

const LIVE_LIST_TIMEOUT_MS = 15_000;
const UNKNOWN_FAMILY_CONTEXT_WINDOW = 200_000;
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const NOT_A_CHAT_MODEL =
  /embed|tts|whisper|transcri|moderation|dall-e|image|audio|realtime|sora|video|veo|rerank|guard|speech|search|robotics|computer-use/i;

export const hasLiveProviderModelList = (provider: string): boolean => provider in LISTINGS;

export const liveProviderModelListNeedsKey = (provider: string): boolean =>
  LISTINGS[provider] !== undefined && LISTINGS[provider].auth !== "none";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;

const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

const rate = (value: unknown, perToken: boolean): number | undefined => {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return undefined;
  return perToken ? Math.round(parsed * 1e12) / 1e6 : parsed;
};

const supported = (value: unknown): boolean | undefined => {
  const flag = record(value)?.supported;
  return typeof flag === "boolean" ? flag : undefined;
};

const listedCost = (raw: Record<string, unknown>): LiveProviderModel["cost"] => {
  const perToken = record(raw.pricing);
  if (perToken) {
    const input = rate(perToken.prompt ?? perToken.input, true);
    const output = rate(perToken.completion ?? perToken.output, true);
    if (input === undefined || output === undefined) return undefined;
    return {
      input,
      output,
      cacheRead: rate(perToken.input_cache_read, true) ?? 0,
      cacheWrite: rate(perToken.input_cache_write, true) ?? 0,
    };
  }
  const text = record(record(raw.cost)?.text);
  const input = record(text?.input);
  const inputRate = rate(input?.price, false);
  const outputRate = rate(record(text?.output)?.price, false);
  if (inputRate === undefined || outputRate === undefined) return undefined;
  const cache = record(input?.cache);
  return {
    input: inputRate,
    output: outputRate,
    cacheRead: rate(cache?.read, false) ?? 0,
    cacheWrite: rate(cache?.write, false) ?? 0,
  };
};

const listedModel = (value: unknown): LiveProviderModel | undefined => {
  const raw = record(value);
  if (!raw) return undefined;
  const resourceName = typeof raw.name === "string" && raw.name.startsWith("models/") ? raw.name.slice(7) : undefined;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : resourceName;
  if (!id) return undefined;

  const architecture = record(raw.architecture);
  const modalities = record(raw.modalities);
  const capabilities = record(raw.capabilities);
  const tags = strings(raw.tags);
  const parameters = strings(raw.supported_parameters);
  const outputs = strings(architecture?.output_modalities) ?? strings(modalities?.output);
  const endpoints = strings(raw.endpoints);
  const methods = strings(raw.supportedGenerationMethods);
  const usesTools = parameters?.includes("tools") ?? tags?.includes("tool-use") ?? supported(capabilities?.tools);

  if (typeof raw.type === "string" && !["language", "chat", "model"].includes(raw.type)) return undefined;
  if (typeof raw.lifecycle === "string" && raw.lifecycle !== "active") return undefined;
  if (outputs && !outputs.includes("text")) return undefined;
  if (endpoints && !endpoints.some((endpoint) => /chat\/completions|\/messages|\/responses/.test(endpoint))) return undefined;
  if (methods && !methods.includes("generateContent")) return undefined;
  if (usesTools === false) return undefined;

  const inputs = strings(architecture?.input_modalities) ?? strings(modalities?.input);
  const seesImages =
    inputs?.some((modality) => modality.startsWith("image")) ??
    supported(capabilities?.image_input) ??
    (tags ? tags.includes("vision") : undefined);
  const reasons =
    (raw.reasoning !== undefined && raw.reasoning !== null && raw.reasoning !== false ? true : undefined) ??
    (parameters ? parameters.includes("reasoning") : undefined) ??
    (tags ? tags.includes("reasoning") : undefined) ??
    supported(capabilities?.reasoning) ??
    supported(capabilities?.thinking) ??
    (typeof raw.thinking === "boolean" ? raw.thinking : undefined);
  const limit = record(raw.limit);
  const name =
    (typeof raw.display_name === "string" && raw.display_name) ||
    (typeof raw.displayName === "string" && raw.displayName) ||
    (typeof raw.name === "string" && !resourceName && raw.name) ||
    undefined;
  const contextWindow =
    positive(raw.context_length) ??
    positive(raw.context_window) ??
    positive(raw.max_input_tokens) ??
    positive(raw.inputTokenLimit) ??
    positive(limit?.context);
  const maxTokens =
    positive(record(raw.top_provider)?.max_completion_tokens) ??
    positive(raw.max_tokens) ??
    positive(raw.outputTokenLimit) ??
    positive(limit?.output);
  const cost = listedCost(raw);
  return {
    id,
    ...(name ? { name } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(seesImages === undefined ? {} : { input: seesImages ? ["text", "image"] : ["text"] }),
    ...(reasons === undefined ? {} : { reasoning: reasons }),
    ...(cost ? { cost } : {}),
  };
};

/**
 * The models a provider's own API lists right now. Undefined when the
 * provider has no list Stella reads, or its list needs a key and none was
 * given; throws when the request fails.
 */
export const fetchLiveProviderModels = async (
  provider: string,
  options: { apiKey?: string; fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<LiveProviderModel[] | undefined> => {
  const listing = LISTINGS[provider];
  if (!listing) return undefined;
  const apiKey = options.apiKey?.trim();
  if (listing.auth !== "none" && !apiKey) return undefined;
  const headers: Record<string, string> = { accept: "application/json" };
  if (listing.auth === "bearer") headers.authorization = `Bearer ${apiKey}`;
  if (listing.auth === "google") headers["x-goog-api-key"] = apiKey!;
  if (listing.auth === "anthropic") {
    headers["x-api-key"] = apiKey!;
    headers["anthropic-version"] = "2023-06-01";
  }
  const timeout = AbortSignal.timeout(LIVE_LIST_TIMEOUT_MS);
  const response = await (options.fetch ?? fetch)(listing.url, {
    headers,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`${provider} model list request failed: ${response.status}`);
  const payload = record(await response.json());
  const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  const models = new Map<string, LiveProviderModel>();
  for (const entry of entries) {
    const model = listedModel(entry);
    if (model && !models.has(model.id)) models.set(model.id, model);
  }
  return [...models.values()];
};

const familyStem = (id: string): string => /^[^0-9]*/.exec(id.toLowerCase())![0];

const versionOf = (id: string): [number, number] | undefined => {
  const match = /^[^0-9]*(\d+)(?:[.-](\d{1,2})(?!\d))?/.exec(id);
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : undefined;
};

const sharedPrefix = (a: string, b: string): number => {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
};

const sharedSuffix = (a: string, b: string): number => {
  let index = 0;
  while (index < a.length && index < b.length && a[a.length - 1 - index] === b[b.length - 1 - index]) index += 1;
  return index;
};

const familyOf = <M extends { id: string }>(known: readonly M[], id: string): M[] => {
  const stem = familyStem(id);
  if (!stem || stem === id.toLowerCase()) return [];
  return known.filter((model) => model.id.toLowerCase().startsWith(stem));
};

/**
 * The known model closest to `id` within its family: `claude-fable-5-1` for
 * `claude-fable-5-2`, the newest Opus for `claude-opus-6`.
 */
export const siblingModel = <M extends { id: string }>(known: readonly M[], id: string): M | undefined => {
  const target = id.toLowerCase();
  let best: M | undefined;
  let bestScore: number[] = [];
  for (const model of familyOf(known, id)) {
    const candidate = model.id.toLowerCase();
    const [major, minor] = versionOf(candidate) ?? [-1, -1];
    const score = [sharedPrefix(candidate, target), major, minor, sharedSuffix(candidate, target), -candidate.length];
    const difference = score.findIndex((value, index) => value !== bestScore[index]);
    if (!best || difference < 0 || score[difference]! > bestScore[difference]!) {
      best = model;
      bestScore = score;
    }
  }
  return best;
};

const isNewerVersionOfKnownFamily = (known: readonly { id: string }[], id: string): boolean => {
  if (NOT_A_CHAT_MODEL.test(id)) return false;
  const version = versionOf(id);
  if (!version) return false;
  const versions = familyOf(known, id).flatMap((model) => {
    const knownVersion = versionOf(model.id);
    return knownVersion ? [knownVersion] : [];
  });
  if (versions.length === 0) return false;
  return versions.every(([major, minor]) => version[0] > major || (version[0] === major && version[1] >= minor));
};

/**
 * A runnable model for an id the catalog doesn't list. It takes its wire
 * shape (API, base URL, compat, effort levels) from its nearest sibling, or
 * from the provider's newest model when the family is new, and its limits,
 * modalities and price from `live` when the provider listed them. A price
 * nobody published is zero, never a sibling's.
 */
export const modelForUnlistedId = <M extends CatalogShape>(
  known: readonly M[],
  id: string,
  live?: LiveProviderModel,
): M | undefined => {
  const sibling = siblingModel(known, id);
  const vendor = id.includes("/") ? id.slice(0, id.indexOf("/") + 1) : undefined;
  const template =
    sibling ?? (vendor ? known.filter((model) => model.id.startsWith(vendor)).at(-1) : undefined) ?? known.at(-1);
  if (!template) return undefined;
  return {
    ...template,
    id,
    name: live?.name ?? id,
    reasoning: live?.reasoning ?? template.reasoning,
    input: live?.input ?? (sibling ? template.input : ["text", "image"]),
    cost: live?.cost ?? NO_COST,
    contextWindow:
      live?.contextWindow ??
      (sibling ? template.contextWindow : Math.max(template.contextWindow || 0, UNKNOWN_FAMILY_CONTEXT_WINDOW)),
    maxTokens: live?.maxTokens ?? (sibling || template.api !== "openai-completions" ? template.maxTokens : 0),
  };
};

/** Catalog entries for the models a provider lists that `known` lacks. */
export const unlistedLiveModels = <M extends CatalogShape>(
  provider: string,
  known: readonly M[],
  live: readonly LiveProviderModel[],
): M[] => {
  const listing = LISTINGS[provider];
  if (!listing) return [];
  const knownIds = new Set(known.map((model) => model.id));
  return live.flatMap((entry) => {
    if (knownIds.has(entry.id) || knownIds.has(entry.id.replace(/\./g, "-"))) return [];
    if (!listing.described && !isNewerVersionOfKnownFamily(known, entry.id)) return [];
    const model = modelForUnlistedId(known, entry.id, entry);
    return model ? [model] : [];
  });
};
