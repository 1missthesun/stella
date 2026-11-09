import { useMemo } from "react";
import { Pressable } from "react-native";
import { Text } from "../Text";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import { useSafeguardCard } from "../../lib/safeguard-notice";
import type { Colors } from "../../theme/colors";
import { ScheduleCardShell, makeChatCardButtonStyles } from "./ScheduleCardShell";

/** The chat's safety-block card, in the message list where the stopped reply would be. */
export function SafeguardChatCard({
  conversationId,
  replying,
  colors,
}: {
  conversationId: string | null | undefined;
  replying: boolean;
  colors: Colors;
}) {
  const card = useSafeguardCard(conversationId);
  const styles = useMemo(() => makeChatCardButtonStyles(colors), [colors]);
  if (!card || !conversationId || replying) return null;
  const { notice, pending } = card;
  const working = pending !== undefined;
  const text = card.problem ?? notice.description;
  return (
    <ScheduleCardShell
      colors={colors}
      icon="alert-circle"
      iconColor={colors.warning}
      wrap
      headline={notice.title}
      status={text}
      actions={
        <>
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            disabled={working}
            onPress={() => card.choose("remove")}
            testID="safeguard-remove"
            style={({ pressed }) => [styles.button, styles.primary, (pressed || working) && styles.dimmed]}
          >
            <Text style={[styles.label, styles.primaryLabel]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              {pending === "remove" ? "Removing…" : notice.remove.label}
            </Text>
          </Pressable>
          {notice.switchTo ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={10}
              disabled={working}
              onPress={() => card.choose("switch")}
              testID="safeguard-switch"
              style={({ pressed }) => [styles.button, (pressed || working) && styles.dimmed]}
            >
              <Text style={styles.label} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                {pending === "switch" ? "Switching…" : notice.switchTo.actionLabel}
              </Text>
            </Pressable>
          ) : null}
          {notice.clear ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={10}
              disabled={working}
              onPress={() => card.choose("clear")}
              testID="safeguard-clear"
              style={({ pressed }) => [styles.button, (pressed || working) && styles.dimmed]}
            >
              <Text style={styles.label} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                {pending === "clear" ? "Starting fresh…" : notice.clear.label}
              </Text>
            </Pressable>
          ) : null}
        </>
      }
      testID="safeguard-card"
      accessibilityLabel={[notice.title, text].join(", ")}
    />
  );
}
