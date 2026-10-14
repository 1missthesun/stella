import { getBackendClient } from "./backend";
import { requestDeviceJson } from "./device-requests";
import { postJson } from "./http";
import { resolveExecutionBuilderOrigin } from "./execution-placement";
import type { StoredPhoneAccess } from "./phone-access";
import type { RealtimeVoiceOrchestratorConfig } from "./realtime-voice-protocol";

const DESKTOP_VOICE_SETUP_TIMEOUT_MS = 30_000;

export type DesktopRealtimeVoice = {
  access: StoredPhoneAccess;
  config: RealtimeVoiceOrchestratorConfig;
};

export const connectDesktopRealtimeVoice = async (
  access: StoredPhoneAccess,
  conversationId: string,
): Promise<DesktopRealtimeVoice> => {
  const config = await requestDeviceJson<RealtimeVoiceOrchestratorConfig>(
    access,
    "voice.config",
    { conversationId },
    { timeoutMs: DESKTOP_VOICE_SETUP_TIMEOUT_MS },
  );
  if (!config || typeof config.instructions !== "string") {
    throw new Error(
      "The connected computer did not return a valid voice configuration.",
    );
  }
  return { access, config };
};

const JOURNAL_DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const JOURNAL_APPEND_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const journalDeviceId = (mobileDeviceId: string): string => {
  if (JOURNAL_DEVICE_ID_PATTERN.test(mobileDeviceId)) return mobileDeviceId;
  const cleaned = mobileDeviceId.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64);
  return cleaned || "mobile";
};

const emptyVoiceUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

export const persistDesktopRealtimeVoiceTranscript = async (
  voice: DesktopRealtimeVoice,
  payload: {
    conversationId: string;
    eventId: string;
    timestamp: number;
    role: "user" | "assistant";
    text: string;
    uiVisibility: "visible" | "hidden";
    voiceSession?: { durationMs: number };
  },
): Promise<void> => {
  const eventId = payload.eventId.trim();
  if (!JOURNAL_APPEND_ID_PATTERN.test(eventId)) {
    throw new Error("Voice transcripts need a stable append id.");
  }
  const identity = await getBackendClient().call("owner.identity", {});
  const expectedOwnerGeneration = identity.ownerGeneration.trim();
  if (!expectedOwnerGeneration) {
    throw new Error("Voice transcript could not establish owner authority.");
  }
  const message =
    payload.role === "user"
      ? {
          role: "user" as const,
          content: [{ type: "text" as const, text: payload.text }],
          source: "voice" as const,
          ...(payload.voiceSession ? { voiceSession: payload.voiceSession } : {}),
          timestamp: payload.timestamp,
        }
      : {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: payload.text }],
          api: "stella-voice",
          provider: "stella",
          model: "realtime-voice",
          usage: emptyVoiceUsage(),
          stopReason: "stop" as const,
          source: "voice" as const,
          ...(payload.voiceSession ? { voiceSession: payload.voiceSession } : {}),
          timestamp: payload.timestamp,
        };
  await postJson(
    `/conversations/${encodeURIComponent(payload.conversationId)}/journal`,
    {
      deviceId: journalDeviceId(voice.access.mobileDeviceId),
      expectedOwnerGeneration,
      localTurnId: eventId,
      source: "voice",
      records: [
        {
          kind: "message",
          role: payload.role,
          payloadJson: JSON.stringify(message),
          ...(payload.uiVisibility === "hidden" ? { hidden: true } : {}),
        },
      ],
    },
    {
      origin: await resolveExecutionBuilderOrigin(),
      timeoutMs: DESKTOP_VOICE_SETUP_TIMEOUT_MS,
    },
  );
};
