import {
  getCronTriggerKind,
  type LocalCronJobRecord,
  type LocalCronPayload,
  type LocalCronSchedule,
  type LocalHeartbeatConfigRecord,
  type ScheduleToolDetails,
} from "@stella/contracts/scheduling";
import type { ScheduleToolApi, ToolContext, ToolResult } from "./types.js";
import {
  formatScheduleList,
  type ScheduleListRow,
} from "./defs/schedule-manage-def.js";

const requireScheduleApi = (scheduleApi?: ScheduleToolApi): ScheduleToolApi => {
  if (!scheduleApi) {
    throw new Error("Scheduling is not configured on this device.");
  }
  return scheduleApi;
};

const getConversationId = (
  args: Record<string, unknown>,
  context: ToolContext,
): string => {
  const explicit =
    typeof args.conversationId === "string" ? args.conversationId.trim() : "";
  return explicit || context.conversationId;
};

const asTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const cronDetails = (
  change: "added" | "updated" | "removed",
  record: Pick<LocalCronJobRecord, "id"> &
    Partial<
      Pick<LocalCronJobRecord, "conversationId" | "name" | "enabled" | "nextRunAtMs">
    >,
): ScheduleToolDetails => ({
  schedule: {
    affected:
      change === "removed"
        ? []
        : [
            {
              kind: "cron",
              id: record.id,
              conversationId: record.conversationId ?? "",
              name: record.name?.trim() || "Scheduled task",
              enabled: record.enabled ?? true,
              nextRunAtMs: record.nextRunAtMs ?? 0,
            },
          ],
    changes: {
      added: change === "added" ? [{ kind: "cron", id: record.id }] : [],
      updated: change === "updated" ? [{ kind: "cron", id: record.id }] : [],
      removed: change === "removed" ? [{ kind: "cron", id: record.id }] : [],
    },
  },
});

const heartbeatDetails = (
  change: "updated" | "removed",
  record: LocalHeartbeatConfigRecord,
): ScheduleToolDetails => ({
  schedule: {
    affected:
      change === "removed"
        ? []
        : [
            {
              kind: "heartbeat",
              id: record.id,
              conversationId: record.conversationId,
              name: heartbeatDisplayName(record),
              enabled: record.enabled,
              nextRunAtMs: record.nextRunAtMs,
            },
          ],
    changes: {
      added: [],
      updated: change === "updated" ? [{ kind: "heartbeat", id: record.id }] : [],
      removed: change === "removed" ? [{ kind: "heartbeat", id: record.id }] : [],
    },
  },
});

const heartbeatDisplayName = (record: LocalHeartbeatConfigRecord): string => {
  const prompt = record.prompt?.trim();
  if (!prompt) return "Check-in";
  return prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt;
};

const findHeartbeat = async (
  api: ScheduleToolApi,
  id: string,
): Promise<LocalHeartbeatConfigRecord | null> =>
  (await api.listHeartbeats()).find((entry) => entry.id === id) ?? null;

const summarizeHeartbeat = (
  record: LocalHeartbeatConfigRecord,
): ScheduleListRow => ({
  jobId: record.id,
  name: "heartbeat",
  kind: "heartbeat",
  when: `every ${Math.round(record.intervalMs / 1000)}s`,
  enabled: record.enabled,
  next: new Date(record.nextRunAtMs).toISOString(),
  ...(record.prompt ? { prompt: record.prompt } : {}),
  ...(record.lastError ? { lastError: record.lastError } : {}),
});

const describeSchedule = (schedule: LocalCronSchedule): string => {
  if (schedule.kind === "at") {
    return `once at ${new Date(schedule.atMs).toISOString()}`;
  }
  if (schedule.kind === "every") {
    return `every ${Math.round(schedule.everyMs / 1000)}s`;
  }
  return `cron "${schedule.expr}"${schedule.tz ? ` (${schedule.tz})` : ""}`;
};

