import { useSyncExternalStore } from "react";
import { useT } from "@/shared/i18n";
import { uiState } from "@/platform/ui-state";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { useChatStorageMode } from "@/features/chat/services/chat-storage-preference";
import { X } from "@/ui/icons";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import "./local-mode.css";

const DISMISSED_KEY = "stella:signed-out-banner-dismissed";
const DISMISSED_EVENT = "stella:signed-out-banner-dismissed";

const subscribe = (listener: () => void) => {
  window.addEventListener(DISMISSED_EVENT, listener);
  return () => window.removeEventListener(DISMISSED_EVENT, listener);
};
const isDismissed = () => uiState.getItem(DISMISSED_KEY) === "1";

/** Signed out, chats stay on this computer; this says what an account would add. */
export function SignedOutBanner() {
  const t = useT();
  const localMode = useChatStorageMode() === "local";
  const { hasConnectedAccount } = useAuthSessionState();
  const dismissed = useSyncExternalStore(subscribe, isDismissed, () => false);
  if (hasConnectedAccount || !localMode || dismissed) return null;
  return (
    <div className="local-mode-banner" role="status" data-testid="signed-out-banner">
      <span className="local-mode-banner__text">{t("global.localMode.banner")}</span>
      <button type="button" className="local-mode-banner__action" onClick={SIGN_IN_TOAST_ACTION.onClick}>
        {t("common.signIn")}
      </button>
      <button
        type="button"
        className="local-mode-banner__close"
        aria-label={t("common.close")}
        onClick={() => {
          uiState.setItem(DISMISSED_KEY, "1");
          window.dispatchEvent(new Event(DISMISSED_EVENT));
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
