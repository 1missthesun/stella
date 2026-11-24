import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MainTabId } from "./last-main-tab";

export type BottomBarTab = Extract<
  MainTabId,
  "chat" | "schedule" | "apps" | "files"
>;

export const BOTTOM_BAR_TABS: readonly BottomBarTab[] = [
  "chat",
  "schedule",
  "apps",
  "files",
];

export function isBottomBarTab(tab: MainTabId | null): tab is BottomBarTab {
  return BOTTOM_BAR_TABS.some((candidate) => candidate === tab);
}

const WIDE_LAYOUT_MIN_WIDTH = 920;
const HOME_INDICATOR_OVERLAP = 6;
const MIN_BOTTOM_PADDING = 4;
const CLEARANCE_ABOVE_BAR = 10;

export const BOTTOM_BAR_ROW_HEIGHT = 50;

export function useWideLayout(): boolean {
  return useWindowDimensions().width >= WIDE_LAYOUT_MIN_WIDTH;
}

export function bottomBarPadding(safeAreaBottom: number): number {
  return Math.max(safeAreaBottom - HOME_INDICATOR_OVERLAP, MIN_BOTTOM_PADDING);
}

/** The space a tab page keeps free at its bottom edge: the safe area plus the bar. */
export function useTabBottomInset(): number {
  const safeAreaBottom = useSafeAreaInsets().bottom;
  const wide = useWideLayout();
  if (wide) return safeAreaBottom;
  return (
    bottomBarPadding(safeAreaBottom) +
    BOTTOM_BAR_ROW_HEIGHT +
    CLEARANCE_ABOVE_BAR
  );
}
