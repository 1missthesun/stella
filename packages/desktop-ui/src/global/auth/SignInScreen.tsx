import { useState } from "react";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { showToast } from "@/ui/toast";
import { useT, useTPlural } from "@/shared/i18n";
import { enterSignedOutLocalMode } from "@/features/chat/services/chat-storage-preference";
import {
  waitingMessages,
  wipeAccountsFromThisComputer,
} from "@/features/cloud/paused-account";
import { AuthMethods } from "./AuthDialog";
import {
  accountHintChanged,
  accountLabel,
  useAccountHint,
} from "./hooks/use-account-hint";
import "./AuthDialog.css";
import "@/global/local-mode/local-mode.css";

function SwitchAccountDialog({
  account,
  unsent,
  onCancel,
  onConfirm,
  busy,
}: {
  account: string;
  unsent: number;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const t = useT();
  const tPlural = useTPlural();
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent fit className="sign-out-choice" data-testid="switch-account-dialog">
        <DialogHeader>
          <DialogTitle>{t("global.switchAccount.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="sign-out-choice-body">
          <DialogDescription className="sign-out-choice-text">
            {unsent > 0
              ? tPlural("global.switchAccount.bodyUnsent", unsent, { account })
              : t("global.switchAccount.body", { account })}
          </DialogDescription>
          <div className="local-mode-choice-actions">
            <Button
              type="button"
              variant="ghost"
              size="large"
              className="pill-btn pill-btn--lg"
              disabled={busy}
              onClick={onCancel}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="large"
              className="pill-btn pill-btn--primary pill-btn--lg"
              disabled={busy}
              onClick={onConfirm}
              data-testid="switch-account-confirm"
            >
              {t("global.switchAccount.confirm")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function SignInScreen() {
  const t = useT();
  const hint = useAccountHint();
  const [showMethods, setShowMethods] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [busy, setBusy] = useState(false);
  const account = accountLabel(hint);
  const remembered = Boolean(hint && account);

  const useWithoutAccount = (
    <button
      type="button"
      className="auth-screen__link"
      onClick={enterSignedOutLocalMode}
      data-testid="use-without-account"
    >
      {t("global.signedOut.withoutAccount")}
    </button>
  );

  if (!remembered || showMethods) {
    return (
      <div className="auth-screen" data-testid="sign-in-screen">
        <div className="auth-screen__card">
          <AuthMethods loginHint={showMethods ? (hint?.email ?? null) : null} />
          <div className="auth-screen__links">{useWithoutAccount}</div>
        </div>
      </div>
    );
  }

  const switchAccount = async () => {
    setBusy(true);
    try {
      await wipeAccountsFromThisComputer(null);
      accountHintChanged();
      setConfirmSwitch(false);
      setShowMethods(true);
    } catch (error) {
      console.warn("[auth] Couldn't remove the previous account.", error);
      showToast({ title: t("global.switchAccount.failed"), variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen" data-testid="sign-in-screen">
      <div className="auth-screen__card auth-screen__card--signed-out">
        <div className="auth-dialog-hero">
          <p className="auth-dialog-headline">{t("global.signedOut.title")}</p>
          <p className="auth-dialog-sub">{t("global.signedOut.body")}</p>
        </div>
        <div className="auth-screen__account" data-testid="remembered-account">
          <span className="auth-screen__avatar" aria-hidden="true">
            {(hint?.name ?? account ?? "?").trim().charAt(0).toUpperCase()}
          </span>
          <span className="auth-screen__who">
            {hint?.name ? <span className="auth-screen__name">{hint.name}</span> : null}
            <span className="auth-screen__email">{account}</span>
          </span>
          <Button
            type="button"
            variant="primary"
            className="pill-btn pill-btn--primary"
            onClick={() => setShowMethods(true)}
            data-testid="sign-in-remembered"
          >
            {t("common.signIn")}
          </Button>
        </div>
        <div className="auth-screen__links">
          <button
            type="button"
            className="auth-screen__link"
            onClick={() => setConfirmSwitch(true)}
            data-testid="use-different-account"
          >
            {t("global.signedOut.differentAccount")}
          </button>
          {useWithoutAccount}
        </div>
      </div>
      {confirmSwitch && account ? (
        <SwitchAccountDialog
          account={account}
          unsent={waitingMessages(`account:${hint?.userId ?? ""}`).length}
          busy={busy}
          onCancel={() => setConfirmSwitch(false)}
          onConfirm={() => void switchAccount()}
        />
      ) : null}
    </div>
  );
}
