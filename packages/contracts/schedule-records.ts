import type { ScheduleCalls, ScheduleKind, ScheduleRow } from "./backend/schedules.js";
import type {
  LocalCronJobCreateInput,
  LocalCronJobRecord,
  LocalCronJobUpdatePatch,
  LocalCronSchedule,
} from "./scheduling.js";

const DEFAULT_WATCH_INSTRUCTIONS = "Tell the user what it found.";

type CronPayload = LocalCronJobCreateInput["payload"];

export const schedulePromptOf = (payload: CronPayload): string => {
  if (payload.kind === "notify") return payload.text;
  if (payload.kind === "task") return payload.prompt;
  if (payload.kind === "watch") return payload.instructions?.trim() || DEFAULT_WATCH_INSTRUCTIONS;
  throw new Error("Only reminders, tasks and cloud watches can be stored in the cloud.");
};

export const scheduleKindOf = (payload: CronPayload): ScheduleKind =>
  payload.kind === "notify" ? "reminder" : payload.kind === "watch" ? "watch" : "task";

export const scheduleWatchFieldsOf = (payload: CronPayload) =>
  payload.kind === "watch"
    ? {
        ...(payload.script ? { script: payload.script } : {}),
        ...(payload.route ? { route: payload.route } : {}),
        ...(payload.once !== undefined ? { once: payload.once } : {}),
      }
    : payload.kind === "task" && payload.route
      ? { route: payload.route }
      : {};

const payloadOf = (row: ScheduleRow): LocalCronJobRecord["payload"] => {
  if (row.kind === "reminder") return { kind: "notify", text: row.prompt };
  if (row.kind === "watch") {
    return {
      kind: "watch",
      instructions: row.prompt,
      ...(row.route === "agent" ? { route: "agent" as const } : {}),
      ...(row.once ? { once: true } : {}),
    };
  }
  return { kind: "task", prompt: row.prompt, route: row.route };
};

export const cronJobOfScheduleRow = (row: ScheduleRow): LocalCronJobRecord => ({
  id: row.scheduleId,
  conversationId: row.conversationId ?? "",
  name: row.description,
  description: row.description,
  enabled: row.status === "active",
  schedule: JSON.parse(row.schedule) as LocalCronSchedule,
  ...(row.zone ? { zone: row.zone } : {}),
  payload: payloadOf(row),
  nextRunAtMs: row.nextRunAt,
  ...(row.lastRunAt !== undefined ? { lastRunAtMs: row.lastRunAt } : {}),
  ...(row.lastFinding ? { lastOutputPreview: row.lastFinding } : {}),
  ...(row.lastError ? { lastStatus: "error", lastError: row.lastError } : {}),
  ...(row.computerOnly && row.kind !== "reminder" ? { runsOn: "computer" as const } : {}),
  ...(row.waitingSince !== undefined ? { waitingSinceMs: row.waitingSince } : {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const scheduleUpdateArgsOf = (
  scheduleId: string,
  patch: LocalCronJobUpdatePatch,
): Omit<ScheduleCalls["schedules.update"]["args"], "requestId"> => {
  const description =
    patch.name !== undefined || patch.description !== undefined
      ? (patch.name ?? patch.description)
      : undefined;
  return {
    scheduleId,
    ...(patch.payload
      ? { prompt: schedulePromptOf(patch.payload), ...scheduleWatchFieldsOf(patch.payload) }
      : {}),
    ...(patch.schedule ? { schedule: patch.schedule } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(patch.enabled !== undefined
      ? { status: patch.enabled ? ("active" as const) : ("paused" as const) }
      : {}),
  };
};
