import type { GestureResponderEvent } from "react-native";

export type TouchAnchor = { x: number; y: number };

let last: { anchor: TouchAnchor; at: number } | null = null;

const FRESH_MS = 1500;

export const recordTouchStart = (event: GestureResponderEvent): false => {
  const { pageX, pageY } = event.nativeEvent;
  last = { anchor: { x: pageX, y: pageY }, at: Date.now() };
  return false;
};

export const recentTouchAnchor = (): TouchAnchor | null =>
  last && Date.now() - last.at < FRESH_MS ? last.anchor : null;
