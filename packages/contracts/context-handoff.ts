export const CONTEXT_HANDOFF_TOOL = "handoff";

export const CONTEXT_HANDOFF_DESCRIPTION =
  "Hand your work to a fresh context in this same conversation. Call it when a Stella reminder says your context is large, or when a long task moves to a clearly new phase. `notes` is the brief you'd give yourself to carry on: the goal and what done looks like, decisions and why, exact paths, commands, ids, numbers and errors that still matter, what is finished, what is in progress, and the next steps. Stella adds your task, this turn's messages and the work still running. Afterwards only these notes and what follows are in your context; the conversation's history stays searchable.";

export const CONTEXT_HANDOFF_NOTES_DESCRIPTION = "Your handoff notes, plain text or markdown.";

export const CONTEXT_HANDOFF_PREFIX =
  "[Context handoff] Your earlier context was replaced by the notes below, which you wrote just before the switch. Older messages are no longer in your context; search this conversation's history when you need one.";

const HANDOFF_FRACTION = 0.6;
const HANDOFF_MAX_TOKENS = 500_000;
const HANDOFF_MIN_WINDOW = 32_000;
const OFFERED_FRACTION = 0.5;
const NUDGE_STEP_FRACTION = 0.05;

export const CONTEXT_HANDOFF_NOTES_MAX_CHARS = 60_000;
export const CONTEXT_HANDOFFS_PER_TURN = 2;

const ATTACHED_TASK_MAX_CHARS = 16_000;
const ATTACHED_TURN_MAX_CHARS = 24_000;
const ATTACHED_RUNNING_MAX = 40;

export const CLAUDE_CODE_AGENT_AUTO_COMPACT_WINDOW = 433_000;

export const CONTEXT_SIZE_DIAGNOSTIC = "stella.context";

export const contextHandoffThreshold = (window: number, override?: number): number | undefined => {
  if (override !== undefined && Number.isFinite(override) && override > 0) return Math.floor(override);
  if (!(window >= HANDOFF_MIN_WINDOW)) return undefined;
  return Math.min(Math.floor(window * HANDOFF_FRACTION), HANDOFF_MAX_TOKENS);
};

export const contextHandoffOffered = (tokens: number, threshold: number): boolean => tokens >= threshold * OFFERED_FRACTION;

export const parseHandoffTokens = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

export const isContextHandoffText = (text: string): boolean => text.startsWith(CONTEXT_HANDOFF_PREFIX);

const kilo = (tokens: number): string => `${Math.round(tokens / 1000)}k`;

export const contextHandoffNudge = (args: { tokens: number; threshold: number; blocked?: string }): string => {
  const step = Math.max(1, Math.floor(args.threshold * NUDGE_STEP_FRACTION));
  const shown = Math.floor(args.tokens / step) * step;
  return [
    "<system-reminder>",
    `Your context is about ${kilo(shown)} tokens; Stella hands work to a fresh context at ${kilo(args.threshold)}.`,
    args.blocked
      ? `Before you can, ${args.blocked} Then call \`${CONTEXT_HANDOFF_TOOL}\`.`
      : `Call \`${CONTEXT_HANDOFF_TOOL}\` now, before anything else, then carry on in the fresh context.`,
    "Write the notes as the brief you'd give yourself to continue: the goal and what done looks like, decisions and why, exact paths, commands, ids, numbers and errors that still matter, what is finished, what is in progress, and the next steps. Stella adds your task, this turn's messages and the work still running.",
    "</system-reminder>",
  ].join("\n");
};

const bounded = (text: string, max: number, keep: "head" | "tail"): string => {
  if (text.length <= max) return text;
  const note = `[… ${text.length - max} characters left out …]`;
  return keep === "head" ? `${text.slice(0, max)}\n${note}` : `${note}\n${text.slice(text.length - max)}`;
};

export type ContextHandoffRunning = { kind: "helper" | "command"; id: string; description: string };

export const contextHandoffText = (args: {
  notes: string;
  task?: string;
  turn: readonly string[];
  running: readonly ContextHandoffRunning[];
}): string => {
  const parts = [CONTEXT_HANDOFF_PREFIX, "", "<handoff_notes>", args.notes.trim(), "</handoff_notes>"];
  const task = args.task?.trim();
  if (task) parts.push("", "<your_task>", bounded(task, ATTACHED_TASK_MAX_CHARS, "head"), "</your_task>");
  const turn = args.turn.map((text) => text.trim()).filter((text) => text && text !== task);
  if (turn.length > 0) {
    parts.push("", "<this_turn_messages>", bounded(turn.join("\n\n---\n\n"), ATTACHED_TURN_MAX_CHARS, "tail"), "</this_turn_messages>");
  }
  const running = args.running.slice(0, ATTACHED_RUNNING_MAX);
  parts.push(
    "",
    "<still_running>",
    ...(running.length === 0
      ? ["Nothing you started is still running."]
      : running.map((item) =>
          item.kind === "helper"
            ? `- Helper ${item.id}: ${item.description} (its report reaches you on its own)`
            : `- Background command ${item.id}: ${item.description} (you are told when it ends)`,
        )),
    ...(args.running.length > running.length ? [`- …and ${args.running.length - running.length} more`] : []),
    "</still_running>",
    "",
    "Continue the work from these notes.",
  );
  return parts.join("\n");
};
