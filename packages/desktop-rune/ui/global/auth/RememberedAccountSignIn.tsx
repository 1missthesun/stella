import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, Press, T, showToast, tx } from "../../kit/compat";
import { useLocalMode } from "../local-mode/local-mode.styles";
import { usePill } from "../shared/pill.styles";
import { useAuthDialog } from "./AuthDialog.styles";
import { useState } from "react";
import type { AccountHint } from "@stella/contracts/auth-session";
import { useT, useTPlural } from "@/shared/i18n";
import { waitingMessages, wipeAccountsFromThisComputer } from "@/features/cloud/paused-account";
import { accountHintChanged } from "@/global/auth/hooks/use-account-hint";

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
  const s = useLocalMode();
  const t = useT();
  const tPlural = useTPlural();
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent fit {...s.signOutChoice}>
        <DialogHeader>
          <DialogTitle>{t("global.switchAccount.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody {...s.signOutChoiceBody}>
          <DialogDescription {...s.signOutChoice_signOutChoiceText}>
            {unsent > 0
              ? tPlural("global.switchAccount.bodyUnsent", unsent, { account })
              : t("global.switchAccount.body", { account })}
          </DialogDescription>
          <row {...s.localModeChoiceActions}>
            <Button variant="ghost" size="large" className="pill-btn pill-btn--lg" disabled={busy} onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" className="pill-btn pill-btn--primary pill-btn--lg" disabled={busy} onClick={onConfirm}>
              {t("global.switchAccount.confirm")}
            </Button>
          </row>
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
  const sAuthDialog = useAuthDialog();
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
      <col {...sAuthDialog.authDialogHero}>
        <T {...tx(sAuthDialog.authDialogHero)} w="full" {...sAuthDialog.authDialogHeadline}>{t("global.signedOut.title")}</T>
        <T {...tx(sAuthDialog.authDialogHero)} w="full" {...sAuthDialog.authDialogSub}>{t("global.signedOut.body")}</T>
      </col>
      <row {...sAuthDialog.authRememberedAccount}>
        <T {...sAuthDialog.authRememberedAvatar}>
          {(hint.name ?? account).trim().charAt(0).toUpperCase()}
        </T>
        <col {...sAuthDialog.authRememberedWho}>
          {hint.name ? <T {...sAuthDialog.authRememberedName}>{hint.name}</T> : null}
          <T {...sAuthDialog.authRememberedEmail}>{account}</T>
        </col>
        <Button variant="primary" className="pill-btn pill-btn--primary" autoFocus onClick={onSignIn}>
          {t("common.signIn")}
        </Button>
      </row>
      <row {...sAuthDialog.authRememberedLinks}>
        <Press {...sAuthDialog.authRememberedLink} onPress={() => setConfirmSwitch(true)}>
          {t("global.signedOut.differentAccount")}
        </Press>
        <Press {...sAuthDialog.authRememberedLink} onPress={onDismiss}>
          {t("global.signedOut.withoutAccount")}
        </Press>
      </row>
      {confirmSwitch ? (
        <SwitchAccountDialog account={account} unsent={waitingMessages(`account:${hint.userId}`).length} busy={busy} onCancel={() => setConfirmSwitch(false)} onConfirm={() => void switchAccount()} />
      ) : null}
    </>
  );
}
