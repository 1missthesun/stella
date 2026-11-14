import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import type { ScheduleNoticeCard as ScheduleNotice } from "@stella/contracts/schedule-notice";
import {
  scheduleNoticeStatusText,
  scheduleNoticeSummaryText,
  showsAsSingleScheduleCard,
  summarizeScheduleNotices,
} from "@stella/contracts/schedule-notice-group";
import { useLocale, useT, useTPlural } from "../../i18n";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import { tapLight } from "../../lib/haptics";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { Text } from "../Text";
import { ScheduleCardShell, makeChatCardButtonStyles } from "./ScheduleCardShell";
import { ScheduleNoticeCard } from "./ScheduleNoticeCard";

/**
 * Schedule notices that arrived one after another. One the user will care
 * about keeps its own card; a run reads as one card with what it left behind,
 * opening in place to every notice. A background task's own follow-ups sit on
 * a plain line, without the card's bubble.
 */
export const ScheduleNotices = memo(function ScheduleNotices({
  first,
  run,
  colors,
}: {
  first: ScheduleNotice;
  /** The whole run when more than one notice arrived in a row. */
  run?: readonly ScheduleNotice[];
  colors: Colors;
}) {
  const cards = useMemo(() => run ?? [first], [first, run]);
  if (showsAsSingleScheduleCard(cards)) return <ScheduleNoticeCard card={cards[0]!} colors={colors} />;
  return <ScheduleNoticeGroup cards={cards} colors={colors} />;
});

const ScheduleNoticeGroup = memo(function ScheduleNoticeGroup({
  cards,
  colors,
}: {
  cards: readonly ScheduleNotice[];
  colors: Colors;
}) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const buttonStyles = useMemo(() => makeChatCardButtonStyles(colors), [colors]);
  const i18n = useMemo(() => ({ t, tPlural, locale }), [locale, t, tPlural]);
  const nowMs = useMemo(() => Date.now(), [cards]);
  const summary = useMemo(() => summarizeScheduleNotices(cards, nowMs), [cards, nowMs]);
  const text = useMemo(() => scheduleNoticeSummaryText(summary, i18n, nowMs), [i18n, nowMs, summary]);
  const rows = useMemo(
    () => (open ? cards.map((card) => ({ card, status: scheduleNoticeStatusText(card, i18n, nowMs) })) : []),
    [cards, i18n, nowMs, open],
  );
  const bare = summary.agentOnly;
  const only = cards.length === 1 ? cards[0]! : null;
  const openSchedule = (card: ScheduleNotice) => {
    tapLight();
    router.push({ pathname: "/schedule", params: card.action === "removed" ? {} : { focus: card.scheduleId } });
  };
  const toggle = () => {
    tapLight();
    setOpen((value) => !value);
  };
  const toggleLabel = open ? t("schedule.notice.group.showLess") : t("schedule.notice.group.showAll");

  return (
    <ScheduleCardShell
      colors={colors}
      bare={bare}
      headline={text.headline}
      status={text.status}
      struck={text.undone}
      testID="schedule-notice-run"
      accessibilityLabel={`${text.headline}, ${text.status}`}
      accessibilityHint={only ? t("schedule.notice.open") : toggleLabel}
      onPress={open ? undefined : only ? () => openSchedule(only) : toggle}
      trailing={
        only ? undefined : open ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={toggle} style={buttonStyles.button}>
            <Text style={buttonStyles.label} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              {toggleLabel}
            </Text>
          </Pressable>
        ) : (
          <Text style={buttonStyles.label} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {toggleLabel}
          </Text>
        )
      }
    >
      {open ? (
        <View style={styles.list}>
          {rows.map(({ card, status }, index) => (
            <Pressable
              key={`${card.scheduleId}:${card.action}:${index}`}
              accessibilityRole="button"
              accessibilityLabel={`${card.name}, ${status}`}
              accessibilityHint={t("schedule.notice.open")}
              onPress={() => openSchedule(card)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.rowText} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                <Text style={[styles.rowName, card.action === "removed" && styles.struck]}>{card.name}</Text>
                <Text style={styles.rowStatus}>{`  ${status}`}</Text>
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScheduleCardShell>
  );
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { marginTop: 6, paddingBottom: 2 },
    row: { paddingVertical: 4 },
    pressed: { opacity: 0.6 },
    rowText: {
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      letterSpacing: -0.15,
      lineHeight: 19,
    },
    rowName: { color: colors.assistantBubbleText },
    rowStatus: { color: colors.textMuted, fontVariant: ["tabular-nums"] },
    struck: { color: colors.textMuted, textDecorationLine: "line-through" },
  });
