import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useColors } from "../theme/theme-context";
import {
  useReplyMorphController,
  type ReplyMorphSnapshot,
} from "./reply-morph";
import { WorkingIndicatorGhost } from "./WorkingIndicator";

const MORPH_SPRING = { stiffness: 247, damping: 27, mass: 1 };
const MORPH_RADIUS = 18;
const GHOST_FADE_MS = 150;
const SHELL_FADE_MS = 220;
const CONTENT_DELAY_MS = 190;
const CONTENT_FADE_MS = 230;

type Pop = { side: "left" | "right"; rise: number; scale: number };

export const SENT_BUBBLE_POP: Pop = { side: "right", rise: 14, scale: 0.84 };
const ARRIVING_BUBBLE_POP: Pop = { side: "left", rise: 10, scale: 0.9 };

/**
 * iMessage-style entry shared by the sent bubble and the arriving reply: the
 * bubble springs up out of its tail corner while the fade finishes early, so
 * it reads as solid by the time it lands. Same spring as the desktop
 * `--bubble-spring` (stiffness 420, damping 30).
 *
 * `animate` is read once, at mount: callers flip it off on the next render
 * (the row is "seen" by then), and that must not cut the pop short.
 */
export function useBubblePop(animate: boolean, pop: Pop) {
  const reducedMotion = useReducedMotion();
  const play = useRef(animate).current && !reducedMotion;
  const progress = useRef(new Animated.Value(play ? 0 : 1)).current;
  const opacity = useRef(new Animated.Value(play ? 0 : 1)).current;

  useEffect(() => {
    if (!play) {
      progress.setValue(1);
      opacity.setValue(1);
      return;
    }
    const animation = Animated.parallel([
      Animated.spring(progress, {
        toValue: 1,
        stiffness: 420,
        damping: 30,
        mass: 1,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: pop.side === "right" ? 120 : 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [play, progress, opacity, pop.side]);

  return useMemo(
    () => ({
      opacity,
      transformOrigin: pop.side === "right" ? "bottom right" : "bottom left",
      transform: [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [pop.rise, 0],
          }),
        },
        {
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [pop.scale, 1],
          }),
        },
      ],
    }),
    [opacity, progress, pop.side, pop.rise, pop.scale],
  );
}

/** The reply bubble: it grows out of the working indicator when one is up as it
 * arrives, and otherwise pops in once if it mounts with `animate`. */
export function AssistantBubble({
  children,
  style,
  animate,
}: {
  children: ReactNode;
  style: StyleProp<ViewStyle>;
  animate: boolean;
}) {
  const controller = useReplyMorphController();
  const reducedMotion = useReducedMotion();
  const [morphFrom] = useState(() =>
    animate && !reducedMotion ? (controller?.peek() ?? null) : null,
  );
  return morphFrom ? (
    <MorphingBubble style={style} from={morphFrom}>
      {children}
    </MorphingBubble>
  ) : (
    <PoppingBubble style={style} animate={animate}>
      {children}
    </PoppingBubble>
  );
}

function PoppingBubble({
  children,
  style,
  animate,
}: {
  children: ReactNode;
  style: StyleProp<ViewStyle>;
  animate: boolean;
}) {
  const colors = useColors();
  const pop = useBubblePop(animate, ARRIVING_BUBBLE_POP);
  return (
    <Animated.View style={[style, pop]}>
      <LinearGradient
        pointerEvents="none"
        colors={[
          colors.assistantBubbleFillTop,
          colors.assistantBubbleFillBottom,
        ]}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </Animated.View>
  );
}

function MorphingBubble({
  children,
  style,
  from,
}: {
  children: ReactNode;
  style: StyleProp<ViewStyle>;
  from: ReplyMorphSnapshot;
}) {
  const colors = useColors();
  const controller = useReplyMorphController();
  const width = useSharedValue(from.width);
  const height = useSharedValue(from.height);
  const shell = useSharedValue(1);
  const ghost = useSharedValue(1);
  const content = useSharedValue(0);
  const startedRef = useRef(false);
  const [landed, setLanded] = useState(false);

  useLayoutEffect(() => {
    controller?.vacate();
  }, [controller]);

  const onLayout = (event: LayoutChangeEvent) => {
    if (startedRef.current) return;
    startedRef.current = true;
    const target = event.nativeEvent.layout;
    width.value = withSpring(target.width, MORPH_SPRING, (finished) => {
      if (finished) runOnJS(setLanded)(true);
    });
    height.value = withSpring(target.height, MORPH_SPRING);
    ghost.value = withTiming(0, { duration: GHOST_FADE_MS });
    shell.value = withTiming(0, { duration: SHELL_FADE_MS });
    content.value = withDelay(
      CONTENT_DELAY_MS,
      withTiming(1, { duration: CONTENT_FADE_MS }),
    );
  };

  const layerStyle = useAnimatedStyle(() => ({
    width: width.value,
    height: height.value,
  }));
  const shellStyle = useAnimatedStyle(() => ({ opacity: shell.value }));
  const ghostStyle = useAnimatedStyle(() => ({ opacity: ghost.value }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: content.value }));
  const fill = (
    <LinearGradient
      pointerEvents="none"
      colors={[colors.assistantBubbleFillTop, colors.assistantBubbleFillBottom]}
      style={StyleSheet.absoluteFill}
    />
  );

  return (
    <Reanimated.View style={style} onLayout={onLayout}>
      {landed ? (
        fill
      ) : (
        <Reanimated.View
          pointerEvents="none"
          style={[morphStyles.layer, layerStyle]}
        >
          {fill}
          <Reanimated.View
            style={[
              StyleSheet.absoluteFill,
              morphStyles.shell,
              { backgroundColor: colors.card, borderColor: colors.border },
              shellStyle,
            ]}
          />
          <Reanimated.View style={[StyleSheet.absoluteFill, ghostStyle]}>
            <WorkingIndicatorGhost snapshot={from} />
          </Reanimated.View>
        </Reanimated.View>
      )}
      <Reanimated.View style={contentStyle}>{children}</Reanimated.View>
    </Reanimated.View>
  );
}

const morphStyles = StyleSheet.create({
  layer: {
    borderCurve: "continuous",
    borderRadius: MORPH_RADIUS,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    top: 0,
  },
  shell: {
    borderCurve: "continuous",
    borderRadius: MORPH_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
