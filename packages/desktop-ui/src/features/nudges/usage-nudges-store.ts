import { useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";

const STORAGE_KEY = "stella:usage-nudges";
/** Set by the "How did you find Stella?" step of the earlier, longer setup. */
export const FOUND_VIA_CHOICE_KEY = "stella-onboarding-found-via";

export const FOUND_VIA_NOTICE_ID = "found-via-nudge";

export type NudgeId = "foundVia" | "phoneApp";
type NudgeStatus = "pending" | "done";

export type UsageNudgesState = {
  /** Finished replies seen on this computer. */
  replies: number;
  /** The first two local days Stella was opened on. */
  days: string[];
  nudges: Record<NudgeId, NudgeStatus>;
};

/** "How did you find Stella?" asks after this many replies. */
export const FOUND_VIA_AFTER_REPLIES = 3;
/** The phone app is suggested on a second day with at least one reply, or after this many replies. */
export const PHONE_APP_AFTER_REPLIES = 6;

const CHANGE_EVENT = "stella:usage-nudges-changed";

const localDay = (date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const isStatus = (value: unknown): value is NudgeStatus => value === "pending" || value === "done";

const parse = (raw: string | null): UsageNudgesState | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UsageNudgesState> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const nudges = (parsed.nudges ?? {}) as Partial<Record<NudgeId, unknown>>;
    return {
      replies: typeof parsed.replies === "number" && parsed.replies >= 0 ? parsed.replies : 0,
      days: Array.isArray(parsed.days)
        ? parsed.days.filter((day): day is string => typeof day === "string").slice(0, 2)
        : [],
      nudges: {
        foundVia: isStatus(nudges.foundVia) ? nudges.foundVia : "done",
        phoneApp: isStatus(nudges.phoneApp) ? nudges.phoneApp : "done",
      },
    };
  } catch {
    return null;
  }
};

let cached: { raw: string | null; state: UsageNudgesState | null } = { raw: null, state: null };

export const readUsageNudges = (): UsageNudgesState | null => {
  const raw = uiState.getItem(STORAGE_KEY);
  if (raw !== cached.raw) cached = { raw, state: parse(raw) };
  return cached.state;
};

const write = (state: UsageNudgesState) => {
  uiState.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

const update = (change: (state: UsageNudgesState) => UsageNudgesState | null) => {
  const current = readUsageNudges();
  if (!current) return;
  const next = change(current);
  if (next) write(next);
};

/**
 * Starts the nudges once per install. Someone who finished the earlier, longer
 * setup already saw both questions there, so theirs start done.
 */
export const startUsageNudges = (onboardingAlreadyDone: boolean): void => {
  if (readUsageNudges()) return;
  const status: NudgeStatus = onboardingAlreadyDone ? "done" : "pending";
  write({
    replies: 0,
    days: [],
    nudges: {
      foundVia: uiState.getItem(FOUND_VIA_CHOICE_KEY) ? "done" : status,
      phoneApp: status,
    },
  });
};

export const noteStellaReply = (): void => {
  update((state) => ({ ...state, replies: state.replies + 1 }));
};

export const noteOpenedToday = (): void => {
  const today = localDay();
  update((state) =>
    state.days.includes(today) || state.days.length >= 2
      ? null
      : { ...state, days: [...state.days, today] },
  );
};

export const finishNudge = (id: NudgeId): void => {
  update((state) =>
    state.nudges[id] === "done" ? null : { ...state, nudges: { ...state.nudges, [id]: "done" } },
  );
};

export const nudgeDue = (state: UsageNudgesState | null, id: NudgeId): boolean => {
  if (!state || state.nudges[id] !== "pending") return false;
  if (id === "foundVia") return state.replies >= FOUND_VIA_AFTER_REPLIES;
  return (state.days.length >= 2 && state.replies >= 1) || state.replies >= PHONE_APP_AFTER_REPLIES;
};

const subscribe = (listener: () => void) => {
  window.addEventListener(CHANGE_EVENT, listener);
  const stop = uiState.onExternalChange((key) => {
    if (key === STORAGE_KEY) listener();
  });
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    stop();
  };
};

export const useUsageNudges = (): UsageNudgesState | null =>
  useSyncExternalStore(subscribe, readUsageNudges, () => null);
