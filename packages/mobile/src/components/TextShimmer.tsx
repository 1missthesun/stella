import { useCallback, useEffect, useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type TextStyle,
} from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { withAlpha } from "@stella/theme";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";
import { shouldRunContinuousAnimation } from "../lib/continuous-animation";
import { useAppVisible } from "../lib/use-app-visible";

const SHIMMER_WINDOW_FRACTION = 0.44;
const SHIMMER_PER_CHAR_MS = 95;
const SHIMMER_EASING = Easing.bezier(0.42, 0, 0.58, 1);
const SHIMMER_STOPS = [0, 0.12, 0.32, 0.5, 0.68, 0.88, 1] as const;
const SHIMMER_ALPHAS = [0, 0.2, 0.72, 1, 0.72, 0.2, 0] as const;

const shimmerTiming = (textLength: number) => {
  const duration = Math.max(
    1400,
    Math.min(4000, textLength * SHIMMER_PER_CHAR_MS),
  );
  return {
    sweepMs: Math.min(2200, Math.max(1400, duration * 0.85)),
    restMs: Math.max(3000, duration * 1.5),
  };
};

export function TextShimmer({
  text,
  active,
  color,
  sweepColor,
  textStyle,
}: {
  text: string;
  active: boolean;
  color: string;
  sweepColor: string;
  textStyle: TextStyle | TextStyle[];
}) {
  const reducedMotion = useReducedMotion();
  const appVisible = useAppVisible();
  const animating = shouldRunContinuousAnimation({
    logicalActive: active,
    appVisible,
    reducedMotion,
  });
  const width = useSharedValue(0);
  const progress = useSharedValue(0);
  const { sweepMs, restMs } = shimmerTiming(text.length);

  useEffect(() => {
    if (!animating) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 0 }),
        withTiming(1, { duration: sweepMs, easing: SHIMMER_EASING }),
        withTiming(1, { duration: restMs }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [animating, progress, restMs, sweepMs, text]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      width.value = event.nativeEvent.layout.width;
    },
    [width],
  );

  const windowStyle = useAnimatedStyle(() => {
    const window = width.value * SHIMMER_WINDOW_FRACTION;
    return {
      width: window,
      transform: [
        { translateX: -window + progress.value * (width.value + window) },
      ],
    };
  });

  const gradientColors = useMemo(
    () =>
      SHIMMER_ALPHAS.map((alpha) => withAlpha(sweepColor, alpha)) as [
        string,
        string,
        ...string[],
      ],
    [sweepColor],
  );

  const label = (
    <Text
      style={[textStyle, { color }]}
      numberOfLines={1}
      maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
    >
      {text}
    </Text>
  );

  if (!animating) return label;

  return (
    <View style={styles.root} onLayout={onLayout}>
      {label}
      <MaskedView
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        maskElement={
          <Text
            style={[textStyle, styles.maskText]}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {text}
          </Text>
        }
      >
        <Animated.View style={[styles.window, windowStyle]}>
          <LinearGradient
            colors={gradientColors}
            locations={SHIMMER_STOPS}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </MaskedView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: "hidden",
  },
  maskText: {
    color: "#000000",
  },
  window: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  },
});
