import { useSyncExternalStore } from "react";
import { isSelfHostedServer } from "@/platform/backend/server-discovery";

let open = false;
let focusPlans = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const planUsageDialog = {
  open() {
    if (open || isSelfHostedServer()) return;
    open = true;
    emit();
  },
  openPlans() {
    focusPlans = true;
    this.open();
  },
  consumeFocusPlans() {
    const value = focusPlans;
    focusPlans = false;
    return value;
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
