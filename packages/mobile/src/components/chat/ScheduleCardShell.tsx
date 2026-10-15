import { useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Text } from "../Text";
import { Icon } from "../Icon";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";

/** Two rows in an assistant bubble: a clock and the headline, then a quiet status line with optional trailing controls; an optional footer (action row) sits under them at the status indent. */
export function ScheduleCardShell({
  colors,
  headline,
  status,
  trailing,
  footer,
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
  footer?: ReactNode;
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
      <View style={styles.row}>
        <Icon name="clock" size={15} color={colors.textMuted} />
        <Text
          style={[styles.headline, struck && styles.struck]}
          numberOfLines={1}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {headline}
        </Text>
      </View>
      <View style={styles.meta}>
        <Text style={styles.status} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {status}
        </Text>
        {trailing}
      </View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
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
      gap: 1,
      maxWidth: "100%",
      overflow: "hidden",
      paddingBottom: 9,
      paddingHorizontal: 14,
      paddingTop: 9,
    },
    pressed: { opacity: 0.75 },
    row: { alignItems: "center", flexDirection: "row", gap: 6 },
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
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      justifyContent: "space-between",
      minHeight: 22,
      paddingLeft: 21,
    },
    footer: { marginTop: 6, paddingLeft: 21 },
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
