import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type KeyboardEvent,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OverlayPortal } from "./OverlayHost";
import { PopoverSurface, type PopoverAction } from "./FloatingPopoverParts";
import { GlassIconButton } from "./GlassIconButton";
import type { IconName } from "./Icon";
import { useColors } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";

const SIDE_MARGIN = 8;
const MAX_WIDTH = 760;
const EDGE_GAP = 8;
export const FILE_VIEWER_MIN_HEIGHT = 140;
const CONFIRM_MS = 1400;
const BUTTON_SIZE = 36;
export const FILE_VIEWER_SURFACE_RIM = 1;
const COMPOSER_TOP_SLACK = 12;
const RESIZE_TIMING = { duration: 240, easing: Easing.out(Easing.cubic) };

export const fileViewerPanelWidth = (screenWidth: number): number =>
  Math.min(screenWidth - SIDE_MARGIN * 2, MAX_WIDTH);

export const fileViewerContentWidth = (screenWidth: number): number =>
  fileViewerPanelWidth(screenWidth) - FILE_VIEWER_SURFACE_RIM * 2;

function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = (event: KeyboardEvent) => setHeight(event.endCoordinates.height);
    const hide = () => setHeight(0);
    const subs =
      Platform.OS === "ios"
        ? [
            Keyboard.addListener("keyboardWillShow", show),
            Keyboard.addListener("keyboardWillHide", hide),
          ]
        : [
            Keyboard.addListener("keyboardDidShow", show),
            Keyboard.addListener("keyboardDidHide", hide),
          ];
    return () => {
      for (const sub of subs) sub.remove();
    };
  }, []);
  return height;
}

/**
 * The centred popover files and replies open in. It takes `preferredHeight`
 * on its very first frame, so a caller that knows the content's size never
 * shows a max-size frame first; later changes ease to the new size. Without a
 * preferred height it fills the room between the top of the screen and the
 * composer. `ready={false}` keeps it invisible while the caller measures.
 */
export function FileViewerPanel({
  onClose,
  closeLabel,
  bottomReserve = 0,
  preferredHeight = null,
  ready = true,
  children,
}: {
  onClose: () => void;
  closeLabel: string;
  bottomReserve?: number;
  preferredHeight?: number | null;
  ready?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [onClose]);

  const keyboardLift = Math.max(0, keyboardHeight - insets.bottom);
  const obstruction =
    bottomReserve > 0
      ? Math.max(0, bottomReserve - COMPOSER_TOP_SLACK) + keyboardLift
      : Math.max(insets.bottom, keyboardHeight);
  const bandTop = insets.top + EDGE_GAP;
  const maxHeight = Math.max(
    FILE_VIEWER_MIN_HEIGHT,
    screenHeight - bandTop - obstruction - EDGE_GAP,
  );
  const height =
    preferredHeight === null
      ? maxHeight
      : Math.min(
          maxHeight,
          Math.max(
            FILE_VIEWER_MIN_HEIGHT,
            Math.ceil(preferredHeight + FILE_VIEWER_SURFACE_RIM * 2),
          ),
        );
  const top = bandTop + Math.max(0, Math.floor((maxHeight - height) / 2));
  const width = fileViewerPanelWidth(screenWidth);

  const animatedHeight = useSharedValue(height);
  const animatedTop = useSharedValue(top);
  const shown = useSharedValue(0);
  const visible = ready && origin !== null;
  useEffect(() => {
    if (!visible || shown.value === 0) {
      animatedHeight.value = height;
      animatedTop.value = top;
      shown.value = visible ? 1 : 0;
      return;
    }
    animatedHeight.value = withTiming(height, RESIZE_TIMING);
    animatedTop.value = withTiming(top, RESIZE_TIMING);
  }, [animatedHeight, animatedTop, height, shown, top, visible]);
  const offscreen = -2 * screenHeight;
  const frameStyle = useAnimatedStyle(() => ({
    height: animatedHeight.value,
    transform: [
      { translateY: shown.value === 1 ? animatedTop.value : offscreen },
    ],
  }));

  const originX = origin?.x ?? 0;
  const originY = origin?.y ?? 0;

  const panel = (
    <View
      ref={rootRef}
      pointerEvents="box-none"
      style={styles.root}
      onLayout={() =>
        rootRef.current?.measureInWindow((x, y) =>
          setOrigin((current) =>
            current && current.x === x && current.y === y ? current : { x, y },
          ),
        )
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        style={[
          styles.backdrop,
          {
            top: -originY,
            left: -originX,
            width: screenWidth,
            bottom: bottomReserve > 0 ? obstruction : 0,
          },
        ]}
      />
      <Animated.View
        pointerEvents={visible ? "box-none" : "none"}
        style={[
          styles.panel,
          {
            top: -originY,
            left: (screenWidth - width) / 2 - originX,
            width,
          },
          frameStyle,
        ]}
      >
        <PopoverSurface width={width} fill="background" style={styles.surface}>
          {children}
        </PopoverSurface>
      </Animated.View>
    </View>
  );
  return <OverlayPortal>{panel}</OverlayPortal>;
}

function FooterButton({
  icon,
  accessibilityLabel,
  onPress,
  loading,
  disabled,
  active,
  confirm,
}: {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => unknown;
  loading?: boolean;
  disabled?: boolean;
  active?: boolean;
  confirm?: boolean;
}) {
  const colors = useColors();
  const [confirmed, setConfirmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <GlassIconButton
      icon={confirmed ? "check" : icon}
      size={BUTTON_SIZE}
      iconSize={16}
      accessibilityLabel={accessibilityLabel}
      loading={Boolean(loading)}
      disabled={Boolean(disabled)}
      dot={active ? colors.accent : null}
      onPress={() => {
        void Promise.resolve(onPress()).then((result) => {
          if (!confirm || result === false) return;
          setConfirmed(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setConfirmed(false), CONFIRM_MS);
        });
      }}
    />
  );
}

export function FileViewerFooter({
  name,
  actions,
  onBack,
  onClose,
  closeLabel,
}: {
  name: string;
  actions: readonly PopoverAction[];
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  closeLabel: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.footer, { borderTopColor: colors.border }]}>
      {onBack ? (
        <FooterButton icon="chevron-left" accessibilityLabel="Back" onPress={onBack} />
      ) : null}
      <Text
        style={[styles.name, { color: colors.text }]}
        numberOfLines={1}
        ellipsizeMode="middle"
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {name}
      </Text>
      <View style={styles.actions}>
        {actions.map((action) => (
          <FooterButton
            key={action.key}
            icon={action.icon}
            accessibilityLabel={action.accessibilityLabel}
            onPress={action.onPress}
            {...(action.loading !== undefined ? { loading: action.loading } : {})}
            {...(action.disabled !== undefined ? { disabled: action.disabled } : {})}
            {...(action.active !== undefined ? { active: action.active } : {})}
            {...(action.confirm !== undefined ? { confirm: action.confirm } : {})}
          />
        ))}
        {onClose ? (
          <FooterButton icon="x" accessibilityLabel={closeLabel} onPress={onClose} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
  },
  backdrop: {
    position: "absolute",
  },
  panel: { position: "absolute" },
  surface: {
    flex: 1,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  footer: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 6,
  },
  name: {
    flex: 1,
    fontFamily: fonts.sans.medium,
    fontSize: 14,
    letterSpacing: -0.1,
    minWidth: 0,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
});
