import { Button, LogIn, Press, T, X, showToast } from "../../kit/compat";
import { useComposerNotice } from "../shared/composer-notice.styles";
import { usePill } from "../shared/pill.styles";
import { useT } from "@/shared/i18n";
import type { ComposerNotice } from "@/features/chat/composer-notice-store";
import { ClaudeLoginPrompt } from "./ClaudeLoginPrompt";
import { useClaudeLocalAccounts } from "@/features/claude/use-claude-local-accounts";
import { rememberClaudeHeadsUpDismissed } from "@/features/claude/use-claude-login-heads-up";
import { useClaudeLogin, type ClaudeLoginTarget } from "@/features/claude/use-claude-login";
import { useClaudeInstallThenSignIn } from "@/features/claude/use-claude-cli-install";
import { ClaudeCliInstallStatus } from "./ClaudeCliInstallStatus";

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
  const s = useComposerNotice();
  const t = useT();
  const local = useClaudeLocalAccounts();
  const continues = notice.claudeSignIn?.continues === true;
  const login = useClaudeLogin({
    onSignedIn: (result) => {
      onDismiss();
      showToast({
        title: continues
          ? t("claudeLogin.signedInContinuing")
          : result.email
            ? t("claudeLogin.signedInAsResend", { email: result.email })
            : t("claudeLogin.signedInResend"),
      });
      void local.reload();
    },
  });
  const email = notice.claudeSignIn?.email;
  const cloud = notice.claudeSignIn?.place === "cloud";
  const missingCli = !cloud && local.available && local.loaded && !local.cliInstalled;
  const canSignIn = cloud || (local.available && (!local.loaded || local.cliInstalled));

  const target = (): ClaudeLoginTarget => {
    if (cloud) return email ? { place: "cloud", email } : { place: "cloud" };
    if (email) {
      const config = local.configs.find((entry) => !entry.isDefault && sameEmail(entry.email, email));
      return config ? { place: "local", configId: config.configId, email } : { place: "local", email };
    }
    return local.defaultSignedOut ? { place: "local", configId: "default" } : { place: "local" };
  };

  const install = useClaudeInstallThenSignIn({
    reload: local.reload,
    signIn: () =>
      void login.start(email ? { place: "local", email } : { place: "local", configId: "default" }),
  });
  const offerInstall = missingCli && install.available;

  return (
    <row {...s.composerNotice} {...(compact ? s.composerNoticeCompact : null)} role="status">
      <row {...s.composerNoticeIcon} {...(compact ? s.composerNoticeCompact_composerNoticeIcon : null)}>
        <LogIn size={compact ? 14 : 16} color={s.composerNoticeIcon.color} />
      </row>
      <col {...s.composerNoticeBody}>
        <T w="full" {...s.composerNoticeTitle}>{notice.title}</T>
        {notice.description ? <T w="full" {...s.composerNoticeSub}>{notice.description}</T> : null}
        {missingCli && install.state.status === "idle" ? (
          <>
            {notice.title === t("claudeInstall.chatTitle") ? null : (
              <T w="full" {...s.composerNoticeSub}>{t("claudeInstall.chatTitle")}</T>
            )}
            <T w="full" {...s.composerNoticeSub}>{t("claudeInstall.ownPlan")}</T>
          </>
        ) : null}
        <ClaudeCliInstallStatus state={install.state} onRetry={() => void install.run()} />
        <ClaudeLoginPrompt login={login} />
      </col>
      {offerInstall && !login.open && !install.installing && install.state.status !== "error" ? (
        <row {...s.composerNoticeActions}>
          <Button variant="primary" className="pill-btn pill-btn--primary composer-notice__primary" onClick={() => void install.run()}>
            {t("claudeInstall.install")}
          </Button>
        </row>
      ) : null}
      {login.open || !canSignIn ? null : (
        <row {...s.composerNoticeActions}>
          <Button variant="primary" className="pill-btn pill-btn--primary composer-notice__primary" onClick={() => void login.start(target())}>
            {t("claudeLogin.signIn")}
          </Button>
        </row>
      )}
      <Press {...s.composerNoticeDismiss} label={t("common.close")} onPress={() => {
          login.cancel();
          const dismissKey = notice.claudeSignIn?.dismissKey;
          if (dismissKey) rememberClaudeHeadsUpDismissed(dismissKey);
          onDismiss();
        }}>
        <X size={14} color={s.composerNoticeDismiss.color} />
      </Press>
    </row>
  );
}
