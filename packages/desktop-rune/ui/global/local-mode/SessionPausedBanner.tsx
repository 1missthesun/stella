import { Press, T, tx } from "../../kit/compat";
import { useLocalMode } from "./local-mode.styles";
import { useT } from "@/shared/i18n";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { useChatStore } from "@/context/chat-store-context";
import { useAuthBootstrapState } from "@/global/auth/BackendAuthProvider";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { accountLabel } from "@/global/auth/hooks/use-account-hint";

export function SessionPausedBanner() {
  const s = useLocalMode();
  const t = useT();
  const { storageMode } = useChatStore();
  const { status } = useAuthBootstrapState();
  const { user } = useAuthSessionState();
  if (status !== "reauth_required" || storageMode !== "cloud") return null;
  const account = accountLabel(user);
  return (
    <row {...s.localModeBanner} role="status">
      <T {...tx(s.localModeBanner)} {...s.localModeBannerText}>
        <T {...tx(s.localModeBanner)} weight={700} {...s.localModeBannerLead}>{t("global.sessionPaused.title")}</T>{" "}
        {account
          ? t("global.sessionPaused.bodyAs", { account })
          : t("global.sessionPaused.body")}
      </T>
      <Press text={tx(s.localModeBanner)} {...s.localModeBannerAction} onPress={SIGN_IN_TOAST_ACTION.onClick}>
        {t("common.signIn")}
      </Press>
    </row>
  );
}
