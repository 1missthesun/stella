import { StyleSheet } from "react-native";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";

export function settingsSurfaceFills(isDark: boolean) {
  return {
    subtleFill: isDark ? "rgba(255, 255, 255, 0.048)" : "rgba(0, 0, 0, 0.028)",
    tonalFill: isDark ? "rgba(255, 255, 255, 0.085)" : "rgba(0, 0, 0, 0.055)",
    strongFill: isDark ? "rgba(255, 255, 255, 0.13)" : "rgba(0, 0, 0, 0.085)",
  };
}

export const makeSettingsStyles = (colors: Colors) =>
  StyleSheet.create({
    section: {
      marginTop: 26,
    },
    sectionFirst: {
      marginTop: 18,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12.5,
      letterSpacing: 0.05,
      marginBottom: 8,
    },
    group: {
      borderBottomColor: colors.borderWeak,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderWeak,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    groupGap: {
      marginTop: 14,
    },
    row: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 48,
      paddingVertical: 11,
    },
    rowDivider: {
      borderTopColor: colors.borderWeak,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    rowPressed: {
      opacity: 0.58,
    },
    rowDisabled: {
      opacity: 0.48,
    },
    rowIcon: {
      alignItems: "center",
      justifyContent: "center",
      width: 20,
    },
    rowCopy: {
      flex: 1,
      gap: 2,
      minWidth: 0,
    },
    rowLabel: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    rowSub: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
      lineHeight: 17.5,
    },
    rowTrailingWrap: {
      alignItems: "center",
      flexDirection: "row",
      flexShrink: 1,
      gap: 6,
      maxWidth: "46%",
    },
    rowTrailing: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
      letterSpacing: -0.1,
    },
    rowAction: {
      color: colors.accent,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
      letterSpacing: -0.1,
    },
    rowDanger: {
      color: colors.danger,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
      letterSpacing: -0.1,
    },
    hint: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
      lineHeight: 19,
      paddingVertical: 12,
    },
    attentionDot: {
      backgroundColor: colors.accent,
      borderRadius: 3,
      height: 6,
      width: 6,
    },
  });

export type SettingsStyles = ReturnType<typeof makeSettingsStyles>;
