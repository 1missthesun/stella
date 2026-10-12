import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BackHandler,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type KeyboardEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TOP_BAR_BAR_HEIGHT } from "./AppBackdrop";
import { PopoverSurface, type PopoverAction } from "./FloatingPopoverParts";
import { GlassIconButton } from "./GlassIconButton";
import type { IconName } from "./Icon";
import { useColors } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";

const SIDE_MARGIN = 8;
const MAX_WIDTH = 760;
const EDGE_GAP = 8;
const MIN_HEIGHT = 140;
const CONFIRM_MS = 1400;
const BUTTON_SIZE = 36;
const SURFACE_RIM = 1;

function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const apply = (next: number, duration?: number) => {
      LayoutAnimation.configureNext({
        duration: duration && duration > 0 ? duration : 250,
        update: { type: LayoutAnimation.Types.keyboard },
      });
      setHeight(next);
    };
    const show = (event: KeyboardEvent) =>
      apply(event.endCoordinates.height, event.duration);
    const hide = (event: KeyboardEvent) => apply(0, event?.duration);
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

export function FileViewerPanel({
  onClose,
  closeLabel,
  bottomReserve = 0,
  preferredHeight = null,
  children,
}: {
  onClose: () => void;
  closeLabel: string;
  bottomReserve?: number;
  preferredHeight?: number | null;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

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
      ? bottomReserve + keyboardLift
      : Math.max(insets.bottom, keyboardHeight);
  const bandTop = insets.top + TOP_BAR_BAR_HEIGHT + EDGE_GAP;
  const maxHeight = Math.max(MIN_HEIGHT, screenHeight - bandTop - obstruction - EDGE_GAP);
  const height =
    preferredHeight === null
      ? maxHeight
      : Math.min(maxHeight, Math.max(MIN_HEIGHT, Math.ceil(preferredHeight + SURFACE_RIM * 2)));
  const top = bandTop + Math.max(0, Math.floor((maxHeight - height) / 2));
  const width = Math.min(screenWidth - SIDE_MARGIN * 2, MAX_WIDTH);

  return (
    <View
      ref={rootRef}
      pointerEvents="box-none"
      style={styles.root}
      onLayout={() =>
        rootRef.current?.measureInWindow((x, y) =>
          setOrigin((current) =>
            current.x === x && current.y === y ? current : { x, y },
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
            top: -origin.y,
            left: -origin.x,
            width: screenWidth,
            bottom: bottomReserve > 0 ? obstruction : 0,
          },
        ]}
      />
      <View
        pointerEvents="box-none"
        style={[
          styles.panel,
          {
            top: top - origin.y,
            left: (screenWidth - width) / 2 - origin.x,
            width,
            height,
          },
        ]}
      >
        <PopoverSurface width={width} height={height} style={styles.shadow}>
          {children}
        </PopoverSurface>
      </View>
    </View>
  );
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
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  panel: { position: "absolute" },
  shadow: {
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
