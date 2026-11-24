import { useState } from "react";
import type { AccountHint } from "@stella/contracts/auth-session";
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
import { waitingMessages, wipeAccountsFromThisComputer } from "@/features/cloud/paused-account";
import { accountHintChanged } from "./hooks/use-account-hint";
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

export function RememberedAccountSignIn({
  hint,
  account,
  onSignIn,
  onDismiss,
}: {
  hint: AccountHint;
  account: string;
  onSignIn: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [busy, setBusy] = useState(false);

  const switchAccount = async () => {
    setBusy(true);
    try {
      await wipeAccountsFromThisComputer(null);
      setConfirmSwitch(false);
      onSignIn();
      accountHintChanged();
    } catch (error) {
      console.warn("[auth] Couldn't remove the previous account.", error);
      showToast({ title: t("global.switchAccount.failed"), variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="auth-dialog-hero">
        <p className="auth-dialog-headline">{t("global.signedOut.title")}</p>
        <p className="auth-dialog-sub">{t("global.signedOut.body")}</p>
      </div>
      <div className="auth-remembered__account" data-testid="remembered-account">
        <span className="auth-remembered__avatar" aria-hidden="true">
          {(hint.name ?? account).trim().charAt(0).toUpperCase()}
        </span>
        <span className="auth-remembered__who">
          {hint.name ? <span className="auth-remembered__name">{hint.name}</span> : null}
          <span className="auth-remembered__email">{account}</span>
        </span>
        <Button
          type="button"
          variant="primary"
          className="pill-btn pill-btn--primary"
          autoFocus
          onClick={onSignIn}
          data-testid="sign-in-remembered"
        >
          {t("common.signIn")}
        </Button>
      </div>
      <div className="auth-remembered__links">
        <button
          type="button"
          className="auth-remembered__link"
          onClick={() => setConfirmSwitch(true)}
          data-testid="use-different-account"
        >
          {t("global.signedOut.differentAccount")}
        </button>
        <button
          type="button"
          className="auth-remembered__link"
          onClick={onDismiss}
          data-testid="use-without-account"
        >
          {t("global.signedOut.withoutAccount")}
        </button>
      </div>
      {confirmSwitch ? (
        <SwitchAccountDialog
          account={account}
          unsent={waitingMessages(`account:${hint.userId}`).length}
          busy={busy}
          onCancel={() => setConfirmSwitch(false)}
          onConfirm={() => void switchAccount()}
        />
      ) : null}
    </>
  );
}
