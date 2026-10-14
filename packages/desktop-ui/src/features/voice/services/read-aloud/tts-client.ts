import type { ReadAloudVoiceProvider } from "@stella/contracts/local-preferences";
import {
  VOICE_TTS_PATH,
  VOICE_TTS_STREAM_PATH,
} from "@stella/contracts/backend/voice";
import { voiceBackendFetch } from "../voice-backend";

export type ReadAloudVoiceFamily = ReadAloudVoiceProvider;

export type ReadAloudRequest = {
  text: string;
  voice?: string;
  voiceProvider: ReadAloudVoiceFamily;
  signal?: AbortSignal;
};

export type ReadAloudResponse = {
  audio: ArrayBuffer;
  contentType: string;
};

export async function openReadAloudStream(
  req: Omit<ReadAloudRequest, "voiceProvider">,
): Promise<Response> {
  return await voiceBackendFetch(VOICE_TTS_STREAM_PATH, {
    body: JSON.stringify({ text: req.text, ...(req.voice ? { voice: req.voice } : {}) }),
    contentType: "application/json",
    signal: req.signal,
  });
}

export async function fetchReadAloudAudio(
  req: ReadAloudRequest,
): Promise<ReadAloudResponse> {
  const response = await voiceBackendFetch(VOICE_TTS_PATH, {
    body: JSON.stringify({
      text: req.text,
      voiceProvider: req.voiceProvider,
      ...(req.voice ? { voice: req.voice } : {}),
    }),
    contentType: "application/json",
    signal: req.signal,
  });
  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ?? "audio/mpeg";
  const audio = await response.arrayBuffer();
  return { audio, contentType };
}
