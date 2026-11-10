import { viewAtom } from "@/platform/view-state/view-state";

const open = viewAtom("settings.open", false);

export const settingsDialog = {
  open() {
    open.set(true);
  },
  close() {
    open.set(false);
  },
  setOpen(next: boolean) {
    open.set(next);
  },
};

export const useSettingsDialogOpen = () => open.use();
