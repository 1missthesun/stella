import { createContext, useContext, type HTMLAttributes } from "react";
import "./retained-surface.css";

const RetainedSurfaceActiveContext = createContext(true);

export const useRetainedSurfaceActive = (): boolean =>
  useContext(RetainedSurfaceActiveContext);

type RetainedSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  active: boolean;
};

export function RetainedSurface({
  active,
  children,
  ...props
}: RetainedSurfaceProps) {
  const shown = useRetainedSurfaceActive() && active;
  return (
    <div
      {...props}
      data-retained-surface={active ? "shown" : "suspended"}
      aria-hidden={!active || undefined}
      inert={!active}
    >
      <RetainedSurfaceActiveContext value={shown}>
        {children}
      </RetainedSurfaceActiveContext>
    </div>
  );
}
