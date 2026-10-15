import { Pressable, StyleSheet } from "react-native";
import { Text } from "./Text";
import { Icon, type IconName } from "./Icon";
import type { MobileSchedule } from "../lib/schedules";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";

export type ScheduleRowStyles = ReturnType<typeof makeScheduleRowStyles>;

const scheduleIcon = (schedule: MobileSchedule): IconName => {
  if (schedule.kind === "heartbeat") return "waveform";
  if (schedule.scheduleKind === "watch") return "eye";
  if (schedule.scheduleKind === "task") return "checklist";
  if (schedule.scheduleKind === "reminder") return "bell";
  return "clock";
};

export function ScheduleRow({
  schedule,
  trailing,
  busy,
  highlighted,
  styles,
  colors,
  onPress,
}: {
  schedule: MobileSchedule;
  trailing: string | null;
  busy: boolean;
  highlighted?: boolean;
  styles: ScheduleRowStyles;
  colors: Colors;
  onPress: () => void;
}) {
  const paused = !schedule.enabled;
  const failed = !paused && Boolean(schedule.lastError);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[schedule.title, trailing].filter(Boolean).join(", ")}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        (pressed || highlighted) && styles.rowPressed,
        busy && styles.rowBusy,
      ]}
    >
      <Icon
        name={scheduleIcon(schedule)}
        size={19}
        color={paused ? colors.textMuted : colors.accent}
        style={styles.icon}
      />
      <Text
        style={[styles.title, paused && styles.titlePaused]}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {schedule.title}
      </Text>
      {failed ? (
        <Icon name="alert-circle" size={15} color={colors.danger} />
      ) : null}
      {trailing ? (
        <Text
          style={styles.trailing}
          numberOfLines={1}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {trailing}
        </Text>
      ) : null}
    </Pressable>
  );
}

export const makeScheduleRowStyles = (colors: Colors) =>
  StyleSheet.create({
    section: {
      alignSelf: "center",
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
      letterSpacing: -0.1,
      paddingBottom: 6,
      paddingTop: 16,
    },
    row: {
      alignItems: "center",
      borderRadius: 12,
      flexDirection: "row",
      gap: 14,
      marginHorizontal: -8,
      minHeight: 48,
      paddingHorizontal: 8,
      paddingVertical: 10,
    },
    rowPressed: {
      backgroundColor: colors.surfaceInset,
    },
    rowBusy: {
      opacity: 0.5,
    },
    icon: {
      width: 24,
    },
    title: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 17,
      letterSpacing: -0.3,
      minWidth: 0,
    },
    titlePaused: {
      color: colors.textMuted,
    },
    trailing: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      fontVariant: ["tabular-nums"],
      letterSpacing: -0.2,
    },
  });
