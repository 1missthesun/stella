import { useMemo } from "react";
import { StyleSheet } from "react-native";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors } from "../theme/theme-context";

export function useAiryList() {
  const colors = useColors();
  return useMemo(() => makeAiryList(colors), [colors]);
}

export type AiryListStyles = ReturnType<typeof makeAiryList>;

const makeAiryList = (colors: Colors) =>
  StyleSheet.create({
    section: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      paddingBottom: 6,
      paddingTop: 30,
    },
    sectionFirst: {
      paddingTop: 14,
    },
    row: {
      alignItems: "center",
      flexDirection: "row",
      gap: 16,
      minHeight: 60,
      paddingVertical: 9,
    },
    pressed: {
      opacity: 0.55,
      transform: [{ scale: 0.985 }],
    },
    copy: {
      flex: 1,
      gap: 2,
      minWidth: 0,
    },
    title: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 19,
      letterSpacing: -0.4,
      lineHeight: 25,
    },
    quiet: {
      color: colors.textMuted,
    },
    detail: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      lineHeight: 20,
    },
    danger: {
      color: colors.danger,
    },
    trailing: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      fontVariant: ["tabular-nums"],
      letterSpacing: -0.2,
    },
  });
