import { useT } from "@/shared/i18n";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { useChatStore } from "@/context/chat-store-context";
import { useAuthBootstrapState } from "@/global/auth/BackendAuthProvider";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { accountLabel } from "@/global/auth/hooks/use-account-hint";
import "./local-mode.css";

/** The account's session ended on its own: its chat stays, and signing back in continues it. */
export function SessionPausedBanner() {
  const t = useT();
  const { storageMode } = useChatStore();
  const { status } = useAuthBootstrapState();
  const { user } = useAuthSessionState();
  if (status !== "reauth_required" || storageMode !== "cloud") return null;
  const account = accountLabel(user);
  return (
    <div className="local-mode-banner" role="status" data-testid="session-paused-banner">
      <span className="local-mode-banner__text">
        <b className="local-mode-banner__lead">{t("global.sessionPaused.title")}</b>{" "}
        {account
          ? t("global.sessionPaused.bodyAs", { account })
          : t("global.sessionPaused.body")}
      </span>
      <button
        type="button"
        className="local-mode-banner__action"
        onClick={SIGN_IN_TOAST_ACTION.onClick}
      >
        {t("common.signIn")}
      </button>
    </div>
  );
}
