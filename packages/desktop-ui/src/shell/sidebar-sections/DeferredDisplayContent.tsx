import { useEffect, useState, type ReactNode } from "react";
import { useRetainedSurfaceActive } from "@/ui/retained-surface";

/**
 * Mounts a viewer after its surface has painted, so heavy viewers (PDFs,
 * canvases, documents) don't hold up the frame that opens it. `immediate`
 * skips the wait for light ones (a picture, a clip): they only start a read,
 * and waiting would show an empty viewer for two frames on every step.
 */
export const DeferredDisplayContent = ({
  render,
  immediate = false,
}: {
  render: () => ReactNode;
  immediate?: boolean;
}) => {
  const shown = useRetainedSurfaceActive();
  const [painted, setPainted] = useState(immediate);

  useEffect(() => {
    if (!shown || painted) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPainted(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, painted]);

  return painted ? render() : null;
};
