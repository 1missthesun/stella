import { agentReportReceipt } from "@stella/contracts/backend/agent-reports";
import { object, optional, string } from "../args.js";
import { endedWaiting, queueAgentNote } from "./agent-reports.js";
import type { OwnerContext, OwnerDomain } from "../registry.js";

export const DEVICE_OFFLINE_JOB = "device-offline.check";
export const DEVICE_OFFLINE_NOTE_AFTER_MS = 2 * 60_000;
const NOTED_MARKER_MS = 30 * 24 * 60 * 60_000;

const jobId = (deviceId: string) => `device-offline:${deviceId}`;

type WaitingThread = {
  thread_id: string;
  description: string;
  conversation: string;
  owner_generation: string | null;
};

type CheckPayload = { deviceId: string; lostAt: number; connectionId?: string; noted?: true };

const SAME_ABSENCE_MS = 3 * 60_000;

const deviceLost = (
  ctx: OwnerContext,
  args: { deviceId: string; connectionId?: string | undefined },
): { scheduled: boolean } => {
  const pending = ctx.db.one<{ payload: string }>("SELECT payload FROM owner_jobs WHERE id = ?", jobId(args.deviceId));
  const prior = pending ? (JSON.parse(pending.payload) as Partial<CheckPayload>) : undefined;
  const same = prior
    ? args.connectionId || prior.connectionId
      ? prior.connectionId === args.connectionId
      : typeof prior.lostAt === "number" && ctx.now - prior.lostAt < SAME_ABSENCE_MS
    : false;
  if (same) return { scheduled: false };
  ctx.jobs.schedule(
    DEVICE_OFFLINE_JOB,
    ctx.now + DEVICE_OFFLINE_NOTE_AFTER_MS,
    {
      deviceId: args.deviceId,
      lostAt: ctx.now,
      ...(args.connectionId ? { connectionId: args.connectionId } : {}),
    } satisfies CheckPayload,
    { id: jobId(args.deviceId) },
  );
  return { scheduled: true };
};

export const deviceOfflineNoteText = (args: {
  name: string;
  deviceId: string;
  since: number | undefined;
  now: number;
  tasks: ReadonlyArray<{ threadId: string; description: string }>;
  helpers?: true;
}): string => {
  const minutes = args.since ? Math.max(1, Math.round((args.now - args.since) / 60_000)) : undefined;
  const them = args.helpers ? "helpers you started" : "tasks";
  return [
    "[Computer offline]",
    `${args.name} (device_id: ${args.deviceId}) has been offline${
      args.since ? ` since ${new Date(args.since).toISOString()} (about ${minutes} minutes)` : ""
    }. These ${them} were running there and are paused until it is back; they pick up by themselves, with their context, when Stella starts there again${args.helpers ? ", and their reports come to you as usual" : ""}:`,
    ...args.tasks.map((task) => `- ${task.description} (thread_id: ${task.threadId})`),
    `If one can't wait, you can carry it on elsewhere: send_message to its thread_id with destination "cloud" or another computer's device_id. Its conversation history goes with it (as last synced from ${args.name}); files only on ${args.name} (such as uncommitted work in its folder), processes it had running there, and any last steps not yet synced don't. Or stop it with stop_agent: that works now, and the stop is held for ${args.name} and applied the moment it is back, so it doesn't carry on there. If you redo its work some other way (a new agent), stop it first, so the old one doesn't come back and repeat it. Messages to it are refused until ${args.name} is back. Otherwise leave it: it continues when ${args.name} is back.`,
    args.helpers
      ? "Nothing needs doing if you can wait for them: end your turn waiting again unless you decide to carry one on elsewhere or stop it."
      : "This is for your awareness only: nothing needs doing and no reply is expected. Tell the user only if they are waiting on these tasks.",
  ].join("\n");
};

type WaitingHelper = WaitingThread & { parent_thread_id: string };

type Lead = {
  thread_id: string;
  conversation_id: string;
  owner_generation: string | null;
  executor_device_id: string | null;
  origin_device_id: string | null;
  placement: string;
  status: string;
  result_json: string | null;
};

