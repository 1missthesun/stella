import { useSyncExternalStore } from "react";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";

/** Which digest the Email tab shows; null shows the newest. */
let selected: string | null = null;
let openedAt = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const selectEmailDigest = (digestId: string | null): void => {
  selected = digestId;
  openedAt = Date.now();
  emit();
};

/** Opens the Email tab on Today, as the bell's entries do. */
export const openEmailToday = (): void => {
  selectEmailDigest(null);
  sidebarSections.openSectionTab("email");
};

export const useSelectedEmailDigest = (): { digestId: string | null; openedAt: number } => {
  const digestId = useSyncExternalStore(subscribe, () => selected);
  const at = useSyncExternalStore(subscribe, () => openedAt);
  return { digestId, openedAt: at };
};
