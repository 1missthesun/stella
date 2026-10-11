/**
 * A conversation stored in the cloud, run on this computer. Its turns run in
 * the local pi-durable transcript and are mirrored into the conversation's
 * journal, which every other device reads, through the local-turn protocol
 * the agent loops use: `begin` journals a turn's prompt and holds the
 * journal's lease, `finish` journals what the turn produced and how it ended.
 * Every user entry opens a journal turn (a steer mid-run opens the next one);
 * what a voice call said goes in outside any turn, as the loops' voice does.
 *
 * The other way, what other writers journaled (a turn sent from the phone,
 * another computer's) is imported into the transcript before this computer
 * answers, and while the conversation is open, so its orchestrator and its
 * timeline have the whole conversation.
 *
 * A turn runs here only while the cloud has it as this computer's. A turn a
 * previous process left running waits until the cloud confirms that this
 * computer still holds the brain and that turn (`standing`); one the cloud
 * settled without it (another host took the brain over, its lease lapsed)
 * stops here instead of running on unseen, and so does a turn whose lease
 * this process learns it lost (a computer back from a pause).
 */
import { parseClaudeUsageLimitCard, type ClaudeUsageLimitCard } from "@stella/contracts/claude-usage-limit";
import { parseReminderCard, reminderAssistantMessage } from "@stella/contracts/reminders";
import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import {
  defineExtension,
  GenerationTask,
  hook,
  LiveDoc,
  ROOT_CONVERSATION_ID,
  ToolTask,
  watchEvents,
  type AgentEventStream,
  type Conversation,
  type EntryId,
  type EntryRecord,
  type Extension,
  type Harness,
  type HookApi,
} from "@earendil-works/pi-durable";
import { piJournalUserMessage, piTerminalNotice, type PiRemoteTurn, type PiUserMessage } from "@stella/contracts/pi-chat";
import { CLIENT_MSG_ID_PATTERN } from "@stella/contracts/turn-plane/turn-start";
import type { JournalCheckpointFirstKept } from "@stella/contracts/journal-checkpoint";
import { isAgentAttemptOutcome } from "@stella/contracts/agent-status";
import { PI_BRAIN_ELSEWHERE_CODE, type PiBrainRecord } from "@stella/contracts/turn-plane/pi-brain";
import {
  checkpointToPublish,
  importJournal,
  journalImportAfter,
  noteCheckpointPublished,
  journalSeqOf,
  JournalSyncDoc,
  type JournalAgentReport,
  type JournalMessage,
  type JournalOpenTurn,
  type JournalStart,
  type JournalSyncState,
} from "../stella/journal-sync.ts";
import { NO_MESSAGE_ID, recordMessageId } from "../stella/message-ids.ts";
import { stopStella } from "../stella/stop.ts";

/** One journal record as `history.read` returns it; only messages are imported. */
export type JournalReadRecord = {
  seq: number;
  kind: string;
  turnId: string;
  createdAtMs?: number;
  /** A turn record's phase: `started`, then how it ended. */
  phase?: string;
  role?: "user" | "assistant" | "toolResult";
  hidden?: boolean;
  payload?: unknown;
  /** A card record's card. */
  card?: unknown;
  /** A prompt row's client message id. */
  clientMsgId?: string;
};

/** A computer's cloud agent's brief or message (`pi-cloud-agents`): the agent's, not the conversation's. */
const AGENT_OPERATION = /^pia:/;

