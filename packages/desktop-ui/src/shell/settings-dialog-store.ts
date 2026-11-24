import { viewAtom, writeViewState } from "@/platform/view-state/view-state";
import type { SettingsTab } from "@/global/settings/settings-tabs";
import { requestSettingsCard } from "@/global/settings/settings-card-targets";

const open = viewAtom("settings.open", false);

export const settingsDialog = {
  open() {
    open.set(true);
  },
  openAt(tab: SettingsTab, cardKey?: string) {
    writeViewState("settings.tab", tab);
    if (cardKey) requestSettingsCard(cardKey);
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
