import * as SecureStore from "./secure-store";

const HANDLED_KEY = "stella-notification_actions_handled";
const MAX_HANDLED = 48;

const claimedInMemory = new Set<string>();

const readHandled = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(SecureStore.getItem(HANDLED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const writeHandled = (keys: string[]): void => {
  try {
    SecureStore.setItem(HANDLED_KEY, JSON.stringify(keys.slice(-MAX_HANDLED)));
  } catch {
    return;
  }
};

export const claimNotificationAction = (key: string): boolean => {
  if (claimedInMemory.has(key)) return false;
  const handled = readHandled();
  if (handled.includes(key)) return false;
  claimedInMemory.add(key);
  writeHandled([...handled, key]);
  return true;
};

export const releaseNotificationAction = (key: string): void => {
  claimedInMemory.delete(key);
  writeHandled(readHandled().filter((item) => item !== key));
};
