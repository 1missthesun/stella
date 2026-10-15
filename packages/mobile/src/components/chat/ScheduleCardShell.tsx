import { useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Text } from "../Text";
import { Icon, type IconName } from "../Icon";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";

/**
 * A chat card in an assistant bubble: an icon tile in a leading column,
 * centred against the headline and a quiet status line; trailing controls sit
 * at the right end of the status line, and an optional ✕ on the headline row.
 */
export function ScheduleCardShell({
  colors,
  headline,
  status,
  trailing,
  icon = "clock",
  iconColor,
  wrap,
  onDismiss,
  dismissLabel,
  struck,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  colors: Colors;
  headline: string;
  status: string;
  trailing?: ReactNode;
  icon?: IconName;
  iconColor?: string;
  /** Let long text wrap instead of truncating. */
  wrap?: boolean;
  onDismiss?: () => void;
  dismissLabel?: string;
  struck?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const body = (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={[colors.assistantBubbleFillTop, colors.assistantBubbleFillBottom]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.tile}>
        <Icon name={icon} size={17} color={iconColor ?? colors.textMuted} />
      </View>
      <View style={styles.body}>
        <Text
          style={[styles.headline, struck && styles.struck, onDismiss && styles.headlineDismiss]}
          numberOfLines={wrap ? undefined : 1}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {headline}
        </Text>
        {status || trailing ? (
          <View style={styles.meta}>
            <Text style={styles.status} numberOfLines={wrap ? undefined : 1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              {status}
            </Text>
            {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
          </View>
        ) : null}
      </View>
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          hitSlop={8}
          onPress={onDismiss}
          style={styles.dismiss}
        >
          <Icon name="x" size={14} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.card} testID={testID} accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      alignSelf: "flex-start",
      borderCurve: "continuous",
      borderRadius: 18,
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      maxWidth: "100%",
      overflow: "hidden",
      paddingBottom: 9,
      paddingHorizontal: 14,
      paddingTop: 9,
    },
    pressed: { opacity: 0.75 },
    tile: {
      alignItems: "center",
      backgroundColor: colors.muted,
      borderRadius: 10,
      height: 34,
      justifyContent: "center",
      width: 34,
    },
    body: { flexShrink: 1, gap: 1 },
    headlineDismiss: { paddingRight: 24 },
    trailing: { flexShrink: 0 },
    // On the headline row; its visible 14pt icon's right edge = the card's
    // content edge (paddingRight 14), so trailing buttons line up under it.
    dismiss: {
      alignItems: "center",
      height: 24,
      justifyContent: "center",
      position: "absolute",
      right: 9,
      top: 6,
      width: 24,
    },
    headline: {
      color: colors.assistantBubbleText,
      flexShrink: 1,
      fontFamily: fonts.sans.medium,
      fontSize: 17,
      letterSpacing: -0.3,
      lineHeight: 23,
    },
    struck: { color: colors.textMuted, textDecorationLine: "line-through" },
    meta: {
      alignItems: "baseline",
      flexDirection: "row",
      gap: 10,
      justifyContent: "space-between",
      minHeight: 22,
    },
    status: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      fontVariant: ["tabular-nums"],
      letterSpacing: -0.2,
      lineHeight: 20,
    },
  });

/** Chat-card actions: plain text links on the status line, its size, medium weight; the primary in the accent colour, others muted. */
export const makeChatCardButtonStyles = (colors: Colors) =>
  StyleSheet.create({
    actions: { alignItems: "baseline", flexDirection: "row", flexShrink: 0, gap: 14 },
    button: {},
    primary: {},
    dimmed: { opacity: 0.5 },
    label: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
      lineHeight: 20,
    },
    primaryLabel: { color: colors.accent },
  });
