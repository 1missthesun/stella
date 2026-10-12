import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { mixSrgb, parseColorOr, toHex, type Rgba } from "@stella/theme";
import type { Colors } from "../theme/colors";
import { useColors, useTheme } from "../theme/theme-context";
import { GlassIconButton } from "./GlassIconButton";
import type { IconName } from "./Icon";
import type { TouchAnchor } from "../lib/touch-anchor";

export const POPOVER_SIDE_MARGIN = 18;
export const POPOVER_MAX_WIDTH = 560;
export const POPOVER_RADIUS = 24;
export const POPOVER_BUTTON_SIZE = 44;
export const POPOVER_FOOTER_PAD = 10;
const POPOVER_FOOTER_GAP = 10;
export const POPOVER_FOOTER_HEIGHT = POPOVER_BUTTON_SIZE + POPOVER_FOOTER_PAD * 2;
const RIM = 1;
const CONFIRM_MS = 1400;

export type PopoverAction = {
  key: string;
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => unknown;
  /** Paint the button as switched on (a dot on its glyph). */
  active?: boolean;
  loading?: boolean;
  disabled?: boolean;
  /** Swap the glyph for a check for a moment after the press settles. */
  confirm?: boolean;
};

export type FloatingPopoverProps = {
  /** Window point the popover points at; the latest tap when omitted. */
  anchor?: TouchAnchor | null;
  /** Where to point when there is neither an anchor nor a recent tap. */
  fallbackAnchor?: TouchAnchor;
  /** Called once the popover has finished going away. */
  onClose: () => void;
  closeLabel: string;
  /** Width of the bubble; defaults to the screen less a margin either side. */
  width?: number;
  /** Fixed bubble height. Without it the bubble hugs its content up to `maxHeight`. */
  height?: number;
  maxHeight?: number;
  actions?: readonly PopoverAction[];
  children: ReactNode | ((close: () => void) => ReactNode);
};

function over(color: string, base: Rgba): Rgba {
  const top = parseColorOr(color);
  const a = top.a;
  return {
    r: top.r * a + base.r * (1 - a),
    g: top.g * a + base.g * (1 - a),
    b: top.b * a + base.b * (1 - a),
    a: 1,
  };
}

/**
 * The assistant bubble's translucent fill, flattened onto the chat
 * background it sits on, so a presented surface can wear the same colour
 * without letting the timeline show through.
 */
export function popoverSurfaceFill(colors: Colors): {
  top: string;
  bottom: string;
  solid: string;
} {
  const base = parseColorOr(colors.background);
  const top = over(colors.assistantBubbleFillTop, base);
  const bottom = over(colors.assistantBubbleFillBottom, base);
  return {
    top: toHex(top),
    bottom: toHex(bottom),
    solid: toHex(mixSrgb(top, bottom, 0.5)),
  };
}

/**
 * A specular rim: brightest along the top edge and its corners, fading down
 * the sides, with a faint catch-light returning at the bottom. Light themes
 * pair a white top highlight with a soft dark edge so the rim still reads on
 * a pale fill.
 */
export function popoverRimColors(isDark: boolean): [string, string, ...string[]] {
  return isDark
    ? [
        "rgba(255,255,255,0.36)",
        "rgba(255,255,255,0.16)",
        "rgba(255,255,255,0.07)",
        "rgba(255,255,255,0.05)",
        "rgba(255,255,255,0.05)",
        "rgba(255,255,255,0.07)",
        "rgba(255,255,255,0.14)",
      ]
    : [
        "rgba(255,255,255,1)",
        "rgba(0,0,0,0.05)",
        "rgba(0,0,0,0.07)",
        "rgba(0,0,0,0.07)",
        "rgba(0,0,0,0.08)",
        "rgba(0,0,0,0.10)",
        "rgba(0,0,0,0.13)",
      ];
}

/**
 * The bubble inside a specular rim, clipping its content: the assistant fill
 * by default, or the app's own background with `fill="background"`.
 */
export function PopoverSurface({
  width,
  height,
  maxHeight,
  fill: fillKind = "assistant",
  children,
  style,
}: {
  width: number;
  height?: number;
  maxHeight?: number;
  fill?: "assistant" | "background";
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const fill =
    fillKind === "background"
      ? {
          top: colors.background,
          bottom: colors.background,
          solid: toHex(parseColorOr(colors.background)),
        }
      : popoverSurfaceFill(colors);
  return (
    <View
      style={[
        styles.surface,
        {
          width,
          backgroundColor: fill.solid,
          ...(height !== undefined ? { height } : {}),
          ...(maxHeight !== undefined ? { maxHeight } : {}),
        },
        style,
      ]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={popoverRimColors(isDark)}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.inner,
          fillKind === "background" ? { backgroundColor: fill.solid } : null,
        ]}
      >
        {fillKind === "background" ? null : (
          <LinearGradient
            pointerEvents="none"
            colors={[fill.top, fill.bottom]}
            style={StyleSheet.absoluteFill}
          />
        )}
        {children}
      </View>
    </View>
  );
}

function ActionButton({ action }: { action: PopoverAction }) {
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
      icon={confirmed ? "check" : action.icon}
      size={POPOVER_BUTTON_SIZE}
      iconSize={18}
      accessibilityLabel={action.accessibilityLabel}
      loading={action.loading}
      disabled={action.disabled}
      dot={action.active ? colors.accent : null}
      onPress={() => {
        void Promise.resolve(action.onPress()).then((result) => {
          if (!action.confirm || result === false) return;
          setConfirmed(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setConfirmed(false), CONFIRM_MS);
        });
      }}
    />
  );
}

/**
 * The popover's footer, inside the same surface as its content: the actions
 * and close, right-aligned and centred in the row.
 */
export function PopoverFooter({
  actions = [],
  closeLabel,
  onClose,
}: {
  actions?: readonly PopoverAction[];
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.footer}>
      {actions.map((action) => (
        <ActionButton key={action.key} action={action} />
      ))}
      <GlassIconButton
        icon="x"
        size={POPOVER_BUTTON_SIZE}
        iconSize={18}
        accessibilityLabel={closeLabel}
        onPress={onClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: POPOVER_RADIUS,
    borderCurve: "continuous",
    overflow: "hidden",
    padding: RIM,
  },
  inner: {
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: POPOVER_RADIUS - RIM,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    gap: POPOVER_FOOTER_GAP,
    justifyContent: "flex-end",
    padding: POPOVER_FOOTER_PAD,
  },
});
