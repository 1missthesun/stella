import { StyleSheet } from "react-native";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { fadeHex } from "../../theme/oklch";

export const makeSettingsStyles = (colors: Colors) =>
  StyleSheet.create({
    section: {
      marginTop: 28,
    },
    sectionLabel: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 20,
      letterSpacing: -0.4,
      marginBottom: 8,
    },
    group: {
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    groupGap: {
      marginTop: 12,
    },
    row: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 52,
      paddingVertical: 12,
    },
    rowDivider: {
      borderTopColor: fadeHex(colors.border, 0.8),
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    rowPressed: {
      opacity: 0.6,
    },
    rowDisabled: {
      opacity: 0.55,
    },
    rowIcon: {
      width: 22,
    },
    rowCopy: {
      flex: 1,
      gap: 2,
    },
    rowLabel: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    rowSub: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    rowTrailing: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      letterSpacing: -0.1,
      maxWidth: 150,
    },
    rowAction: {
      color: colors.accent,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      letterSpacing: -0.1,
    },
    rowDanger: {
      color: colors.danger,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      letterSpacing: -0.1,
    },
    hint: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 20,
      paddingVertical: 14,
    },
  });

export type SettingsStyles = ReturnType<typeof makeSettingsStyles>;
