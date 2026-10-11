import { memo, useMemo, useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { tomorrowMorningMinutes, type ReminderMark } from "@stella/contracts/reminders";
import { markReminderDone, snoozeReminder, useReminderFires } from "../../lib/reminders";
import { tapMedium } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/setup-text-defaults";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { useT } from "../../i18n";

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

/** Done and Snooze under a reminder Stella delivered; the same state on every device. */
export const ReminderActions = memo(function ReminderActions({
  mark,
  colors,
}: {
  mark: ReminderMark;
  colors: Colors;
}) {
  const t = useT();
  const fires = useReminderFires(true);
  const [busy, setBusy] = useState(false);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fire = fires?.get(mark.fireId);
  if (!fire) return null;

  const run = (action: () => Promise<unknown>) => {
    tapMedium();
    setBusy(true);
    void action()
      .catch(() => Alert.alert(t("reminders.failed")))
      .finally(() => setBusy(false));
  };

  const chooseSnooze = () => {
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

  if (fire.state !== "open") {
    const label =
      fire.state === "done"
        ? t("reminders.doneState")
        : fire.snoozedUntil && fire.snoozedUntil > Date.now()
          ? t("reminders.snoozedUntil", { time: formatTime(fire.snoozedUntil) })
          : t("reminders.snoozed");
    return (
      <Text style={styles.settled} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {label}
      </Text>
    );
  }
  return (
    <View style={styles.row}>
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
    </View>
  );
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: { flexDirection: "row", gap: 8, marginTop: 8 },
    button: {
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    primary: { backgroundColor: colors.textStrong, borderColor: colors.textStrong },
    dimmed: { opacity: 0.6 },
    label: { color: colors.text, fontFamily: fonts.sans.medium, fontSize: 14 },
    primaryLabel: { color: colors.background },
    settled: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      marginTop: 6,
    },
  });
