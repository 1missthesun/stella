export const SCHEDULE_ADD_TOOL_NAME = "schedule_add";
export const SCHEDULE_LIST_TOOL_NAME = "schedule_list";
export const SCHEDULE_UPDATE_TOOL_NAME = "schedule_update";
export const SCHEDULE_REMOVE_TOOL_NAME = "schedule_remove";

export const SCHEDULE_TOOL_NAMES = [
  SCHEDULE_ADD_TOOL_NAME,
  SCHEDULE_LIST_TOOL_NAME,
  SCHEDULE_UPDATE_TOOL_NAME,
  SCHEDULE_REMOVE_TOOL_NAME,
] as const;

export const SCHEDULE_SEARCH_TERMS = [
  "schedule",
  "schedules",
  "scheduling",
  "reminder",
  "remind",
  "recurring",
  "cron",
  "daily",
  "weekly",
  "timer",
  "alarm",
  "watch",
  "watcher",
  "monitor",
  "sensor",
  "notify",
  "automation",
  "task",
] as const;

/**
 * Flat on purpose: the handlers validate the shape per kind, so the schema
 * carries only the one-line contract instead of a oneOf per kind.
 */
export const SCHEDULE_DEFINITION_PROPERTY = {
  type: "object",
  description:
    "When to fire: { kind: 'at', atMs } once at an epoch ms | { kind: 'every', everyMs, anchorMs? } | { kind: 'cron', expr, tz? } (5-field cron; without tz it runs at that clock time wherever the user is, following their time zone; pass an IANA tz only for a time tied to a specific other place).",
  properties: {
    kind: { type: "string", enum: ["at", "every", "cron"] },
    atMs: { type: "number" },
    everyMs: { type: "number" },
    anchorMs: { type: "number" },
    expr: { type: "string" },
    tz: { type: "string" },
  },
  required: ["kind"],
} as const;

export const SCHEDULE_JOB_ID_PROPERTY = {
  type: "string",
  description:
    "Entry id returned by schedule_add / schedule_list (cron:… for reminders/tasks/watches, heartbeat:… for conversation check-ins).",
} as const;

export type ScheduleToolDescriptor = {
  name: (typeof SCHEDULE_TOOL_NAMES)[number];
  label: string;
  workingText: string;
  description: string;
  parameters: Record<string, unknown>;
};