const noteLeads = async (
  ctx: OwnerContext,
  args: { deviceId: string; name: string; absence: Partial<CheckPayload> },
): Promise<void> => {
  const helpers = ctx.db.all<WaitingHelper>(
    `SELECT thread_id, description, parent_thread_id, COALESCE(origin_conversation_id, conversation_id) AS conversation, owner_generation
       FROM agent_threads
      WHERE status = 'running'
        AND parent_thread_id IS NOT NULL AND parent_thread_id <> thread_id
        AND (executor_device_id = ?
             OR (executor_device_id IS NULL AND placement = 'computer' AND origin_device_id = ?))
      ORDER BY updated_at ASC
      LIMIT 200`,
    args.deviceId,
    args.deviceId,
  );
  const byLead = new Map<string, WaitingHelper[]>();
  for (const helper of helpers) {
    byLead.set(helper.parent_thread_id, [...(byLead.get(helper.parent_thread_id) ?? []), helper]);
  }
  for (const [leadId, waiting] of byLead) {
    const lead = ctx.db.one<Lead>(
      `SELECT thread_id, conversation_id, owner_generation, executor_device_id, origin_device_id, placement, status, result_json
         FROM agent_threads WHERE thread_id = ?`,
      leadId,
    );
    if (!lead) continue;
    const leadHere =
      lead.executor_device_id === args.deviceId ||
      (lead.executor_device_id === null && lead.placement === "computer" && lead.origin_device_id === args.deviceId);
    if (leadHere || !(lead.status === "running" || lead.status === "waiting_for_user" || endedWaiting(lead))) continue;
    const ownerGeneration = lead.owner_generation ?? waiting.find((helper) => helper.owner_generation)?.owner_generation;
    if (!ownerGeneration) continue;
    queueAgentNote(ctx, {
      noteId: agentReportReceipt(
        `offline:${args.deviceId}:${args.absence.connectionId ?? args.absence.lostAt ?? 0}:${leadId}`,
      ),
      parentThreadId: leadId,
      conversationId: lead.conversation_id,
      ownerGeneration,
      fromThreadId: waiting[0]!.thread_id,
      text: deviceOfflineNoteText({
        name: args.name,
        deviceId: args.deviceId,
        since: typeof args.absence.lostAt === "number" ? args.absence.lostAt : undefined,
        now: ctx.now,
        tasks: waiting.map((helper) => ({ threadId: helper.thread_id, description: helper.description })),
        helpers: true,
      }),
    });
  }
};

const check = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const absence = (payload ?? {}) as Partial<CheckPayload>;
  const { deviceId, lostAt } = absence;
  if (typeof deviceId !== "string" || !deviceId || absence.noted) return;
  const device = (await ctx.host.deviceDestinations()).find((candidate) => candidate.deviceId === deviceId);
  if (!device || device.online) return;
  const threads = ctx.db.all<WaitingThread>(
    `SELECT thread_id, description, COALESCE(origin_conversation_id, conversation_id) AS conversation, owner_generation
       FROM agent_threads
      WHERE status = 'running'
        AND (parent_thread_id IS NULL OR parent_thread_id = thread_id)
        AND (executor_device_id = ?
             OR (executor_device_id IS NULL AND placement = 'computer' AND origin_device_id = ?))
      ORDER BY updated_at ASC
      LIMIT 200`,
    deviceId,
    deviceId,
  );
  const byConversation = new Map<string, WaitingThread[]>();
  for (const thread of threads) {
    byConversation.set(thread.conversation, [...(byConversation.get(thread.conversation) ?? []), thread]);
  }
  const name = device.label?.trim() || deviceId;
  await noteLeads(ctx, { deviceId, name, absence });
  for (const [conversationId, waiting] of byConversation) {
    const ownerGeneration = waiting.find((thread) => thread.owner_generation)?.owner_generation;
    if (!ownerGeneration) continue;
    await ctx.host.appendConversationNote({
      conversationId,
      ownerGeneration,
      noteId: `offline-${deviceId.slice(0, 48)}-${absence.connectionId?.slice(0, 64) ?? lostAt ?? 0}`,
      text: deviceOfflineNoteText({
        name,
        deviceId,
        since: typeof lostAt === "number" ? lostAt : undefined,
        now: ctx.now,
        tasks: waiting.map((thread) => ({ threadId: thread.thread_id, description: thread.description })),
      }),
    });
  }
  ctx.jobs.schedule(DEVICE_OFFLINE_JOB, ctx.now + NOTED_MARKER_MS, { ...absence, deviceId, lostAt: lostAt ?? ctx.now, noted: true } satisfies CheckPayload, {
    id: jobId(deviceId),
  });
};

export const deviceOfflineDomain: OwnerDomain = {
  name: "device-offline",
  internal: {
    "deviceOffline.lost": (ctx, raw) =>
      deviceLost(
        ctx,
        object({ deviceId: string({ min: 1, max: 256 }), connectionId: optional(string({ min: 1, max: 256 })) })(raw),
      ),
  },
  jobs: {
    [DEVICE_OFFLINE_JOB]: { run: check, maxAttempts: 12 },
  },
};