const summarizeJob = (record: LocalCronJobRecord): ScheduleListRow => {
  const payload = record.payload;
  return {
    jobId: record.id,
    name: record.name,
    kind: getCronTriggerKind(payload),
    when: describeSchedule(record.schedule),
    enabled: record.enabled,
    next: new Date(record.nextRunAtMs).toISOString(),
    ...(payload.kind === "notify" ? { message: payload.text } : {}),
    ...(payload.kind === "task" || payload.kind === "agent"
      ? { prompt: payload.prompt }
      : {}),
    ...(payload.kind === "watch" && payload.instructions
      ? { prompt: payload.instructions }
      : {}),
    ...((payload.kind === "script" || payload.kind === "watch") &&
    payload.scriptPath
      ? { scriptPath: payload.scriptPath }
      : {}),
    ...(payload.kind === "task" || payload.kind === "watch"
      ? { deliverTo: payload.route ?? "orchestrator" }
      : {}),
    ...(payload.kind === "watch" && payload.once ? { once: true as const } : {}),
    ...(payload.kind === "watch" && record.lastOutputPreview
      ? { lastFinding: record.lastOutputPreview }
      : {}),
    ...(record.lastError ? { lastError: record.lastError } : {}),
  };
};

const buildPayloadForAdd = (
  args: Record<string, unknown>,
): LocalCronPayload => {
  const kind = asTrimmedString(args.kind);
  if (kind === "reminder") {
    const message = asTrimmedString(args.message);
    if (!message) {
      throw new Error('kind="reminder" requires message.');
    }
    return { kind: "notify", text: message };
  }
  if (kind === "task") {
    const prompt = asTrimmedString(args.prompt);
    if (!prompt) {
      throw new Error('kind="task" requires prompt.');
    }
    return { kind: "task", prompt, route: args.deliverTo === "orchestrator" ? "orchestrator" : "agent" };
  }
  if (kind === "watch") {
    const instructions = asTrimmedString(args.prompt);
    const watchOptions = {
      ...(instructions ? { instructions } : {}),
      ...(args.deliverTo === "agent" ? { route: "agent" as const } : {}),
      ...(args.once === true ? { once: true } : {}),
    };
    if (args.deliverTo === "agent" && !instructions) {
      throw new Error('deliverTo="agent" needs prompt: the action the user approved.');
    }
    if (args.runsOn === "computer") {
      const scriptPath = asTrimmedString(args.scriptPath);
      if (!scriptPath) {
        throw new Error(
          'A watch on this computer requires scriptPath (author + dry-run the check script with ScriptDraft first).',
        );
      }
      return { kind: "watch", scriptPath, ...watchOptions };
    }
    const script = typeof args.script === "string" ? args.script.trim() : "";
    if (!script) {
      throw new Error(
        'A cloud watch requires script (an ES module whose default export checks and returns { found, state }). Use runsOn "computer" with a ScriptDraft scriptPath only when the check needs this machine.',
      );
    }
    return { kind: "watch", script, ...watchOptions };
  }
  throw new Error('kind must be "reminder", "task", or "watch".');
};