/** The conversation's journal, as this computer reaches it. */
export type DesktopJournal = {
  /** This computer, which a cloud agent's report card names when it is for it. */
  deviceId: string;
  /** Where a new transcript of the conversation starts (`journalImportAfter`). */
  start(): Promise<JournalStart>;
  /** This transcript's newest compaction, as the conversation's checkpoint. */
  publishCheckpoint(checkpoint: { summary: string; firstKept: JournalCheckpointFirstKept }): Promise<void>;
  /** Records after `afterSeq`, ascending, a batch at a time. */
  read(afterSeq: number): Promise<{ records: JournalReadRecord[]; complete: boolean }>;
  /** The Claude Code work the cloud holds on the usage limit now, by its journal's newest cards. */
  usageLimitHolds?(): Promise<Array<{ threadId?: string; until?: number; createdAtMs: number }>>;
  /** This computer's own mirrored turns and voice lines, which are not imported back. */
  ownTurn(turnId: string): boolean;
  begin(turn: {
    localTurnId: string;
    clientMsgId: string;
    userMessageJson: string;
    hidden: boolean;
    /** Reacquire the lease of a turn a previous process opened, under its owner epoch. */
    adopt?: boolean;
    ownerGeneration?: string;
    /** The turn's lease is gone: the cloud refused its renewal (`reason`), or it went unrenewed too long. */
    onLeaseLost?: (reason: string) => void;
  }): Promise<{
    leaseToken: string;
    ownerGeneration: string;
    /** The journal seq of a visible prompt, its `message #N` id, when it could be read. */
    promptSeq?: number;
  }>;
  finish(turn: {
    localTurnId: string;
    leaseToken: string;
    ownerGeneration: string;
    records: Array<{ ordinal: number; role: "assistant" | "toolResult"; payloadJson: string }>;
    phase: "completed" | "failed" | "canceled";
    notice?: string;
  }): Promise<void>;
  /** What a voice call said, outside any turn. */
  appendVoice(append: { appendId: string; role: "user" | "assistant"; payloadJson: string; hidden: boolean }): Promise<void>;
};

export type JournalMirror = {
  /** Import what other writers journaled since the last import. */
  importNow(): Promise<void>;
  /** Stella's turns another writer is running now, as the imports found them. */
  remoteTurns(): PiRemoteTurn[];
  /** Whether a turn of this computer's is open in the journal (a Stop from another device ends it). */
  turnOpen(): boolean;
  /**
   * Whether Stella's turn may run on here: true at once, unless a previous
   * process left a turn running; then once the cloud confirms this computer
   * still holds the brain and that turn, and false (the turn is being
   * stopped here) when it does not.
   */
  standing: Promise<boolean>;
  /** Mirror what the transcript has added since the last sync. */
  sync(): void;
  stop(): Promise<void>;
};

const PAGE = 100;
/** A turn journaled as started this long ago and never ended is taken as abandoned. */
const REMOTE_TURN_STALE_MS = 30 * 60_000;
/** Events after which the transcript may have something to mirror. */
const MIRRORED_EVENTS = new Set(["entry_appended", "message_end", "tool_execution_end", "run_end"]);
/** The writer's reason for a lease it stopped hearing renewed, which says nothing of whether the cloud moved on. */
const LEASE_SILENCE = "lease_renewal_silence";
/** How often the brain record is read again while the cloud can't be reached to confirm a turn left running. */
const CONFIRM_RETRY_MS = 10_000;

/** How long a turn the cloud refused waits for the stop that ends it before it gives up on its own. */
const REFUSED_STOP_WAIT_MS = 30_000;

