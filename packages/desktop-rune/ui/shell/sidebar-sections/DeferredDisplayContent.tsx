import { useEffect, useState, type ReactNode } from "react";
import { useRetainedSurfaceActive } from "../../kit";

/** desktop-ui's `DeferredDisplayContent`: a heavy viewer body builds a frame after its surface first shows. */
export const DeferredDisplayContent = ({ render, immediate = false }: { render: () => ReactNode; immediate?: boolean }) => {
  const shown = useRetainedSurfaceActive();
  const [painted, setPainted] = useState(immediate);

  useEffect(() => {
    if (!shown || painted) return;
    const timer = setTimeout(() => setPainted(true), 16);
    return () => clearTimeout(timer);
  }, [shown, painted]);

  return painted ? render() : null;
};
