import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Text, type TextStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";
import { shouldRunContinuousAnimation } from "../lib/continuous-animation";
import { useAppVisible } from "../lib/use-app-visible";

const DEFAULT_DURATION_MS = 1600;

const DEFAULT_DIM_ALPHA = 0.15;
const PULSE_LOW_OPACITY = 0.45;

export function ShimmerText({
  text,
  active,
  color,
  textStyle,
  durationMs = DEFAULT_DURATION_MS,
  dimAlpha = DEFAULT_DIM_ALPHA,
  variant = "trough",
}: {
  text: string;
  active: boolean;
  color: string;
  textStyle: TextStyle | TextStyle[];
  durationMs?: number;
  dimAlpha?: number;
  variant?: "trough" | "highlight";
}) {
  const restingOpacity = variant === "highlight" ? Math.max(dimAlpha, 0.45) : 1;
  const pulseOpacity = variant === "highlight" ? 1 : PULSE_LOW_OPACITY;
  const pulse = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  const appVisible = useAppVisible();

  const animating = shouldRunContinuousAnimation({
    logicalActive: active,
    appVisible,
    reducedMotion: reduceMotion,
  });

  useEffect(() => {
    if (!animating) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const half = Math.max(200, durationMs / 2);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: half,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: half,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animating, durationMs, pulse]);

  const opacity = useMemo(
    () =>
      pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [restingOpacity, pulseOpacity],
      }),
    [pulse, pulseOpacity, restingOpacity],
  );

  if (!active || reduceMotion) {
    return (
      <Text
        style={textStyle}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {text}
      </Text>
    );
  }

  return (
    <Animated.Text
      style={[textStyle, { color, opacity }]}
      numberOfLines={1}
      maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
    >
      {text}
    </Animated.Text>
  );
}

