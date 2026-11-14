import { describeScheduleTiming } from "./schedule-format.js";
import {
  scheduleNoticeTitleKey,
  scheduleTimingText,
  type ScheduleNoticeAction,
  type ScheduleNoticeCard,
  type ScheduleNoticeKind,
} from "./schedule-notice.js";

/**
 * Consecutive schedule notices in a chat read as one card: what the run left
 * behind (a schedule made and then removed inside it cancels out), with
 * numbered series ("Indexing 1/9" … "9/9") folded into one line. Every client
 * draws runs from this so desktop, web and phone say the same thing.
 */

type Translate = (key: string, params?: Record<string, string | number>) => string;
type TranslatePlural = (key: string, count: number, params?: Record<string, string | number>) => string;
export type ScheduleNoticeI18n = { t: Translate; tPlural: TranslatePlural; locale: string };

/** What a run did to one schedule, net. */
export type ScheduleNoticeNet = "created" | "updated" | "removed";

export type ScheduleNoticeItem = {
  scheduleId: string;
  kind: ScheduleNoticeKind;
  net: ScheduleNoticeNet;
  /** The schedule's latest notice in the run. */
  card: ScheduleNoticeCard;
};

export type ScheduleNoticeEntry =
  | { type: "item"; item: ScheduleNoticeItem }
  | {
      type: "series";
      name: string;
      kind: ScheduleNoticeKind;
      net: ScheduleNoticeNet;
      items: ScheduleNoticeItem[];
      firstRunAt?: number;
      lastRunAt?: number;
    };

export type ScheduleNoticeSummary = {
  /** How many notices the run holds. */
  notices: number;
  entries: ScheduleNoticeEntry[];
  counts: { net: ScheduleNoticeNet; kind: ScheduleNoticeKind; count: number }[];
  /** Made and removed inside the run: out of the summary, still in the full list. */
  cancelled: ScheduleNoticeItem[];
  /** The soonest upcoming run among what the run left scheduled. */
  next?: ScheduleNoticeCard;
  /** Every notice is about a background task's own follow-up. */
  agentOnly: boolean;
  /** How many agent threads those follow-ups wake. */
  agentThreads: number;
};

/** A task or watch that wakes an agent's thread rather than coming to the user. */
export const isAgentScheduleNotice = (card: ScheduleNoticeCard): boolean =>
  card.kind !== "reminder" && Boolean(card.threadId);

/** Shown as its own card: one notice the user will want to see as it is. */
export const showsAsSingleScheduleCard = (cards: readonly ScheduleNoticeCard[]): boolean =>
  cards.length === 1 && !isAgentScheduleNotice(cards[0]!);

const netOf = (action: ScheduleNoticeAction): ScheduleNoticeNet =>
  action === "created" ? "created" : action === "removed" ? "removed" : "updated";

