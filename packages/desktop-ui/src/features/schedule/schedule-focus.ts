import { useSyncExternalStore } from "react";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";

export type ScheduleFocus = { scheduleId: string; at: number };

let focus: ScheduleFocus | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Open the Schedule view with one schedule scrolled into view and marked. */
export const openScheduleFocused = (scheduleId: string): void => {
  focus = { scheduleId, at: Date.now() };
  for (const listener of listeners) listener();
  sidebarSections.openLocation("schedule", null);
};

export const useScheduleFocus = (): ScheduleFocus | null =>
  useSyncExternalStore(subscribe, () => focus, () => null);
