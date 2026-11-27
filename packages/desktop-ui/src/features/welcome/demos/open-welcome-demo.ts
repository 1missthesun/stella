import { displayTabs } from "@/features/workspace-display/tab-store";
import { fileViewer } from "@/features/workspace-display/file-viewer-store";
import { showInViewer } from "@/features/workspace-display/open-payload";
import { welcomeDemoTabId, welcomeDemoTabSpec } from "./welcome-demo-tab";

export type WelcomeDemoId = "errands" | "customize" | "memory";

let runs = 0;

/**
 * Shows a welcome demo in the viewer. One already on screen is only brought
 * forward; otherwise it opens from the start, resting on its poster.
 */
export const openWelcomeDemo = (id: WelcomeDemoId): void => {
  const tabId = welcomeDemoTabId(id);
  if (fileViewer.surfaceOf(tabId) === null) {
    runs += 1;
    displayTabs.openTab(welcomeDemoTabSpec(id, runs), {
      activate: false,
      openPanel: displayTabs.getLayoutSnapshot().panelOpen,
    });
  }
  showInViewer(tabId);
};
