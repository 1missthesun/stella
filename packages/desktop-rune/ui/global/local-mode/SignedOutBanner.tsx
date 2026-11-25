import { Press, T, X, tx } from "../../kit/compat";
import { useLocalMode } from "./local-mode.styles";
import { useSyncExternalStore } from "react";
import { useT } from "@/shared/i18n";
import { uiState } from "@/platform/ui-state";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { useChatStorageMode } from "@/features/chat/services/chat-storage-preference";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";

const DISMISSED_KEY = "stella:signed-out-banner-dismissed";
const DISMISSED_EVENT = "stella:signed-out-banner-dismissed";

const subscribe = (listener: () => void) => {
  window.addEventListener(DISMISSED_EVENT, listener);
  return () => window.removeEventListener(DISMISSED_EVENT, listener);
};
const isDismissed = () => uiState.getItem(DISMISSED_KEY) === "1";

export function SignedOutBanner() {
  const s = useLocalMode();
  const t = useT();
  const localMode = useChatStorageMode() === "local";
  const { hasConnectedAccount } = useAuthSessionState();
  const dismissed = useSyncExternalStore(subscribe, isDismissed, () => false);
  if (hasConnectedAccount || !localMode || dismissed) return null;
  return (
    <row {...s.localModeBanner} role="status">
      <T {...tx(s.localModeBanner)} {...s.localModeBannerText}>{t("global.localMode.banner")}</T>
      <Press text={tx(s.localModeBanner)} {...s.localModeBannerAction} onPress={SIGN_IN_TOAST_ACTION.onClick}>
        {t("common.signIn")}
      </Press>
      <Press text={tx(s.localModeBanner)} {...s.localModeBannerClose} label={t("common.close")} onPress={() => {
          uiState.setItem(DISMISSED_KEY, "1");
          window.dispatchEvent(new Event(DISMISSED_EVENT));
        }}>
        <X size={13} color={s.localModeBanner.color} />
      </Press>
    </row>
  );
}
