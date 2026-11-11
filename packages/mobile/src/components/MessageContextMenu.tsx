import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  Dimensions,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
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
  selectsText?: boolean;
};

const MENU_WIDTH = 250;
const MENU_ITEM_HEIGHT = 48;
const MENU_PADDING = 6;
const MENU_LABEL_MAX_FONT_SCALE = 1.3;
const GAP = 8;
const EDGE = 12;
const MIN_BUBBLE_VIEWPORT = 80;
const BUBBLE_RADIUS = 18;
const EDGE_FADE = 28;
const OUTSIDE_ROOM = 72;
const REPLY_PILL_HEIGHT = 40;
const MIN_SELECT_HEIGHT = 120;
const CLEAR = "rgba(0,0,0,0)";
const SOLID = "#000";
const SELECT_LAYOUT = LayoutAnimation.create(
  200,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
);
export const MESSAGE_PRESS_SCALE = 0.96;

export function MessageContextMenu({
  rect,
  side,
  bubble,
  selectableText,
  actions,
  colors,
  onReplyWithText,
  onDismiss,
}: {
  rect: MessageMenuRect;
  side: "left" | "right";
  bubble: ReactNode;
  selectableText: string;
  actions: readonly MessageMenuAction[];
  colors: Colors;
  onReplyWithText?: (text: string) => void;
  onDismiss: () => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const menuShown = useRef(new Animated.Value(1)).current;
  const closingRef = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const [textHeight, setTextHeight] = useState<number | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });

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

  const startSelecting = useCallback(() => {
    if (!reducedMotion) LayoutAnimation.configureNext(SELECT_LAYOUT);
    Animated.timing(menuShown, {
      toValue: 0,
      duration: reducedMotion ? 0 : 140,
      useNativeDriver: true,
    }).start();
    setSelecting(true);
  }, [menuShown, reducedMotion]);

  const onTextHeight = useCallback(
    (height: number) => {
      setTextHeight((current) => {
        if (current !== null && Math.abs(current - height) < 1) return current;
        if (!reducedMotion) LayoutAnimation.configureNext(SELECT_LAYOUT);
        return height;
      });
    },
    [reducedMotion],
  );

  const replyWithSelection = useCallback(() => {
    if (!onReplyWithText) return;
    const { start, end } = selectionRef.current;
    const picked = selectableText.slice(Math.min(start, end), Math.max(start, end));
    const text = picked.trim() ? picked : selectableText;
    close(() => onReplyWithText(text));
  }, [close, onReplyWithText, selectableText]);

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
  const alignLeft = (width: number) =>
    side === "left"
      ? Math.max(EDGE, Math.min(rect.x, screen.width - width - EDGE))
      : Math.max(EDGE, Math.min(rect.x + rect.width, screen.width - EDGE) - width);

  const canReplyWithSelection = Platform.OS === "ios" && onReplyWithText != null;
  const replyRoom = canReplyWithSelection ? REPLY_PILL_HEIGHT + GAP : 0;
  const selectMaxHeight = Math.max(
    MIN_SELECT_HEIGHT,
    bottom - top - replyRoom - OUTSIDE_ROOM,
  );
  const selectHeight = Math.min(textHeight ?? viewportHeight, selectMaxHeight);
  const selectTop = Math.max(
    top,
    Math.min(bubbleTop, bottom - replyRoom - selectHeight),
  );

  // Text laid out again at the measured (fractional) width can wrap one word
  // early on Android, so the lifted copy gets a pixel of slack on its far side.
  const bubbleWidth = Math.ceil(rect.width) + 1;
  const bubbleLeft = side === "left" ? rect.x : rect.x + rect.width - bubbleWidth;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [startShift, 0],
  });
  const fill = side === "left" ? "assistant" : "user";
  const bubbleStyle = selecting
    ? {
        left: bubbleLeft,
        top: selectTop,
        width: bubbleWidth,
        height: selectHeight,
        opacity: progress,
      }
    : {
        left: bubbleLeft,
        top: bubbleTop,
        width: bubbleWidth,
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
    left: alignLeft(MENU_WIDTH),
    top: bubbleTop + viewportHeight + GAP,
    width: MENU_WIDTH,
    height: menuHeight,
    opacity: Animated.multiply(progress, menuShown),
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
        accessibilityLabel={selecting ? "Stop selecting text" : "Dismiss menu"}
      />
      <Animated.View
        style={[styles.bubble, bubbleStyle]}
        shouldRasterizeIOS={!scrolls && !selecting}
        renderToHardwareTextureAndroid={!scrolls && !selecting}
      >
        {selecting ? (
          <View style={[styles.clip, fill === "user" && styles.userFill]}>
            {fill === "assistant" ? <AssistantFill colors={colors} /> : null}
            <SelectableBody
              text={selectableText}
              tone={fill}
              colors={colors}
              styles={styles}
              viewportHeight={selectHeight}
              onTextHeight={onTextHeight}
              onSelection={(selection) => {
                selectionRef.current = selection;
              }}
            />
          </View>
        ) : (
          <MenuBubble
            scrolls={scrolls}
            fill={fill}
            colors={colors}
            styles={styles}
            initialOffset={initialOffset}
            room={rect.height - viewportHeight}
            onPress={() => close()}
          >
            {bubble}
          </MenuBubble>
        )}
      </Animated.View>
      {selecting && canReplyWithSelection ? (
        <Animated.View
          style={[
            styles.replyPill,
            { top: selectTop + selectHeight + GAP, opacity: progress },
            side === "left" ? { left: alignLeft(0) } : { right: screen.width - alignLeft(0) },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reply with selected text"
            onPress={replyWithSelection}
            style={({ pressed }) => [styles.replyButton, pressed && styles.itemPressed]}
          >
            <Icon name="reply" size={18} color={colors.text} />
            <Text style={styles.replyLabel} maxFontSizeMultiplier={MENU_LABEL_MAX_FONT_SCALE}>
              Reply
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
      <Animated.View
        pointerEvents={selecting ? "none" : "auto"}
        style={[styles.menu, menuStyle]}
      >
        {actions.map((action) => (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => {
              if (action.selectsText) {
                action.onSelect();
                startSelecting();
              } else {
                close(action.onSelect);
              }
            }}
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

type MenuStyles = ReturnType<typeof makeStyles>;

function MenuBubble({
  scrolls,
  fill,
  colors,
  styles,
  initialOffset,
  room,
  onPress,
  children,
}: {
  scrolls: boolean;
  fill: "assistant" | "user";
  colors: Colors;
  styles: MenuStyles;
  initialOffset: number;
  room: number;
  onPress: () => void;
  children: ReactNode;
}) {
  const y = useSharedValue(initialOffset);
  const roomValue = useSharedValue(room);
  useEffect(() => {
    roomValue.value = room;
  }, [room, roomValue]);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      y.value = event.contentOffset.y;
    },
  });
  return (
    <View style={[styles.clip, scrolls && fill === "user" && styles.userFill]}>
      {scrolls && fill === "assistant" ? <AssistantFill colors={colors} /> : null}
      <EdgeFade enabled={scrolls} y={y} room={roomValue}>
        <Reanimated.ScrollView
          style={styles.fill}
          contentOffset={{ x: 0, y: initialOffset }}
          scrollEnabled={scrolls}
          showsVerticalScrollIndicator={scrolls}
          bounces={scrolls}
          overScrollMode={scrolls ? "auto" : "never"}
          scrollEventThrottle={16}
          onScroll={onScroll}
        >
          <Pressable onPress={onPress} accessible={false}>
            <View pointerEvents="none">{children}</View>
          </Pressable>
        </Reanimated.ScrollView>
      </EdgeFade>
    </View>
  );
}

type SelectableBodyProps = {
  text: string;
  tone: "assistant" | "user";
  colors: Colors;
  styles: MenuStyles;
  viewportHeight: number;
  onTextHeight: (height: number) => void;
  onSelection: (selection: { start: number; end: number }) => void;
};

function SelectableBody({
  text,
  tone,
  colors,
  styles,
  viewportHeight,
  onTextHeight,
  onSelection,
}: SelectableBodyProps) {
  const [contentHeight, setContentHeight] = useState(0);
  const y = useSharedValue(0);
  const room = useSharedValue(0);
  useEffect(() => {
    room.value = Math.max(0, contentHeight - viewportHeight);
  }, [contentHeight, viewportHeight, room]);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      y.value = event.contentOffset.y;
    },
  });
  const tint = tone === "user" ? colors.userBubbleText : colors.accent;
  const textStyle = [
    styles.selectText,
    tone === "user" ? styles.selectTextUser : styles.selectTextAssistant,
    { color: tone === "user" ? colors.userBubbleText : colors.assistantBubbleText },
  ];
  return (
    <EdgeFade enabled y={y} room={room}>
      <Reanimated.ScrollView
        style={styles.fill}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onContentSizeChange={(_width, height) => {
          setContentHeight(Math.ceil(height));
          onTextHeight(Math.ceil(height));
        }}
      >
        {Platform.OS === "ios" ? (
          // A non-editable text view keeps iOS's handles and its read-only
          // Copy / Look Up / Share callout and reports the selection.
          <TextInput
            value={text}
            editable={false}
            multiline
            scrollEnabled={false}
            caretHidden
            onSelectionChange={(
              event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
            ) => onSelection(event.nativeEvent.selection)}
            selectionColor={tint}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            accessibilityLabel="Message text, selectable"
            style={textStyle}
          />
        ) : (
          <Text
            selectable
            selectionColor={fadeHex(tint, 0.32)}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            accessibilityLabel="Message text, selectable"
            style={textStyle}
          >
            {text}
          </Text>
        )}
      </Reanimated.ScrollView>
    </EdgeFade>
  );
}

function AssistantFill({ colors }: { colors: Colors }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[colors.assistantBubbleFillTop, colors.assistantBubbleFillBottom]}
      style={StyleSheet.absoluteFill}
    />
  );
}

