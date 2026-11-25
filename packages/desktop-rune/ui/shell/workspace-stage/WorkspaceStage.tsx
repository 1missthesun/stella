import { forwardRef, useImperativeHandle } from "react";
import type { WorkspaceStageHandle } from "@/shell/workspace-stage/WorkspaceStage";

export const WorkspaceStage = forwardRef<WorkspaceStageHandle, object>(function WorkspaceStage(_props, ref) {
  useImperativeHandle(ref, () => ({ open() {}, update() {}, close() {} }), []);
  return null;
});
