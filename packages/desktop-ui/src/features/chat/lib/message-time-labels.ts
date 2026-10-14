export const TIMESTAMP_GAP_MS = 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

const startOfDay = (ms: number): number => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const timeOfDay = (ms: number, locale?: string): string =>
  new Date(ms).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });

const daysAgo = (ms: number, now: number): number =>
  Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);

const capitalize = (value: string): string =>
  value.length > 0 ? value[0]!.toLocaleUpperCase() + value.slice(1) : value;

const relativeDayLabel = (days: number, locale?: string): string =>
  capitalize(
    new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      -days,
      "day",
    ),
  );

export function formatTimestampHeader(
  ms: number,
  locale?: string,
  now = Date.now(),
): string {
  const days = daysAgo(ms, now);
  const time = timeOfDay(ms, locale);
  if (days <= 0) return `${relativeDayLabel(0, locale)} ${time}`;
  if (days === 1) return `${relativeDayLabel(1, locale)} ${time}`;
  const date = new Date(ms);
  if (days < 7) {
    return `${capitalize(date.toLocaleDateString(locale, { weekday: "long" }))} ${time}`;
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timestampHeaders(
  entries: readonly { id: string; timestampMs?: number }[],
): Map<string, number> {
  const headers = new Map<string, number>();
  let previous: number | null = null;
  for (const entry of entries) {
    const at = entry.timestampMs;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (previous === null || at - previous >= TIMESTAMP_GAP_MS) {
      headers.set(entry.id, at);
    }
    previous = at;
  }
  return headers;
}
