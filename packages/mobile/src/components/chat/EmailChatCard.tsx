import { memo, useMemo } from "react";
import { Pressable, StyleSheet } from "react-native";
import type { EmailCard } from "@stella/contracts/email-card";
import { Text } from "../Text";
import { Icon } from "../Icon";
import { useT, useTPlural } from "../../i18n";
import { openEmailDigest } from "../../lib/email";
import { tapLight } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";

/**
 * Email in the chat is one row the size of a reply: a mail icon and how much
 * came in, never the mail itself. Tapping it opens the briefing in the top
 * sheet; Stella keeps the list in hidden context.
 */
export const EmailChatCard = memo(function EmailChatCard({ card, colors }: { card: EmailCard; colors: Colors }) {
  const t = useT();
  const tPlural = useTPlural();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const count = card.items.length;
  if (count === 0) return null;
  const urgent = card.items.filter((item) => item.bucket === "urgent").length;
  const label =
    card.kind === "rule"
      ? tPlural("email.row.askedEmails", count)
      : card.kind === "urgent"
        ? tPlural("email.row.urgentEmails", count)
        : urgent > 0
          ? `${tPlural("email.row.urgent", urgent)} · ${tPlural("email.row.newEmails", count)}`
          : tPlural("email.row.newEmails", count);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t("email.title")}: ${label}`}
      accessibilityHint={t("email.row.open")}
      testID="email-card"
      onPress={() => {
        tapLight();
        openEmailDigest(card.cardId);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Icon name="mail" size={18} color={card.kind === "urgent" || urgent > 0 ? colors.accent : colors.textMuted} />
      <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
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
      backgroundColor: colors.assistantBubbleFillTop,
      borderCurve: "continuous",
      borderRadius: 18,
      flexDirection: "row",
      gap: 9,
      marginVertical: 2,
      maxWidth: "100%",
      paddingLeft: 12,
      paddingRight: 15,
      paddingVertical: 9,
    },
    pressed: { opacity: 0.7 },
    label: {
      color: colors.assistantBubbleText,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 17,
      letterSpacing: 0.03 * 17,
      lineHeight: 17 * 1.52,
    },
  });
