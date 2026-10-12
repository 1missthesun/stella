import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./Icon";
import type { PopoverAction } from "./FloatingPopoverParts";
import type { Colors } from "../theme/colors";
import { useColors } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";

const CONFIRM_MS = 1400;

function HeaderAction({ action }: { action: PopoverAction }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [confirmed, setConfirmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Pressable
      onPress={() => {
        void Promise.resolve(action.onPress()).then((result) => {
          if (!action.confirm || result === false) return;
          setConfirmed(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setConfirmed(false), CONFIRM_MS);
        });
      }}
      disabled={action.disabled || action.loading}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel}
      accessibilityState={{ disabled: Boolean(action.disabled) }}
      hitSlop={10}
      style={({ pressed }) => [
        styles.action,
        (pressed || action.disabled) && styles.actionDimmed,
      ]}
    >
      {action.loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Icon name={confirmed ? "check" : action.icon} size={20} color={colors.text} />
      )}
      {action.active ? <View style={[styles.dot, { backgroundColor: colors.accent }]} /> : null}
    </Pressable>
  );
}

/** The top sheet's title row: back for a folder trail, the name, then the file's actions. */
export function ArtifactSheetHeader({
  title,
  subtitle,
  actions,
  onBack,
}: {
  title: string;
  subtitle: string;
  actions: readonly PopoverAction[];
  onBack?: (() => void) | undefined;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.back, pressed && styles.actionDimmed]}
        >
          <Icon name="chevron-left" size={20} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={styles.subtitle}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions.map((action) => (
        <HeaderAction key={action.key} action={action} />
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    header: {
      alignItems: "center",
      backgroundColor: colors.background,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 8,
      paddingBottom: 12,
      paddingHorizontal: 18,
    },
    back: {
      alignItems: "center",
      justifyContent: "center",
      marginLeft: -6,
      width: 28,
    },
    text: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    subtitle: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
      marginTop: 2,
    },
    action: {
      alignItems: "center",
      height: 32,
      justifyContent: "center",
      marginLeft: 8,
      width: 32,
    },
    actionDimmed: {
      opacity: 0.6,
    },
    dot: {
      borderRadius: 3.5,
      height: 7,
      position: "absolute",
      right: 2,
      top: 3,
      width: 7,
    },
  });
