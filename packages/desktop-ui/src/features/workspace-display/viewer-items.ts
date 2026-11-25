import { useSyncExternalStore } from "react";
import type { MenuBuilder } from "@/platform/context-menu";

export type ViewerNav = {
  canPrevious: boolean;
  canNext: boolean;
  previous: () => void;
  next: () => void;
  previousLabel: string;
  nextLabel: string;
  sets?: boolean;
};

export type ViewerItemActions = {
  copyLabel?: string;
  copy?: () => Promise<void>;
  remove?: () => void;
};

export type ViewerItemState = {
  detail: string | null;
  nav: ViewerNav | null;
  actions: ViewerItemActions | null;
};

const EMPTY: ViewerItemState = { detail: null, nav: null, actions: null };

// @reloadable open bodies report again when they mount
const items = new Map<string, ViewerItemState>();
// @reloadable frames register their menu again on every render
const menus = new Map<string, MenuBuilder>();
const listeners = new Set<() => void>();

export const viewerItems = {
  get(id: string): ViewerItemState {
    return items.get(id) ?? EMPTY;
  },
  patch(id: string, patch: Partial<ViewerItemState>): void {
    const current = viewerItems.get(id);
    const next = { ...current, ...patch };
    if (
      next.detail === current.detail &&
      next.nav === current.nav &&
      next.actions === current.actions
    ) {
      return;
    }
    if (next.detail === null && next.nav === null && next.actions === null) {
      items.delete(id);
    } else {
      items.set(id, next);
    }
    for (const listener of listeners) listener();
  },
  setMenu(id: string, menu: MenuBuilder | null): void {
    if (menu) menus.set(id, menu);
    else menus.delete(id);
  },
  menu(id: string): MenuBuilder | null {
    return menus.get(id) ?? null;
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useViewerItem = (id: string | null): ViewerItemState =>
  useSyncExternalStore(
    subscribe,
    () => (id ? viewerItems.get(id) : EMPTY),
    () => EMPTY,
  );
