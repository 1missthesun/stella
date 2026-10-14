import { useEffect, useState, type ReactNode } from "react";
import { useRetainedSurfaceActive } from "@/ui/retained-surface";

export const DeferredDisplayContent = ({
  render,
}: {
  render: () => ReactNode;
}) => {
  const shown = useRetainedSurfaceActive();
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    if (!shown || painted) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPainted(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, painted]);

  return painted ? render() : null;
};
