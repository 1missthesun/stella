import { Button } from "@/ui/button";
import { LogIn, X } from "@/ui/icons";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import type { ComposerNotice } from "@/features/chat/composer-notice-store";
import { ClaudeLoginPrompt } from "./ClaudeLoginPrompt";
import { useClaudeLocalAccounts } from "./use-claude-local-accounts";
import { useClaudeLogin, type ClaudeLoginTarget } from "./use-claude-login";
import { useClaudeInstallThenSignIn } from "./use-claude-cli-install";
import { ClaudeCliInstallStatus } from "./ClaudeCliInstallStatus";
import "@/app/chat/composer-notice.css";

const sameEmail = (a: string | undefined, b: string | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

export function ClaudeSignInNotice({
  notice,
  compact,
  onDismiss,
}: {
  notice: ComposerNotice;
  compact: boolean;
  onDismiss: () => void;
}) {
  const t = useT();
  const local = useClaudeLocalAccounts();
  const login = useClaudeLogin({
    onSignedIn: (result) => {
      onDismiss();
      showToast({
        title: result.email
          ? `Signed in to Claude as ${result.email}. Send your message again to continue.`
          : "Signed in to Claude. Send your message again to continue.",
      });
      void local.reload();
    },
  });
  const email = notice.claudeSignIn?.email;
  const missingCli = local.available && local.loaded && !local.cliInstalled;
  const canSignIn = local.available && (!local.loaded || local.cliInstalled);

  const target = (): ClaudeLoginTarget => {
    if (email) {
      const config = local.configs.find((entry) => !entry.isDefault && sameEmail(entry.email, email));
      return config ? { place: "local", configId: config.configId, email } : { place: "local", email };
    }
    return local.defaultSignedOut ? { place: "local", configId: "default" } : { place: "local" };
  };

  // Claude Code isn't on this computer: install it here, then sign in.
  const install = useClaudeInstallThenSignIn({
    reload: local.reload,
    signIn: () =>
      void login.start(email ? { place: "local", email } : { place: "local", configId: "default" }),
  });
  const offerInstall = missingCli && install.available;

  return (
    <div
      className={`composer-notice composer-notice--sign-in${compact ? " composer-notice--compact" : ""}`}
      role="status"
      data-testid="composer-notice"
    >
      <div className="composer-notice__icon" aria-hidden>
        <LogIn size={compact ? 14 : 16} />
      </div>
      <div className="composer-notice__body">
        <p className="composer-notice__title">{notice.title}</p>
        {notice.description ? <p className="composer-notice__sub">{notice.description}</p> : null}
        {missingCli && install.state.status === "idle" ? (
          <>
            {notice.title === t("claudeInstall.chatTitle") ? null : (
              <p className="composer-notice__sub">{t("claudeInstall.chatTitle")}</p>
            )}
            <p className="composer-notice__sub">{t("claudeInstall.ownPlan")}</p>
          </>
        ) : null}
        <ClaudeCliInstallStatus state={install.state} onRetry={() => void install.run()} />
        <ClaudeLoginPrompt login={login} />
      </div>
      {offerInstall && !login.open && !install.installing && install.state.status !== "error" ? (
        <div className="composer-notice__actions">
          <Button
            type="button"
            variant="primary"
            className="pill-btn pill-btn--primary composer-notice__primary"
            onClick={() => void install.run()}
          >
            {t("claudeInstall.install")}
          </Button>
        </div>
      ) : null}
      {login.open || !canSignIn ? null : (
        <div className="composer-notice__actions">
          <Button
            type="button"
            variant="primary"
            className="pill-btn pill-btn--primary composer-notice__primary"
            onClick={() => void login.start(target())}
          >
            Sign in
          </Button>
        </div>
      )}
      <button
        type="button"
        className="composer-notice__dismiss"
        aria-label={t("common.close")}
        onClick={() => {
          login.cancel();
          onDismiss();
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
