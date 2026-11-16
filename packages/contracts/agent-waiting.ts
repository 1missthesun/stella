export const END_TURN_WAITING_TOOL = "end_turn_waiting";

export const WAITING_FOR_MAX_CHARS = 200;

export const END_TURN_WAITING_DESCRIPTION =
  "End this turn waiting instead of reporting: you keep your task, no report goes to whoever started you, and nobody is woken. Use it whenever your assignment is not done and is waiting on something still going (an agent you started, a background command or monitor that tells you when it ends, another task, a go-ahead, an upload, a set time); a message, a helper's report, a finished command or a scheduled fire resumes you as usual. Call it as your last step, then end the turn with one short line. When the work is done or failed, or you need your starter, end your turn with your report instead.";

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

/**
 * An attempt that ended waiting: stored as its result, it is not reported.
 * `reply` is what goes to its starter as a message instead (see
 * `unansweredWaitingReply`), when the turn took in the starter's message.
 */
export const waitingResultJson = (finalText: string, waitingFor: string, reply?: string): string =>
  JSON.stringify({ finalText, waitingFor, ...(reply ? { reply } : {}) });

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
