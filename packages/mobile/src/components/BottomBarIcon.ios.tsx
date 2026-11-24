import { SymbolView, type SymbolViewProps } from "expo-symbols";
import type { BottomBarTab } from "../lib/bottom-bar";
import type { BottomBarIconProps } from "./BottomBarIcon.types";

const SYMBOLS: Record<
  BottomBarTab,
  { rest: SymbolViewProps["name"]; selected: SymbolViewProps["name"] }
> = {
  chat: { rest: "bubble.left", selected: "bubble.left.fill" },
  schedule: { rest: "calendar", selected: "calendar" },
  apps: { rest: "square.grid.2x2", selected: "square.grid.2x2.fill" },
  files: { rest: "folder", selected: "folder.fill" },
};

export function BottomBarIcon({ tab, selected, color, size }: BottomBarIconProps) {
  return (
    <SymbolView
      name={selected ? SYMBOLS[tab].selected : SYMBOLS[tab].rest}
      size={size}
      tintColor={color}
      weight={selected ? "semibold" : "regular"}
    />
  );
}