const buildPayloadPatch = (
  current: LocalCronPayload,
  args: Record<string, unknown>,
): LocalCronPayload | null => {
  const message = asTrimmedString(args.message);
  const prompt = asTrimmedString(args.prompt);
  const scriptPath = asTrimmedString(args.scriptPath);
  const script = typeof args.script === "string" ? args.script.trim() : "";
  if (current.kind === "watch") {
    const deliverTo = args.deliverTo === "agent" || args.deliverTo === "orchestrator" ? args.deliverTo : undefined;
    const once = typeof args.once === "boolean" ? args.once : undefined;
    if (!prompt && !scriptPath && !script && deliverTo === undefined && once === undefined) return null;
    if (scriptPath && !current.scriptPath) throw new Error("This watch runs in the cloud: replace its script, not a scriptPath.");
    if (script && current.scriptPath) throw new Error("This watch runs on this computer: replace its scriptPath, not a script.");
    return {
      ...current,
      ...(scriptPath ? { scriptPath } : {}),
      ...(script ? { script } : {}),
      ...(prompt ? { instructions: prompt } : {}),
      ...(deliverTo ? { route: deliverTo } : {}),
      ...(once !== undefined ? { once } : {}),
    };
  }
  const deliverTo = args.deliverTo === "agent" || args.deliverTo === "orchestrator" ? args.deliverTo : undefined;
  if (!message && !prompt && !scriptPath && !(current.kind === "task" && deliverTo)) return null;

  if (message) {
    if (current.kind !== "notify") {
      throw new Error(
        `message only applies to reminder entries (this entry is ${getCronTriggerKind(current)}).`,
      );
    }
    return { kind: "notify", text: message };
  }
  if (current.kind === "task" && (prompt || deliverTo)) {
    return { ...current, ...(prompt ? { prompt } : {}), ...(deliverTo ? { route: deliverTo } : {}) };
  }
  if (prompt) {
    if (current.kind === "agent") return { ...current, prompt };
    throw new Error(
      `prompt only applies to task entries (this entry is ${getCronTriggerKind(current)}).`,
    );
  }
  if (current.kind === "script") return { kind: "script", scriptPath };
  throw new Error(
    `scriptPath only applies to watch entries (this entry is ${getCronTriggerKind(current)}).`,
  );
};

