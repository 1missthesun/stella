import { STELLA_MESSAGE_TARGET } from "./agent-directory.js";

export const SEND_MESSAGE_DONE_PARAMETER = "done";

export const SEND_MESSAGE_DONE_DESCRIPTION =
  "Agents only: true on your finished report to whoever started you. It closes your task. Leave it off for anything else (a question, a blocker, an answer mid-task, a note to a teammate).";

export const IDLE_WAITING_FOR = "a message";

const IDLE_STATUS_MAX_CHARS = 200;

export const idleWaitingFor = (wakers: readonly string[] | undefined): string => {
  const live = (wakers ?? []).map((waker) => waker.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (live.length === 0) return IDLE_WAITING_FOR;
  const line = live.join("; ");
  return line.length <= IDLE_STATUS_MAX_CHARS ? line : `${line.slice(0, IDLE_STATUS_MAX_CHARS - 1).trimEnd()}…`;
};

export const IDLE_STOP_NUDGE_MARK = "[Not delivered]";

export const IDLE_STOP_NUDGE = `${IDLE_STOP_NUDGE_MARK} Your plain text isn't delivered to Stella or whoever started you. If it holds a finished report or an answer they are waiting for, send that now with send_message (done: true for a finished report). If nothing needs sending (you only acknowledged, or there is nothing new), stop now without sending anything.`;

export const isIdleStopNudge = (text: string): boolean => text.trimStart().startsWith(IDLE_STOP_NUDGE_MARK);

export const SILENT_END_MARK = "[Agent ended without reporting]";

export const silentEndReport = (lastMessage: string | undefined): string => {
  const last = lastMessage?.trim();
  return [
    `${SILENT_END_MARK} It stopped with nothing running and sent no message, even after being reminded once.`,
    last ? `Its last words in its own thread were:\n\n${last}` : "It wrote nothing at all.",
    "Check its work (agent_status, or message it) before relying on this.",
  ].join("\n\n");
};

export const doneResultJson = (finalText: string): string => JSON.stringify({ finalText, done: true });

export const resultDone = (resultJson: string | null | undefined): boolean => {
  if (!resultJson) return false;
  try {
    const parsed = JSON.parse(resultJson) as { done?: unknown } | null;
    return Boolean(parsed && typeof parsed === "object" && parsed.done === true);
  } catch {
    return false;
  }
};

export const doneWhileHelpersWorkText = (helpers: readonly string[]): string =>
  `Not sent: ${helpers.join("; ")} ${helpers.length === 1 ? "is" : "are"} still at work, so your work isn't finished. Wait for ${
    helpers.length === 1 ? "its report" : "their reports"
  } (end your turn; it wakes you), or stop_agent ${helpers.length === 1 ? "it" : "them"}, then send your report with done: true. A message without done goes out now.`;

export const doneNotToStarterText = (starterThreadId: string | undefined): string =>
  starterThreadId && starterThreadId !== STELLA_MESSAGE_TARGET
    ? `Not sent: done: true is only for your finished report to whoever started you, which is the agent with thread_id ${starterThreadId}. Send your report there with done: true, or send this without done.`
    : `Not sent: done: true is only for your finished report to whoever started you, which is Stella ("${STELLA_MESSAGE_TARGET}"). Send your report there with done: true, or send this without done.`;

export const DONE_ONLY_FOR_AGENTS = "done is for agents reporting to whoever started them; you are Stella, so send this without done.";

export const DONE_ACCEPTED_TEXT =
  "Sent: your report goes to whoever started you as this turn ends, and your task is then done. Nothing else is needed; end your turn.";

export const DONE_ALREADY_SENT =
  "Not sent: your finished report for this turn is already on its way, and nothing more goes out this turn. End your turn now, without calling any more tools.";

export const agentIdentityText = (agent: {
  threadId: string;
  startedBy?: { threadId: string; label?: string; stella?: boolean };
}): string => {
  const by = agent.startedBy;
  const starter = !by
    ? `Stella started you; send_message to "${STELLA_MESSAGE_TARGET}" reaches it.`
    : by.stella
      ? `Stella started you; its thread_id is ${by.threadId} ("${STELLA_MESSAGE_TARGET}" also reaches it).`
      : by.label
        ? `The agent "${by.label}" started you; its thread_id is ${by.threadId}. Send your messages and your finished report to that thread_id, not to "${STELLA_MESSAGE_TARGET}".`
        : `Another agent started you; its thread_id is ${by.threadId}. Send your messages and your finished report to that thread_id, not to "${STELLA_MESSAGE_TARGET}".`;
  return [
    `Your thread_id is ${agent.threadId}.`,
    starter,
    'Every message from Stella or another agent arrives as `<agent-message from="…" thread_id="…">`, marked `relation="started you"` when it is from whoever started you; answer it with send_message to that thread_id.',
  ].join(" ");
};

/** A task that messaged whoever started it (without done) and ended its turn waits on their reply. */
export const STARTER_REPLY_WAKER = "a reply to the message you sent whoever started you";

/** A task that asked with ask_user or request_secure_input waits on that answer, which comes from Stella or the user. */
export const QUESTION_ASKED_WAKER = "an answer to the question you put to whoever started you";

/**
 * What a waiting helper's own wait means to the agent that started it: `onStarter` when it waits on
 * that agent's reply (a debt the starter owes, never something that wakes it), `live` when something
 * else of the helper's own can still wake it (and so, through its report, the starter).
 */
export const helperWait = (wait: { waitingFor?: string; wakers?: readonly string[] }): { onStarter: boolean; live: boolean } => {
  if (wait.wakers !== undefined) {
    const others = wait.wakers.map((waker) => waker.trim()).filter((waker) => waker && waker !== STARTER_REPLY_WAKER);
    return { onStarter: wait.wakers.includes(STARTER_REPLY_WAKER), live: others.length > 0 };
  }
  const text = wait.waitingFor?.trim() ?? "";
  const onStarter = text.includes(STARTER_REPLY_WAKER);
  return { onStarter, live: text !== "" && text !== IDLE_WAITING_FOR && text !== STARTER_REPLY_WAKER };
};

export type HelperWaitingOnYou = { threadId: string; description: string };

const helperName = (helper: HelperWaitingOnYou) =>
  `"${helper.description.replace(/\s+/g, " ").trim().slice(0, 80)}" (thread_id: ${helper.threadId})`;

export const HELPER_WAITS_ON_YOU_MARK = "[Your helper is waiting on you]";

export const helperWaitsOnYouText = (helpers: readonly HelperWaitingOnYou[]): string => {
  const one = helpers.length === 1;
  return [
    `${HELPER_WAITS_ON_YOU_MARK} Your ${one ? "helper" : "helpers"} ${helpers.map(helperName).join(", ")} ${
      one ? "messaged you and ended its turn" : "messaged you and ended their turns"
    } waiting for your reply, and nothing else will wake ${one ? "it" : "them"}.`,
    `Reply with send_message to ${one ? "its thread_id" : "each thread_id"} (handling its point elsewhere is not a reply), or stop_agent ${
      one ? "it" : "them"
    } if nothing more is needed from ${one ? "it" : "them"}.`,
  ].join(" ");
};

export const doneWhileHelpersWaitText = (helpers: readonly HelperWaitingOnYou[]): string => {
  const one = helpers.length === 1;
  return `Not sent: your ${one ? "helper" : "helpers"} ${helpers.map(helperName).join(", ")} ${
    one ? "is" : "are"
  } waiting for your reply to ${one ? "its" : "their"} message. Reply with send_message, or stop_agent ${
    one ? "it" : "them"
  } if nothing more is needed, then send your report with done: true.`;
};
