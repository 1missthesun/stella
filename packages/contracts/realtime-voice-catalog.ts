export type { RealtimeVoiceUnderlyingProvider } from "./local-preferences.js";
import type { RealtimeVoiceUnderlyingProvider } from "./local-preferences.js";

export interface RealtimeVoiceCatalogEntry {
  id: string;
  label: string;
  description: string;
}

export const OPENAI_REALTIME_VOICES: readonly RealtimeVoiceCatalogEntry[] = [
  {
    id: "marin",
    label: "Marin",
    description: "Warm, natural — the default Realtime voice.",
  },
  { id: "alloy", label: "Alloy", description: "Balanced and neutral." },
  { id: "ash", label: "Ash", description: "Soft, breathy." },
  { id: "ballad", label: "Ballad", description: "Calm and measured." },
  { id: "coral", label: "Coral", description: "Bright and friendly." },
  { id: "echo", label: "Echo", description: "Crisp and clear." },
  { id: "sage", label: "Sage", description: "Thoughtful and steady." },
  { id: "shimmer", label: "Shimmer", description: "Upbeat and energetic." },
  { id: "verse", label: "Verse", description: "Smooth and lyrical." },
];

export const XAI_REALTIME_VOICES: readonly RealtimeVoiceCatalogEntry[] = [
  { id: "eve", label: "Eve", description: "Energetic and upbeat (default)." },
  { id: "ara", label: "Ara", description: "Warm and friendly." },
  {
    id: "rex",
    label: "Rex",
    description: "Confident and articulate — good for business.",
  },
  { id: "sal", label: "Sal", description: "Smooth and balanced." },
  {
    id: "leo",
    label: "Leo",
    description: "Authoritative — good for instructional content.",
  },
];

export const GPT_LIVE_VOICES: readonly RealtimeVoiceCatalogEntry[] = [
  ...OPENAI_REALTIME_VOICES,
  {
    id: "quartz",
    label: "Quartz",
    description: "Australian, feminine — generated.",
  },
  {
    id: "ripple",
    label: "Ripple",
    description: "Australian, masculine — natural.",
  },
];

// Stella's own read-aloud voices: Speechify Simba 3.5 voice ids, as
// OpenRouter takes them. The server falls back to the default for any other
// id, including voices saved for an earlier read-aloud model.
export const STELLA_TTS_VOICES: readonly RealtimeVoiceCatalogEntry[] = [
  { id: "beth", label: "Beth", description: "Natural and clear — the default read-aloud voice." },
];

export const DEFAULT_STELLA_TTS_VOICE = "beth";

export const isStellaTtsVoice = (voice: string): boolean =>
  STELLA_TTS_VOICES.some((entry) => entry.id === voice);

export const XAI_REALTIME_CLIENT_SECRET_TTL_SECONDS = 5 * 60;

/**
 * xAI's client-secret endpoint accepts expiry configuration only. Realtime
 * session fields (voice, instructions, tools) are sent after the WebSocket
 * opens via `session.update`.
 */
export const buildXaiRealtimeClientSecretRequest = (
  expiresAfterSeconds = XAI_REALTIME_CLIENT_SECRET_TTL_SECONDS,
): { expires_after: { seconds: number } } => ({
  expires_after: {
    seconds: Math.max(
      60,
      Math.floor(
        Number.isFinite(expiresAfterSeconds)
          ? expiresAfterSeconds
          : XAI_REALTIME_CLIENT_SECRET_TTL_SECONDS,
      ),
    ),
  },
});
export const DEFAULT_OPENAI_REALTIME_VOICE = "marin";
export const DEFAULT_XAI_REALTIME_VOICE = "eve";
export const DEFAULT_GPT_LIVE_VOICE = "marin";

export function getDefaultRealtimeVoice(
  provider: RealtimeVoiceUnderlyingProvider,
): string {
  if (provider === "xai") return DEFAULT_XAI_REALTIME_VOICE;
  if (provider === "openai") return DEFAULT_OPENAI_REALTIME_VOICE;
  return DEFAULT_GPT_LIVE_VOICE;
}

export function getRealtimeVoiceCatalog(
  provider: RealtimeVoiceUnderlyingProvider,
): readonly RealtimeVoiceCatalogEntry[] {
  if (provider === "xai") return XAI_REALTIME_VOICES;
  if (provider === "openai") return OPENAI_REALTIME_VOICES;
  return GPT_LIVE_VOICES;
}

