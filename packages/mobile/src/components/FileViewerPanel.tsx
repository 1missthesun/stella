import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
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
import { useBottomObstruction } from "../lib/use-bottom-obstruction";
import { useHoldDrawer } from "../lib/drawer";

const SIDE_MARGIN = 8;
const MAX_WIDTH = 760;
const EDGE_GAP = 8;
export const FILE_VIEWER_MIN_HEIGHT = 140;
const CONFIRM_MS = 1400;
const BUTTON_SIZE = 36;
const FOOTER_PAD = 10;
export const FILE_VIEWER_SURFACE_RIM = 1;
export const COMPOSER_TOP_SLACK = 12;
const RESIZE_TIMING = { duration: 240, easing: Easing.out(Easing.cubic) };

export const fileViewerPanelWidth = (screenWidth: number): number =>
  Math.min(screenWidth - SIDE_MARGIN * 2, MAX_WIDTH);

/**
 * The centred popover reply and task chains open in. It takes `preferredHeight`
 * on its very first frame, so a caller that knows the content's size never
 * shows a max-size frame first; later content changes ease to the new size.
 * Without a preferred height it fills the room between the top of the screen
 * and the composer. The keyboard and the composer shrink that room as they
 * move, on the UI thread, so the popover keeps pace with them frame for frame.
 * `ready={false}` keeps it invisible while the caller measures.
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
  const obstruction = useBottomObstruction(bottomReserve, COMPOSER_TOP_SLACK);
  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  useHoldDrawer(true);

  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [onClose]);

  const bandTop = insets.top + EDGE_GAP;
  const width = fileViewerPanelWidth(screenWidth);
  const wanted =
    preferredHeight === null
      ? -1
      : Math.max(
          FILE_VIEWER_MIN_HEIGHT,
          Math.ceil(preferredHeight + FILE_VIEWER_SURFACE_RIM * 2),
        );

  const preferred = useSharedValue(wanted);
  const shown = useSharedValue(0);
  const visible = ready && origin !== null;
  useEffect(() => {
    if (!visible || shown.value === 0) {
      preferred.value = wanted;
      shown.value = visible ? 1 : 0;
      return;
    }
    preferred.value =
      wanted < 0 || preferred.value < 0 ? wanted : withTiming(wanted, RESIZE_TIMING);
  }, [preferred, shown, visible, wanted]);

  const frame = useDerivedValue(() => {
    const room = Math.max(
      FILE_VIEWER_MIN_HEIGHT,
      screenHeight - bandTop - obstruction.value - EDGE_GAP,
    );
    const height = preferred.value < 0 ? room : Math.min(room, preferred.value);
    return {
      height,
      top: bandTop + Math.max(0, Math.floor((room - height) / 2)),
    };
  });
  const offscreen = -2 * screenHeight;
  const frameStyle = useAnimatedStyle(() => ({
    height: frame.value.height,
    transform: [
      { translateY: shown.value === 1 ? frame.value.top : offscreen },
    ],
  }));
  const keepsComposer = bottomReserve > 0;
  const backdropStyle = useAnimatedStyle(() => ({
    bottom: keepsComposer ? obstruction.value : 0,
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
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        style={[
          styles.backdrop,
          { top: -originY, left: -originX, width: screenWidth },
          backdropStyle,
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

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  closeLabel?: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.footer}>
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
          <FooterButton icon="x" accessibilityLabel={closeLabel ?? "Close"} onPress={onClose} />
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
    flexDirection: "row",
    gap: 8,
    minHeight: BUTTON_SIZE + FOOTER_PAD * 2,
    paddingLeft: 16,
    paddingRight: FOOTER_PAD,
    paddingVertical: FOOTER_PAD,
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
