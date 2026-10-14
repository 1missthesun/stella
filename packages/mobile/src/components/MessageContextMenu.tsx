import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "./Text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "react-native-reanimated";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { Icon, type IconName } from "./Icon";

export type MessageMenuRect = { x: number; y: number; width: number; height: number };

export type MessageMenuAction = {
  id: string;
  label: string;
  icon: IconName;
  onSelect: () => void;
};

const MENU_WIDTH = 250;
const MENU_ITEM_HEIGHT = 48;
const MENU_PADDING = 6;
const MENU_LABEL_MAX_FONT_SCALE = 1.3;
const GAP = 8;
const EDGE = 12;
const MIN_BUBBLE_VIEWPORT = 80;
export const MESSAGE_PRESS_SCALE = 0.96;

export function MessageContextMenu({
  rect,
  side,
  bubble,
  actions,
  colors,
  onDismiss,
}: {
  rect: MessageMenuRect;
  side: "left" | "right";
  bubble: ReactNode;
  actions: readonly MessageMenuAction[];
  colors: Colors;
  onDismiss: () => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    Animated.spring(progress, {
      toValue: 1,
      stiffness: 380,
      damping: 28,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [progress, reducedMotion]);

  const close = useCallback(
    (after?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      after?.();
      Animated.timing(progress, {
        toValue: 0,
        duration: reducedMotion ? 0 : 160,
        useNativeDriver: true,
      }).start(() => onDismiss());
    },
    [onDismiss, progress, reducedMotion],
  );

  const screen = Dimensions.get("window");
  const top = insets.top + EDGE;
  const bottom = screen.height - Math.max(insets.bottom, EDGE) - EDGE;
  const menuHeight = MENU_PADDING * 2 + actions.length * MENU_ITEM_HEIGHT;
  const room = Math.max(MIN_BUBBLE_VIEWPORT, bottom - top - menuHeight - GAP);
  const viewportHeight = Math.min(rect.height, room);
  const scrolls = rect.height > viewportHeight;
  const bubbleTop = Math.max(
    top,
    Math.min(rect.y, bottom - menuHeight - GAP - viewportHeight),
  );
  const initialOffset = scrolls
    ? Math.min(Math.max(0, bubbleTop - rect.y), rect.height - viewportHeight)
    : 0;
  const startShift = rect.y + initialOffset - bubbleTop;
  const menuLeft =
    side === "left"
      ? Math.max(EDGE, Math.min(rect.x, screen.width - MENU_WIDTH - EDGE))
      : Math.max(EDGE, Math.min(rect.x + rect.width, screen.width - EDGE) - MENU_WIDTH);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [startShift, 0],
  });
  const bubbleStyle = {
    left: rect.x,
    top: bubbleTop,
    width: rect.width,
    height: viewportHeight,
    transformOrigin: side === "left" ? "bottom left" : "bottom right",
    transform: scrolls
      ? [{ translateY }]
      : [
          { translateY },
          {
            scale: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [MESSAGE_PRESS_SCALE, 1],
            }),
          },
        ],
  };
  const menuStyle = {
    left: menuLeft,
    top: bubbleTop + viewportHeight + GAP,
    width: MENU_WIDTH,
    height: menuHeight,
    opacity: progress,
    transformOrigin: side === "left" ? "top left" : "top right",
    transform: [
      {
        scale: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.5, 1],
        }),
      },
    ],
  };

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => close()}
    >
      <Animated.View pointerEvents="none" style={[styles.scrim, { opacity: progress }]} />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => close()}
        accessibilityRole="button"
        accessibilityLabel="Dismiss menu"
      />
      <Animated.View
        style={[styles.bubble, bubbleStyle]}
        shouldRasterizeIOS={!scrolls}
        renderToHardwareTextureAndroid={!scrolls}
      >
        <ScrollView
          style={styles.bubbleViewport}
          contentOffset={{ x: 0, y: initialOffset }}
          scrollEnabled={scrolls}
          showsVerticalScrollIndicator={scrolls}
          bounces={scrolls}
          overScrollMode={scrolls ? "auto" : "never"}
        >
          <Pressable onPress={() => close()} accessible={false}>
            <View pointerEvents="none">{bubble}</View>
          </Pressable>
        </ScrollView>
      </Animated.View>
      <Animated.View style={[styles.menu, menuStyle]}>
        {actions.map((action) => (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => close(action.onSelect)}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          >
            <Icon name={action.icon} size={21} color={colors.text} style={styles.itemIcon} />
            <Text
              style={styles.itemLabel}
              numberOfLines={1}
              maxFontSizeMultiplier={MENU_LABEL_MAX_FONT_SCALE}
            >
              {action.label}
            </Text>
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },
    bubble: {
      position: "absolute",
    },
    bubbleViewport: {
      flex: 1,
    },
    menu: {
      position: "absolute",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 22,
      borderCurve: "continuous",
      overflow: "hidden",
      paddingVertical: MENU_PADDING - StyleSheet.hairlineWidth,
    },
    item: {
      alignItems: "center",
      flexDirection: "row",
      gap: 14,
      height: MENU_ITEM_HEIGHT,
      paddingHorizontal: 20,
    },
    itemPressed: { backgroundColor: fadeHex(colors.text, 0.08) },
    itemIcon: { width: 24 },
    itemLabel: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 17,
      letterSpacing: -0.3,
    },
  });
