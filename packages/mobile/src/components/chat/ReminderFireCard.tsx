import { memo, useMemo, useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../Text";
import { tomorrowMorningMinutes, type ReminderMark } from "@stella/contracts/reminders";
import { markReminderDone, snoozeReminder, useReminderFires } from "../../lib/reminders";
import { tapMedium } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { useT } from "../../i18n";
import { ScheduleCardShell, makeChatCardButtonStyles } from "./ScheduleCardShell";

const SNOOZES = [
  { label: "reminders.snooze10", minutes: () => 10 },
  { label: "reminders.snooze60", minutes: () => 60 },
  { label: "reminders.snoozeTomorrow", minutes: () => tomorrowMorningMinutes(new Date()) },
] as const;

const formatTime = (ms: number): string => {
  const date = new Date(ms);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
};

/** A reminder that went off: what to do on row 1; "Reminder · 9:00 AM" on row 2 with Snooze / Done at its right end. */
export const ReminderFireCard = memo(function ReminderFireCard({
  mark,
  text,
  firedAtMs,
  colors,
}: {
  mark: ReminderMark;
  text: string;
  firedAtMs: number | undefined;
  colors: Colors;
}) {
  const t = useT();
  const fires = useReminderFires(true);
  const [busy, setBusy] = useState(false);
  const styles = useMemo(() => ({ ...makeChatCardButtonStyles(colors), ...makeStyles(colors) }), [colors]);
  const fire = fires?.get(mark.fireId);
  const atMs = mark.dueAt ?? firedAtMs;
  const status = [t("reminders.title"), atMs !== undefined ? formatTime(atMs) : null]
    .filter(Boolean)
    .join(" · ");

  const run = (action: () => Promise<unknown>) => {
    tapMedium();
    setBusy(true);
    void action()
      .catch(() => Alert.alert(t("reminders.failed")))
      .finally(() => setBusy(false));
  };

  const chooseSnooze = () => {
    if (!fire) return;
    const pick = (index: number) => {
      const choice = SNOOZES[index];
      if (choice) run(() => snoozeReminder(fire.fireId, choice.minutes()));
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...SNOOZES.map((choice) => t(choice.label)), t("common.cancel")], cancelButtonIndex: SNOOZES.length },
        pick,
      );
      return;
    }
    Alert.alert(t("reminders.snooze"), undefined, [
      ...SNOOZES.map((choice, index) => ({ text: t(choice.label), onPress: () => pick(index) })),
      { text: t("common.cancel"), style: "cancel" as const },
    ]);
  };

  let trailing = null;
  if (fire && fire.state !== "open") {
    const label =
      fire.state === "done"
        ? `✓ ${t("reminders.doneState")}`
        : fire.snoozedUntil && fire.snoozedUntil > Date.now()
          ? t("reminders.snoozedUntil", { time: formatTime(fire.snoozedUntil) })
          : t("reminders.snoozed");
    trailing = (
      <Text style={styles.settled} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {label}
      </Text>
    );
  } else if (fire) {
    trailing = (
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={chooseSnooze}
          style={({ pressed }) => [styles.button, (pressed || busy) && styles.dimmed]}
        >
          <Text style={styles.label} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("reminders.snooze")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => run(() => markReminderDone(fire.fireId))}
          style={({ pressed }) => [styles.button, styles.primary, (pressed || busy) && styles.dimmed]}
        >
          <Text style={[styles.label, styles.primaryLabel]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("reminders.done")}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScheduleCardShell
      colors={colors}
      headline={text}
      status={status}
      trailing={trailing}
      testID="reminder-fire-card"
      accessibilityLabel={`${text}, ${status}`}
    />
  );
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    settled: {
      color: colors.textMuted,
      flexShrink: 0,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
    },
  });
