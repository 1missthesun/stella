/**
 * `schedule_add` / `schedule_list` / `schedule_update` / `schedule_remove`
 * for the cloud orchestrator — the device tools' exact model-visible
 * surface (see `defs/schedule-manage-def.ts`) over the owner's schedules in
 * the owner's object (`schedules.tool`).
 *
 * The cloud store keeps the device's trigger kinds:
 *  - task     — the prompt, run at fire time
 *  - reminder — the message itself, delivered with no model: a push to the
 *               phone and Stella's line in the conversation
 *  - watch    — a check script run with no model at each fire; its prompt
 *               is what to do with a finding. A watch on a computer
 *               (`runsOn: "computer"`) is set up from that computer.
 */

import type { TSchema } from "@sinclair/typebox";
import type { AgentToolResult } from "@stella/runtime/kernel/agent-core/types.js";
import {
  SCHEDULE_ADD_TOOL_DESCRIPTOR,
  SCHEDULE_LIST_TOOL_DESCRIPTOR,
  SCHEDULE_REMOVE_TOOL_DESCRIPTOR,
  SCHEDULE_SEARCH_TERMS,
  SCHEDULE_UPDATE_TOOL_DESCRIPTOR,
  formatScheduleList,
  type ScheduleListRow,
  type ScheduleToolDescriptor,
} from "@stella/runtime/kernel/tools/defs/schedule-manage-def.js";
import { WATCH_MIN_INTERVAL_MS } from "@stella/contracts/backend/schedules";
import type { CloudCodeSourceAgentTool } from "./cloud-code-tool.js";
import { sha256Hex } from "./hash.js";
import { RpcError } from "./owner-store/errors.js";
import type { OwnerInternalCall } from "./owner-store/registry.js";

export type CloudScheduleToolContext = Readonly<{
  ownerId: string;
  ownerGeneration: string;
  conversationId: string;
  /** A server-internal operation on the owner's object, under `ownerGeneration`. */
  ownerInternal: OwnerInternalCall;
}>;

/** The cloud scheduler's floor; nothing can run more often than this. */
export const CLOUD_SCHEDULE_MIN_EVERY_MS = 15 * 60_000;

type ScheduleRow = {
  scheduleId: string;
  kind?: string;
  route?: string;
  once?: boolean;
  lastFinding?: string;
  lastCheckAt?: number;
  conversationId?: string;
  prompt: string;
  schedule: string;
  zone?: string;
  nextRunAt: number;
  lastRunAt?: number;
  status: string;
  description: string;
  lastError?: string;
  lastErrorAt?: number;
};

const asTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const iso = (value: number | undefined): string | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : undefined;

const parseStoredSchedule = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : { raw: value };
  } catch {
    return { raw: value };
  }
};

const describeSchedule = (schedule: Record<string, unknown>): string => {
  if (schedule.kind === "at" && typeof schedule.atMs === "number") {
    return `once at ${new Date(schedule.atMs).toISOString()}`;
  }
  if (schedule.kind === "every" && typeof schedule.everyMs === "number") {
    return `every ${Math.round(schedule.everyMs / 1000)}s`;
  }
  if (schedule.kind === "cron" && typeof schedule.expr === "string") {
    return `cron "${schedule.expr}" (${typeof schedule.tz === "string" && schedule.tz ? schedule.tz : "follows the user's time zone"})`;
  }
  return "unknown schedule";
};

