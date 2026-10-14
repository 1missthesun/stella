import type { CallArgs } from "@stella/contracts/backend/api";
import { GPT_LIVE_MODEL } from "@stella/contracts/backend/voice";
import { backendClient } from "@/platform/backend/backend-client";
import { GptLiveWebRTCTransport } from "../transports/gpt-live-webrtc-transport";
import { stellaProxiedSdpFetcher } from "../transports/sdp-fetchers";
import type {
  ProviderModule,
  ProviderTokenContext,
  VoiceSessionToken,
} from "./types";

const readGptLiveVoice = async (): Promise<string | undefined> => {
  try {
    const prefs =
      await window.electronAPI?.system?.getLocalModelPreferences?.();
    const voice = prefs?.realtimeVoice?.voices?.gptlive;
    const trimmed = typeof voice === "string" ? voice.trim() : "";
    return trimmed || undefined;
  } catch {
    return undefined;
  }
};

export const buildStellaVoiceSessionRequest = (
  ctx: Pick<ProviderTokenContext, "instructions" | "history">,
  voice?: string,
): CallArgs<"voice.session"> => ({
  instructions: ctx.instructions,
  ...(ctx.history?.length ? { history: ctx.history } : {}),
  ...(voice ? { voice } : {}),
});

export const stellaProvider: ProviderModule = {
  billsConnectedTime: true,
  async fetchToken(ctx): Promise<VoiceSessionToken> {
    const voice = await readGptLiveVoice();
    const session = await backendClient.call(
      "voice.session",
      buildStellaVoiceSessionRequest(ctx, voice),
    );
    return {
      provider: "stella",
      transport: "gptlive-webrtc",
      clientSecret: "",
      model: session.model || GPT_LIVE_MODEL,
      voice: session.voice,
      leaseId: session.leaseId,
      leaseExpiresAt: session.leaseExpiresAt,
    };
  },

  createTransport(token) {
    if (!token.leaseId) {
      throw new Error("Stella voice session is missing its lease.");
    }
    return new GptLiveWebRTCTransport({
      model: token.model,
      sdpFetch: stellaProxiedSdpFetcher(token.leaseId),
    });
  },
};
