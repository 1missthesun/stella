import { useEffect, useState, type ReactNode } from "react";
import { useViewerWindow } from "@/shell/workspace-stage/viewer-item-context";
import { useRetainedSurfaceActive } from "@/ui/retained-surface";

export const DeferredDisplayContent = ({
  render,
  immediate = false,
}: {
  render: () => ReactNode;
  immediate?: boolean;
}) => {
  const viewerWindow = useViewerWindow();
  const shown = useRetainedSurfaceActive();
  const [painted, setPainted] = useState(immediate);

  useEffect(() => {
    if (!shown || painted) return;
    let frame = viewerWindow.requestAnimationFrame(() => {
      frame = viewerWindow.requestAnimationFrame(() => setPainted(true));
    });
    return () => viewerWindow.cancelAnimationFrame(frame);
  }, [shown, painted, viewerWindow]);

  return painted ? render() : null;
};
