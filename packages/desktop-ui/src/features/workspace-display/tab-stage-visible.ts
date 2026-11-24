import { useDisplayPanelOpen } from "./tab-store";
import { useSidebarActiveTabId, useSidebarOpenTabs } from "./sidebar-sections";

export const useTabStageVisible = (): boolean => {
  const panelOpen = useDisplayPanelOpen();
  const tabs = useSidebarOpenTabs();
  const activeTabId = useSidebarActiveTabId();
  return panelOpen && tabs.some((tab) => tab.id === activeTabId);
};
