const DAY_MS = 24 * 60 * 60_000;

export type Translate = (key: string, params?: Record<string, string | number>) => string;

const startOfDay = (ms: number): number => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const dayOffset = (ms: number, now: number): number =>
  Math.round((startOfDay(ms) - startOfDay(now)) / DAY_MS);

const weekday = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { weekday: "long" });

export function pastSection(
  ms: number,
  now: number,
  t: Translate,
): { key: string; label: string } {
  if (ms <= 0) return { key: "other", label: t("mobile.activityHub.files.types.other") };
  const offset = dayOffset(ms, now);
  if (offset >= 0) return { key: "today", label: t("mobile.activityHub.time.today") };
  if (offset === -1) {
    return { key: "yesterday", label: t("mobile.activityHub.time.yesterday") };
  }
  if (offset > -7) return { key: `day:${offset}`, label: weekday(ms) };
  const date = new Date(ms);
  const today = new Date(now);
  const sameYear = date.getFullYear() === today.getFullYear();
  if (sameYear && date.getMonth() === today.getMonth()) {
    return {
      key: "month:current",
      label: t("mobile.activityHub.time.earlierThisMonth"),
    };
  }
  return {
    key: `month:${date.getFullYear()}-${date.getMonth()}`,
    label: date.toLocaleDateString(undefined, {
      month: "long",
      ...(sameYear ? {} : { year: "numeric" }),
    }),
  };
}

export function upcomingSection(
  ms: number,
  now: number,
  t: Translate,
): { key: string; label: string } {
  const offset = dayOffset(ms, now);
  if (offset <= 0) return { key: "today", label: t("mobile.activityHub.time.today") };
  if (offset === 1) {
    return { key: "tomorrow", label: t("mobile.activityHub.time.tomorrow") };
  }
  if (offset < 7) return { key: `day:${offset}`, label: weekday(ms) };
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return {
    key: `date:${startOfDay(ms)}`,
    label: date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    }),
  };
}

export const timeOfDay = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
