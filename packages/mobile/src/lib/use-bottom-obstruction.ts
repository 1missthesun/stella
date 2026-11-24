import { useEffect } from "react";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import {
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTabBottomInset } from "./bottom-bar";

const COMPOSER_SPRING = { duration: 350, dampingRatio: 1 };

export function useBottomObstruction(
  composerHeight: number,
  composerOverlap = 0,
): SharedValue<number> {
  const safeAreaBottom = useSafeAreaInsets().bottom;
  const tabBottomInset = useTabBottomInset();
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
    if (composer.value <= 0) return Math.max(safeAreaBottom, keyboardHeight);
    return (
      Math.max(0, composer.value - composerOverlap) +
      Math.max(0, keyboardHeight - tabBottomInset)
    );
  });
}
