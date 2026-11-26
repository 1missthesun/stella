import { viewAtom } from "@/platform/view-state/view-state";

const open = viewAtom("whatsNew.open", false);
const selected = viewAtom<string | null>("whatsNew.selected", null, (value) => value === null || typeof value === "string");

export const whatsNewDialog = {
  open(releaseKey?: string) {
    selected.set(releaseKey ?? null);
    open.set(true);
  },
  select(releaseKey: string) {
    selected.set(releaseKey);
  },
  setOpen(next: boolean) {
    open.set(next);
  },
};

export const useWhatsNewOpen = () => open.use();
export const useWhatsNewSelected = () => selected.use();
