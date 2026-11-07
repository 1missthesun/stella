/**
 * OpenAI bills a GPT-5.4-and-later prompt above 272K input tokens at 2x input
 * and 1.5x output for the whole request, although the models accept 1.05M.
 * Verified 2026-11-06 on developers.openai.com model pages.
 */
export const OPENAI_LONG_CONTEXT_INPUT_TOKENS = 272_000;

/**
 * The context Stella holds a model family to, whichever provider serves it.
 * Keys are bare model ids; a provider's vendor prefix (`openai/`), tier
 * suffixes (`-pro`, `-fast`, `-decisions`) and `:batch` are ignored.
 */
const EFFECTIVE_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  "gpt-5.4": OPENAI_LONG_CONTEXT_INPUT_TOKENS,
  "gpt-5.5": OPENAI_LONG_CONTEXT_INPUT_TOKENS,
  "gpt-5.6-luna": OPENAI_LONG_CONTEXT_INPUT_TOKENS,
  "gpt-5.6-sol": OPENAI_LONG_CONTEXT_INPUT_TOKENS,
  "gpt-5.6-terra": OPENAI_LONG_CONTEXT_INPUT_TOKENS,
  "gpt-6-astra": OPENAI_LONG_CONTEXT_INPUT_TOKENS,
  "gpt-6-sol": OPENAI_LONG_CONTEXT_INPUT_TOKENS,
  "gpt-6-luna": OPENAI_LONG_CONTEXT_INPUT_TOKENS,
  "gpt-6.1-sol": OPENAI_LONG_CONTEXT_INPUT_TOKENS,
  "gpt-6.1-terra": OPENAI_LONG_CONTEXT_INPUT_TOKENS,
};

const familyOf = (modelId: string): string =>
  modelId
    .trim()
    .toLowerCase()
    .replace(/^.*\//, "")
    .replace(/:batch$/, "")
    .replace(/(-pro|-fast|-decisions)+$/, "");

/**
 * OpenAI's default window for a model on a ChatGPT plan, where subscription
 * usage has no long-context surcharge ("GPT-6.1 Sol uses a default context
 * window of 500K tokens in Codex and ChatGPT Work"). Keyed by provider id.
 */
const PLAN_CONTEXT_WINDOWS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  chatgpt: { "gpt-6.1-sol": 500_000 },
};

/**
 * The window to compact a model against: the plan default where OpenAI sets
 * one, else its family's effective window when that is smaller than what the
 * provider advertises, else the advertised one.
 */
export const effectiveContextWindow = (modelId: string, advertised: number, provider?: string): number => {
  const family = familyOf(modelId);
  const plan = provider === undefined ? undefined : PLAN_CONTEXT_WINDOWS[provider]?.[family];
  if (plan !== undefined) return plan;
  const effective = EFFECTIVE_CONTEXT_WINDOWS[family];
  return effective !== undefined && effective < advertised ? effective : advertised;
};
