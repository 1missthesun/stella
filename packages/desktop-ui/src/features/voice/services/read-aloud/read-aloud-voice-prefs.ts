import { resolveReadAloudProvider } from "@stella/contracts/local-preferences";
import type { ReadAloudVoiceFamily } from "./tts-client";

export type ReadAloudVoicePrefs = {
  family: ReadAloudVoiceFamily;
  voice?: string;
};

export const resolveReadAloudVoicePrefs =
  async (): Promise<ReadAloudVoicePrefs> => {
    try {
      const prefs =
        await window.electronAPI?.system?.getLocalModelPreferences?.();
      const rt = prefs?.realtimeVoice;
      const family: ReadAloudVoiceFamily = resolveReadAloudProvider({
        readAloudProvider: rt?.readAloudProvider,
      });
      const stored = rt?.voices?.[family];
      const voice =
        typeof stored === "string" && stored.trim().length > 0
          ? stored.trim()
          : undefined;
      return { family, voice };
    } catch {
      return { family: "gemini" };
    }
  };
