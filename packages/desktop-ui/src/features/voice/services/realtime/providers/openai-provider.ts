import { ASK_STELLA_SESSION_TOOLS } from "../ask-stella-tool";
import { OpenAIWebRTCTransport } from "../transports/openai-webrtc-transport";
import { bearerSdpFetcher } from "../transports/sdp-fetchers";
import { VoiceSessionError } from "../voice-session-error";
import type {
  ProviderModule,
  ProviderTokenContext,
  VoiceSessionToken,
} from "./types";

const OPENAI_SDP_ENDPOINT = "https://api.openai.com/v1/realtime/calls";

export const buildOpenAIRealtimeSessionConfig = (
  ctx: ProviderTokenContext,
): Record<string, unknown> => ({
  type: "realtime",
  instructions: ctx.instructions,
  tools: [...ASK_STELLA_SESSION_TOOLS],
  tool_choice: "auto",
});

export const openaiProvider: ProviderModule = {
  billsConnectedTime: false,
  async fetchToken(ctx): Promise<VoiceSessionToken> {
    const voiceApi = window.electronAPI?.voice;
    if (!voiceApi) {
      throw new Error("Voice API is not available.");
    }
    const result = await voiceApi.createOpenAISession({
      instructions: ctx.instructions,
    });
    if ("failure" in result) throw new VoiceSessionError(result.failure);
    return {
      provider: "openai",
      transport: "openai-webrtc",
      clientSecret: result.clientSecret,
      model: result.model,
      voice: result.voice,
      expiresAt: result.expiresAt,
      sessionId: result.sessionId,
    };
  },

  createTransport(token, ctx) {
    return new OpenAIWebRTCTransport({
      model: token.model,
      sdpFetch: bearerSdpFetcher(OPENAI_SDP_ENDPOINT, token.clientSecret),
      initialSessionConfig: buildOpenAIRealtimeSessionConfig(ctx),
    });
  },
};
