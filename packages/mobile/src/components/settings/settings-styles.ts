import { StyleSheet } from "react-native";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";

export function settingsSurfaceFills(isDark: boolean) {
  return {
    subtleFill: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.032)",
    tonalFill: isDark ? "rgba(255, 255, 255, 0.09)" : "rgba(0, 0, 0, 0.06)",
    strongFill: isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.09)",
  };
}

export const makeSettingsStyles = (colors: Colors) =>
  StyleSheet.create({
    section: {
      marginTop: 22,
    },
    sectionFirst: {
      marginTop: 4,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      marginBottom: 8,
    },
    group: {
      gap: 4,
    },
    groupGap: {
      marginTop: 18,
    },
    row: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 50,
      paddingVertical: 7,
    },
    rowDivider: {
      marginTop: 2,
    },
    rowPressed: {
      opacity: 0.55,
      transform: [{ scale: 0.985 }],
    },
    rowDisabled: {
      opacity: 0.42,
    },
    rowIcon: {
      alignItems: "center",
      justifyContent: "center",
      width: 24,
    },
    rowCopy: {
      flex: 1,
      gap: 3,
      minWidth: 0,
    },
    rowLabel: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 19,
      letterSpacing: -0.4,
    },
    rowSub: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
      lineHeight: 19,
    },
    rowTrailingWrap: {
      alignItems: "center",
      flexDirection: "row",
      flexShrink: 1,
      gap: 7,
      maxWidth: "46%",
    },
    rowTrailing: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      fontVariant: ["tabular-nums"],
      letterSpacing: -0.2,
    },
    rowAction: {
      color: colors.textInteractive,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15.5,
      letterSpacing: -0.2,
    },
    rowDanger: {
      color: colors.danger,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15.5,
      letterSpacing: -0.2,
    },
    hint: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      lineHeight: 20,
      paddingVertical: 10,
    },
    attentionDot: {
      backgroundColor: colors.accent,
      borderRadius: 3,
      height: 6,
      width: 6,
    },
  });

export type SettingsStyles = ReturnType<typeof makeSettingsStyles>;
