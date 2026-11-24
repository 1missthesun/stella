import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { fileViewer } from "@/features/workspace-display/file-viewer-store";

export const ViewerItemContext = createContext<string | null>(null);

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

export type ViewerNav = {
  canPrevious: boolean;
  canNext: boolean;
  previous: () => void;
  next: () => void;
  previousLabel: string;
  nextLabel: string;
  sets?: boolean;
};

export const ViewerNavContext = createContext<
  ((nav: ViewerNav | null) => void) | null
>(null);

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

export type ViewerItemActions = {
  copyLabel?: string;
  copy?: () => Promise<void>;
  remove?: () => void;
};

export const ViewerActionsContext = createContext<
  ((actions: ViewerItemActions | null) => void) | null
>(null);

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
