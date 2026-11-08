import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { fileViewer } from "@/features/workspace-display/file-viewer-store";

/** The display item id a viewer body is rendering inside the file viewer. */
export const ViewerItemContext = createContext<string | null>(null);

/**
 * Lets a viewer report where you are inside the item ("p. 3"), which the
 * composer chip carries. A no-op outside the file viewer.
 */
export const useViewerDetailReporter = (): ((
  detail: string | null,
) => void) => {
  const itemId = useContext(ViewerItemContext);
  return useCallback(
    (detail: string | null) => {
      if (itemId) fileViewer.setDetail(itemId, detail);
    },
    [itemId],
  );
};

/**
 * What ← → and the viewer's edge arrows step through. Media steps across the
 * conversation's items; a viewer with its own pages (PDF, slides, a diff's
 * files) registers those instead.
 */
export type ViewerNav = {
  canPrevious: boolean;
  canNext: boolean;
  previous: () => void;
  next: () => void;
  /** e.g. "Previous page". */
  previousLabel: string;
  nextLabel: string;
};

export const ViewerNavContext = createContext<
  ((nav: ViewerNav | null) => void) | null
>(null);

/** Register page-style navigation for the viewer this body is shown in. */
export const useRegisterViewerNav = (nav: ViewerNav | null): void => {
  const register = useContext(ViewerNavContext);
  const key = nav
    ? `${nav.canPrevious}|${nav.canNext}|${nav.previousLabel}|${nav.nextLabel}`
    : "none";
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    if (!register) return;
    if (!navRef.current) {
      register(null);
      return;
    }
    register({
      ...navRef.current,
      previous: () => navRef.current?.previous(),
      next: () => navRef.current?.next(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, register]);
  useEffect(() => () => register?.(null), [register]);
};
