/**
 * The scheduling tools' model-visible surface — `schedule_add`,
 * `schedule_list`, `schedule_update`, `schedule_remove` — split from the
 * executable definitions so workerd hosts advertise the byte-identical
 * tools. The device host executes them against the local schedule store;
 * the cloud Durable Object against the owner's cloud schedule.
 */

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
    "When to fire: { kind: 'at', atMs } once at an epoch ms | { kind: 'every', everyMs, anchorMs? } | { kind: 'cron', expr, tz? } (5-field cron, IANA tz).",
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
    "Create a scheduled trigger. 'reminder' delivers message as written, with no AI: a phone push, an in-app notice on the desktop, and your line in the chat with Done and Snooze. 'task' is work that needs AI each time: at fire time an agent runs prompt and its result comes back to you like any finished job (deliverTo 'orchestrator' wakes you instead, for tasks that need your judgment then). 'watch' runs an AI-free check script on its schedule, in the cloud by default (script, checked once before it is saved) or on this computer when it needs something local (runsOn 'computer' with a ScriptDraft scriptPath); only a finding or a failure wakes AI, going to you or, with deliverTo 'agent', straight to an agent for an action the user already approved.",
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
          "kind='task': the work, as the brief an agent gets at fire time (or you, with deliverTo 'orchestrator'). kind='watch': what to do with a finding, as the user put it (tell them, ask them, or act; with deliverTo 'agent', the approved action itself). Make it self-contained.",
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
        enum: ["orchestrator", "agent"],
        description:
          "kind='task': 'agent' (default) runs it as an agent; 'orchestrator' only when it needs your judgment at fire time. kind='watch': who handles a finding; 'orchestrator' (default) wakes you to tell, ask or act as prompt says, 'agent' starts an agent on prompt right away, for an action the user already approved (\"book it when it opens\").",
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
        enum: ["orchestrator", "agent"],
        description: "Task entries: who runs it at fire time. Watch entries: who handles a finding.",
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

export const SCHEDULE_TOOL_DESCRIPTORS = [
  SCHEDULE_ADD_TOOL_DESCRIPTOR,
  SCHEDULE_LIST_TOOL_DESCRIPTOR,
  SCHEDULE_UPDATE_TOOL_DESCRIPTOR,
  SCHEDULE_REMOVE_TOOL_DESCRIPTOR,
] as const;
