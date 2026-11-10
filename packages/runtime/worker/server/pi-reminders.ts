import { formatDateTimeReminder, THIRTY_MINUTES_MS, wrapSystemReminder } from "@stella/contracts/message-timestamp";

export const piUserReminders = async (
  dataDir: string,
  input: { text: string; sentAt: number; previousUserAt?: number; timezone?: string },
): Promise<string[]> => {
  const reminders: string[] = [];
  if (input.previousUserAt === undefined || input.sentAt - input.previousUserAt >= THIRTY_MINUTES_MS) {
    reminders.push(formatDateTimeReminder(input.sentAt, input.timezone));
  }
  reminders.push(
    ...(await import("./connector-hints.js").then(
      ({ connectorHints }) => connectorHints(dataDir, input.text),
      () => [],
    )),
  );
  return reminders.map((text) => wrapSystemReminder(text));
};
