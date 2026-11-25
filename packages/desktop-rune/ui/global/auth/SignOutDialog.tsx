import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, NativeCheckbox, T, showToast, tx } from "../../kit/compat";
import { useLocalMode } from "../local-mode/local-mode.styles";
import { usePill } from "../shared/pill.styles";
import { useState, useSyncExternalStore } from "react";
import { useT } from "@/shared/i18n";
import { secureSignOut } from "@/global/auth/services/auth";
import { wipeAccountsFromThisComputer } from "@/features/cloud/paused-account";
import { accountHintChanged } from "@/global/auth/hooks/use-account-hint";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";

let open = false;
const listeners = new Set<() => void>();
const setOpen = (next: boolean) => {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const openSignOutDialog = () => setOpen(true);

export const signOutOfThisComputer = async (removeFromComputer: boolean) => {
  await secureSignOut("current_device", { forgetAccount: removeFromComputer });
  if (removeFromComputer) await wipeAccountsFromThisComputer(null);
  accountHintChanged();
  SIGN_IN_TOAST_ACTION.onClick();
};

export function SignOutDialog() {
  const s = useLocalMode();
  const t = useT();
  const isOpen = useSyncExternalStore(subscribe, () => open, () => false);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!isOpen) return null;
  const close = () => {
    if (busy) return;
    setOpen(false);
    setRemove(false);
  };
  const confirm = async () => {
    setBusy(true);
    try {
      await signOutOfThisComputer(remove);
      setOpen(false);
      setRemove(false);
    } catch (error) {
      console.warn("[auth] Sign-out failed.", error);
      showToast({ title: t("global.signOut.failed"), variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent fit {...s.signOutChoice}>
        <DialogHeader>
          <DialogTitle>{t("global.signOut.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody {...s.signOutChoiceBody}>
          <DialogDescription {...s.signOutChoice_signOutChoiceText}>
            {t("global.signOut.body")}
          </DialogDescription>
          <row {...s.signOutChoiceCheck} onPress={busy ? undefined : () => setRemove(!remove)}>
            <NativeCheckbox {...s.signOutChoiceCheck_input} checked={remove} disabled={busy} onChange={setRemove} label={t("global.signOut.remove")} />
            <col grow={1} shrink minW={0}>
              <T {...tx(s.signOutChoiceCheck)}>{t("global.signOut.remove")}</T>
              <T {...tx(s.signOutChoiceCheck)} {...s.signOutChoiceCheck_small}>{t("global.signOut.removeNote")}</T>
            </col>
          </row>
          <row {...s.localModeChoiceActions}>
            <Button variant="ghost" size="large" className="pill-btn pill-btn--lg" disabled={busy} onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" className="pill-btn pill-btn--primary pill-btn--lg" disabled={busy} onClick={() => void confirm()}>
              {t("common.signOut")}
            </Button>
          </row>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
