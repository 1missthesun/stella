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
import { viewAtom } from "@/platform/view-state/view-state";

type WorkspaceDisplayPayloadAdapter = {
  payloadToTabSpec: (payload: DisplayTabPayload) => DisplayTabSpec;
  createSourceDiffTabSpec: () => DisplayTabSpec;
};

let adapter: WorkspaceDisplayPayloadAdapter | null = null;

const REMEMBERED_ITEMS = 16;
const REMEMBERED_ITEM_BYTES = 16_000;
const SOURCE_DIFF_KIND = "source-diff";

type OpenItems = { payloads: DisplayTabPayload[]; viewing: string | null };

const openItems = viewAtom<OpenItems>("workspace.openItems", {
  payloads: [],
  viewing: null,
});

const rememberOpenItems = () => {
  const payloads: DisplayTabPayload[] = [];
  for (const tab of displayTabs.getTabListSnapshot().tabs) {
    if (!tab.payload) continue;
    if (JSON.stringify(tab.payload).length > REMEMBERED_ITEM_BYTES) continue;
    payloads.push(tab.payload);
  }
  const viewing = fileViewer.getSnapshot().fileId;
  const remembered = openItems.get();
  const next = { payloads: payloads.slice(-REMEMBERED_ITEMS), viewing };
  if (JSON.stringify(next) !== JSON.stringify(remembered)) openItems.set(next);
};

const keepOpen = { activate: false } as const;

const reopenRememberedItems = (from: WorkspaceDisplayPayloadAdapter) => {
  const { payloads, viewing } = openItems.get();
  for (const payload of payloads) {
    try {
      displayTabs.openTab(from.payloadToTabSpec(payload), {
        ...keepOpen,
        openPanel: displayTabs.getLayoutSnapshot().panelOpen,
      });
    } catch {
      continue;
    }
  }
  const tabs = displayTabs.getTabListSnapshot().tabs;
  if (viewing && tabs.some((tab) => tab.id === viewing)) fileViewer.open(viewing);
};

const rebuildOpenItems = (from: WorkspaceDisplayPayloadAdapter) => {
  for (const tab of displayTabs.getTabListSnapshot().tabs) {
    const spec = tab.payload
      ? from.payloadToTabSpec(tab.payload)
      : tab.kind === SOURCE_DIFF_KIND
        ? from.createSourceDiffTabSpec()
        : null;
    if (!spec || spec.id !== tab.id) continue;
    displayTabs.openTab(spec, {
      ...keepOpen,
      openPanel: displayTabs.getLayoutSnapshot().panelOpen,
    });
  }
};

export const registerWorkspaceDisplayPayloadAdapter = (
  nextAdapter: WorkspaceDisplayPayloadAdapter,
): void => {
  const first = adapter === null;
  adapter = nextAdapter;
  if (!first) {
    rebuildOpenItems(nextAdapter);
    return;
  }
  reopenRememberedItems(nextAdapter);
  displayTabs.subscribeTabList(rememberOpenItems);
  fileViewer.subscribe(rememberOpenItems);
};

export const closeOpenItems = (): void => {
  fileViewer.close();
  for (const tab of displayTabs.getTabListSnapshot().tabs) {
    if (tab.payload || tab.kind === SOURCE_DIFF_KIND) displayTabs.closeTab(tab.id);
  }
};

const getAdapter = (): WorkspaceDisplayPayloadAdapter => {
  if (!adapter) {
    throw new Error(
      "Workspace display payload adapter has not been registered.",
    );
  }
  return adapter;
};

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

export const showInViewer = (id: string): void => {
  const active = sidebarSections.getActiveTab();
  if (
    displayTabs.getLayoutSnapshot().panelOpen &&
    (active?.kind === "browser" ||
      active?.kind === "apps" ||
      active?.kind === "takeover")
  ) {
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