export const handleScheduleAdd = async (
  scheduleApi: ScheduleToolApi | undefined,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> => {
  const api = requireScheduleApi(scheduleApi);
  const payload = buildPayloadForAdd(args);
  const record = await api.addCronJob({
    name: asTrimmedString(args.name),
    schedule: args.schedule as LocalCronSchedule,
    payload,
    conversationId: getConversationId(args, context),
    ...(asTrimmedString(args.description)
      ? { description: asTrimmedString(args.description) }
      : {}),
    ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
    ...(typeof args.deleteAfterRun === "boolean"
      ? { deleteAfterRun: args.deleteAfterRun }
      : {}),
  });
  return {
    result: `Added ${getCronTriggerKind(record.payload)} "${record.name}" (${record.id}), ${describeSchedule(record.schedule)}; next fire ${new Date(record.nextRunAtMs).toISOString()}.${watchCheckNote(record)}`,
    details: cronDetails("added", record),
  };
};

const watchCheckNote = (record: LocalCronJobRecord): string => {
  if (record.payload.kind !== "watch" || record.payload.scriptPath) return "";
  return record.lastOutputPreview
    ? ` Its first check already finds: ${record.lastOutputPreview} (not handed over; tell the user if it matters now).`
    : " Its first check ran clean and found nothing yet.";
};

export const handleScheduleList = async (
  scheduleApi: ScheduleToolApi | undefined,
  _context: ToolContext,
): Promise<ToolResult> => {
  const api = requireScheduleApi(scheduleApi);
  const [jobs, heartbeats] = await Promise.all([
    api.listCronJobs(),
    api.listHeartbeats().catch(() => []),
  ]);
  return {
    result: formatScheduleList(
      jobs.map(summarizeJob),
      heartbeats.map(summarizeHeartbeat),
    ),
    details: { action: "list", count: jobs.length + heartbeats.length },
  };
};

const updateHeartbeat = async (
  api: ScheduleToolApi,
  heartbeat: LocalHeartbeatConfigRecord,
  args: Record<string, unknown>,
): Promise<ToolResult> => {
  for (const field of ["message", "scriptPath", "name"] as const) {
    if (asTrimmedString(args[field])) {
      throw new Error(
        `${field} does not apply to a heartbeat check-in (${heartbeat.id}).`,
      );
    }
  }
  let intervalMs: number | undefined;
  if (args.schedule !== undefined) {
    const schedule = args.schedule as Partial<LocalCronSchedule> | null;
    if (
      !schedule ||
      schedule.kind !== "every" ||
      typeof (schedule as { everyMs?: unknown }).everyMs !== "number"
    ) {
      throw new Error(
        "Heartbeat cadence must be schedule: { kind: 'every', everyMs }.",
      );
    }
    intervalMs = (schedule as { everyMs: number }).everyMs;
  }
  const record = await api.upsertHeartbeat({
    conversationId: heartbeat.conversationId,
    ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
    intervalMs: intervalMs ?? heartbeat.intervalMs,
    ...(typeof args.prompt === "string" ? { prompt: args.prompt } : {}),
  });
  return {
    result: `Updated check-in "${heartbeatDisplayName(record)}" (${record.id}): ${record.enabled ? "active" : "paused"}, every ${Math.round(record.intervalMs / 60000)} min; next fire ${new Date(record.nextRunAtMs).toISOString()}.`,
    details: heartbeatDetails("updated", record),
  };
};

export const handleScheduleUpdate = async (
  scheduleApi: ScheduleToolApi | undefined,
  args: Record<string, unknown>,
): Promise<ToolResult> => {
  const api = requireScheduleApi(scheduleApi);
  const jobId = asTrimmedString(args.jobId);
  if (!jobId) {
    throw new Error("jobId is required.");
  }
  const existing = (await api.listCronJobs()).find((job) => job.id === jobId);
  if (!existing) {
    const heartbeat = await findHeartbeat(api, jobId);
    if (heartbeat) {
      return await updateHeartbeat(api, heartbeat, args);
    }
    return { error: `No schedule entry found with jobId ${jobId}.` };
  }
  const payloadPatch = buildPayloadPatch(existing.payload, args);
  const record = await api.updateCronJob(jobId, {
    ...(asTrimmedString(args.name) ? { name: asTrimmedString(args.name) } : {}),
    ...(args.schedule !== undefined
      ? { schedule: args.schedule as LocalCronSchedule }
      : {}),
    ...(payloadPatch ? { payload: payloadPatch } : {}),
    ...(typeof args.description === "string"
      ? { description: args.description }
      : {}),
    ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
    ...(typeof args.deleteAfterRun === "boolean"
      ? { deleteAfterRun: args.deleteAfterRun }
      : {}),
  });
  if (!record) {
    return { error: `No schedule entry found with jobId ${jobId}.` };
  }
  return {
    result: `Updated ${getCronTriggerKind(record.payload)} "${record.name}" (${record.id}), ${describeSchedule(record.schedule)}; next fire ${new Date(record.nextRunAtMs).toISOString()}.${payloadPatch?.kind === "watch" && payloadPatch.script ? watchCheckNote(record) : ""}`,
    details: cronDetails("updated", record),
  };
};

export const handleScheduleRemove = async (
  scheduleApi: ScheduleToolApi | undefined,
  args: Record<string, unknown>,
): Promise<ToolResult> => {
  const api = requireScheduleApi(scheduleApi);
  const jobId = asTrimmedString(args.jobId);
  if (!jobId) {
    throw new Error("jobId is required.");
  }
  const removed = await api.removeCronJob(jobId);
  if (!removed) {
    const heartbeat = await findHeartbeat(api, jobId);
    if (heartbeat) {
      const record = await api.upsertHeartbeat({
        conversationId: heartbeat.conversationId,
        enabled: false,
        intervalMs: heartbeat.intervalMs,
      });
      return {
        result: `Turned off check-in "${heartbeatDisplayName(record)}" (${record.id}). Check-ins are disabled rather than deleted; re-enable it later with schedule_update if wanted.`,
        details: heartbeatDetails("removed", record),
      };
    }
    return { error: `No schedule entry found with jobId ${jobId}.` };
  }
  return {
    result: `Removed schedule entry ${jobId}.`,
    details: cronDetails("removed", { id: jobId }),
  };
};
