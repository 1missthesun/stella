import type { ReactNode } from "react";

export const STATUS_PILL_HEIGHT = 44;

export const STATUS_PILL_INSET = 7;

export const STATUS_PILL_SPRING = { duration: 420, dampingRatio: 0.88 } as const;

export type StatusPillProps = {
  width: number;
  slotWidth: number;
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
};
