import { useDisplayPanelOpen } from "./tab-store";
import { useSidebarActiveTabId, useSidebarOpenTabs } from "./sidebar-sections";

/** Whether a tab other than Chat is on the stage over the chat. */
export const useTabStageVisible = (): boolean => {
  const panelOpen = useDisplayPanelOpen();
  const tabs = useSidebarOpenTabs();
  const activeTabId = useSidebarActiveTabId();
  return panelOpen && tabs.some((tab) => tab.id === activeTabId);
};
