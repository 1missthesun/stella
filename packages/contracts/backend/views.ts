/** Stella Views' `stella.ask`: a one-shot answer from Stella's model, for any device's views host. */
export const VIEW_ASK_LIMITS = {
  maxPromptChars: 32_000,
  maxSystemChars: 8_000,
  maxOutputTokens: 2_000,
  timeoutMs: 60_000,
  perHour: 120,
} as const;

export type ViewCalls = {
  "views.ask": {
    args: { prompt: string; system?: string };
    result: { text: string; model: string };
  };
};