export const SCHEDULE_ADD_TOOL_DESCRIPTOR: ScheduleToolDescriptor = {
  name: SCHEDULE_ADD_TOOL_NAME,
  label: "Add schedule",
  workingText: "Adding schedule",
  description:
    "Create a reminder (message, delivered as written with no AI), a task (an agent runs prompt at each fire and reports back, or an existing agent thread is messaged with it) or a watch (an AI-free check script on a repeating schedule, in the cloud or with runsOn 'computer' here; only a finding or failure wakes AI). Limits: repeats at least 15 minutes apart (watches 5), at most 25 schedules, and a daily budget of scheduled runs. A cloud watch script is run once before saving and the first result is returned. On a computer signed out of Stella, or one keeping chats only on itself (cloud sync off), every schedule lives only on that computer (a watch then needs runsOn 'computer'). On a plan without cloud runs (Free), tasks and a watch's findings run only on the user's computer: if it is off or asleep when one is due, the user is told and it runs once the computer is back. An agent that schedules a task or watch gets it on its own thread by default: at fire time it resumes with its whole context, and its report goes where its reports always go, without waking Stella first.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Short human label shown in lists and notifications.",
      },
      kind: {
        type: "string",
        enum: ["reminder", "task", "watch"],
        description: "Trigger kind.",
      },
      schedule: SCHEDULE_DEFINITION_PROPERTY,
      message: {
        type: "string",
        description:
          "kind='reminder': what you will say when it fires, written now in your own voice and complete. Delivered as is, with no AI.",
      },
      prompt: {
        type: "string",
        description:
          "kind='task': the work, as the brief an agent gets at fire time (or you, with deliverTo 'orchestrator'; or the message the target thread gets, with deliverTo 'thread'). kind='watch': what to do with a finding, as the user put it (tell them, ask them, or act; with deliverTo 'agent', the approved action itself). Make it self-contained.",
      },
      script: {
        type: "string",
        description:
          "kind='watch' in the cloud: an ES module, `export default async function check({ state }) { ... return { found, state } }`. It may fetch; `state` is what it returned last time (null at first). Return a non-empty `found` describing what it found only when there is something to act on; throw when the check itself fails. No AI, no secrets, no local files.",
      },
      scriptPath: {
        type: "string",
        description:
          "kind='watch' with runsOn 'computer': absolute path of the check script verified with ScriptDraft. Empty stdout = nothing found (silent); non-empty stdout = what it found; non-zero exit = sensor failure.",
      },
      runsOn: {
        type: "string",
        enum: ["cloud", "computer"],
        description:
          "kind='watch': where it runs, one place only. 'cloud' (default) works with the computer off; use 'computer' only when the check needs this machine (a site signed in here, local files) or the cloud is off.",
      },
      deliverTo: {
        type: "string",
        enum: ["orchestrator", "agent", "thread"],
        description:
          "kind='task': 'agent' (default for Stella) starts a new agent on prompt; 'orchestrator' only when it needs Stella's judgment at fire time; 'thread' messages an existing agent thread (threadId) with prompt, which resumes it with its own context. kind='watch': who handles a finding; 'orchestrator' (default for Stella) wakes Stella to tell, ask or act as prompt says, 'agent' starts an agent on prompt right away, for an action the user already approved (\"book it when it opens\"), 'thread' hands the finding to an existing agent thread. An agent calling this gets 'thread' on its own thread by default; pass 'orchestrator' or 'agent' to wake Stella or start a fresh agent instead.",
      },
      threadId: {
        type: "string",
        description:
          "kind='task' or 'watch' with deliverTo 'thread': the thread_id of an existing agent (from agent_status or spawn_agent) to message at fire time. Use it to have the agent already doing that work pick up its own follow-up (\"check the deploy in 2 hours\") instead of a fresh agent. Defaults to the calling agent's own thread. If that thread is gone when it fires, Stella gets it instead, with a note.",
      },
      once: {
        type: "boolean",
        description:
          "kind='watch': stop after the first finding is handed over (a one-off question). Leave false to keep watching.",
      },
      description: {
        type: "string",
        description: "Optional explanation shown in schedule_list.",
      },
      conversationId: {
        type: "string",
        description:
          "Optional conversation override; defaults to the current conversation.",
      },
      deleteAfterRun: {
        type: "boolean",
        description:
          "Remove the entry after a successful fire. Only meaningful for schedule.kind='at'.",
      },
    },
    required: ["name", "kind", "schedule"],
  },
};

export const SCHEDULE_LIST_TOOL_DESCRIPTOR: ScheduleToolDescriptor = {
  name: SCHEDULE_LIST_TOOL_NAME,
  label: "List schedules",
  workingText: "Checking schedules",
  description:
    "List every scheduled trigger (reminders, tasks, watches, plus any legacy entries) and every conversation heartbeat check-in, with ids, schedules, next fire times, and last-run status.",
  parameters: { type: "object", properties: {} },
};

export const SCHEDULE_UPDATE_TOOL_DESCRIPTOR: ScheduleToolDescriptor = {
  name: SCHEDULE_UPDATE_TOOL_NAME,
  label: "Update schedule",
  workingText: "Updating schedule",
  description:
    "Patch an existing schedule entry: rename, reschedule, enable/disable, or edit its content (message for reminders, prompt for tasks, scriptPath for watches — the entry keeps its kind). Also edits heartbeat check-ins by their heartbeat:… id: enabled pauses/resumes, schedule { kind: 'every', everyMs } changes cadence, prompt changes what each check-in does. Pass only the fields to change.",
  parameters: {
    type: "object",
    properties: {
      jobId: SCHEDULE_JOB_ID_PROPERTY,
      name: { type: "string", description: "New label." },
      schedule: SCHEDULE_DEFINITION_PROPERTY,
      message: {
        type: "string",
        description: "Reminder entries: replacement message text.",
      },
      prompt: {
        type: "string",
        description: "Task entries: replacement intent prompt. Watch entries: replacement instructions for a finding.",
      },
      script: {
        type: "string",
        description:
          "Cloud watch entries: replacement check script (same contract as schedule_add), checked once before it is saved.",
      },
      scriptPath: {
        type: "string",
        description:
          "Computer watch entries: replacement verified check script path (from ScriptDraft).",
      },
      deliverTo: {
        type: "string",
        enum: ["orchestrator", "agent", "thread"],
        description: "Task entries: who runs it at fire time. Watch entries: who handles a finding. 'thread' with threadId (default: your own thread) targets an existing agent; 'orchestrator' or 'agent' drops the target thread.",
      },
      threadId: {
        type: "string",
        description: "Task and watch entries: deliver to this existing agent thread from now on.",
      },
      once: {
        type: "boolean",
        description: "Watch entries: stop after the first finding is handed over.",
      },
      description: { type: "string" },
      enabled: {
        type: "boolean",
        description: "Pause (false) or resume (true) the entry.",
      },
      deleteAfterRun: { type: "boolean" },
    },
    required: ["jobId"],
  },
};

