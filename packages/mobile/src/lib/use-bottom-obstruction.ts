import { useEffect } from "react";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import {
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The composer's own grow and shrink: a 350ms critically damped spring. */
const COMPOSER_SPRING = { duration: 350, dampingRatio: 1 };

/**
 * How much of the bottom of the screen an overlay must stay clear of, as a
 * UI-thread value: the keyboard as it moves, frame for frame, plus the
 * composer sitting on it, which eases with the composer's own spring when it
 * grows or shrinks. With no composer (`composerHeight` 0) it is the keyboard
 * or the home indicator, whichever is taller.
 */
export function useBottomObstruction(
  composerHeight: number,
  composerOverlap = 0,
): SharedValue<number> {
  const bottomInset = useSafeAreaInsets().bottom;
  const keyboard = useReanimatedKeyboardAnimation().height;
  const composer = useSharedValue(composerHeight);
  useEffect(() => {
    composer.value =
      composerHeight > 0 && composer.value > 0
        ? withSpring(composerHeight, COMPOSER_SPRING)
        : composerHeight;
  }, [composer, composerHeight]);
  return useDerivedValue(() => {
    const keyboardHeight = Math.abs(keyboard.value);
    if (composer.value <= 0) return Math.max(bottomInset, keyboardHeight);
    return (
      Math.max(0, composer.value - composerOverlap) +
      Math.max(0, keyboardHeight - bottomInset)
    );
  });
}
