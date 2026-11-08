import { useState, useSyncExternalStore } from "react";
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
import { useT } from "@/shared/i18n";
import { secureSignOut } from "@/global/auth/services/auth";
import { wipeAccountsFromThisComputer } from "@/features/cloud/paused-account";
import { accountHintChanged } from "@/global/auth/hooks/use-account-hint";
import "@/global/local-mode/local-mode.css";

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

/** Signs this computer out; the chat stays in the account and is hidden here, or removed. */
export const signOutOfThisComputer = async (removeFromComputer: boolean) => {
  await secureSignOut("current_device", { forgetAccount: removeFromComputer });
  if (removeFromComputer) await wipeAccountsFromThisComputer(null);
  accountHintChanged();
};

export function SignOutDialog() {
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
      <DialogContent fit className="sign-out-choice" data-testid="sign-out-dialog">
        <DialogHeader>
          <DialogTitle>{t("global.signOut.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="sign-out-choice-body">
          <DialogDescription className="sign-out-choice-text">
            {t("global.signOut.body")}
          </DialogDescription>
          <label className="sign-out-choice-check">
            <input
              type="checkbox"
              checked={remove}
              disabled={busy}
              onChange={(event) => setRemove(event.target.checked)}
              data-testid="sign-out-remove"
            />
            <span>
              {t("global.signOut.remove")}
              <small>{t("global.signOut.removeNote")}</small>
            </span>
          </label>
          <div className="local-mode-choice-actions">
            <Button
              type="button"
              variant="ghost"
              size="large"
              className="pill-btn pill-btn--lg"
              disabled={busy}
              onClick={close}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="large"
              className="pill-btn pill-btn--primary pill-btn--lg"
              disabled={busy}
              onClick={() => void confirm()}
              data-testid="sign-out-confirm"
            >
              {t("common.signOut")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
