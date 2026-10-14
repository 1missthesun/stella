import type { DisplayTabPayload } from "@stella/contracts/desktop/display-payload";
import { isFilesPayload } from "./payload-kind";
import { sidebarSections } from "./sidebar-sections";
import { displayTabs } from "./tab-store";
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

export const openDisplayPayloadTab = (
  payload: DisplayTabPayload,
  opts?: OpenTabOptions,
): string => {
  const spec = getAdapter().payloadToTabSpec(payload);
  displayTabs.openTab(spec, opts);
  if (isFilesPayload(payload) && (opts?.activate ?? true)) {
    sidebarSections.openLocation("files", spec.id);
  }
  return spec.id;
};

export const openSourceDiffBatch = (batch: SourceDiffBatch): void => {
  sourceDiffBatches.pushAndActivate(batch);
  const spec = getAdapter().createSourceDiffTabSpec();
  displayTabs.openTab(spec);
  sidebarSections.openLocation("files", spec.id);
};
