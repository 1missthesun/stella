export const END_TURN_WAITING_TOOL = "end_turn_waiting";

export const WAITING_FOR_MAX_CHARS = 200;

export const END_TURN_WAITING_DESCRIPTION =
  "End this turn waiting instead of reporting: you keep your task, no report goes to whoever started you, and nobody is woken. Use it whenever your assignment is not done and is waiting on something still going (an agent you started, a background command or monitor that tells you when it ends, another task, a go-ahead, an upload, a set time); a message, a helper's report, a finished command or a scheduled fire resumes you as usual. Something live must be able to wake you: with nothing (no background command or monitor of yours running, no helper at work, no schedule aimed at you, no open question to whoever started you) the wait is refused, so set one up first (a scheduled check aimed at you survives restarts). If what you wait on is stopped or removed while you wait, you are woken and told. Call it as your last step, then end the turn with one short line. When the work is done or failed, or you need your starter, end your turn with your report instead.";

export const END_TURN_WAITING_PARAMETERS = {
  type: "object",
  properties: {
    waiting_for: {
      type: "string",
      description: "What you are waiting for, in a few words. It shows as your status.",
    },
  },
  required: ["waiting_for"],
  additionalProperties: false,
} as const;

export const parseWaitingFor = (args: Record<string, unknown>): string | undefined => {
  const value = typeof args.waiting_for === "string" ? args.waiting_for.replace(/\s+/g, " ").trim() : "";
  return value ? value.slice(0, WAITING_FOR_MAX_CHARS) : undefined;
};

export const END_TURN_WAITING_MISSING = "Say what you are waiting for in waiting_for.";

export const endTurnWaitingResult = (waitingFor: string, wakers?: readonly string[]): string =>
  [
    `You end this turn waiting for ${waitingFor}. No report goes out and nobody is woken; a message, a helper's report or a scheduled fire resumes you.`,
    ...(wakers && wakers.length > 0 ? [`What can wake you now: ${wakers.join("; ")}.`] : []),
    "End your turn now with one short line.",
  ].join(" ");

const SCHEDULE_GONE_MARK = "[wake: the schedule \"";

export const isScheduleGoneText = (text: string): boolean => text.trimStart().startsWith(SCHEDULE_GONE_MARK);

export const scheduleGoneText = (name: string, change: "removed" | "paused"): string =>
  [
    `${SCHEDULE_GONE_MARK}${name.replace(/\s+/g, " ").trim().slice(0, 120)}" aimed at you was ${change}, so it will not wake you.]`,
    "",
    "You were resumed for this. If you were waiting on it, check directly whether what it was for has happened; if you still need to wait, set up another way to be woken (a background command or monitor that ends when it happens, or a scheduled check aimed at you), or report.",
  ].join("\n");

export const UNLISTED_SCHEDULES_WAKER = "schedules aimed at you (they could not be listed just now)";
export const UNLISTED_WORK_WAKER = "work of yours on this computer that could not be listed just now";
export const isUnlistedWaker = (waker: string): boolean => waker === UNLISTED_SCHEDULES_WAKER || waker === UNLISTED_WORK_WAKER;

export const waitingResultJson = (finalText: string, waitingFor: string, reply?: string, wakers?: readonly string[]): string =>
  JSON.stringify({ finalText, waitingFor, ...(reply ? { reply } : {}), ...(wakers ? { wakers: wakers.slice(0, WAKERS_MAX) } : {}) });

export const WAKERS_MAX = 20;

export const resultWakers = (resultJson: string | null | undefined): string[] | undefined => {
  if (!resultJson?.trim()) return undefined;
  try {
    const parsed = JSON.parse(resultJson) as { wakers?: unknown } | null;
    return parsed && typeof parsed === "object" && Array.isArray(parsed.wakers)
      ? parsed.wakers.filter((waker): waker is string => typeof waker === "string" && waker.trim() !== "").slice(0, WAKERS_MAX)
      : undefined;
  } catch {
    return undefined;
  }
};

export const resultWaitingFor = (resultJson: string | null | undefined): string | undefined => {
  if (!resultJson?.trim()) return undefined;
  try {
    const parsed = JSON.parse(resultJson) as { waitingFor?: unknown } | null;
    return parsed && typeof parsed === "object" && typeof parsed.waitingFor === "string" && parsed.waitingFor.trim()
      ? parsed.waitingFor.trim()
      : undefined;
  } catch {
    return undefined;
  }
};

export const helperStoppedText = (helper: { threadId: string; description: string }): string =>
  [
    `Your helper "${helper.description.replace(/\s+/g, " ").trim().slice(0, 120)}" (thread_id: ${helper.threadId}) was stopped, so no report will come from it, and none of your helpers is still at work.`,
    "Carry on without it: do that part yourself, start another helper, or report what you have. End your turn waiting again only if you are waiting for something else.",
  ].join(" ");

const STARTER_MESSAGE_RE = /<agent-message from="([^"\n]*)" thread_id="([^"\n]*)" relation="started you">/gu;

export const starterMessageSender = (texts: readonly string[]): { label: string; threadId: string } | undefined => {
  let found: { label: string; threadId: string } | undefined;
  for (const text of texts) {
    for (const match of text.matchAll(STARTER_MESSAGE_RE)) found = { label: match[1]!, threadId: match[2]! };
  }
  return found;
};

export const unansweredWaitingReply = (text: string, waitingFor: string): string =>
  [text.trim(), `(Still working: it ended this turn waiting for ${waitingFor}.)`].filter(Boolean).join("\n\n");
