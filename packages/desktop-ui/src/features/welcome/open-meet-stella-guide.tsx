import { lazy, Suspense } from "react";
import { MEET_STELLA_GUIDE_TITLE } from "@stella/contracts/welcome-message";
import { displayTabs } from "@/features/workspace-display/tab-store";
import { showInViewer } from "@/features/workspace-display/open-payload";
import type { DisplayTabSpec } from "@/features/workspace-display/types";

const MeetStellaGuideView = lazy(() => import("./MeetStellaGuideView"));

export const MEET_STELLA_GUIDE_TAB_ID = "welcome:meet-stella";

const guideTabSpec = (): DisplayTabSpec => ({
  id: MEET_STELLA_GUIDE_TAB_ID,
  kind: "canvas",
  title: MEET_STELLA_GUIDE_TITLE,
  render: () => (
    <Suspense fallback={null}>
      <MeetStellaGuideView />
    </Suspense>
  ),
});

/** Shows the Meet Stella guide in the viewer, as a file under a message opens. */
export const openMeetStellaGuide = (): void => {
  displayTabs.openTab(guideTabSpec(), {
    activate: false,
    openPanel: displayTabs.getLayoutSnapshot().panelOpen,
  });
  showInViewer(MEET_STELLA_GUIDE_TAB_ID);
};
