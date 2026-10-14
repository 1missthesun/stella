import { useEffect } from "react";
import { resolveVoiceErrorToast } from "@/features/voice/runtime/voice-error-toast";
import { presentComposerNotice } from "@/features/chat/composer-notice-store";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { useT } from "@/shared/i18n";

export function VoiceErrorToastListener() {
  const t = useT();
  useEffect(() => {
    const off = window.electronAPI?.voice?.onSessionError?.((message) => {
      const toast = resolveVoiceErrorToast(message, t);
      if (toast) {
        presentComposerNotice(
          {
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
    return () => {
      off?.();
    };
  }, [t]);

  return null;
}
