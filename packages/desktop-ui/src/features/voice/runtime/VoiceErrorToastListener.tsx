import { useEffect } from "react";
import { voiceFailureToast } from "@/features/voice/runtime/voice-error-toast";
import {
  dismissComposerNotice,
  presentComposerNotice,
  VOICE_FAILURE_NOTICE_ID,
} from "@/features/chat/composer-notice-store";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { useT } from "@/shared/i18n";

export function VoiceErrorToastListener() {
  const t = useT();
  useEffect(() => {
    const off = window.electronAPI?.voice?.onSessionError?.((failure) => {
      const toast = voiceFailureToast(failure, t);
      if (toast) {
        presentComposerNotice(
          {
            id: VOICE_FAILURE_NOTICE_ID,
            conversationId: null,
            kind:
              toast.action === SIGN_IN_TOAST_ACTION ? "sign-in" : "provider",
            title: toast.title ?? "",
            description: toast.description,
            action: toast.action,
            secondaryAction: toast.secondaryAction,
          },
          toast,
        );
      }
    });
    const offState = window.electronAPI?.voice?.onSessionErrorState?.(
      (message) => {
        if (!message) dismissComposerNotice(VOICE_FAILURE_NOTICE_ID);
      },
    );
    return () => {
      off?.();
      offState?.();
    };
  }, [t]);

  return null;
}