const SERIES_PATTERN = /^(.*?\S)[\s:#–—-]*[([]?\s*(\d{1,4})\s*(?:\/|of)\s*(\d{1,4})\s*[)\]]?$/iu;

const seriesKey = (item: ScheduleNoticeItem): { key: string; name: string } => {
  const name = item.card.name.trim();
  const match = SERIES_PATTERN.exec(name);
  const base = match ? match[1]!.replace(/[\s:#–—-]+$/u, "") : name;
  const total = match ? match[3] : "=";
  return { key: `${item.kind}\u0000${item.net}\u0000${base.toLocaleLowerCase()}\u0000${total}`, name: base };
};

const upcoming = (card: ScheduleNoticeCard, nowMs: number): number | undefined =>
  card.nextRunAt !== undefined && card.nextRunAt >= nowMs ? card.nextRunAt : undefined;

const COUNT_ORDER: ScheduleNoticeNet[] = ["created", "updated", "removed"];
const KIND_ORDER: ScheduleNoticeKind[] = ["task", "reminder", "watch"];

export const summarizeScheduleNotices = (
  cards: readonly ScheduleNoticeCard[],
  nowMs: number,
): ScheduleNoticeSummary => {
  const bySchedule = new Map<string, { created: boolean; last: ScheduleNoticeCard }>();
  for (const card of cards) {
    const seen = bySchedule.get(card.scheduleId);
    bySchedule.set(card.scheduleId, {
      created: (seen?.created ?? false) || card.action === "created",
      last: card,
    });
  }
  const items: ScheduleNoticeItem[] = [];
  const cancelled: ScheduleNoticeItem[] = [];
  for (const [scheduleId, { created, last }] of bySchedule) {
    const net: ScheduleNoticeNet = created && last.action !== "removed" ? "created" : netOf(last.action);
    const item = { scheduleId, kind: last.kind, net, card: last };
    if (created && last.action === "removed") cancelled.push(item);
    else items.push(item);
  }

  const groups = new Map<string, { name: string; items: ScheduleNoticeItem[] }>();
  const order: (ScheduleNoticeItem | string)[] = [];
  for (const item of items) {
    const { key, name } = seriesKey(item);
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      continue;
    }
    groups.set(key, { name, items: [item] });
    order.push(key);
  }
  const entries: ScheduleNoticeEntry[] = order.map((key) => {
    const group = groups.get(key as string)!;
    if (group.items.length === 1) return { type: "item", item: group.items[0]! };
    const runs = group.items
      .map((item) => (item.net === "removed" ? undefined : item.card.nextRunAt))
      .filter((at): at is number => at !== undefined);
    return {
      type: "series",
      name: group.name,
      kind: group.items[0]!.kind,
      net: group.items[0]!.net,
      items: group.items,
      ...(runs.length > 0 ? { firstRunAt: Math.min(...runs), lastRunAt: Math.max(...runs) } : {}),
    };
  });

  const counts: ScheduleNoticeSummary["counts"] = [];
  for (const net of COUNT_ORDER) {
    for (const kind of KIND_ORDER) {
      const count = items.filter((item) => item.net === net && item.kind === kind).length;
      if (count > 0) counts.push({ net, kind, count });
    }
  }

  let next: ScheduleNoticeCard | undefined;
  for (const item of items) {
    if (item.net === "removed" || item.card.action === "paused") continue;
    const at = upcoming(item.card, nowMs);
    if (at === undefined) continue;
    if (!next || at < next.nextRunAt!) next = item.card;
  }

  const threads = new Set(cards.filter(isAgentScheduleNotice).map((card) => card.threadId!));
  return {
    notices: cards.length,
    entries,
    counts,
    cancelled,
    ...(next ? { next } : {}),
    agentOnly: cards.length > 0 && cards.every(isAgentScheduleNotice),
    agentThreads: threads.size,
  };
};

/** When a notice's schedule runs, as its card says it. */
export const scheduleNoticeWhenText = (
  card: ScheduleNoticeCard,
  i18n: ScheduleNoticeI18n,
  nowMs: number,
): string | null => {
  if (card.action === "waiting") return i18n.t("schedule.notice.whenBack");
  if (card.action === "removed" || !card.schedule) return null;
  const timing = describeScheduleTiming(card.schedule, {
    nowMs,
    ...(card.nextRunAt !== undefined ? { nextRunAtMs: card.nextRunAt } : {}),
    ...(card.zone ? { zone: card.zone } : {}),
  });
  return scheduleTimingText(timing, i18n);
};

/** A single notice's status line: "Task scheduled · Tomorrow at 9:00 AM". */
export const scheduleNoticeStatusText = (
  card: ScheduleNoticeCard,
  i18n: ScheduleNoticeI18n,
  nowMs: number,
): string =>
  [i18n.t(`schedule.notice.title.${scheduleNoticeTitleKey(card)}`), scheduleNoticeWhenText(card, i18n, nowMs)]
    .filter(Boolean)
    .join(" · ");

const sameYear = (atMs: number): boolean => new Date(atMs).getFullYear() === new Date().getFullYear();

const monthDay = (locale: string, atMs: number): string => {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      ...(sameYear(atMs) ? {} : { year: "numeric" }),
    }).format(new Date(atMs));
  } catch {
    return new Date(atMs).toDateString();
  }
};

const dayStamp = (atMs: number): string => new Date(atMs).toDateString();

const entryLabel = (entry: ScheduleNoticeEntry, i18n: ScheduleNoticeI18n): string => {
  if (entry.type === "item") return entry.item.card.name;
  const parts = [entry.name, i18n.tPlural("schedule.notice.group.runs", entry.items.length)];
  if (entry.firstRunAt !== undefined && entry.lastRunAt !== undefined) {
    parts.push(
      dayStamp(entry.firstRunAt) === dayStamp(entry.lastRunAt)
        ? monthDay(i18n.locale, entry.firstRunAt)
        : `${monthDay(i18n.locale, entry.firstRunAt)} – ${monthDay(i18n.locale, entry.lastRunAt)}`,
    );
  }
  return parts.join(", ");
};

export type ScheduleNoticeSummaryText = {
  /** What the run is about: names, series folded ("Indexing, 9 runs, Nov 24 – Dec 2"). */
  headline: string;
  /** What changed and when it next runs: "10 tasks scheduled · Today at 6:20 AM". */
  status: string;
  /** Only made-and-removed schedules: the headline reads as removed. */
  undone: boolean;
};

export const scheduleNoticeSummaryText = (
  summary: ScheduleNoticeSummary,
  i18n: ScheduleNoticeI18n,
  nowMs: number,
): ScheduleNoticeSummaryText => {
  const origin =
    summary.agentOnly ? i18n.tPlural("schedule.notice.group.fromAgents", Math.max(1, summary.agentThreads)) : null;
  const only = summary.notices === 1 && summary.entries[0]?.type === "item" ? summary.entries[0].item.card : null;
  if (only) {
    return {
      headline: only.name,
      status: [scheduleNoticeStatusText(only, i18n, nowMs), origin].filter(Boolean).join(" · "),
      undone: false,
    };
  }
  const undone = summary.entries.length === 0;
  const headline = undone
    ? [...new Set(summary.cancelled.map((item) => item.card.name))].join(", ")
    : summary.entries.map((entry) => entryLabel(entry, i18n)).join(", ");
  const counts = undone
    ? i18n.t("schedule.notice.group.undone")
    : summary.counts
        .map(({ net, kind, count }) => i18n.tPlural(`schedule.notice.group.count.${net}.${kind}`, count))
        .join(", ");
  const when = summary.next ? scheduleNoticeWhenText(summary.next, i18n, nowMs) : null;
  return {
    headline,
    status: [counts, when, origin].filter(Boolean).join(" · "),
    undone,
  };
};
