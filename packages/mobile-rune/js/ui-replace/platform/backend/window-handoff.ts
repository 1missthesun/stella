// The phone's desktop-ui platform/backend/window-handoff.ts. On a computer a new window starts
// from what the last one last saw (the owner's identity, the recent conversations) for half a
// minute. A phone app is killed in the background without a goodbye, and its next launch is the
// moment that matters: so each value is kept as it is seen, per account, and a launch starts from
// the last session's. The chat then opens from its cache as soon as the server confirms who is
// signed in (one round trip, as the RN app's bootstrap) instead of after the conversation list
// loads too; the fresh list replaces the kept one as it arrives, and the saved identity carries a
// launch without a network, as it does on a computer.

const PREFIX = "stella:phone-handoff:";

const remembered = new Map<string, unknown>();

export const recallHandoff = <T>(key: string): T | undefined => {
  if (remembered.has(key)) return remembered.get(key) as T;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${key}`);
    if (raw) {
      const value = JSON.parse(raw) as T;
      remembered.set(key, value);
      return value;
    }
  } catch {}
  return undefined;
};

export const rememberForHandoff = (key: string, value: unknown): void => {
  remembered.set(key, value);
  try {
    window.localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
  } catch {}
};
