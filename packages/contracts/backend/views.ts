/** Stella Views' `stella.ask`: a one-shot answer from Stella's model, for any device's views host. */
export const VIEW_ASK_LIMITS = {
  maxPromptChars: 32_000,
  maxSystemChars: 8_000,
  maxOutputTokens: 2_000,
  timeoutMs: 60_000,
  perHour: 120,
} as const;

/** A chat turn a view sent (`stella.send`) carries `trigger: { kind: VIEW_SEND_TRIGGER, source: <view title> }`. */
export const VIEW_SEND_TRIGGER = "view";

export const viewSendMetadata = (title: string) => ({ trigger: { kind: VIEW_SEND_TRIGGER, source: title } });

/** The view a chat turn came from, when a view sent it. */
export const viewSendSource = (metadata: unknown): string | null => {
  const trigger = (metadata as { trigger?: { kind?: unknown; source?: unknown } } | null | undefined)?.trigger;
  if (trigger?.kind !== VIEW_SEND_TRIGGER) return null;
  return typeof trigger.source === "string" && trigger.source.trim() ? trigger.source.trim().slice(0, 120) : "a view";
};

export type ViewCalls = {
  "views.ask": {
    args: { prompt: string; system?: string };
    result: { text: string; model: string };
  };
};
