import { viewerItems, type ViewerNav } from "@/features/workspace-display/viewer-items";

const siblingNavs = new Map<string, ViewerNav>();
const siblingSets = new Map<string, { jump(backwards: boolean): boolean }>();

/** The strip registers how to move between its items and sets, for the arrow keys. */
export const registerSiblingNav = (itemId: string, nav: ViewerNav | null, sets: { jump(backwards: boolean): boolean } | null): (() => void) => {
  if (nav) siblingNavs.set(itemId, nav);
  if (sets) siblingSets.set(itemId, sets);
  return () => {
    if (siblingNavs.get(itemId) === nav) siblingNavs.delete(itemId);
    if (siblingSets.get(itemId) === sets) siblingSets.delete(itemId);
  };
};

/** ← / → step through the shown item's own pages or its strip; ⇧ jumps a whole set. */
export const stepViewer = (chord: string, itemId: string): boolean => {
  const backwards = chord.endsWith("ArrowLeft");
  if (chord.startsWith("shift+")) return siblingSets.get(itemId)?.jump(backwards) ?? false;
  const nav = viewerItems.get(itemId).nav ?? siblingNavs.get(itemId) ?? null;
  if (!nav || (backwards ? !nav.canPrevious : !nav.canNext)) return false;
  if (backwards) nav.previous();
  else nav.next();
  return true;
};
