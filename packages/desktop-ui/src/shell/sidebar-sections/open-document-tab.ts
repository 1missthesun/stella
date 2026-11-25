import { createElement } from "react";
import { cloudAppIdFromLocation } from "@/features/cloud/open-cloud-app-panel";
import {
  openAppTab,
  openDisplayPayloadTab,
  showInViewer,
} from "@/features/workspace-display/open-payload";
import {
  fileNameFromDisplayTabId,
  sidebarSections,
  type SidebarTab,
} from "@/features/workspace-display/sidebar-sections";
import { displayTabs } from "@/features/workspace-display/tab-store";
import {
  payloadFileUnavailableMessage,
  restorablePayloadFor,
  unrestorableFileMessage,
} from "./file-tab-restore";
import { UnavailableFile } from "./UnavailableFile";

const restoreFile = async (tab: SidebarTab, location: string) => {
  const payload = restorablePayloadFor(tab);
  const message = payload
    ? await payloadFileUnavailableMessage(payload)
    : unrestorableFileMessage(location);
  if (!sidebarSections.hasLocation("files", location)) return;
  if (payload && !message) {
    const openedId = openDisplayPayloadTab(payload, { activate: false });
    sidebarSections.retargetFile(tab.id, location, openedId);
    showInViewer(openedId);
    return;
  }
  const title = tab.file?.title || fileNameFromDisplayTabId(location);
  displayTabs.openTab(
    {
      id: location,
      kind: tab.file?.kind ?? "text",
      title,
      render: () =>
        createElement(UnavailableFile, { name: title, message: message ?? "" }),
    },
    { activate: false, openPanel: displayTabs.getLayoutSnapshot().panelOpen },
  );
  showInViewer(location);
};

/** Shows a file's or app's tab in the viewer, reopening it when needed. */
export const openDocumentTab = (tab: SidebarTab): void => {
  const { location } = tab;
  if (!location) return;
  sidebarSections.markRead(tab.id);
  if (tab.kind === "apps") {
    if (cloudAppIdFromLocation(location)) openAppTab(location);
    return;
  }
  const open = displayTabs
    .getTabListSnapshot()
    .tabs.find((item) => item.id === location);
  if (open?.payload) showInViewer(location);
  else void restoreFile(tab, location);
};
