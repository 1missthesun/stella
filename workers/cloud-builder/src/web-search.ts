/**
 * Web search through Cloudflare's Web Search API, reached with the Worker's
 * AI binding through an AI Gateway on the same account, so it needs no
 * provider key. The provider is Exa unless `WEB_SEARCH_PROVIDER` names
 * another. The `search` owner domain meters it; this module only talks to the
 * provider.
 */

import type {
  WebSearchHit,
  WebSearchResult,
} from "@stella/contracts/backend/search";

type Provider = "ceramic" | "exa" | "linkup";

/** List price per request in micro-cents: $0.25, $7 and $5 per 1,000. */
const PROVIDER_COST_MICRO_CENTS: Record<Provider, number> = {
  ceramic: 25_000,
  exa: 700_000,
  linkup: 500_000,
};

const DEFAULT_PROVIDER: Provider = "exa";
const DEFAULT_GATEWAY_ID = "default";
const MAX_RESULTS = 6;
const MAX_QUERY_CHARS = 1_024;
const MAX_SNIPPET_CHARS = 300;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export type WebSearchOutcome = {
  result: WebSearchResult;
  /** What the provider billed us; zero when it did not serve the search. */
  costMicroCents: number;
};

const providerOf = (env: Cloudflare.Env): Provider => {
  const named = (
    env as { WEB_SEARCH_PROVIDER?: string }
  ).WEB_SEARCH_PROVIDER?.trim().toLowerCase();
  return named && named in PROVIDER_COST_MICRO_CENTS
    ? (named as Provider)
    : DEFAULT_PROVIDER;
};

type WebSearchItem = {
  url?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  faviconUrl?: string;
};

type WebSearchBody = {
  items?: WebSearchItem[];
  error?: { message?: string; code?: string } | string;
  errors?: Array<{ message?: string }>;
};

const formatText = (query: string, results: WebSearchHit[]): string => {
  if (results.length === 0) return `No web results found for "${query}".`;
  const formatted = results
    .map((result, index) => {
      const parts = [`${index + 1}. ${result.title}`, `   ${result.url}`];
      if (result.snippet) parts.push(`   ${result.snippet}`);
      return parts.join("\n");
    })
    .join("\n\n");
  return `[External Content - Untrusted Source: web search: ${query}]\n${formatted}\n[End External Content]`;
};

const failed = (text: string): WebSearchOutcome => ({
  result: { text, results: [] },
  costMicroCents: 0,
});

const readBody = async (response: Response): Promise<string> => {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Search response is too large.");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_RESPONSE_BYTES)
    throw new Error("Search response is too large.");
  return new TextDecoder().decode(bytes);
};

const parseBody = (body: string): WebSearchBody => {
  try {
    return JSON.parse(body) as WebSearchBody;
  } catch {
    return {};
  }
};

const errorMessage = (data: WebSearchBody, body: string): string => {
  if (typeof data.error === "string") return data.error;
  return data.error?.message ?? data.errors?.[0]?.message ?? body.slice(0, 500);
};

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

const queryTerms = (query: string): string[] => [
  ...new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length > 2),
  ),
];

const clip = (text: string): string =>
  text.length <= MAX_SNIPPET_CHARS
    ? text
    : `${text.slice(0, MAX_SNIPPET_CHARS - 1).trimEnd()}…`;

const snippetOf = (
  description: string | undefined,
  title: string,
  terms: string[],
): string => {
  const paragraphs = (description ?? "")
    .split(/\n\s*\n/)
    .map(collapse)
    .filter(Boolean);
  if (paragraphs[0] && paragraphs[0].toLowerCase() === title.toLowerCase())
    paragraphs.shift();
  if (paragraphs.length === 0) return "";
  let best = 0;
  let bestScore = 0;
  paragraphs.forEach((paragraph, index) => {
    const lower = paragraph.toLowerCase();
    const score = terms.filter((term) => lower.includes(term)).length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  let text = paragraphs[best]!;
  for (
    let next = best + 1;
    next < paragraphs.length && text.length < MAX_SNIPPET_CHARS;
    next++
  ) {
    text = `${text} ${paragraphs[next]}`;
  }
  return clip(text);
};

const toHit = (item: WebSearchItem, terms: string[]): WebSearchHit => {
  const image = item.imageUrl?.trim();
  const favicon = item.faviconUrl?.trim();
  const title = collapse(item.title ?? "") || "(no title)";
  return {
    title,
    url: (item.url ?? "").trim(),
    snippet: snippetOf(item.description, title, terms),
    ...(image ? { image } : {}),
    ...(favicon ? { favicon } : {}),
  };
};

const withTimeout = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });

type SearchBackend = "cloudflare" | "openrouter" | "off";

const configured = (env: unknown, name: string): string => {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
};

