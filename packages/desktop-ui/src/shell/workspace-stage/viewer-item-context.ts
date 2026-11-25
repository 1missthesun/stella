import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { detachedWindows } from "@/features/workspace-display/detached-windows";
import {
  DOCKED,
  type ViewerSurface,
} from "@/features/workspace-display/file-viewer-store";
import {
  viewerItems,
  type ViewerItemActions,
  type ViewerNav,
} from "@/features/workspace-display/viewer-items";

export const ViewerItemContext = createContext<string | null>(null);

export const ViewerSurfaceContext = createContext<ViewerSurface>(DOCKED);

/** The window the viewer's item is drawn in: Stella's own, or a detached one. */
export const useViewerWindow = (): Window =>
  detachedWindows.get(useContext(ViewerSurfaceContext))?.window ?? window;

export const useViewerDetailReporter = (): ((
  detail: string | null,
) => void) => {
  const itemId = useContext(ViewerItemContext);
  return useCallback(
    (detail: string | null) => {
      if (itemId) viewerItems.patch(itemId, { detail });
    },
    [itemId],
  );
};

export const useRegisterViewerNav = (nav: ViewerNav | null): void => {
  const itemId = useContext(ViewerItemContext);
  const key = nav
    ? `${nav.canPrevious}|${nav.canNext}|${nav.previousLabel}|${nav.nextLabel}`
    : "none";
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    if (!itemId) return;
    const current = navRef.current;
    viewerItems.patch(itemId, {
      nav: current && {
        ...current,
        previous: () => navRef.current?.previous(),
        next: () => navRef.current?.next(),
      },
    });
  }, [key, itemId]);
  useEffect(
    () => () => {
      if (itemId) viewerItems.patch(itemId, { nav: null });
    },
    [itemId],
  );
};

export const useRegisterViewerActions = (
  actions: ViewerItemActions | null,
): void => {
  const itemId = useContext(ViewerItemContext);
  const key = actions
    ? `${actions.copyLabel ?? ""}|${Boolean(actions.copy)}|${Boolean(actions.remove)}`
    : "none";
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    if (!itemId) return;
    const current = ref.current;
    viewerItems.patch(itemId, {
      actions: current && {
        ...(current.copyLabel ? { copyLabel: current.copyLabel } : {}),
        ...(current.copy
          ? { copy: () => ref.current?.copy?.() ?? Promise.resolve() }
          : {}),
        ...(current.remove ? { remove: () => ref.current?.remove?.() } : {}),
      },
    });
  }, [key, itemId]);
  useEffect(
    () => () => {
      if (itemId) viewerItems.patch(itemId, { actions: null });
    },
    [itemId],
  );
};
