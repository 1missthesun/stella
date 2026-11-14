export const END_TURN_WAITING_TOOL = "end_turn_waiting";

export const WAITING_FOR_MAX_CHARS = 200;

export const END_TURN_WAITING_DESCRIPTION =
  "End this turn waiting instead of reporting: you keep your task, no report goes to whoever started you, and nobody is woken. Use it only when your assignment is not done and can't move until something arrives (a go-ahead, another task's work, an upload, a set time); a message, a helper's report or a scheduled fire resumes you as usual. Call it as your last step, then end the turn with one short line. When the work is done or failed, or you need your starter, end your turn with your report instead.";

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

export const endTurnWaitingResult = (waitingFor: string): string =>
  `You end this turn waiting for ${waitingFor}. No report goes out and nobody is woken; a message, a helper's report or a scheduled fire resumes you. End your turn now with one short line.`;

/** An attempt that ended waiting: stored as its result, it is not reported. */
export const waitingResultJson = (finalText: string, waitingFor: string): string =>
  JSON.stringify({ finalText, waitingFor });

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
