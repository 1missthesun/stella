/**
 * When a computer running tasks goes away, Stella learns it within a couple
 * of minutes instead of the tasks hanging silently.
 *
 * Losing a computer (its presence socket closed, or a task's dispatch lease
 * lapsed) schedules one check per absence. If the computer is still offline
 * then, every conversation with tasks running there gets one hidden note in
 * its journal: which computer, since when, which tasks wait for it, and what
 * she can do (they resume by themselves when it is back, however long that
 * takes; or she carries one on elsewhere with send_message's destination, or
 * stops it). The note runs no turn; she reads it with her next one. Nothing
 * moves or fails by itself.
 */

import { object, optional, string } from "../args.js";
import type { OwnerContext, OwnerDomain } from "../registry.js";

export const DEVICE_OFFLINE_JOB = "device-offline.check";
/**
 * How long a computer may be away before Stella hears of it: just past what a
 * restart or update takes to reconnect (seconds, and up to about a minute and
 * a half), so an ordinary restart only brings the "[Computer restarted]" note.
 */
export const DEVICE_OFFLINE_NOTE_AFTER_MS = 2 * 60_000;
/** After its note, an absence's check stays as a marker so its later signals don't note it again. */
const NOTED_MARKER_MS = 30 * 24 * 60 * 60_000;

const jobId = (deviceId: string) => `device-offline:${deviceId}`;

type WaitingThread = {
  thread_id: string;
  description: string;
  conversation: string;
  owner_generation: string | null;
};

type CheckPayload = { deviceId: string; lostAt: number; connectionId?: string; noted?: true };

/** Signals this close together with no connection to tell them apart are one absence. */
const SAME_ABSENCE_MS = 3 * 60_000;

const deviceLost = (
  ctx: OwnerContext,
  args: { deviceId: string; connectionId?: string | undefined },
): { scheduled: boolean } => {
  const pending = ctx.db.one<{ payload: string }>("SELECT payload FROM owner_jobs WHERE id = ?", jobId(args.deviceId));
  const prior = pending ? (JSON.parse(pending.payload) as Partial<CheckPayload>) : undefined;
  // The same absence: its last connection is the same (it hasn't been back),
  // or, without one, the signals came within minutes of each other.
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
}): string => {
  const minutes = args.since ? Math.max(1, Math.round((args.now - args.since) / 60_000)) : undefined;
  return [
    "[Computer offline]",
    `${args.name} (device_id: ${args.deviceId}) has been offline${
      args.since ? ` since ${new Date(args.since).toISOString()} (about ${minutes} minutes)` : ""
    }. These tasks were running there and are paused until it is back; they pick up by themselves, with their context, when Stella starts there again:`,
    ...args.tasks.map((task) => `- ${task.description} (thread_id: ${task.threadId})`),
    `If one can't wait, you can carry it on elsewhere: send_message to its thread_id with destination "cloud" or another computer's device_id. Its conversation history goes with it (as last synced from ${args.name}); files only on ${args.name} (such as uncommitted work in its folder), processes it had running there, and any last steps not yet synced don't. Or stop it with stop_agent. Otherwise leave it: it continues when ${args.name} is back.`,
    "This is for your awareness only: nothing needs doing and no reply is expected. Tell the user only if they are waiting on these tasks.",
  ].join("\n");
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
  for (const [conversationId, waiting] of byConversation) {
    const ownerGeneration = waiting.find((thread) => thread.owner_generation)?.owner_generation;
    if (!ownerGeneration) continue;
    await ctx.host.appendConversationNote({
      conversationId,
      ownerGeneration,
      // One note per absence: its last connection names it.
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
    // A busy conversation refuses the append for a moment; retries cover a long reply.
    [DEVICE_OFFLINE_JOB]: { run: check, maxAttempts: 12 },
  },
};
