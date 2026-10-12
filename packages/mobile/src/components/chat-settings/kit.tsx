import { forwardRef, useMemo, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/setup-text-defaults";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { useColors } from "../../theme/theme-context";
import { Icon, type IconName } from "../Icon";

/**
 * The right sidebar's few pieces, so every page in it speaks the left
 * sidebar's language: large bold names with the accent dot on what's chosen,
 * quiet labels, hairlines between sections, text actions, and one filled
 * button for the one thing a page asks for. No cards, no boxes.
 */

export const KIT = {
  gutter: 24,
  switcherHeight: 62,
  rowHeight: 46,
};

export function useKitStyles() {
  const colors = useColors();
  return useMemo(() => makeStyles(colors), [colors]);
}

export function SectionLabel({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  const styles = useKitStyles();
  return (
    <View style={styles.labelRow}>
      <Text
        style={styles.label}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        accessibilityRole="header"
      >
        {children}
      </Text>
      {trailing}
    </View>
  );
}

export function Hairline({ space = 22 }: { space?: number }) {
  const styles = useKitStyles();
  return <View style={[styles.rule, { marginVertical: space }]} />;
}

export function Dot({ size = 8 }: { size?: number }) {
  const colors = useColors();
  return (
    <View
      style={{
        backgroundColor: colors.accent,
        borderRadius: size / 2,
        height: size,
        width: size,
      }}
    />
  );
}

/**
 * The face of a switcher: what is chosen now, large, with the up-down mark
 * that says a tap offers the others.
 */
export function SwitcherFace({
  glyph,
  title,
  detail,
  detailTone = "muted",
  busy,
}: {
  glyph: ReactNode;
  title: string;
  detail?: string;
  detailTone?: "muted" | "ok" | "warning";
  busy?: boolean;
}) {
  const colors = useColors();
  const styles = useKitStyles();
  return (
    <View style={styles.switcher}>
      <View style={styles.glyph}>{glyph}</View>
      <View style={styles.switcherText}>
        <Text
          style={styles.switcherTitle}
          numberOfLines={1}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {title}
        </Text>
        {detail ? (
          <View style={styles.detailLine}>
            {detailTone !== "muted" ? (
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      detailTone === "ok" ? colors.ok : colors.warning,
                  },
                ]}
              />
            ) : null}
            <Text
              style={styles.detail}
              numberOfLines={1}
              maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            >
              {detail}
            </Text>
          </View>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : (
        <Icon
          name="chevrons-up-down"
          size={15}
          color={colors.textMuted}
          weight="semibold"
        />
      )}
    </View>
  );
}

/** A choice in a list: medium weight, muted until chosen. */
export function ChoiceRow({
  label,
  detail,
  selected,
  disabled,
  leading,
  trailing,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  disabled?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const styles = useKitStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: Boolean(selected), disabled }}
      style={({ pressed }) => [
        styles.choice,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {leading ? <View style={styles.choiceLeading}>{leading}</View> : null}
      <View style={styles.choiceText}>
        <View style={styles.choiceLine}>
          <Text
            style={[styles.choiceLabel, selected && styles.choiceChosen]}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {label}
          </Text>
          {selected ? <Dot size={6} /> : null}
        </View>
        {detail ? (
          <Text
            style={styles.choiceDetail}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

export function TextAction({
  label,
  onPress,
  tone = "interactive",
  icon,
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: "interactive" | "muted" | "danger";
  icon?: IconName;
  disabled?: boolean;
}) {
  const colors = useColors();
  const styles = useKitStyles();
  const color =
    tone === "danger"
      ? colors.danger
      : tone === "muted"
        ? colors.textMuted
        : colors.textInteractive;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 10, bottom: 10 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.textAction,
        disabled && styles.disabled,
        pressed && styles.pressedSoft,
      ]}
    >
      <Text
        style={[styles.textActionLabel, { color }]}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {label}
      </Text>
      {icon ? (
        <Icon name={icon} size={13} color={color} weight="semibold" />
      ) : null}
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const colors = useColors();
  const styles = useKitStyles();
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      style={({ pressed }) => [
        styles.primary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.accentForeground} />
      ) : (
        <Text
          style={styles.primaryLabel}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** A field drawn as a line, not a box. */
export const LineField = forwardRef<
  TextInput,
  TextInputProps & { trailing?: ReactNode }
>(function LineField({ trailing, style, ...props }, ref) {
  const colors = useColors();
  const styles = useKitStyles();
  return (
    <View style={styles.field}>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textWeaker}
        selectionColor={colors.accent}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        style={[styles.fieldInput, style]}
        {...props}
      />
      {trailing ? <View style={styles.fieldTrailing}>{trailing}</View> : null}
    </View>
  );
});

export function Note({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "danger";
}) {
  const colors = useColors();
  const styles = useKitStyles();
  return (
    <Text
      style={[styles.note, tone === "danger" && { color: colors.danger }]}
      maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
    >
      {children}
    </Text>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    labelRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      justifyContent: "space-between",
      marginBottom: 4,
      minHeight: 20,
    },
    label: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
    },
    rule: {
      backgroundColor: colors.border,
      height: StyleSheet.hairlineWidth,
      opacity: 0.8,
    },
    switcher: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: KIT.switcherHeight,
    },
    glyph: {
      alignItems: "center",
      height: 30,
      justifyContent: "center",
      width: 30,
    },
    switcherText: {
      flex: 1,
      minWidth: 0,
    },
    switcherTitle: {
      color: colors.text,
      fontFamily: fonts.sans.bold,
      fontSize: 28,
      letterSpacing: -1,
      lineHeight: 34,
    },
    detailLine: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
    },
    statusDot: {
      borderRadius: 3,
      height: 6,
      width: 6,
    },
    detail: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 14,
    },
    choice: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: KIT.rowHeight,
      paddingVertical: 4,
    },
    choiceLeading: {
      alignItems: "center",
      justifyContent: "center",
      width: 24,
    },
    choiceText: {
      flex: 1,
      minWidth: 0,
    },
    choiceLine: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
    },
    choiceLabel: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 18,
      letterSpacing: -0.4,
    },
    choiceChosen: {
      color: colors.text,
    },
    choiceDetail: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      marginTop: 1,
    },
    textAction: {
      alignItems: "center",
      alignSelf: "flex-start",
      flexDirection: "row",
      gap: 5,
      minHeight: 32,
    },
    textActionLabel: {
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
    },
    primary: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 25,
      justifyContent: "center",
      minHeight: 50,
      paddingHorizontal: 22,
      paddingVertical: 10,
    },
    primaryLabel: {
      color: colors.accentForeground,
      textAlign: "center",
      fontFamily: fonts.sans.bold,
      fontSize: 17,
      letterSpacing: -0.2,
    },
    field: {
      alignItems: "center",
      borderBottomColor: colors.borderStrong,
      borderBottomWidth: StyleSheet.hairlineWidth * 2,
      flexDirection: "row",
      gap: 10,
      minHeight: 50,
    },
    fieldTrailing: {
      alignItems: "center",
      justifyContent: "center",
    },
    fieldInput: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 18,
      paddingVertical: 12,
    },
    note: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      lineHeight: 20,
    },
    disabled: {
      opacity: 0.4,
    },
    pressed: {
      opacity: 0.55,
      transform: [{ scale: 0.98 }],
    },
    pressedSoft: {
      opacity: 0.55,
    },
  });
