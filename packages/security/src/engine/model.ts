/**
 * The one place Stella Security talks to a language model. The model never acts:
 * it only returns a verdict in a fixed shape, which plain code turns into what the
 * person sees. Text from emails, news and file names is data, never instructions.
 */
export type ModelRequest = {
  system: string;
  user: string;
  maxTokens?: number;
  /** "low" keeps reasoning models cheap; the judgments here are short. */
  reasoning?: "none" | "minimal" | "low" | "medium" | "high";
  purpose: string;
};

export type ModelUsage = { inputTokens: number; cachedTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number; ms: number };
export type ModelResponse = { text: string; usage: ModelUsage; model: string; provider?: string };

export interface ModelClient {
  readonly model: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

/** USD per million tokens, as billed through OpenRouter (Nov 2026). */
export const PRICES: Record<string, { input: number; cached: number; output: number; label: string; hosting: string }> = {
  "openai/gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5, label: "GPT-6 Luna", hosting: "OpenAI (US)" },
  "deepseek/deepseek-v4.1-flash": { input: 0.103, cached: 0.0103, output: 0.6, label: "DeepSeek V4.1 Flash", hosting: "Inference.net (US)" },
  "openai/gpt-6.1-terra": { input: 1, cached: 0.05, output: 5, label: "GPT-6.1 Terra", hosting: "OpenAI (US)" },
  "google/gemini-4-hydrogen": { input: 1.5, cached: 0.075, output: 7.5, label: "Gemini 4 Hydrogen", hosting: "Google (US)" },
};

export const costOf = (model: string, u: Omit<ModelUsage, "costUsd" | "ms">): number => {
  const p = PRICES[model];
  if (!p) return 0;
  return ((u.inputTokens - u.cachedTokens) * p.input + u.cachedTokens * p.cached + u.outputTokens * p.output) / 1e6;
};

type ChatCompletion = {
  provider?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number }; cost?: number };
  error?: { message?: string };
};

const providerRouting = (model: string) =>
  model.startsWith("deepseek/") ? { provider: { only: ["inference-net/us", "inference-net"], allow_fallbacks: false, data_collection: "deny" } } : { provider: { data_collection: "deny" } };

const body = (model: string, req: ModelRequest) => ({
  model,
  messages: [
    { role: "system", content: req.system },
    { role: "user", content: req.user },
  ],
  max_tokens: req.maxTokens ?? 2000,
  response_format: { type: "json_object" },
  ...(req.reasoning ? { reasoning: { effort: req.reasoning === "none" ? "minimal" : req.reasoning } } : {}),
});

const parse = (model: string, data: ChatCompletion, ms: number): ModelResponse => {
  const text = data.choices?.[0]?.message?.content ?? "";
  const u = data.usage ?? {};
  const usage = {
    inputTokens: u.prompt_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
  return { text, model, usage: { ...usage, costUsd: costOf(model, usage), ms }, ...(data.provider ? { provider: data.provider } : {}) };
};

/** Direct OpenRouter (measurement and development). */
export const openRouterClient = (model: string, apiKey: string): ModelClient => ({
  model,
  async complete(req) {
    const t = Date.now();
    for (let attempt = 0; ; attempt++) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-title": "Stella Security" },
        body: JSON.stringify({ ...body(model, req), ...providerRouting(model) }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = (await res.json().catch(() => ({}))) as ChatCompletion;
      if (res.ok && !data.error) return parse(model, data, Date.now() - t);
      if (attempt < 2 && (res.status >= 500 || res.status === 429)) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new Error(`${model}: HTTP ${res.status} ${data.error?.message ?? ""}`.trim());
    }
  },
});

/**
 * Through Stella's model gateway as the signed-in person (the product path): their
 * Stella account pays, limits and billing are Stella's.
 */
export const stellaGatewayClient = (model: string, fetchRelay: (url: string, init: RequestInit) => Promise<Response>, relayBaseUrl: string): ModelClient => ({
  model,
  async complete(req) {
    const t = Date.now();
    const res = await fetchRelay(`${relayBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-stella-agent-type": "general" },
      body: JSON.stringify(body(`stella/${model}`, req)),
    });
    const data = (await res.json().catch(() => ({}))) as ChatCompletion;
    if (!res.ok || data.error) throw new Error(`Stella gateway ${res.status}: ${data.error?.message ?? ""}`);
    return parse(model, data, Date.now() - t);
  },
});

/** Pull the first JSON object out of a model reply (tolerates code fences). */
export const parseJson = <T>(text: string): T => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error("The model's answer wasn't valid JSON.");
  }
};
