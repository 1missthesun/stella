import { useState, type ReactNode } from "react";
import { useRetainedSurfaceActive } from "../../kit";

/** desktop-ui's `DeferredDisplayContent`: a heavy viewer body builds once its surface first shows, and stays built. */
export const DeferredDisplayContent = ({ render, immediate = false }: { render: () => ReactNode; immediate?: boolean }) => {
  const shown = useRetainedSurfaceActive();
  const [painted, setPainted] = useState(immediate || shown);
  if (shown && !painted) setPainted(true);
  return painted || shown ? render() : null;
};
