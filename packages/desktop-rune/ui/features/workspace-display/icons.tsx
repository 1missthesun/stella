import type { DisplayTabKind } from "@/features/workspace-display/types";
import { Icon, Icons, type IconData } from "../../kit";

const DISPLAY = Icons.display as Record<string, IconData>;

/** desktop-ui's `DisplayTabIcon`, from the generated catalog (type badges keep their colours). */
export function DisplayTabIcon({ kind, size = 18, color, opacity }: { kind: DisplayTabKind | string; size?: number; color?: string; opacity?: number }) {
  const icon = DISPLAY[kind] ?? DISPLAY.text;
  return <Icon icon={icon} size={size} color={color} opacity={opacity} />;
}
