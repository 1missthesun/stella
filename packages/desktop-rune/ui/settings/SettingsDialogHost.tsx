import { memo, useCallback } from "react";
import { openSignOutDialog } from "@/global/auth/SignOutDialog";
import { settingsDialog, useSettingsDialogOpen } from "@/shell/settings-dialog-store";
import { Dialog, DialogBody, DialogCloseButton, DialogContent } from "../kit/compat";
import { lazyScreen, useLazyReady } from "../kit/lazy";
import { useT } from "../i18n";

const SettingsScreen = lazyScreen(() => import("./SettingsView"), (module) => module.SettingsScreen);

export const SettingsDialogHost = memo(function SettingsDialogHost() {
  const open = useSettingsDialogOpen();
  const t = useT();
  const handleSignOut = useCallback(() => {
    settingsDialog.close();
    openSignOutDialog();
  }, []);

  const ready = useLazyReady(open, SettingsScreen);
  if (!open || !ready) return null;

  return (
    <Dialog open onOpenChange={(next) => settingsDialog.setOpen(next)}>
      <DialogContent size="page" focusSelf aria-label={t("settings.title")} enter={undefined} exit={undefined}>
        <DialogCloseButton absolute={{ top: 14, right: 14 }} raise />
        <DialogBody scrollY={false}>
          <SettingsScreen onSignOut={handleSignOut} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
});
