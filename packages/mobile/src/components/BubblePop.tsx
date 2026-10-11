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
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useReducedMotion } from "react-native-reanimated";
import { useColors } from "../theme/theme-context";
import { useReplyHandoffController } from "./reply-handoff";

type Pop = {
  side: "left" | "right";
  rise: number;
  scale: number;
  fadeFrom?: number;
  beforePaint?: boolean;
};

export const SENT_BUBBLE_POP: Pop = { side: "right", rise: 14, scale: 0.84 };
const ARRIVING_BUBBLE_POP: Pop = {
  side: "left",
  rise: 14,
  scale: 0.84,
  fadeFrom: 0.4,
  beforePaint: true,
};

/**
 * iMessage-style entry shared by the sent bubble and the arriving reply: the
 * bubble springs up out of its tail corner while the fade finishes early, so
 * it reads as solid by the time it lands. Same spring as the desktop
 * `--bubble-spring` (stiffness 420, damping 30).
 *
 * `animate` is read once, at mount: callers flip it off on the next render
 * (the row is "seen" by then), and that must not cut the pop short.
 */
export function useBubblePop(animate: boolean, pop: Pop, ready = true) {
  const reducedMotion = useReducedMotion();
  const play = useRef(animate).current && !reducedMotion;
  const progress = useRef(new Animated.Value(play ? 0 : 1)).current;
  const opacity = useRef(new Animated.Value(play ? (pop.fadeFrom ?? 0) : 1))
    .current;
  const useStartEffect = pop.beforePaint ? useLayoutEffect : useEffect;

  useStartEffect(() => {
    if (!play) {
      progress.setValue(1);
      opacity.setValue(1);
      return;
    }
    if (!ready) return;
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
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [play, ready, progress, opacity, pop.side]);

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

/** The reply bubble, popping in once if it mounts with `animate`. */
export function AssistantBubble({
  children,
  style,
  animate,
}: {
  children: ReactNode;
  style: StyleProp<ViewStyle>;
  animate: boolean;
}) {
  const colors = useColors();
  const handoff = useReplyHandoffController();
  const reducedMotion = useReducedMotion();
  const [staged, setStaged] = useState(
    () => animate && !reducedMotion && Boolean(handoff?.canStage()),
  );
  const stagedOnMountRef = useRef(staged);
  const arrivedUnstagedRef = useRef(animate && !staged);
  const landingRef = useRef(false);
  const settleRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
      if (stagedOnMountRef.current && !landingRef.current) {
        handoff?.replyArrived();
      }
    },
    [handoff],
  );
  useLayoutEffect(() => {
    if (stagedOnMountRef.current) handoff?.holdIndicator();
    else if (arrivedUnstagedRef.current) handoff?.replyArrived();
  }, [handoff]);
  const onStagedLayout = (event: LayoutChangeEvent) => {
    if (landingRef.current || !handoff) return;
    landingRef.current = true;
    settleRef.current = handoff.land(event.nativeEvent.layout.height, () => {
      if (!mountedRef.current) return false;
      setStaged(false);
      return true;
    });
  };
  const pop = useBubblePop(animate, ARRIVING_BUBBLE_POP, !staged);
  return (
    <View
      style={staged ? stagedStyles.hidden : undefined}
      pointerEvents={staged ? "none" : "auto"}
      onLayout={
        staged
          ? undefined
          : (event) => {
              if (event.nativeEvent.layout.height <= 0) return;
              settleRef.current?.();
              settleRef.current = null;
            }
      }
    >
      <Animated.View
        style={[style, pop]}
        onLayout={staged ? onStagedLayout : undefined}
      >
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
    </View>
  );
}

const stagedStyles = StyleSheet.create({
  hidden: { height: 0, opacity: 0 },
});
