import { StyleSheet } from "react-native";
import { type Colors } from "../../theme/colors";
import { fadeHex } from "../../theme/oklch";
import { fonts } from "../../theme/fonts";

/** Shared look for the server screens (welcome, connect, update gates). */
export const makeSelfHostStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flexGrow: 1,
      paddingHorizontal: 28,
      paddingBottom: 24,
      gap: 14,
    },
    hero: {
      flexGrow: 1,
      minHeight: 200,
      paddingVertical: 24,
      justifyContent: "center",
      gap: 14,
    },
    title: {
      color: colors.text,
      fontFamily: fonts.display.semiBold,
      fontSize: 32,
      letterSpacing: -1.6,
      lineHeight: 38,
    },
    body: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 17,
      letterSpacing: -0.3,
      lineHeight: 24,
    },
    small: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 20,
    },
    primaryButton: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 14,
      paddingVertical: 17,
      paddingHorizontal: 18,
    },
    primaryButtonPressed: {
      backgroundColor: colors.accentHover,
    },
    primaryButtonText: {
      color: colors.accentForeground,
      fontFamily: fonts.sans.semiBold,
      fontSize: 17,
      letterSpacing: -0.3,
    },
    secondaryButton: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: "row",
      gap: 10,
      justifyContent: "center",
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    secondaryButtonPressed: {
      backgroundColor: fadeHex(colors.textMuted, 0.08),
    },
    secondaryButtonText: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 17,
      letterSpacing: -0.3,
    },
    buttonHint: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      marginTop: 2,
    },
    disabled: {
      opacity: 0.55,
    },
    textLink: {
      alignItems: "center",
      paddingVertical: 14,
    },
    textLinkPressed: {
      opacity: 0.6,
    },
    textLinkText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    input: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: 1,
      color: colors.text,
      fontFamily: fonts.mono.regular,
      fontSize: 14,
      minHeight: 52,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    inputRow: {
      flexDirection: "row",
      gap: 10,
      alignItems: "stretch",
    },
    label: {
      color: colors.textMuted,
      fontFamily: fonts.mono.regular,
      fontSize: 11,
      letterSpacing: 0,
      textTransform: "uppercase",
      marginTop: 8,
    },
    errorText: {
      color: colors.danger,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 21,
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      padding: 18,
      gap: 12,
    },
    detailRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 16,
    },
    detailLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
    },
    detailValue: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      flexShrink: 1,
      textAlign: "right",
    },
    camera: {
      aspectRatio: 1,
      borderRadius: 22,
      overflow: "hidden",
      backgroundColor: "#000000",
    },
    cameraFill: {
      flex: 1,
    },
    notice: {
      flexDirection: "row",
      gap: 10,
      alignItems: "flex-start",
      backgroundColor: fadeHex(colors.textMuted, 0.08),
      borderRadius: 14,
      padding: 14,
    },
    noticeText: {
      flex: 1,
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 21,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      minHeight: 48,
    },
  } as const);

export type SelfHostStyles = ReturnType<typeof makeSelfHostStyles>;