const abortOf = (signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

/**
 * Stella's turn takes each model request and tool call only once the
 * cloud's word is in (`JournalMirror.standing`): at once in a turn this
 * process began, after the cloud confirms a turn a previous process left
 * running. One it refused never reaches the model or a tool again; it ends
 * with the stop the mirror makes.
 */
export const journalTurnGate = (standing: Promise<boolean>): Extension => {
  const proceed = async (api: HookApi, context: Context): Promise<undefined> => {
    if (api.conversationId !== ROOT_CONVERSATION_ID) return undefined;
    const aborted = abortOf(context.abortSignal);
    if (await Promise.race([standing, aborted.then(() => false)])) return undefined;
    await Promise.race([aborted, new Promise((resolve) => setTimeout(resolve, REFUSED_STOP_WAIT_MS))]);
    throw new Error("This turn was settled without this computer, so it does not run on here.");
  };
  return defineExtension({
    name: "stella-journal-turn-gate",
    hooks: [
      hook(GenerationTask, { beforeRequest: (_request, api, context) => proceed(api, context) }),
      hook(ToolTask, { beforeTool: (_call, api, context) => proceed(api, context) }),
    ],
  });
};

/** A report of this computer's cloud agent, or that one of its messages settled without one. */
const reportFor = (record: JournalReadRecord, deviceId: string): JournalAgentReport | undefined => {
  const card = record.card as
    | {
        type?: unknown;
        reportFor?: unknown;
        threadId?: unknown;
        requestId?: unknown;
        text?: unknown;
        settled?: unknown;
        status?: unknown;
      }
    | undefined;
  if (record.kind !== "card" || card?.type !== "agent-report" || card.reportFor !== deviceId) return undefined;
  if (typeof card.threadId !== "string" || typeof card.requestId !== "string") return undefined;
  const text = card.settled === true ? undefined : typeof card.text === "string" && card.text ? card.text : undefined;
  if (text === undefined && card.settled !== true) return undefined;
  return {
    seq: record.seq,
    report: {
      threadId: card.threadId,
      requestId: card.requestId,
      ...(text === undefined ? {} : { text }),
      ...(isAgentAttemptOutcome(card.status) ? { status: card.status } : {}),
    },
  };
};

const asJournalMessage = (record: JournalReadRecord): JournalMessage | undefined => {
  if (record.kind !== "message" || !record.role) return undefined;
  const message = record.payload as Message | { $spill?: true } | null;
  if (!message || typeof message !== "object" || !("role" in message) || message.role !== record.role) {
    return undefined;
  }
  const clientMsgId =
    record.role === "user" && record.clientMsgId && CLIENT_MSG_ID_PATTERN.test(record.clientMsgId) ? record.clientMsgId : undefined;
  return {
    seq: record.seq,
    turnId: record.turnId,
    role: record.role,
    hidden: record.hidden === true,
    message,
    ...(clientMsgId ? { clientMsgId } : {}),
  };
};

export async function journalMirror(args: {
  harness: Harness;
  root: Conversation;
  journal: DesktopJournal;
  report: (error: unknown) => void;
  /** The turns running elsewhere changed (`remoteTurns`). */
  onRemoteTurns?: (turns: PiRemoteTurn[]) => void;
  /** The cloud held Claude Code work here until the usage limit resets, or resumed it. */
  onUsageLimit?: (card: ClaudeUsageLimitCard, createdAtMs: number) => void;
  /** The conversation's brain record, as the cloud has it now. */
  readBrain?: () => Promise<PiBrainRecord | null>;
  /** A previous process left Stella's turn running: it waits for the cloud's word (`standing`). */
  resumed: boolean;
  context: Context;
}): Promise<JournalMirror> {
  const { harness, root, journal, report, context } = args;
  /** Other writers' turns journaled as started and not yet ended, by when they started. */
  const remote = new Map<string, number>();
  /** Recent turns' prompt client ids (a prompt is journaled before its turn starts). */
  const prompts = new Map<string, string>();
  const remoteTurns = (): PiRemoteTurn[] =>
    [...remote].flatMap(([turnId, at]) => {
      const clientMsgId = prompts.get(turnId);
      // A cloud agent's operation is the agent's work, not a turn of the conversation.
      if (Date.now() - at >= REMOTE_TURN_STALE_MS || AGENT_OPERATION.test(clientMsgId ?? "")) return [];
      return [{ turnId, ...(clientMsgId ? { clientMsgId } : {}) }];
    });
  let remoteSeen = "[]";
  /** Turns whose lease this process holds (or re-adopted after a restart). */
  const held = new Set<string>();
  const ending = new Set<string>();
  /** Turns the cloud no longer has as this computer's: stopped here, and never finished from here. */
  const lost = new Set<string>();
  /** Turns a previous process opened, by their adoption: the lease token taken back, or undefined when refused. */
  const adoptions = new Map<string, Promise<string | undefined>>();
  let running = false;
  let again = false;
  let stopped = false;

  const doc = async (): Promise<Readonly<JournalSyncState>> =>
    (await harness.snapshot(JournalSyncDoc, root.id, context)) ?? {};
  const save = (patch: (state: JournalSyncState) => void) =>
    harness.commit(async (tx) => {
      patch(await tx.doc(JournalSyncDoc, root.id));
      return undefined;
    }, context);

  /**
   * Once per process, before the first import: the holds the cloud has now,
   * which an import that resumes past their cards would never see again.
   */
  let holdsRebuilt = false;
  const rebuildHolds = async () => {
    if (holdsRebuilt || !journal.usageLimitHolds || !args.onUsageLimit) return;
    holdsRebuilt = true;
    try {
      for (const hold of await journal.usageLimitHolds()) {
        args.onUsageLimit(
          {
            type: "usage-limit",
            state: "held",
            ...(hold.threadId ? { threadId: hold.threadId } : {}),
            ...(hold.until !== undefined ? { until: hold.until } : {}),
          },
          hold.createdAtMs,
        );
      }
    } catch (error) {
      holdsRebuilt = false;
      report(error);
    }
  };

  const importNow = async () => {
    await rebuildHolds();
    const start = await journalImportAfter(await doc(), journal.start);
    let after: number = start.after;
    // A first import from the journal's window starts at a prompt: it may
    // open mid-turn, on tool results whose calls it no longer holds. After a
    // checkpoint, its summary comes first.
    let atPrompt = start.seed === undefined || start.seed.checkpoint !== undefined;
    let stoppedElsewhere = false;
    for (;;) {
      const page = await journal.read(after);
      const messages: (JournalMessage | JournalAgentReport)[] = [];
      for (const record of page.records) {
        const report = reportFor(record, journal.deviceId);
        if (report) {
          messages.push(report);
          continue;
        }
        const usageLimit = record.kind === "card" ? parseClaudeUsageLimitCard(record.card) : null;
        if (usageLimit) {
          args.onUsageLimit?.(usageLimit, record.createdAtMs ?? Date.now());
          continue;
        }
        // A reminder the cloud delivered: Stella's line, in the transcript and the timeline.
        const reminder = record.kind === "card" ? parseReminderCard(record.card) : null;
        if (reminder) {
          messages.push({
            seq: record.seq,
            turnId: record.turnId,
            role: "assistant",
            hidden: false,
            message: reminderAssistantMessage(reminder, record.createdAtMs ?? Date.now()) as JournalMessage["message"],
          });
          continue;
        }
        if (journal.ownTurn(record.turnId)) {
          // One of this computer's prompts, which its begin may not have numbered.
          if (record.kind === "message" && record.role === "user" && record.clientMsgId && !record.hidden) {
            await recordMessageId(harness, root.id, record.clientMsgId, record.seq, context);
          }
          // Stopped from another device (the phone's Stop) while it runs here.
          const open = [...held].some(
            (localTurnId) => !ending.has(localTurnId) && record.turnId.endsWith(`:${localTurnId}`),
          );
          if (open && record.kind === "turn" && record.phase === "canceled") stoppedElsewhere = true;
          // Ended by the cloud without this computer (a takeover, a lapsed lease): it stops here too.
          else if (open && record.kind === "turn" && record.phase && record.phase !== "started") {
            const localTurnId = [...held].find((id) => !ending.has(id) && record.turnId.endsWith(`:${id}`));
            if (localTurnId) loseTurn(localTurnId);
          }
          continue;
        }
        if (record.kind === "turn") {
          if (record.phase === "started") remote.set(record.turnId, record.createdAtMs ?? Date.now());
          else remote.delete(record.turnId);
          continue;
        }
        if (record.role === "user" && record.clientMsgId) {
          prompts.set(record.turnId, record.clientMsgId);
          if (prompts.size > PAGE) prompts.delete(prompts.keys().next().value!);
        }
        if (AGENT_OPERATION.test(record.clientMsgId ?? "")) continue;
        const message = asJournalMessage(record);
        if (!message) continue;
        if (!atPrompt && message.role !== "user") continue;
        atPrompt = true;
        messages.push(message);
      }
      const through: number = page.records.at(-1)?.seq ?? after;
      await importJournal(harness, root, messages, through, context, start.seed);
      if (page.complete || through <= after) break;
      after = through;
    }
    if (stoppedElsewhere) await stopStella(harness, root, context);
    const turns = remoteTurns();
    const seen = JSON.stringify(turns);
    if (seen !== remoteSeen) {
      remoteSeen = seen;
      args.onRemoteTurns?.(turns);
    }
  };

  /** End a journal turn with what it produced; a refusal is reported and the turn let go. */
  const finishTurn = (open: Readonly<JournalOpenTurn>) =>
    finishWith(open).catch((error: unknown) => {
      held.delete(open.localTurnId);
      ending.delete(open.localTurnId);
      report(error);
    });

  const finishWith = async (open: Readonly<JournalOpenTurn>) => {
    if (lost.has(open.localTurnId)) return;
    const entries: EntryRecord[] = [];
    for (const id of open.entries) {
      const entry = await harness.commit(async (tx) => tx.entry(id as EntryId), context);
      if (entry?.model?.[0]) entries.push(entry);
    }
    const messages = entries.map((entry) => entry.model![0]!);
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    ending.add(open.localTurnId);
    await journal.finish({
      localTurnId: open.localTurnId,
      leaseToken: open.leaseToken,
      ownerGeneration: open.ownerGeneration,
      records: messages.map((message, ordinal) => ({
        ordinal,
        role: message.role === "assistant" ? "assistant" : "toolResult",
        payloadJson: JSON.stringify(message),
      })),
      ...((last?.role === "assistant" ? piTerminalNotice(last) : undefined) ?? { phase: "completed" as const }),
    });
    held.delete(open.localTurnId);
    ending.delete(open.localTurnId);
  };

  /**
   * The cloud no longer has this turn as this computer's: what runs here
   * would go nowhere, so Stella stops, as a Stop would end it.
   */
  const loseTurn = (localTurnId: string | undefined) => {
    if (localTurnId) {
      if (lost.has(localTurnId)) return;
      lost.add(localTurnId);
      held.delete(localTurnId);
    }
    void stopStella(harness, root, context).catch(report);
  };

  const brainHere = (record: PiBrainRecord | null) =>
    !record || (record.host === "device" && record.deviceId === journal.deviceId);

  /**
   * A refusal of the turn's lease is final: it stops here. A lease that only
   * went unrenewed (this process paused, or offline) is weighed by the brain
   * record and the journal, which says whether the cloud ended the turn.
   */
  const leaseLost = (localTurnId: string) => (reason: string) => {
    if (stopped || ending.has(localTurnId)) return;
    if (reason !== LEASE_SILENCE) {
      loseTurn(localTurnId);
      return;
    }
    void (async () => {
      const record = await args.readBrain?.();
      if (record !== undefined && !brainHere(record)) {
        loseTurn(localTurnId);
        return;
      }
      await importNow();
    })().catch(report);
  };

  /** Take back the lease of a turn a previous process opened, once; its token, or undefined when the cloud refused it. */
  const adopt = (turn: Readonly<JournalOpenTurn>): Promise<string | undefined> => {
    const known = adoptions.get(turn.localTurnId);
    if (known) return known;
    const adoption = (async () => {
      const userEntry = await harness.commit(async (tx) => tx.entry(Number(turn.localTurnId.split(":").at(-1)) as EntryId), context);
      const user = userEntry?.model?.[0];
      if (user?.role !== "user") return undefined;
      const journaled = piJournalUserMessage(user as PiUserMessage);
      const ack = await journal
        .begin({
          localTurnId: turn.localTurnId,
          clientMsgId: turn.localTurnId,
          userMessageJson: JSON.stringify(journaled.message),
          hidden: journaled.hidden,
          adopt: true,
          ownerGeneration: turn.ownerGeneration,
          onLeaseLost: leaseLost(turn.localTurnId),
        })
        .catch((error: unknown) => {
          report(error);
          return undefined;
        });
      if (!ack) return undefined;
      held.add(turn.localTurnId);
      return ack.leaseToken;
    })();
    adoptions.set(turn.localTurnId, adoption);
    return adoption;
  };

  /**
   * Before a turn a previous process left running goes on: the cloud must
   * still have the brain here and the turn as this computer's. Until it can
   * be asked, the turn waits.
   */
  const confirmResumed = async (): Promise<boolean> => {
    let record: PiBrainRecord | null = null;
    if (args.readBrain) {
      for (;;) {
        if (stopped) return false;
        try {
          record = await args.readBrain();
          break;
        } catch (error) {
          report(error);
          await new Promise((resolve) => setTimeout(resolve, CONFIRM_RETRY_MS));
        }
      }
    }
    const open = (await doc()).open;
    if (!brainHere(record)) {
      loseTurn(open?.localTurnId);
      return false;
    }
    if (open && !(await adopt(open))) {
      loseTurn(open.localTurnId);
      return false;
    }
    return !(open && lost.has(open.localTurnId));
  };

  const mirror = async () => {
    const state = await doc();
    const syncId = state.syncId ?? randomUUID();
    let mirrored = state.mirrored ?? 0;
    let open: JournalOpenTurn | undefined = state.open && { ...state.open, entries: [...state.open.entries] };
    // A turn a previous process opened: take its lease back, or let it go
    // when the journal no longer has it. One the cloud settled without this
    // computer is let go as well.
    if (open && (lost.has(open.localTurnId) || adoptions.has(open.localTurnId) || !held.has(open.localTurnId))) {
      const leaseToken = lost.has(open.localTurnId) ? undefined : await adopt(open);
      open = leaseToken && !lost.has(open.localTurnId) ? { ...open, leaseToken } : undefined;
    }
    // A turn ends when the orchestrator goes idle. Idleness is read before
    // the scan that follows it, so every entry of a run that had ended by
    // then is in that scan: read after it, a run that finished meanwhile
    // would close its turn without the replies it just wrote, and those
    // would never be journaled.
    const idleNow = async () => !(await harness.snapshot(LiveDoc, root.id, context))?.run;
    let idle = await idleNow();
    for (;;) {
      const openedBefore = open?.localTurnId;
      for (;;) {
        const page = await harness.commit(
          async (tx) => (await tx.scanEntries({ conversationId: root.id, minEntryId: (mirrored + 1) as EntryId, order: "ascending" }, PAGE)).items,
          context,
        );
        for (const entry of page) {
          const message = entry.model?.[0];
          // What stays on this computer (the onboarding greeting) is never journaled.
          const localOnly = (entry.data as { localOnly?: unknown } | undefined)?.localOnly === true;
          if (message && !localOnly && journalSeqOf(entry) === undefined) {
            const said = message as Message & { source?: string; stella?: { hidden?: true } };
            if (said.source === "voice" && (message.role === "user" || message.role === "assistant")) {
              const journaled = message.role === "user" ? piJournalUserMessage(message as PiUserMessage) : undefined;
              await journal.appendVoice({
                appendId: `pi:${syncId}:${entry.id}`,
                role: message.role,
                payloadJson: JSON.stringify(journaled?.message ?? message),
                hidden: journaled?.hidden ?? said.stella?.hidden === true,
              });
            } else if (entry.kind === "pi.user" && message.role === "user") {
              if (open) await finishTurn(open);
              const journaled = piJournalUserMessage(message as PiUserMessage);
              const localTurnId = `pi:${syncId}:${entry.id}`;
              // The writer retries what can succeed; a refusal is final, and the
              // turn stays on this computer only. Refused because another host
              // holds the brain, this computer's Stella stops: it does not answer
              // beside the holder, and what it holds is now only a cache.
              const ack = await journal
                .begin({
                  localTurnId,
                  // The sender's own id when it gave one (a phone's placed chat).
                  clientMsgId:
                    journaled.clientMsgId && CLIENT_MSG_ID_PATTERN.test(journaled.clientMsgId)
                      ? journaled.clientMsgId
                      : localTurnId,
                  userMessageJson: JSON.stringify(journaled.message),
                  hidden: journaled.hidden,
                  onLeaseLost: leaseLost(localTurnId),
                })
                .catch(async (error: unknown) => {
                  report(error);
                  if ((error as { code?: unknown } | null)?.code === PI_BRAIN_ELSEWHERE_CODE) {
                    await stopStella(harness, root, context).catch(report);
                  }
                  return undefined;
                });
              if (ack) held.add(localTurnId);
              if (journaled.clientMsgId && !journaled.hidden) {
                await recordMessageId(harness, root.id, journaled.clientMsgId, ack?.promptSeq ?? NO_MESSAGE_ID, context);
              }
              open = ack
                ? { localTurnId, leaseToken: ack.leaseToken, ownerGeneration: ack.ownerGeneration, entries: [] }
                : undefined;
            } else if (open && (entry.kind === "pi.assistant" || entry.kind === "pi.tool-result")) {
              open = { ...open, entries: [...open.entries, entry.id] };
            }
          }
          mirrored = entry.id;
        }
        const turn = open;
        await save((current) => {
          current.syncId = syncId;
          current.mirrored = mirrored;
          if (turn) current.open = turn;
          else delete current.open;
        });
        if (page.length < PAGE) break;
      }
      if (!open || !idle) break;
      if (open.localTurnId === openedBefore) {
        await finishTurn(open);
        open = undefined;
        await save((current) => {
          delete current.open;
        });
        break;
      }
      // A prompt this scan opened may have run to its end already: weigh it again.
      idle = await idleNow();
    }
    await publishCheckpoint(syncId).catch(report);
  };

  /**
   * A compaction is the conversation's checkpoint for every other host: its
   * summary and where the context it kept starts in the journal. One of this
   * computer's own prompts is the journal turn it opened (`pi:<syncId>:<entry>`).
   */
  const publishCheckpoint = async (syncId: string) => {
    const pending = await checkpointToPublish(
      harness,
      root,
      (prompt) => ({ localTurnId: `pi:${syncId}:${prompt.id}` }),
      context,
    );
    if (!pending) return;
    await journal.publishCheckpoint({ summary: pending.summary, firstKept: pending.firstKept });
    await noteCheckpointPublished(harness, root, pending.markerId, context);
  };

  const sync = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      do {
        again = false;
        await mirror().catch(report);
      } while (again && !stopped);
      running = false;
    })();
  };

  const standing = args.resumed
    ? confirmResumed().catch((error: unknown) => {
        report(error);
        loseTurn(undefined);
        return false;
      })
    : Promise.resolve(true);

  const stream: AgentEventStream = await watchEvents(harness, root.id, context);
  stream.start(async (events) => {
    if ((events as Array<{ type: string }>).some((event) => MIRRORED_EVENTS.has(event.type))) sync();
  });
  sync();

  return {
    importNow,
    remoteTurns,
    turnOpen: () => held.size > 0,
    standing,
    sync,
    async stop() {
      stopped = true;
      await stream.stop().catch(() => undefined);
    },
  };
}
