/**
 * Explicit messaging: an agent's words reach whoever started it only through
 * `send_message`. A turn's plain text stays in the agent's own transcript.
 *
 * - `send_message(..., done: true)` to the starter is the agent's finished
 *   report: it is filed as the report when the turn ends, and the task ends
 *   completed.
 * - `send_message` without `done` is a message, delivered at once.
 * - A turn that sends nothing ends quietly: the task is idle (recorded as
 *   waiting on the wire, so older backends never turn it into a report).
 * - The host nudges a quiet turn once (`IDLE_STOP_NUDGE`) when it took in a
 *   message from its starter, or when nothing live is left that could wake
 *   it; never for a turn the user typed into the agent's own thread. A nudged
 *   turn that is still quiet with nothing live ends the task with
 *   `silentEndReport`, unless the quiet turn was answering its starter's
 *   message ("thanks", "noted"): staying quiet is a fine answer there, and the
 *   task just stays idle.
 */

import { STELLA_MESSAGE_TARGET } from "./agent-directory.js";

/** The `send_message` parameter that marks a finished report. */
export const SEND_MESSAGE_DONE_PARAMETER = "done";

export const SEND_MESSAGE_DONE_DESCRIPTION =
  "Agents only: true on your finished report to whoever started you. It closes your task. Leave it off for anything else (a question, a blocker, an answer mid-task, a note to a teammate).";

/** What a task's starter reads as its status while it is idle with nothing running. */
export const IDLE_WAITING_FOR = "a message";

/** The longest idle status line made from what could wake a task. */
const IDLE_STATUS_MAX_CHARS = 200;

/** A quiet turn end's status: what can wake the task, else a message. */
export const idleWaitingFor = (wakers: readonly string[] | undefined): string => {
  const live = (wakers ?? []).map((waker) => waker.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (live.length === 0) return IDLE_WAITING_FOR;
  const line = live.join("; ");
  return line.length <= IDLE_STATUS_MAX_CHARS ? line : `${line.slice(0, IDLE_STATUS_MAX_CHARS - 1).trimEnd()}…`;
};

/** Marks the one nudge a quiet turn gets, so the host can tell it from any other input. */
export const IDLE_STOP_NUDGE_MARK = "[Not delivered]";

export const IDLE_STOP_NUDGE = `${IDLE_STOP_NUDGE_MARK} Your plain text isn't delivered to Stella or whoever started you. If it holds a finished report or an answer they are waiting for, send that now with send_message (done: true for a finished report). If nothing needs sending (you only acknowledged, or there is nothing new), stop now without sending anything.`;

export const isIdleStopNudge = (text: string): boolean => text.trimStart().startsWith(IDLE_STOP_NUDGE_MARK);

/** Starts the report filed for a task that stayed quiet after its nudge, with nothing left that could wake it. */
export const SILENT_END_MARK = "[Agent ended without reporting]";

export const silentEndReport = (lastMessage: string | undefined): string => {
  const last = lastMessage?.trim();
  return [
    `${SILENT_END_MARK} It stopped with nothing running and sent no message, even after being reminded once.`,
    last ? `Its last words in its own thread were:\n\n${last}` : "It wrote nothing at all.",
    "Check its work (agent_status, or message it) before relying on this.",
  ].join("\n\n");
};

/**
 * A task's result that is its finished report. The cloud files it at once:
 * a message already queued for the task starts a turn of its own afterwards
 * rather than holding this report back (older desktops, which end turns with
 * plain text, still have their report wait for that next turn).
 */
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

/** Why a `done` report is refused while the agent's own helpers still work. */
export const doneWhileHelpersWorkText = (helpers: readonly string[]): string =>
  `Not sent: ${helpers.join("; ")} ${helpers.length === 1 ? "is" : "are"} still at work, so your work isn't finished. Wait for ${
    helpers.length === 1 ? "its report" : "their reports"
  } (end your turn; it wakes you), or stop_agent ${helpers.length === 1 ? "it" : "them"}, then send your report with done: true. A message without done goes out now.`;

/** A finished report sent somewhere other than to its starter: says where it goes. */
export const doneNotToStarterText = (starterThreadId: string | undefined): string =>
  starterThreadId && starterThreadId !== STELLA_MESSAGE_TARGET
    ? `Not sent: done: true is only for your finished report to whoever started you, which is the agent with thread_id ${starterThreadId}. Send your report there with done: true, or send this without done.`
    : `Not sent: done: true is only for your finished report to whoever started you, which is Stella ("${STELLA_MESSAGE_TARGET}"). Send your report there with done: true, or send this without done.`;

export const DONE_ONLY_FOR_AGENTS = "done is for agents reporting to whoever started them; you are Stella, so send this without done.";

/** The tool result for a finished report: it goes out as the turn ends. */
export const DONE_ACCEPTED_TEXT =
  "Sent: your report goes to whoever started you as this turn ends, and your task is then done. Nothing else is needed; end your turn.";

/** A second finished report in one turn: the first already goes out as the turn ends. */
export const DONE_ALREADY_SENT =
  "Not sent: your finished report for this turn is already on its way, and nothing more goes out this turn. End your turn now, without calling any more tools.";

/**
 * Who a task is and who started it, for its prompt: what it needs to address
 * its messages and its finished report. A task with no starter given was
 * started by Stella.
 */
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
