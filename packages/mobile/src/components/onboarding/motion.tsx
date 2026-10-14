import { useEffect, type ReactNode } from "react";
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
  type WithSpringConfig,
} from "react-native-reanimated";

const criticalDamping = (stiffness: number, mass = 1) =>
  2 * Math.sqrt(stiffness * mass);

const criticallyDampedSpring = (
  stiffness: number,
  mass = 1,
): WithSpringConfig => ({
  damping: criticalDamping(stiffness, mass),
  stiffness,
  mass,
});

export const SPRING_SOFT = criticallyDampedSpring(170);

export const SPRING_SNAPPY = criticallyDampedSpring(340, 0.7);

const POP_SPRING = {
  ...criticallyDampedSpring(260),
  reduceMotion: ReduceMotion.System,
};

export const cardEntering = (delay = 0) =>
  FadeInDown.springify()
    .damping(criticalDamping(150))
    .stiffness(150)
    .mass(1)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 18 }] })
    .delay(delay)
    .reduceMotion(ReduceMotion.System);

export const rowEntering = (index: number, base = 0) =>
  FadeInDown.springify()
    .damping(criticalDamping(200))
    .stiffness(200)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] })
    .delay(base + index * 55)
    .reduceMotion(ReduceMotion.System);

export const fadeEntering = (delay = 0, duration = 220) =>
  FadeIn.duration(duration).delay(delay).reduceMotion(ReduceMotion.System);

export const fadeExiting = (duration = 160) =>
  FadeOut.duration(duration).reduceMotion(ReduceMotion.System);

export const threadEntering = (delay = 0) =>
  FadeInDown.springify()
    .damping(criticalDamping(210))
    .stiffness(210)
    .mass(1)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] })
    .delay(delay)
    .reduceMotion(ReduceMotion.System);

export const popEntering =
  (fromScale: number, fromY = 0, delay = 0) =>
  () => {
    "worklet";
    const spring = POP_SPRING;
    return {
      initialValues: {
        opacity: 0,
        transform: [{ translateY: fromY }, { scale: fromScale }],
      },
      animations: {
        opacity: withDelay(
          delay,
          withTiming(1, { duration: 150, reduceMotion: ReduceMotion.System }),
        ),
        transform: [
          { translateY: withDelay(delay, withSpring(0, spring)) },
          { scale: withDelay(delay, withSpring(1, spring)) },
        ],
      },
    };
  };

export const springLayout = LinearTransition.springify()
  .damping(criticalDamping(190))
  .stiffness(190)
  .reduceMotion(ReduceMotion.System);

export function useSpringFlag(
  flag: boolean,
  config: WithSpringConfig = SPRING_SOFT,
): SharedValue<number> {
  const reduced = useReducedMotion();
  const value = useSharedValue(flag ? 1 : 0);
  useEffect(() => {
    const target = flag ? 1 : 0;
    value.value = reduced
      ? withTiming(target, { duration: 0 })
      : withSpring(target, config);
  }, [config, flag, reduced, value]);
  return value;
}

type SpringPressableProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  pressScale?: number;
  children?: ReactNode;
};

export function SpringPressable({
  style,
  containerStyle,
  pressScale = 0.965,
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...rest
}: SpringPressableProps) {
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - pressScale) * pressed.value }],
  }));
  return (
    <Pressable
      {...rest}
      style={containerStyle}
      disabled={disabled}
      onPressIn={(event) => {
        pressed.value = withSpring(1, SPRING_SNAPPY);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressed.value = withSpring(0, SPRING_SOFT);
        onPressOut?.(event);
      }}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
