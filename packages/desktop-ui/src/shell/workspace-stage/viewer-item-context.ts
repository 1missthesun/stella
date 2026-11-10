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
  /** The strip groups items into sets, which ⇧← ⇧→ jump between. */
  sets?: boolean;
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
  }, [key, register]);
  useEffect(() => () => register?.(null), [register]);
};

/**
 * Item actions a viewer body knows how to do and the header offers in its
 * "⋯" menu: copying the content itself (an image, some text) and removing
 * the item. Download, Share and Copy path come from the file's path.
 */
export type ViewerItemActions = {
  /** e.g. "Copy image". */
  copyLabel?: string;
  copy?: () => Promise<void>;
  remove?: () => void;
};

export const ViewerActionsContext = createContext<
  ((actions: ViewerItemActions | null) => void) | null
>(null);

/** Register the body's item actions with the viewer it is shown in. */
export const useRegisterViewerActions = (
  actions: ViewerItemActions | null,
): void => {
  const register = useContext(ViewerActionsContext);
  const key = actions
    ? `${actions.copyLabel ?? ""}|${Boolean(actions.copy)}|${Boolean(actions.remove)}`
    : "none";
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    if (!register) return;
    const current = ref.current;
    if (!current) {
      register(null);
      return;
    }
    register({
      ...(current.copyLabel ? { copyLabel: current.copyLabel } : {}),
      ...(current.copy ? { copy: () => ref.current?.copy?.() ?? Promise.resolve() } : {}),
      ...(current.remove ? { remove: () => ref.current?.remove?.() } : {}),
    });
  }, [key, register]);
  useEffect(() => () => register?.(null), [register]);
};
