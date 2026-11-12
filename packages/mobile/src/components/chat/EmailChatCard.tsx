import { memo, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { EmailCard } from "@stella/contracts/email-card";
import { Text } from "../Text";
import { Icon } from "../Icon";
import { useT, useTPlural } from "../../i18n";
import { openEmailDigest } from "../../lib/email";
import { tapLight } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { fadeHex } from "../../theme/oklch";

/**
 * Email in the chat is one tiny row: a count, never the mail itself. Tapping
 * it opens the digest in the top sheet; Stella keeps the list in hidden context.
 */
export const EmailChatCard = memo(function EmailChatCard({ card, colors }: { card: EmailCard; colors: Colors }) {
  const t = useT();
  const tPlural = useTPlural();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const count = card.items.length;
  if (count === 0) return null;
  const urgent = card.kind === "urgent";
  const label = urgent
    ? tPlural("email.row.urgent", count)
    : card.kind === "rule"
      ? tPlural("email.row.asked", count)
      : tPlural("email.row.new", count);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t("email.title")}: ${label}`}
      accessibilityHint={t("email.row.open")}
      testID="email-card"
      hitSlop={6}
      onPress={() => {
        tapLight();
        openEmailDigest(card.cardId);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Icon name="mail" size={13} color={colors.textMuted} />
      {urgent ? <View style={styles.dot} /> : null}
      <Text style={styles.label} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {label}
      </Text>
    </Pressable>
  );
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: {
      alignItems: "center",
      alignSelf: "flex-start",
      borderRadius: 999,
      flexDirection: "row",
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    pressed: { backgroundColor: fadeHex(colors.text, 0.06) },
    dot: { backgroundColor: colors.accent, borderRadius: 3, height: 6, width: 6 },
    label: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
      letterSpacing: -0.1,
    },
  });
