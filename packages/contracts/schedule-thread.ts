import { AGENT_MESSAGE_MAX_CHARS, AGENT_MESSAGE_SCHEDULE_RELATION, formatAgentMessage } from "./agent-directory.js";

export const SCHEDULE_THREAD_ID_MAX_CHARS = 128;

export type ScheduledThreadFire =
  | { kind: "task"; prompt: string; note?: string }
  | { kind: "finding"; found: string; instructions: string; once: boolean }
  | { kind: "failure"; error: string; instructions: string; repair: string };

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const bodyOf = (name: string, fire: ScheduledThreadFire): string => {
  switch (fire.kind) {
    case "task":
      return [`Your scheduled follow-up "${name}" is due now.`, "", fire.prompt, ...(fire.note ? ["", fire.note] : [])].join("\n");
    case "finding":
      return [
        `Watch "${name}" found something:`,
        fire.found,
        "",
        `It was set up for: ${fire.instructions}`,
        fire.once ? "It has done its job and stops checking now." : "It keeps checking on its schedule.",
        "Handle the finding as it says.",
      ].join("\n");
    case "failure":
      return [
        `Watch "${name}" failed to run its check (the check broke; nothing was found):`,
        fire.error,
        "",
        `It was set up for: ${fire.instructions}`,
        fire.repair,
      ].join("\n");
  }
};

/** The message an existing agent thread gets when a schedule targeting it fires. */
export const scheduledThreadMessage = (schedule: { scheduleId: string; name: string }, fire: ScheduledThreadFire): string => {
  const head = formatAgentMessage({ threadId: schedule.scheduleId, label: `schedule "${schedule.name}"` }, "x", {
    relation: AGENT_MESSAGE_SCHEDULE_RELATION,
  });
  const room = AGENT_MESSAGE_MAX_CHARS - head.length;
  return formatAgentMessage(
    { threadId: schedule.scheduleId, label: `schedule "${schedule.name}"` },
    clip(bodyOf(schedule.name, fire), room),
    { relation: AGENT_MESSAGE_SCHEDULE_RELATION },
  );
};

/** Put ahead of the run Stella gets instead when the target thread can't take it. */
export const scheduledThreadFallbackNote = (threadId: string, reason: string): string =>
  `(This schedule was set to wake agent ${threadId}, which ${reason}, so it comes to you instead. Handle it, or start an agent for it.)`;
