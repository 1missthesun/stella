import {
  wrapSystemReminder,
} from "@stella/contracts/system-reminders";
import { formatZonedNow } from "@stella/contracts/schedule-zone";

export { wrapSystemReminder };

const TIME_PATTERN =
  "(?:1[0-2]|0?[1-9]):[0-5]\\d\\s?(?:AM|PM)(?:,\\s+[A-Za-z]{3}\\s+\\d{1,2})?";

export const LEADING_TIME_TAG_RE = new RegExp(
  `^<system-reminder>${TIME_PATTERN}<\\/system-reminder>\\s*`,
  "i",
);

export const TRAILING_TIME_TAG_RE = new RegExp(
  `\\s*\\n\\n<system-reminder>${TIME_PATTERN}<\\/system-reminder>$`,
  "i",
);

export const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export const formatDateTimeReminder = (
  timestamp: number,
  timezone?: string,
): string =>
  `Current date and time: ${formatZonedNow(
    timestamp,
    timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  )}.`;