export const SCHEDULE_REMOVE_TOOL_DESCRIPTOR: ScheduleToolDescriptor = {
  name: SCHEDULE_REMOVE_TOOL_NAME,
  label: "Remove schedule",
  workingText: "Removing schedule",
  description:
    "Delete a schedule entry (and its check script file, for watches). A heartbeat:… id turns that conversation check-in off (heartbeats are disabled rather than deleted, and can be re-enabled with schedule_update).",
  parameters: {
    type: "object",
    properties: { jobId: SCHEDULE_JOB_ID_PROPERTY },
    required: ["jobId"],
  },
};


export type ScheduleTarget =
  | { kind: "orchestrator" }
  | { kind: "agent" }
  | { kind: "thread"; threadId: string };

const STELLA_TARGET = "stella";

const threadTarget = (threadId: string): ScheduleTarget => {
  if (threadId.toLowerCase() === STELLA_TARGET) {
    throw new Error("To have Stella handle it, use deliverTo 'orchestrator' instead of a threadId.");
  }
  return { kind: "thread", threadId };
};

/**
 * Who a task's fire or a watch's finding goes to. An agent's own schedule
 * defaults to its own thread; Stella's keeps each kind's default (undefined).
 * On update, undefined means unchanged.
 */
export const resolveScheduleTarget = (
  args: Record<string, unknown>,
  caller: { threadId?: string },
  mode: "add" | "update",
): ScheduleTarget | undefined => {
  const deliverTo = typeof args.deliverTo === "string" ? args.deliverTo.trim() : "";
  const threadId = typeof args.threadId === "string" ? args.threadId.trim() : "";
  if (deliverTo && deliverTo !== "orchestrator" && deliverTo !== "agent" && deliverTo !== "thread") {
    throw new Error("deliverTo must be 'orchestrator', 'agent' or 'thread'.");
  }
  if (deliverTo === "orchestrator" || deliverTo === "agent") {
    if (threadId) throw new Error(`threadId goes with deliverTo 'thread', not '${deliverTo}'.`);
    return { kind: deliverTo };
  }
  if (threadId) return threadTarget(threadId);
  if (deliverTo === "thread") {
    if (!caller.threadId) {
      throw new Error("deliverTo 'thread' needs threadId: the thread_id of the agent to message when it fires.");
    }
    return threadTarget(caller.threadId);
  }
  return mode === "add" && caller.threadId ? threadTarget(caller.threadId) : undefined;
};

export const scheduleTargetLabel = (threadId: string | undefined, self?: string): string =>
  threadId ? (threadId === self ? " It messages your own thread when it fires." : ` It messages agent ${threadId} when it fires.`) : "";


export type ScheduleListRow = {
  jobId: string;
  name: string;
  kind: string;
  when: string;
  enabled: boolean;
  next?: string;
  message?: string;
  prompt?: string;
  scriptPath?: string;
  deliverTo?: string;
  threadId?: string;
  once?: true;
  lastFinding?: string;
  lastError?: string;
  runsOn?: "computer";
  waitingForComputerSince?: string;
};

const compactScheduleRow = (row: ScheduleListRow): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(row).filter(([, value]) => value !== undefined && value !== ""),
    ),
  );

export const formatScheduleList = (
  entries: readonly ScheduleListRow[],
  heartbeats: readonly ScheduleListRow[] = [],
): string => {
  if (entries.length === 0 && heartbeats.length === 0) {
    return "No schedule entries.";
  }
  const sections = [
    `entries (${entries.length}):`,
    ...entries.map(compactScheduleRow),
  ];
  if (heartbeats.length > 0) {
    sections.push(
      `heartbeats (${heartbeats.length}):`,
      ...heartbeats.map(compactScheduleRow),
    );
  }
  return sections.join("\n");
};