const listRow = (row: ScheduleRow): ScheduleListRow => {
  const message = row.kind === "reminder" ? row.prompt : undefined;
  const watch = row.kind === "watch";
  return {
    jobId: row.scheduleId,
    name: row.description || (message ?? row.prompt).slice(0, 60),
    kind: message !== undefined ? "reminder" : watch ? "watch" : "task",
    when: describeSchedule(parseStoredSchedule(row.schedule)),
    enabled: row.status === "active",
    ...(iso(row.nextRunAt) ? { next: iso(row.nextRunAt) } : {}),
    ...(message !== undefined ? { message } : { prompt: row.prompt }),
    ...(row.kind === "task" || watch
      ? { deliverTo: row.route === "agent" ? "agent" : "orchestrator" }
      : {}),
    ...(watch && row.once ? { once: true as const } : {}),
    ...(watch && row.lastFinding ? { lastFinding: row.lastFinding } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
  };
};

/** The device `summarizeJob` shape so lists read the same on both hosts. */
const summarizeRow = (row: ScheduleRow): Record<string, unknown> => {
  const message = row.kind === "reminder" ? row.prompt : null;
  const watch = row.kind === "watch";
  return {
    jobId: row.scheduleId,
    name: row.description || (message ?? row.prompt).slice(0, 60),
    triggerKind: message !== null ? "reminder" : watch ? "watch" : "task",
    ...(row.kind === "task" ? { deliverTo: row.route === "agent" ? "agent" : "orchestrator" } : {}),
    ...(watch
      ? {
          runsOn: "cloud",
          deliverTo: row.route === "agent" ? "agent" : "orchestrator",
          ...(row.once ? { once: true } : {}),
          ...(row.lastFinding ? { lastFinding: row.lastFinding } : {}),
          ...(iso(row.lastCheckAt) ? { lastCheckAt: iso(row.lastCheckAt) } : {}),
        }
      : {}),
    schedule: parseStoredSchedule(row.schedule),
    ...(row.zone ? { zone: row.zone } : {}),
    enabled: row.status === "active",
    ...(row.conversationId ? { conversationId: row.conversationId } : {}),
    nextRunAt: iso(row.nextRunAt),
    ...(row.description ? { description: row.description } : {}),
    ...(message !== null ? { message } : { prompt: row.prompt }),
    ...(row.lastError ? { lastStatus: "failed", lastError: row.lastError } : {}),
    ...(iso(row.lastRunAt) ? { lastRunAt: iso(row.lastRunAt) } : {}),
  };
};

/**
 * The device schedule shape, validated the way `normalizeScheduleInput`
 * will on the backend, plus the cloud interval floor so the model hears
 * about it before the request leaves.
 */
const scheduleFromArgs = (value: unknown, triggerKind = "task"): Record<string, unknown> => {
  const watch = triggerKind === "watch";
  const floor = watch ? WATCH_MIN_INTERVAL_MS : CLOUD_SCHEDULE_MIN_EVERY_MS;
  if (!isRecord(value)) throw new Error("schedule must be an object.");
  const kind = asTrimmedString(value.kind);
  if (kind === "at") {
    const atMs = Number(value.atMs);
    if (!Number.isFinite(atMs) || atMs <= 0) {
      throw new Error("schedule.kind='at' requires atMs (epoch ms).");
    }
    if (atMs < Date.now()) throw new Error("schedule.atMs is in the past.");
    return { kind: "at", atMs: Math.floor(atMs) };
  }
  if (kind === "every") {
    const everyMs = Number(value.everyMs);
    if (!Number.isFinite(everyMs) || everyMs <= 0) {
      throw new Error("schedule.kind='every' requires everyMs (> 0).");
    }
    if (everyMs < floor) {
      throw new Error(
        `schedule.everyMs must be at least ${floor} (${floor / 60_000} minutes); ${watch ? "watches" : "cloud schedules"} cannot run more often than that.`,
      );
    }
    const anchorMs = Number(value.anchorMs);
    return {
      kind: "every",
      everyMs: Math.floor(everyMs),
      ...(Number.isFinite(anchorMs) && anchorMs > 0
        ? { anchorMs: Math.floor(anchorMs) }
        : {}),
    };
  }
  if (kind === "cron") {
    const expr = asTrimmedString(value.expr);
    if (!expr) throw new Error("schedule.kind='cron' requires expr.");
    const tz = asTrimmedString(value.tz);
    return { kind: "cron", expr, ...(tz ? { tz } : {}) };
  }
  throw new Error('schedule.kind must be "at", "every", or "cron".');
};

const result = (
  value: string,
  details: Record<string, unknown>,
): AgentToolResult<unknown> => ({
  content: [{ type: "text", text: value }],
  details,
});

const failure = (message: string): AgentToolResult<unknown> => ({
  content: [{ type: "text", text: message }],
  details: null,
  isError: true,
});

/** A watch's first check, which ran before it was saved. */
const firstCheckNote = (payload: Record<string, unknown>): string => {
  const check = isRecord(payload.check) ? payload.check : null;
  if (!check || check.ok !== true) return "";
  return typeof check.found === "string" && check.found
    ? ` Its first check already finds: ${check.found} (not handed over; tell the user if it matters now).`
    : " Its first check ran clean and found nothing yet.";
};

const rowsOf = (payload: Record<string, unknown>): ScheduleRow[] =>
  (Array.isArray(payload.schedules) ? payload.schedules : []).filter(
    (row): row is ScheduleRow =>
      isRecord(row) &&
      typeof row.scheduleId === "string" &&
      typeof row.prompt === "string",
  );

export const createCloudScheduleTools = (
  context: CloudScheduleToolContext,
): CloudCodeSourceAgentTool[] => {
  const post = async (
    action: "list" | "create" | "update" | "remove",
    body: Record<string, unknown>,
    toolCallId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> => {
    signal?.throwIfAborted();
    const requestId =
      action === "list"
        ? undefined
        : await sha256Hex(
            `schedule\0${context.ownerGeneration}\0${context.conversationId}\0${toolCallId}`,
          );
    let payload: unknown;
    try {
      payload = await context.ownerInternal("schedules.tool", {
        action,
        ...(requestId ? { requestId } : {}),
        ...body,
      });
    } catch (error) {
      // The model reads this text back to the user.
      throw new Error(
        error instanceof RpcError && error.reason === "sign_in_required"
          ? "Sign in to Stella with a connected account before scheduling."
          : error instanceof Error
            ? error.message
            : "Scheduling failed.",
      );
    }
    return isRecord(payload) ? payload : {};
  };

  const tool = (
    descriptor: ScheduleToolDescriptor,
    execute: CloudCodeSourceAgentTool["execute"],
  ): CloudCodeSourceAgentTool => ({
    name: descriptor.name,
    label: descriptor.label,
    workingText: descriptor.workingText,
    description: descriptor.description,
    parameters: descriptor.parameters as unknown as TSchema,
    demoted: { searchTerms: SCHEDULE_SEARCH_TERMS },
    // Every write carries a request id derived from the tool call id, and
    // the owner's object replays its receipt for it (`replayed: true`), so a
    // rerun reports the first attempt's schedule instead of adding a twin.
    replay:
      descriptor.name === SCHEDULE_LIST_TOOL_DESCRIPTOR.name ? "safe" : "keyed",
    execute,
  });

  return [
    tool(SCHEDULE_ADD_TOOL_DESCRIPTOR, async (toolCallId, params, signal) => {
      const args = (params ?? {}) as Record<string, unknown>;
      try {
        const name = asTrimmedString(args.name);
        const kind = asTrimmedString(args.kind);
        let prompt: string;
        let watch: Record<string, unknown> = {};
        if (kind === "reminder") {
          prompt = asTrimmedString(args.message);
          if (!prompt) throw new Error('kind="reminder" requires message.');
        } else if (kind === "task") {
          prompt = asTrimmedString(args.prompt);
          if (!prompt) throw new Error('kind="task" requires prompt.');
          watch = { route: args.deliverTo === "orchestrator" ? "orchestrator" : "agent" };
        } else if (kind === "watch") {
          if (args.runsOn === "computer" || asTrimmedString(args.scriptPath)) {
            throw new Error(
              'A watch that needs a computer is set up from Stella on that computer. Here, give it a cloud script (runsOn "cloud").',
            );
          }
          const script = typeof args.script === "string" ? args.script.trim() : "";
          if (!script) {
            throw new Error(
              'kind="watch" requires script: an ES module whose default export checks and returns { found, state }.',
            );
          }
          prompt = asTrimmedString(args.prompt) || "Tell the user what it found.";
          if (args.deliverTo === "agent" && !asTrimmedString(args.prompt)) {
            throw new Error('deliverTo="agent" needs prompt: the action the user approved.');
          }
          watch = {
            script,
            ...(args.deliverTo === "agent" ? { route: "agent" } : {}),
            ...(args.once === true ? { once: true } : {}),
          };
        } else {
          throw new Error('kind must be "reminder", "task", or "watch".');
        }
        const schedule = scheduleFromArgs(args.schedule, kind);
        const description = asTrimmedString(args.description) || name;
        const payload = await post(
          "create",
          {
            kind,
            prompt,
            description,
            conversationId:
              asTrimmedString(args.conversationId) || context.conversationId,
            schedule,
            ...watch,
          },
          toolCallId,
          signal,
        );
        // The receipt carries the created row; the list beside it is the
        // owner's full schedule after the change.
        const receiptRow = isRecord(payload.schedule) ? payload.schedule : null;
        const jobId =
          typeof receiptRow?.scheduleId === "string" ? receiptRow.scheduleId : "";
        const record =
          rowsOf(payload).find((row) => row.scheduleId === jobId) ??
          (receiptRow && typeof receiptRow.prompt === "string"
            ? (receiptRow as unknown as ScheduleRow)
            : undefined);
        return result(
          `Added ${kind} "${name}" (${jobId}), ${describeSchedule(schedule)}; next fire ${iso(record?.nextRunAt) ?? "pending"}.${firstCheckNote(payload)}`,
          {
            action: "added",
            jobId,
            ...(record ? summarizeRow(record) : {}),
            ...(payload.replayed === true ? { replayed: true } : {}),
          },
        );
      } catch (error) {
        return failure((error as Error).message);
      }
    }),
    tool(SCHEDULE_LIST_TOOL_DESCRIPTOR, async (toolCallId, _params, signal) => {
      try {
        const payload = await post("list", {}, toolCallId, signal);
        const rows = rowsOf(payload).map(listRow);
        return result(formatScheduleList(rows), {
          action: "list",
          count: rows.length,
        });
      } catch (error) {
        return failure((error as Error).message);
      }
    }),
    tool(SCHEDULE_UPDATE_TOOL_DESCRIPTOR, async (toolCallId, params, signal) => {
      const args = (params ?? {}) as Record<string, unknown>;
      try {
        const jobId = asTrimmedString(args.jobId);
        if (!jobId) throw new Error("jobId is required.");
        if (jobId.startsWith("heartbeat:")) {
          throw new Error(
            "Conversation heartbeat check-ins run on the desktop app; there is none to edit in the cloud.",
          );
        }
        if (asTrimmedString(args.scriptPath)) {
          throw new Error(
            "scriptPath only applies to watches on a computer, which are edited from that computer.",
          );
        }
        const message = asTrimmedString(args.message);
        const prompt = asTrimmedString(args.prompt);
        const nextPrompt = message || prompt || undefined;
        const script = typeof args.script === "string" ? args.script.trim() : "";
        const watch = {
          ...(script ? { script } : {}),
          ...(args.deliverTo === "agent" || args.deliverTo === "orchestrator" ? { route: args.deliverTo } : {}),
          ...(typeof args.once === "boolean" ? { once: args.once } : {}),
        };
        const description =
          asTrimmedString(args.description) || asTrimmedString(args.name);
        const status =
          typeof args.enabled === "boolean"
            ? args.enabled
              ? "active"
              : "paused"
            : undefined;
        const schedule =
          args.schedule === undefined ? undefined : scheduleFromArgs(args.schedule);
        if (!nextPrompt && !description && !status && !schedule && Object.keys(watch).length === 0) {
          throw new Error(
            "Pass at least one field to change: name, schedule, message/prompt, script, deliverTo, once, description, or enabled.",
          );
        }
        const payload = await post(
          "update",
          {
            scheduleId: jobId,
            ...(nextPrompt ? { prompt: nextPrompt } : {}),
            ...(description ? { description } : {}),
            ...(status ? { status } : {}),
            ...(schedule ? { schedule } : {}),
            ...watch,
          },
          toolCallId,
          signal,
        );
        const record = rowsOf(payload).find((row) => row.scheduleId === jobId);
        if (!record) {
          return failure(`No schedule entry found with jobId ${jobId}.`);
        }
        return result(
          `Updated "${record.description || jobId}" (${jobId}); next fire ${iso(record.nextRunAt) ?? "pending"}.${firstCheckNote(payload)}`,
          { action: "updated", jobId, ...summarizeRow(record) },
        );
      } catch (error) {
        return failure((error as Error).message);
      }
    }),
    tool(SCHEDULE_REMOVE_TOOL_DESCRIPTOR, async (toolCallId, params, signal) => {
      const args = (params ?? {}) as Record<string, unknown>;
      try {
        const jobId = asTrimmedString(args.jobId);
        if (!jobId) throw new Error("jobId is required.");
        if (jobId.startsWith("heartbeat:")) {
          throw new Error(
            "Conversation heartbeat check-ins run on the desktop app; there is none to turn off in the cloud.",
          );
        }
        const payload = await post(
          "remove",
          { scheduleId: jobId },
          toolCallId,
          signal,
        );
        const remaining = rowsOf(payload);
        if (remaining.some((row) => row.scheduleId === jobId)) {
          return failure(`Schedule ${jobId} could not be removed.`);
        }
        return result(`Removed schedule ${jobId}.`, {
          action: "removed",
          jobId,
          remaining: remaining.length,
        });
      } catch (error) {
        return failure((error as Error).message);
      }
    }),
  ];
};
