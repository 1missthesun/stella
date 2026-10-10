import type { GestureResponderEvent } from "react-native";

export type TouchAnchor = { x: number; y: number };

let last: { anchor: TouchAnchor; at: number } | null = null;

const FRESH_MS = 1500;

/**
 * Remembers where the latest touch began, in window coordinates. The app root
 * reads every touch through this (it never claims the responder), so a
 * surface opened by a tap can point back at the thing that was tapped.
 */
export const recordTouchStart = (event: GestureResponderEvent): false => {
  const { pageX, pageY } = event.nativeEvent;
  last = { anchor: { x: pageX, y: pageY }, at: Date.now() };
  return false;
};

/** Where the tap that just happened landed, or null when there was none lately. */
export const recentTouchAnchor = (): TouchAnchor | null =>
  last && Date.now() - last.at < FRESH_MS ? last.anchor : null;
