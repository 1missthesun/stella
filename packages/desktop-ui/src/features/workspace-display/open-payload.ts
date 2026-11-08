import type { DisplayTabPayload } from "@stella/contracts/desktop/display-payload";
import { isFilesPayload } from "./payload-kind";
import { sidebarSections } from "./sidebar-sections";
import { displayTabs } from "./tab-store";
import { fileViewer, opensAsStageTab } from "./file-viewer-store";
import {
  sourceDiffBatches,
  type SourceDiffBatch,
} from "./source-diff-batches";
import type { DisplayTabSpec, OpenTabOptions } from "./types";

type WorkspaceDisplayPayloadAdapter = {
  payloadToTabSpec: (payload: DisplayTabPayload) => DisplayTabSpec;
  createSourceDiffTabSpec: () => DisplayTabSpec;
};

let adapter: WorkspaceDisplayPayloadAdapter | null = null;

export const registerWorkspaceDisplayPayloadAdapter = (
  nextAdapter: WorkspaceDisplayPayloadAdapter,
): void => {
  adapter = nextAdapter;
};

const getAdapter = (): WorkspaceDisplayPayloadAdapter => {
  if (!adapter) {
    throw new Error(
      "Workspace display payload adapter has not been registered.",
    );
  }
  return adapter;
};

/**
 * Open a payload the user asked for. Files show in the floating viewer over
 * the chat; canvases open as a top-bar tab on the stage. `activate: false`
 * only registers the item (restores, prefetch) without showing it.
 */
export const openDisplayPayloadTab = (
  payload: DisplayTabPayload,
  opts?: OpenTabOptions,
): string => {
  const spec = getAdapter().payloadToTabSpec(payload);
  const activate = opts?.activate ?? true;
  const asTab = isFilesPayload(payload) && opensAsStageTab(spec.kind);
  displayTabs.openTab(spec, {
    activate,
    openPanel:
      activate && asTab ? true : displayTabs.getLayoutSnapshot().panelOpen,
  });
  if (!activate) return spec.id;
  if (asTab) {
    sidebarSections.openLocation("files", spec.id);
  } else {
    showInViewer(spec.id);
  }
  return spec.id;
};

/** Show an already registered display item in the floating viewer. */
export const showInViewer = (id: string): void => {
  const active = sidebarSections.getActiveTab();
  if (
    displayTabs.getLayoutSnapshot().panelOpen &&
    (active?.kind === "browser" ||
      active?.kind === "apps" ||
      active?.kind === "takeover")
  ) {
    // Native and app surfaces can't sit under the viewer: go back to chat.
    displayTabs.setPanelOpen(false);
  }
  fileViewer.open(id);
};

export const openSourceDiffBatch = (batch: SourceDiffBatch): void => {
  sourceDiffBatches.pushAndActivate(batch);
  const spec = getAdapter().createSourceDiffTabSpec();
  displayTabs.openTab(spec, {
    activate: true,
    openPanel: displayTabs.getLayoutSnapshot().panelOpen,
  });
  showInViewer(spec.id);
};

/**
 * Something the agent put on screen: register it and add a quiet top-bar tab
 * with a dot, without opening anything.
 */
export const addAgentDisplayPayload = (
  payload: DisplayTabPayload,
  opts: { tab: boolean },
): void => {
  const spec = getAdapter().payloadToTabSpec(payload);
  displayTabs.openTab(spec, {
    activate: false,
    openPanel: displayTabs.getLayoutSnapshot().panelOpen,
  });
  if (opts.tab && isFilesPayload(payload)) {
    sidebarSections.addInBackground("files", spec.id);
  }
};
