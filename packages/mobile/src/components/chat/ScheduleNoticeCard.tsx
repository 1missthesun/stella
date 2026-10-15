import { memo, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { describeScheduleTiming } from "@stella/contracts/schedule-format";
import {
  scheduleNoticeTitleKey,
  scheduleTimingText,
  type ScheduleNoticeCard as ScheduleNotice,
} from "@stella/contracts/schedule-notice";
import { Text } from "../Text";
import { Icon, type IconName } from "../Icon";
import { useLocale, useT, useTPlural } from "../../i18n";
import { tapLight } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";

const KIND_ICON: Record<ScheduleNotice["kind"], IconName> = {
  reminder: "bell",
  task: "checklist",
  watch: "eye",
};

export const ScheduleNoticeCard = memo(function ScheduleNoticeCard({
  card,
  colors,
}: {
  card: ScheduleNotice;
  colors: Colors;
}) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const router = useRouter();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const removed = card.action === "removed";
  const when = useMemo(() => {
    if (removed || !card.schedule) return null;
    const timing = describeScheduleTiming(card.schedule, {
      nowMs: Date.now(),
      ...(card.nextRunAt !== undefined ? { nextRunAtMs: card.nextRunAt } : {}),
      ...(card.zone ? { zone: card.zone } : {}),
    });
    return scheduleTimingText(timing, { t, tPlural, locale });
  }, [card, locale, removed, t, tPlural]);
  const title = t(`schedule.notice.title.${scheduleNoticeTitleKey(card)}`);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, card.name, when].filter(Boolean).join(", ")}
      accessibilityHint={t("schedule.notice.open")}
      testID="schedule-notice-card"
      onPress={() => {
        tapLight();
        router.push({
          pathname: "/schedule",
          params: removed ? {} : { focus: card.scheduleId },
        });
      }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={[colors.assistantBubbleFillTop, colors.assistantBubbleFillBottom]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.label}>
        <Icon name={KIND_ICON[card.kind]} size={14} color={colors.textMuted} />
        <Text style={styles.labelText} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {title}
        </Text>
      </View>
      <Text
        style={[styles.name, removed && styles.nameRemoved]}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {card.name}
      </Text>
      {when ? (
        <Text style={styles.detail} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {when}
        </Text>
      ) : null}
      {card.message && !removed ? (
        <Text
          style={[styles.detail, styles.message]}
          numberOfLines={4}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {card.message}
        </Text>
      ) : null}
    </Pressable>
  );
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      alignSelf: "flex-start",
      borderCurve: "continuous",
      borderRadius: 18,
      gap: 2,
      maxWidth: "100%",
      minWidth: 220,
      overflow: "hidden",
      paddingBottom: 11,
      paddingHorizontal: 14,
      paddingTop: 10,
    },
    pressed: { opacity: 0.75 },
    label: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
      marginBottom: 2,
    },
    labelText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      letterSpacing: -0.1,
    },
    name: {
      color: colors.assistantBubbleText,
      fontFamily: fonts.sans.medium,
      fontSize: 17,
      letterSpacing: -0.3,
      lineHeight: 22,
    },
    nameRemoved: {
      color: colors.textMuted,
      textDecorationLine: "line-through",
    },
    detail: {
      color: colors.assistantBubbleText,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      fontVariant: ["tabular-nums"],
      letterSpacing: -0.2,
      lineHeight: 20,
      opacity: 0.75,
    },
    message: { marginTop: 4 },
  });