function EdgeFade({
  enabled,
  y,
  room,
  children,
}: {
  enabled: boolean;
  y: SharedValue<number>;
  room: SharedValue<number>;
  children: ReactNode;
}) {
  if (!enabled) return <View style={fadeStyles.fill}>{children}</View>;
  return (
    <MaskedView style={fadeStyles.fill} maskElement={<EdgeMask y={y} room={room} />}>
      {children}
    </MaskedView>
  );
}

function EdgeMask({
  y,
  room,
}: {
  y: SharedValue<number>;
  room: SharedValue<number>;
}) {
  const topSolid = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, EDGE_FADE], [1, 0], Extrapolation.CLAMP),
  }));
  const bottomSolid = useAnimatedStyle(() => ({
    opacity: interpolate(
      room.value - y.value,
      [0, EDGE_FADE],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <View style={fadeStyles.mask}>
      <View style={fadeStyles.edge}>
        <LinearGradient colors={[CLEAR, SOLID]} style={StyleSheet.absoluteFill} />
        <Reanimated.View style={[fadeStyles.solid, topSolid]} />
      </View>
      <View style={fadeStyles.middle} />
      <View style={fadeStyles.edge}>
        <LinearGradient colors={[SOLID, CLEAR]} style={StyleSheet.absoluteFill} />
        <Reanimated.View style={[fadeStyles.solid, bottomSolid]} />
      </View>
    </View>
  );
}

const fadeStyles = StyleSheet.create({
  fill: { flex: 1 },
  mask: { ...StyleSheet.absoluteFill, flexDirection: "column" },
  edge: { height: EDGE_FADE },
  middle: { flex: 1, marginVertical: -1, backgroundColor: SOLID },
  solid: { ...StyleSheet.absoluteFill, backgroundColor: SOLID },
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },
    bubble: {
      position: "absolute",
    },
    clip: {
      flex: 1,
      borderRadius: BUBBLE_RADIUS,
      borderCurve: "continuous",
      overflow: "hidden",
    },
    fill: { flex: 1 },
    userFill: { backgroundColor: colors.userBubbleFill },
    selectText: {
      margin: 0,
      paddingHorizontal: 14,
      fontFamily: fonts.sans.regular,
      fontSize: 17,
      backgroundColor: "transparent",
    },
    selectTextAssistant: {
      paddingTop: 9,
      paddingBottom: 10,
      lineHeight: 24,
    },
    selectTextUser: {
      paddingVertical: 6,
      letterSpacing: 0.03 * 17,
      lineHeight: 17 * 1.52,
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
    replyPill: {
      position: "absolute",
      height: REPLY_PILL_HEIGHT,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: REPLY_PILL_HEIGHT / 2,
      overflow: "hidden",
    },
    replyButton: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      height: "100%",
      paddingHorizontal: 16,
    },
    replyLabel: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
    },
  });
