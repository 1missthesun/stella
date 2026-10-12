export const SYSTEM_REMINDER_TAG = "system-reminder";

export const wrapSystemReminder = (text: string): string =>
  `<${SYSTEM_REMINDER_TAG}>${text.trim()}</${SYSTEM_REMINDER_TAG}>`;
