/**
 * Global open/close state for the Plan & usage dialog: the account menu's
 * "Plan & usage" item and every Upgrade action (the usage-limit notice, plan
 * restriction toasts, cloud subscription prompts) open the same dialog,
 * hosted once in the root chrome by `PlanUsageDialogHost`.
 */
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const planUsageDialog = {
  open() {
    if (open) return;
    open = true;
    emit();
  },
  close() {
    if (!open) return;
    open = false;
    emit();
  },
  setOpen(next: boolean) {
    if (next) this.open();
    else this.close();
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const usePlanUsageDialogOpen = () =>
  useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
