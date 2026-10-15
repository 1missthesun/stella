import { useMemo } from "react";
import { Pressable } from "react-native";
import { Text } from "../Text";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import { dismissUsageLimitCard, useUsageLimitCard } from "../../lib/claude-usage-limit-notice";
import type { Colors } from "../../theme/colors";
import { useT } from "../../i18n";
import { ScheduleCardShell, makeChatCardButtonStyles } from "./ScheduleCardShell";

/** The chat's usage-limit card, in the message list where the paused reply would be. */
export function UsageLimitChatCard({
  conversationId,
  colors,
}: {
  conversationId: string | null | undefined;
  colors: Colors;
}) {
  const t = useT();
  const card = useUsageLimitCard(conversationId);
  const styles = useMemo(() => makeChatCardButtonStyles(colors), [colors]);
  if (!card || !conversationId) return null;
  const resume = card.resume;
  return (
    <ScheduleCardShell
      colors={colors}
      icon="pause"
      iconColor={colors.warning}
      wrap
      headline={card.title}
      status={card.description ?? ""}
      trailing={
        resume ? (
          <Pressable
            accessibilityRole="button"
            onPress={resume}
            style={({ pressed }) => [styles.button, styles.primary, pressed && styles.dimmed]}
          >
            <Text style={[styles.label, styles.primaryLabel]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              Resume
            </Text>
          </Pressable>
        ) : undefined
      }
      onDismiss={() => dismissUsageLimitCard(conversationId)}
      dismissLabel={t("common.close")}
      testID="usage-limit-card"
      accessibilityLabel={[card.title, card.description].filter(Boolean).join(", ")}
    />
  );
}
