import { memo, useMemo } from "react";
import { useRouter } from "expo-router";
import { describeScheduleTiming } from "@stella/contracts/schedule-format";
import {
  scheduleNoticeTitleKey,
  scheduleTimingText,
  type ScheduleNoticeCard as ScheduleNotice,
} from "@stella/contracts/schedule-notice";
import { useLocale, useT, useTPlural } from "../../i18n";
import { tapLight } from "../../lib/haptics";
import type { Colors } from "../../theme/colors";
import { ScheduleCardShell } from "./ScheduleCardShell";

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
  const removed = card.action === "removed";
  const when = useMemo(() => {
    if (card.action === "waiting") return t("schedule.notice.whenBack");
    if (removed || !card.schedule) return null;
    const timing = describeScheduleTiming(card.schedule, {
      nowMs: Date.now(),
      ...(card.nextRunAt !== undefined ? { nextRunAtMs: card.nextRunAt } : {}),
      ...(card.zone ? { zone: card.zone } : {}),
    });
    return scheduleTimingText(timing, { t, tPlural, locale });
  }, [card, locale, removed, t, tPlural]);
  const status = [t(`schedule.notice.title.${scheduleNoticeTitleKey(card)}`), when]
    .filter(Boolean)
    .join(" · ");

  return (
    <ScheduleCardShell
      colors={colors}
      headline={card.name}
      status={status}
      struck={removed}
      testID="schedule-notice-card"
      accessibilityLabel={`${card.name}, ${status}`}
      accessibilityHint={t("schedule.notice.open")}
      onPress={() => {
        tapLight();
        router.push({ pathname: "/schedule", params: removed ? {} : { focus: card.scheduleId } });
      }}
    />
  );
});
