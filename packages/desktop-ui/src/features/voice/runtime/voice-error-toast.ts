import type { VoiceSessionFailure } from "@stella/contracts/voice-failure";
import type { ToastOptions } from "@/ui/toast";
import {
  OPEN_SETTINGS_TOAST_ACTION,
  SIGN_IN_TOAST_ACTION,
} from "@/shared/lib/auth-cta";

export const voiceFailureToast = (
  failure: VoiceSessionFailure,
  t: (key: string) => string,
): ToastOptions | null => {
  const message = failure.message.trim();
  if (!message) return null;
  switch (failure.action) {
    case "sign-in":
      return {
        title: t("features.voice.signInTitle"),
        description: message,
        variant: "error",
        duration: 8000,
        action: SIGN_IN_TOAST_ACTION,
      };
    case "settings":
      return {
        title: t("features.voice.needsSetupTitle"),
        description: message,
        variant: "error",
        duration: 8000,
        action: OPEN_SETTINGS_TOAST_ACTION,
      };
    case null:
      return null;
  }
};
