/**
 * When a computer running tasks goes quiet, Stella learns it once it has
 * stayed away for a while, instead of the tasks hanging silently.
 *
 * Losing a computer (its presence socket closed, or a task's dispatch lease
 * lapsed) schedules one check per computer. If the computer is still offline
 * at that point, every conversation with tasks running there gets one hidden
 * note in its journal: which computer, since when, which tasks wait for it,
 * and what she can do (they resume by themselves when it is back; or she
 * carries one on elsewhere with send_message's destination, or stops it). The
 * note runs no turn; she reads it with her next one. Nothing moves by itself.
 */

import { object, string } from "../args.js";
import type { OwnerContext, OwnerDomain } from "../registry.js";

export const DEVICE_OFFLINE_JOB = "device-offline.check";
/** How long a computer may be away (a restart or update takes about a minute) before Stella hears of it. */
export const DEVICE_OFFLINE_NOTE_AFTER_MS = 10 * 60_000;

const jobId = (deviceId: string) => `device-offline:${deviceId}`;

type WaitingThread = {
  thread_id: string;
  description: string;
  conversation: string;
  owner_generation: string | null;
};

/** Signals this close together (a socket drop, then its tasks' leases lapsing) are one absence. */
const SAME_ABSENCE_MS = 3 * 60_000;

const deviceLost = (ctx: OwnerContext, args: { deviceId: string }): { scheduled: boolean } => {
  const pending = ctx.db.one<{ payload: string }>("SELECT payload FROM owner_jobs WHERE id = ?", jobId(args.deviceId));
  const lostAt = pending ? (JSON.parse(pending.payload) as { lostAt?: unknown }).lostAt : undefined;
  if (typeof lostAt === "number" && ctx.now - lostAt < SAME_ABSENCE_MS) return { scheduled: false };
  // A new absence (or the first): count from now, not from an earlier drop.
  ctx.jobs.schedule(DEVICE_OFFLINE_JOB, ctx.now + DEVICE_OFFLINE_NOTE_AFTER_MS, { deviceId: args.deviceId, lostAt: ctx.now }, {
    id: jobId(args.deviceId),
  });
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
  const { deviceId, lostAt } = (payload ?? {}) as { deviceId?: unknown; lostAt?: unknown };
  if (typeof deviceId !== "string" || !deviceId) return;
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
      // One note per offline stretch: the same last-seen time is the same stretch.
      noteId: `offline-${deviceId.slice(0, 48)}-${typeof lostAt === "number" ? lostAt : 0}`,
      text: deviceOfflineNoteText({
        name,
        deviceId,
        since: typeof lostAt === "number" ? lostAt : undefined,
        now: ctx.now,
        tasks: waiting.map((thread) => ({ threadId: thread.thread_id, description: thread.description })),
      }),
    });
  }
};

export const deviceOfflineDomain: OwnerDomain = {
  name: "device-offline",
  internal: {
    "deviceOffline.lost": (ctx, raw) => deviceLost(ctx, object({ deviceId: string({ min: 1, max: 256 }) })(raw)),
  },
  jobs: {
    // A busy conversation refuses the append for a moment; retries cover a long reply.
    [DEVICE_OFFLINE_JOB]: { run: check, maxAttempts: 12 },
  },
};
