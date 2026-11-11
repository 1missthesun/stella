import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { useDrawerSwipeGesture } from "./sidebar/DrawerStage";

const FADE = 22;
const CLEAR = "rgba(0,0,0,0)";
const SOLID = "#000";

export type SideScrollerProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  showsIndicator?: boolean;
  fade?: boolean;
  accessibilityLabel?: string;
  onContentSizeChange?: (width: number, height: number) => void;
  onScrollX?: (x: number, viewportWidth: number) => void;
  scrollXStep?: number;
};

/**
 * Sideways scrolling for content inside a chat message (tables, code, media
 * rows). While its content is wider than it, a drag that starts on it scrolls
 * it and the page's sidebar swipe waits for that scroll to fail, so the
 * sidebars never move from it, even when the content is already at an edge.
 * Content that fits takes no swipes at all.
 */
export function SideScroller({
  children,
  style,
  contentContainerStyle,
  showsIndicator = false,
  fade = true,
  accessibilityLabel,
  onContentSizeChange,
  onScrollX,
  scrollXStep = 24,
}: SideScrollerProps) {
  const drawerSwipe = useDrawerSwipeGesture();
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const overflows = viewport > 0 && content > viewport + 1;

  const x = useSharedValue(0);
  const room = useSharedValue(0);
  const reported = useSharedValue(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    x.value = 0;
    reported.value = Number.NEGATIVE_INFINITY;
  }, [overflows, x, reported]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const width = event.nativeEvent.layout.width;
      setViewport(width);
      room.value = Math.max(0, content - width);
    },
    [content, room],
  );
  const onContentSize = useCallback(
    (width: number, height: number) => {
      setContent(width);
      room.value = Math.max(0, width - viewport);
      onContentSizeChange?.(width, height);
    },
    [onContentSizeChange, room, viewport],
  );

  const scrollHandler = useAnimatedScrollHandler(
    {
      onScroll: (event) => {
        x.value = event.contentOffset.x;
        if (
          onScrollX &&
          Math.abs(event.contentOffset.x - reported.value) >= scrollXStep
        ) {
          reported.value = event.contentOffset.x;
          runOnJS(onScrollX)(
            event.contentOffset.x,
            event.layoutMeasurement.width,
          );
        }
      },
    },
    [onScrollX, scrollXStep],
  );

  const native = useMemo(() => {
    const gesture = Gesture.Native()
      .enabled(overflows)
      .disallowInterruption(true)
      .shouldCancelWhenOutside(false);
    return overflows && drawerSwipe
      ? gesture.blocksExternalGesture(drawerSwipe)
      : gesture;
  }, [overflows, drawerSwipe]);

  const scroller = (
    <GestureDetector gesture={native}>
      <Animated.ScrollView
        horizontal
        scrollEnabled={overflows}
        directionalLockEnabled
        bounces={overflows}
        alwaysBounceHorizontal={false}
        alwaysBounceVertical={false}
        nestedScrollEnabled
        overScrollMode={overflows ? "auto" : "never"}
        decelerationRate="normal"
        showsHorizontalScrollIndicator={showsIndicator}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        onLayout={onLayout}
        onContentSizeChange={onContentSize}
        contentContainerStyle={contentContainerStyle}
        accessibilityLabel={accessibilityLabel}
        style={styles.scroller}
      >
        {children}
      </Animated.ScrollView>
    </GestureDetector>
  );

  if (!overflows || !fade) return <View style={style}>{scroller}</View>;
  return (
    <MaskedView style={style} maskElement={<EdgeMask x={x} room={room} />}>
      {scroller}
    </MaskedView>
  );
}

function EdgeMask({
  x,
  room,
}: {
  x: SharedValue<number>;
  room: SharedValue<number>;
}) {
  const startSolid = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, FADE], [1, 0], Extrapolation.CLAMP),
  }));
  const endSolid = useAnimatedStyle(() => ({
    opacity: interpolate(
      room.value - x.value,
      [0, FADE],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <View style={styles.mask}>
      <View style={styles.edge}>
        <LinearGradient
          colors={[CLEAR, SOLID]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View style={[styles.solid, startSolid]} />
      </View>
      <View style={styles.middle} />
      <View style={styles.edge}>
        <LinearGradient
          colors={[SOLID, CLEAR]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View style={[styles.solid, endSolid]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroller: { flexGrow: 0 },
  mask: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
  },
  edge: { width: FADE },
  middle: { flex: 1, backgroundColor: SOLID },
  solid: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: SOLID,
  },
});
