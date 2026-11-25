import { memo, useMemo, useState } from "react";
import { describeScheduleTiming } from "@stella/contracts/schedule-format";
import { scheduleNoticeTitleKey, scheduleTimingText, type ScheduleNoticeCard as ScheduleNotice } from "@stella/contracts/schedule-notice";
import { scheduleNoticeRunRowText, scheduleNoticeSummaryText, showsAsSingleScheduleCard, summarizeScheduleNotices } from "@stella/contracts/schedule-notice-group";
import { useI18n } from "@/shared/i18n";
import { openScheduleFocused } from "@/features/schedule/schedule-focus";
import { Icon, Icons } from "../../kit";
import { radius, useTokens } from "../../theme";
import { APP_TEXT, META_TEXT, ScheduleCard, ScheduleStatus, scheduleCardLook } from "./ScheduleCard";

/** desktop-ui's `ScheduleNoticeCard`: a schedule Stella set, changed or removed; opens it in Schedules. */
export const ScheduleNoticeCard = memo(function ScheduleNoticeCard({ card }: { card: ScheduleNotice }) {
  const { t, tPlural, locale } = useI18n();
  const removed = card.action === "removed";
  const when = useMemo(() => {
    if (card.action === "waiting") return t("schedule.notice.whenBack");
    if (removed || !card.schedule) return null;
    const timing = describeScheduleTiming(card.schedule, { nowMs: Date.now(), ...(card.nextRunAt !== undefined ? { nextRunAtMs: card.nextRunAt } : {}), ...(card.zone ? { zone: card.zone } : {}) });
    return scheduleTimingText(timing, { t, tPlural, locale });
  }, [card, locale, removed, t, tPlural]);
  const status = [t(`schedule.notice.title.${scheduleNoticeTitleKey(card)}`), when].filter(Boolean).join(" · ");
  return (
    <ScheduleCard
      headline={card.name}
      headlineStruck={removed}
      label={`${card.name}, ${status}`}
      title={`${card.name}\n${status}`}
      onPress={() => openScheduleFocused(card.scheduleId)}
      meta={<ScheduleStatus>{status}</ScheduleStatus>}
    />
  );
});

/** desktop-ui's `ScheduleNotices`: one card, or a run of them summarised with Show all. */
export const ScheduleNotices = memo(function ScheduleNotices({ first, run }: { first: ScheduleNotice; run?: readonly ScheduleNotice[] }) {
  const cards = useMemo(() => run ?? [first], [first, run]);
  if (showsAsSingleScheduleCard(cards)) return <ScheduleNoticeCard card={cards[0]!} />;
  return <ScheduleNoticeGroup cards={cards} />;
});

const ScheduleNoticeGroup = memo(function ScheduleNoticeGroup({ cards }: { cards: readonly ScheduleNotice[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const tokens = useTokens();
  const l = scheduleCardLook(tokens);
  const [open, setOpen] = useState(false);
  const nowMs = useMemo(() => Date.now(), [cards]);
  const summary = useMemo(() => summarizeScheduleNotices(cards, nowMs), [cards, nowMs]);
  const text = useMemo(() => scheduleNoticeSummaryText(summary, i18n, nowMs), [i18n, nowMs, summary]);
  const rows = useMemo(() => (open ? cards.map((card) => ({ card, status: scheduleNoticeRunRowText(card, i18n, nowMs) })) : []), [cards, i18n, nowMs, open]);
  const expandable = cards.length > 1;
  const quiet = summary.agentOnly;
  const only = cards.length === 1 ? cards[0]! : null;
  const headStruck = Boolean(text.undone);
  return (
    <col
      w="fit"
      maxW="85%"
      minW={0}
      radius={quiet ? undefined : radius["3xl"]}
      clip={quiet ? undefined : radius["3xl"]}
      fill={quiet ? undefined : tokens.c.chatAssistantBubbleFillTop}
      gradient={quiet ? undefined : tokens.gradient.assistantBubble}
    >
      <row
        role="button"
        focusable
        cursor="pointer"
        label={`${text.headline}, ${text.status}`}
        title={`${text.headline}\n${text.status}`}
        expanded={expandable ? open : undefined}
        align="center"
        gap={quiet ? 8 : 10}
        minW={0}
        pt={quiet ? 2 : 8}
        pb={quiet ? 2 : 9}
        px={quiet ? 0 : 14}
        radius={quiet ? radius.md : radius["3xl"]}
        hoverFill={quiet ? undefined : l.hover}
        hoverGroup
        onPress={() => (only ? openScheduleFocused(only.scheduleId) : setOpen((value) => !value))}
      >
        <box w={quiet ? 16 : 32} h={quiet ? 16 : 32} radius={9} fill={quiet ? undefined : l.tile} center shrink={false}>
          <Icon icon={Icons.stella.Clock} size={16} strokeWidth={1.9} color={tokens.c.textWeak} />
        </box>
        <col grow={1} shrink gap={1} minW={0}>
          <text
            {...APP_TEXT}
            weight={500}
            color={headStruck ? tokens.c.textWeak : quiet ? tokens.c.textBase : tokens.c.chatAssistantBubbleText}
            hoverColor={quiet && !headStruck ? tokens.c.textStrong : undefined}
            strike={headStruck}
            maxLines={2}
            truncate="end"
            minW={0}
          >
            {text.headline}
          </text>
          <row align="center" justify="between" gap={12} minH={18}>
            <ScheduleStatus>{text.status}</ScheduleStatus>
            {expandable ? (
              <text {...META_TEXT} weight={500} color={tokens.c.textWeak} shrink={false}>
                {open ? t("schedule.notice.group.showLess") : t("schedule.notice.group.showAll")}
              </text>
            ) : null}
          </row>
        </col>
      </row>
      {open ? (
        <col pt={quiet ? 2 : 0} pr={quiet ? 0 : 14} pb={quiet ? 0 : 8} pl={quiet ? 24 : 56}>
          {rows.map(({ card, status }, index) => (
            <row key={`${card.scheduleId}:${card.action}:${index}`} role="button" focusable cursor="pointer" align="end" gap={6} w="full" minW={0} py={3} hoverGroup title={`${card.name}\n${status}`} onPress={() => openScheduleFocused(card.scheduleId)}>
              <text {...META_TEXT} color={card.action === "removed" ? tokens.c.textWeak : tokens.c.chatAssistantBubbleText} strike={card.action === "removed"} nowrap truncate minW={0} shrink>
                {card.name}
              </text>
              <text {...META_TEXT} color={tokens.c.textWeak} features="'tnum' 1" nowrap truncate maxW="70%" shrink={false}>
                {status}
              </text>
            </row>
          ))}
        </col>
      ) : null}
    </col>
  );
});
