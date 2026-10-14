export type RealtimeVoiceProvider = "stella" | "openai" | "xai";

export type RealtimeVoiceUnderlyingProvider = "gptlive" | "openai" | "xai";

export type ReadAloudVoiceProvider = "gemini" | "openai";

export type RealtimeVoiceSelections = {
  gptlive?: string;
  openai?: string;
  xai?: string;
  gemini?: string;
};

export type RealtimeVoicePreferences = {
  provider: RealtimeVoiceProvider;
  model?: string;
  voices?: RealtimeVoiceSelections;
  enabled?: boolean;
  readAloudProvider?: ReadAloudVoiceProvider;
};

export const resolveRealtimeUnderlyingProvider = (
  prefs: Pick<RealtimeVoicePreferences, "provider">,
): RealtimeVoiceUnderlyingProvider => {
  if (prefs.provider === "xai") return "xai";
  if (prefs.provider === "openai") return "openai";
  return "gptlive";
};

export const isRealtimeVoiceEnabled = (
  prefs: Pick<RealtimeVoicePreferences, "enabled"> | null | undefined,
): boolean => prefs?.enabled === true;

export const getRealtimeVoiceSessionRouteKey = (
  prefs: Pick<RealtimeVoicePreferences, "provider">,
): string => `${prefs.provider}:${resolveRealtimeUnderlyingProvider(prefs)}`;

export const hasRealtimeVoiceSessionRouteChanged = (
  previous: Pick<RealtimeVoicePreferences, "provider">,
  next: Pick<RealtimeVoicePreferences, "provider">,
): boolean =>
  getRealtimeVoiceSessionRouteKey(previous) !==
  getRealtimeVoiceSessionRouteKey(next);

export const resolveReadAloudProvider = (
  prefs: Pick<RealtimeVoicePreferences, "readAloudProvider">,
): ReadAloudVoiceProvider =>
  prefs.readAloudProvider === "openai" ? "openai" : "gemini";

const REALTIME_VOICE_PROVIDERS: readonly RealtimeVoiceProvider[] = [
  "stella",
  "openai",
  "xai",
];

export const coerceRealtimeVoiceProvider = (
  value: string,
): RealtimeVoiceProvider =>
  (REALTIME_VOICE_PROVIDERS as readonly string[]).includes(value)
    ? (value as RealtimeVoiceProvider)
    : "stella";
