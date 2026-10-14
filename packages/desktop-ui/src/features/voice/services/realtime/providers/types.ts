import type { VoiceHistoryMessage } from "@stella/contracts/backend/voice";
import type { RealtimeVoiceProvider } from "@stella/contracts/local-preferences";
import type { RealtimeTransport } from "../transports/types";

export type RealtimeProviderKey = RealtimeVoiceProvider;

export type RealtimeTransportKind =
  | "gptlive-webrtc"
  | "openai-webrtc"
  | "xai-websocket";

export type VoiceSessionAuthority = {
  leaseId: string;
  leaseExpiresAt: number;
};

export const requireVoiceSessionAuthority = (value: {
  leaseId?: unknown;
  leaseExpiresAt?: unknown;
}): VoiceSessionAuthority => {
  const leaseId = typeof value.leaseId === "string" ? value.leaseId.trim() : "";
  const leaseExpiresAt = value.leaseExpiresAt;
  if (
    !leaseId ||
    typeof leaseExpiresAt !== "number" ||
    !Number.isFinite(leaseExpiresAt) ||
    leaseExpiresAt <= 0
  ) {
    throw new Error(
      "Stella voice session response did not include a valid lease.",
    );
  }
  return { leaseId, leaseExpiresAt };
};

export interface VoiceSessionToken {
  provider: RealtimeProviderKey;
  transport: RealtimeTransportKind;
  clientSecret: string;
  model: string;
  voice: string;
  expiresAt?: number;
  sessionId?: string;
  leaseId?: string;
  leaseExpiresAt?: number;
}

export interface ProviderTokenContext {
  conversationId?: string;
  instructions: string;
  history?: VoiceHistoryMessage[];
}

export interface ProviderModule {
  fetchToken(ctx: ProviderTokenContext): Promise<VoiceSessionToken>;
  createTransport(
    token: VoiceSessionToken,
    ctx: ProviderTokenContext,
  ): RealtimeTransport;
}
