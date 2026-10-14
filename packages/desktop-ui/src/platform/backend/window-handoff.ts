import { APP_RELAUNCHING_EVENT } from "@stella/contracts/desktop/app-source";

const SESSION_PREFIX = "stella:handoff:";
const HANDOFF_KEY = "stella:window-handoff";
const HANDOFF_TTL_MS = 30_000;

const remembered = new Map<string, unknown>();
let handedOver: Record<string, unknown> | null | undefined;

const readHandedOver = (): Record<string, unknown> | null => {
  if (handedOver !== undefined) return handedOver;
  handedOver = null;
  try {
    const raw = window.localStorage.getItem(HANDOFF_KEY);
    if (raw) {
      const handoff = JSON.parse(raw) as { at: number; values: Record<string, unknown> };
      const age = Date.now() - handoff.at;
      if (age >= 0 && age < HANDOFF_TTL_MS) handedOver = handoff.values;
    }
  } catch {
    // Nothing handed over.
  }
  return handedOver;
};

export const recallHandoff = <T>(key: string): T | undefined => {
  try {
    const raw = window.sessionStorage.getItem(`${SESSION_PREFIX}${key}`);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // Fall through to the handoff.
  }
  return readHandedOver()?.[key] as T | undefined;
};

export const rememberForHandoff = (key: string, value: unknown): void => {
  remembered.set(key, value);
  try {
    window.sessionStorage.setItem(`${SESSION_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Without it a reload just waits for the answer.
  }
};

const handOver = () => {
  if (remembered.size === 0) return;
  try {
    window.localStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({ at: Date.now(), values: Object.fromEntries(remembered) }),
    );
  } catch {
    // The next window just waits for the answers.
  }
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", handOver);
  window.addEventListener(APP_RELAUNCHING_EVENT, handOver);
}
