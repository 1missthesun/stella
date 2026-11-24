import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { useColors } from "../../theme/theme-context";
import { ProviderMark } from "../chat-settings/ProviderMark";
import { Icon } from "../Icon";
import { Text } from "../Text";
import { SIDEBAR_BRAND_ROW } from "./SidebarPanel";

export function PanelPageHeader({
  back,
  onBack,
  title,
  mark,
}: {
  back: string;
  onBack: () => void;
  title: string;
  mark?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={`Back to ${back}`}
        style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
      >
        <Icon
          name="chevron-left"
          size={16}
          color={colors.textMuted}
          weight="semibold"
        />
        <Text
          style={styles.back}
          numberOfLines={1}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {back}
        </Text>
      </Pressable>
      <View style={styles.titleRow}>
        {mark ? <ProviderMark provider={mark} size={28} /> : null}
        <Text
          accessibilityRole="header"
          style={styles.title}
          numberOfLines={2}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {title}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    header: {
      marginBottom: 22,
    },
    backRow: {
      alignItems: "center",
      alignSelf: "flex-start",
      flexDirection: "row",
      gap: 4,
      height: SIDEBAR_BRAND_ROW,
    },
    back: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
    },
    titleRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      marginTop: 6,
    },
    title: {
      color: colors.text,
      flexShrink: 1,
      fontFamily: fonts.sans.bold,
      fontSize: 30,
      letterSpacing: -1,
      lineHeight: 38,
    },
    pressed: {
      opacity: 0.55,
    },
  });
