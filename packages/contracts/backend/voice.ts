export const VOICE_LIVE_SDP_PATH = "/api/voice/live/sdp";
export const VOICE_TTS_PATH = "/api/voice/tts";
export const VOICE_TTS_STREAM_PATH = "/api/voice/tts/stream";
export const VOICE_TTS_STREAM_CANCEL_PATH = "/api/voice/tts/stream/cancel";
export const VOICE_TTS_HLS_PREFIX = "/api/voice/tts/stream/hls/";
export const VOICE_LEASE_HEADER = "x-stella-voice-lease";

export const GPT_LIVE_MODEL = "gpt-live-1";

/**
 * GPT-Live accepts `instructions` up to 16,384 tokens. The voice prompt is
 * now a short conversation-and-delegation brief rather than Stella's whole
 * system prompt, so this ceiling is generous at ~3 characters per token and
 * still leaves the model's own budget untouched.
 */
export const VOICE_INSTRUCTIONS_MAX_CHARS = 24_000;
export const VOICE_HISTORY_MAX_MESSAGES = 128;
/** GPT-Live caps startup history at 8,192 combined tokens. */
export const VOICE_HISTORY_MAX_CHARS = 24_000;
/**
 * `session.instructions.append`, `session.thinking.append` and
 * `session.commentary.append` each take at most 500 tokens of content.
 * Callers split longer updates.
 */
export const VOICE_APPEND_MAX_CHARS = 1_500;

export type VoiceHistoryRole = "developer" | "user" | "assistant";

export type VoiceHistoryMessage = {
  role: VoiceHistoryRole;
  text: string;
};

export type VoiceSession = {
  leaseId: string;
  model: string;
  voice: string;
  leaseExpiresAt: number;
};

export type VoiceLeaseEvent = "heartbeat" | "ended" | "expired" | "lost";

export type VoiceLease = {
  directive: "continue" | "closed";
  leaseExpiresAt: number | null;
  reason: string | null;
};

export const voiceTtsPlaylistPath = (ticket: string): string =>
  `${VOICE_TTS_HLS_PREFIX}${encodeURIComponent(ticket)}/index.m3u8`;

export type VoiceCalls = {
  "voice.session": {
    args: {
      instructions: string;
      history?: VoiceHistoryMessage[];
      voice?: string;
      model?: string;
    };
    result: VoiceSession;
  };
  "voice.lease": {
    args: { leaseId: string; event: VoiceLeaseEvent };
    result: VoiceLease;
  };
  "tts.prepare": {
    args: { text: string; voice?: string };
    result: { ticket: string; playlistPath: string; expiresAt: number };
  };
  "dictation.realtimeConfig": {
    args: Record<string, never>;
    result: { relayOrigin: string; modelId: string };
  };
};
