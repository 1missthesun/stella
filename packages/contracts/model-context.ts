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
 * The window to compact a model against: its family's effective window when
 * that is smaller than what the provider advertises, otherwise the advertised
 * one.
 */
export const effectiveContextWindow = (modelId: string, advertised: number): number => {
  const effective = EFFECTIVE_CONTEXT_WINDOWS[familyOf(modelId)];
  return effective !== undefined && effective < advertised ? effective : advertised;
};
