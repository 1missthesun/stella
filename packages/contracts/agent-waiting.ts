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

/** A schedule-gone notice: it matters only to a task still waiting, and is dropped for one at work. */
export const isScheduleGoneText = (text: string): boolean => text.trimStart().startsWith(SCHEDULE_GONE_MARK);

/** What a task waiting with a schedule aimed at it hears when that schedule is removed or paused. */
export const scheduleGoneText = (name: string, change: "removed" | "paused"): string =>
  [
    `${SCHEDULE_GONE_MARK}${name.replace(/\s+/g, " ").trim().slice(0, 120)}" aimed at you was ${change}, so it will not wake you.]`,
    "",
    "You were resumed for this. If you were waiting on it, check directly whether what it was for has happened; if you still need to wait, set up another way to be woken (a background command or monitor that ends when it happens, or a scheduled check aimed at you), or report.",
  ].join("\n");

/** Starts the message a task gets when it ended its turn waiting with nothing left that could wake it. */
export const NOTHING_CAN_WAKE_MARK = "[Nothing can wake you]";

const NOTHING_LIVE =
  "no background command or monitor of yours is running, no helper of yours is at work, no schedule is aimed at you, no message is on its way to you, and you have no question open with whoever started you";

const NOTHING_CAN_WAKE_STEPS =
  "Check directly now whether it has already happened. If it has not and you still need to wait, first set up what will wake you: a background command or monitor that ends when it happens, or a scheduled check aimed at you (schedule_add in code, a task with your thread). Then end your turn waiting again. If only a person can move it on, ask them (ask_user), or end your turn with your report.";

/** end_turn_waiting refused: nothing live could ever resume the task. */
export const nothingCanWakeRefusal = (waitingFor: string): string =>
  `You can't end this turn waiting for ${waitingFor}: nothing that could wake you is live (${NOTHING_LIVE}), so you would wait until someone noticed. ${NOTHING_CAN_WAKE_STEPS}`;

/**
 * The wake a task gets when its turn ended waiting but what could have woken it
 * was gone by then (it stopped its last helper or its watch after calling
 * end_turn_waiting, say).
 */
export const nothingCanWakeText = (waitingFor: string): string =>
  `${NOTHING_CAN_WAKE_MARK} You ended your turn waiting for ${waitingFor}, but by the time it ended nothing that could wake you was live (${NOTHING_LIVE}). You were resumed for this. ${NOTHING_CAN_WAKE_STEPS}`;

/**
 * The wake a waiting task gets when what it may have been waiting on could not
 * be listed as it waited (its cloud schedules, while offline), and once listed,
 * nothing that could wake it is live.
 */
export const nothingCanWakeNowText = (waitingFor: string): string =>
  `${NOTHING_CAN_WAKE_MARK} You are waiting for ${waitingFor}, but nothing that could wake you is live (${NOTHING_LIVE}). You were resumed for this. ${NOTHING_CAN_WAKE_STEPS}`;

/**
 * What can wake a waiting task but could not be listed just now (a schedule
 * list that failed or had not loaded): it counts as live, since it may well
 * be, and the task is checked again once it can be listed.
 */
export const UNLISTED_SCHEDULES_WAKER = "schedules aimed at you (they could not be listed just now)";
export const UNLISTED_WORK_WAKER = "work of yours on this computer that could not be listed just now";
export const isUnlistedWaker = (waker: string): boolean => waker === UNLISTED_SCHEDULES_WAKER || waker === UNLISTED_WORK_WAKER;

/**
 * An attempt that ended waiting: stored as its result, it is not reported.
 * `reply` is what goes to its starter as a message instead (see
 * `unansweredWaitingReply`), when the turn took in the starter's message.
 */
export const waitingResultJson = (finalText: string, waitingFor: string, reply?: string, wakers?: readonly string[]): string =>
  JSON.stringify({ finalText, waitingFor, ...(reply ? { reply } : {}), ...(wakers ? { wakers: wakers.slice(0, WAKERS_MAX) } : {}) });

/** How many of a waiting task's wakers its record keeps. */
export const WAKERS_MAX = 20;

/** What its computer saw could wake a waiting task, when it recorded that. */
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

export const resultWaitingReply = (resultJson: string | null | undefined): string | undefined => {
  if (!resultJson?.trim()) return undefined;
  try {
    const parsed = JSON.parse(resultJson) as { reply?: unknown; waitingFor?: unknown } | null;
    return parsed && typeof parsed === "object" && typeof parsed.waitingFor === "string" && typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What a computer's turn "waits for" when its words go out with the next
 * report instead of one of its own (an input already on its way, a helper
 * still working, or the next turn already reported them): it ends there with no
 * report, and nothing about it is news to whoever started the task.
 */
export const HANDED_ON_WAITING_FOR = "a message already on its way to it, or a helper still working";

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

/**
 * What an agent that ended its turn waiting hears when its last helper still
 * at work was stopped: a stopped agent sends no report, so without this it
 * would wait for good.
 */
export const helperStoppedText = (helper: { threadId: string; description: string }): string =>
  [
    `Your helper "${helper.description.replace(/\s+/g, " ").trim().slice(0, 120)}" (thread_id: ${helper.threadId}) was stopped, so no report will come from it, and none of your helpers is still at work.`,
    "Carry on without it: do that part yourself, start another helper, or report what you have. End your turn waiting again only if you are waiting for something else.",
  ].join(" ");

const STARTER_MESSAGE_RE = /<agent-message from="([^"\n]*)" thread_id="([^"\n]*)" relation="started you">/gu;

/**
 * Whoever started the agent, read from the messages a turn took in: the last
 * message framed `relation="started you"` (see `formatAgentMessage`). Its label
 * is "Stella" when Stella started the agent.
 */
export const starterMessageSender = (texts: readonly string[]): { label: string; threadId: string } | undefined => {
  let found: { label: string; threadId: string } | undefined;
  for (const text of texts) {
    for (const match of text.matchAll(STARTER_MESSAGE_RE)) found = { label: match[1]!, threadId: match[2]! };
  }
  return found;
};

/**
 * A turn that took in a message from its starter and ended waiting without
 * answering it by message: its last words go to the starter as its reply, since
 * a waiting turn sends no report and the waiting note is only a status label.
 */
export const unansweredWaitingReply = (text: string, waitingFor: string): string =>
  [text.trim(), `(Still working: it ended this turn waiting for ${waitingFor}.)`].filter(Boolean).join("\n\n");