/**
 * Cloudflare's Web Search API (AI Gateway credits) on hosted Stella. An
 * owner-mode server searches through OpenRouter's web plugin when it has a
 * key, and through Cloudflare only when STELLA_WEB_SEARCH says so; Claude
 * Code turns search with their own tool either way.
 */
export const webSearchBackend = (env: unknown): SearchBackend => {
  const chosen = configured(env, "STELLA_WEB_SEARCH").toLowerCase();
  if (chosen === "cloudflare" || chosen === "openrouter" || chosen === "off") return chosen;
  if (configured(env, "STELLA_OWNER_MODE") !== "1") return "cloudflare";
  return configured(env, "OPENROUTER_API_KEY") ? "openrouter" : "off";
};

const OPENROUTER_SEARCH_MODEL = "openai/gpt-4o-mini";

type OpenRouterAnnotation = {
  type?: string;
  url_citation?: { url?: string; title?: string; content?: string };
};

const searchOpenRouter = async (
  env: Cloudflare.Env,
  query: string,
  signal: AbortSignal,
): Promise<WebSearchOutcome> => {
  const key = configured(env, "OPENROUTER_API_KEY");
  if (!key) return failed("WebSearch through OpenRouter needs OPENROUTER_API_KEY on this server.");
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: configured(env, "STELLA_WEB_SEARCH_MODEL") || OPENROUTER_SEARCH_MODEL,
        plugins: [{ id: "web", max_results: MAX_RESULTS }],
        max_tokens: 200,
        messages: [{ role: "user", content: `Search the web for: ${query}\nSummarize the top results in two sentences.` }],
      }),
      signal,
    });
    const body = await readBody(response);
    if (!response.ok) return failed(`WebSearch failed (${response.status}): ${body.slice(0, 300)}`);
    const data = JSON.parse(body) as {
      choices?: Array<{ message?: { annotations?: OpenRouterAnnotation[] } }>;
      usage?: { cost?: number };
    };
    const terms = queryTerms(query);
    const seen = new Set<string>();
    const results = (data.choices?.[0]?.message?.annotations ?? [])
      .filter((annotation) => annotation.type === "url_citation" && annotation.url_citation?.url)
      .map((annotation) =>
        toHit(
          {
            url: annotation.url_citation!.url!,
            title: annotation.url_citation!.title ?? "",
            description: annotation.url_citation!.content ?? "",
          },
          terms,
        ),
      )
      .filter((hit) => hit.url && !seen.has(hit.url) && seen.add(hit.url))
      .slice(0, MAX_RESULTS);
    const cost = typeof data.usage?.cost === "number" ? Math.round(data.usage.cost * 100 * 1_000_000) : 0;
    return { result: { text: formatText(query, results), results }, costMicroCents: cost };
  } catch (error) {
    if (signal.aborted) return failed("WebSearch timed out.");
    return failed(`WebSearch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const searchWeb = async (
  env: Cloudflare.Env,
  input: { query: string; category?: string; signal: AbortSignal },
): Promise<WebSearchOutcome> => {
  const query = input.query.trim();
  if (!query) return failed("WebSearch failed: query is required.");
  const backend = webSearchBackend(env);
  if (backend === "off") {
    return failed(
      "Web search isn't set up on this Stella server. Claude Code agents search with their own tool; for other models, add an OpenRouter key to the server or turn on Cloudflare search (STELLA_WEB_SEARCH=cloudflare).",
    );
  }
  if (backend === "openrouter") {
    const category = input.category?.trim();
    return await searchOpenRouter(env, (category ? `${query} ${category}` : query).slice(0, MAX_QUERY_CHARS), input.signal);
  }
  const ai = (env as { AI?: Ai }).AI;
  if (!ai)
    return failed("WebSearch is not configured (missing the AI binding).");
  const gatewayId =
    (env as { AI_GATEWAY_ID?: string }).AI_GATEWAY_ID?.trim() ||
    DEFAULT_GATEWAY_ID;
  const provider = providerOf(env);
  const category = input.category?.trim();
  const providerQuery = (category ? `${query} ${category}` : query).slice(
    0,
    MAX_QUERY_CHARS,
  );
  try {
    const response = await withTimeout(
      ai.websearch({
        gatewayId,
        query: providerQuery,
        provider,
        limit: MAX_RESULTS,
      }),
      input.signal,
    );
    const body = await readBody(response);
    const data = parseBody(body);
    if (!response.ok) {
      return failed(
        `WebSearch failed (${response.status}): ${errorMessage(data, body)}`,
      );
    }
    const terms = queryTerms(query);
    const results = (data.items ?? [])
      .map((item) => toHit(item, terms))
      .filter((hit) => hit.url)
      .slice(0, MAX_RESULTS);
    return {
      result: { text: formatText(query, results), results },
      costMicroCents: PROVIDER_COST_MICRO_CENTS[provider],
    };
  } catch (error) {
    if (input.signal.aborted) return failed("WebSearch timed out.");
    return failed(
      `WebSearch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
