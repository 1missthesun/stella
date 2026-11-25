import { useState, type ReactNode } from "react";
import { useRetainedSurfaceActive } from "@/ui/retained-surface";

export const DeferredDisplayContent = ({
  render,
  immediate = false,
}: {
  render: () => ReactNode;
  immediate?: boolean;
}) => {
  const shown = useRetainedSurfaceActive();
  const [painted, setPainted] = useState(immediate || shown);
  if (shown && !painted) setPainted(true);
  return painted || shown ? render() : null;
};
