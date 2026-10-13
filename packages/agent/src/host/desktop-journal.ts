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
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
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
import {
  piJournalUserMessage,
  piTerminalNotice,
  piUserView,
  type PiRemoteTurn,
  type PiUserMessage,
} from "@stella/contracts/pi-chat";
import { CLIENT_MSG_ID_PATTERN } from "@stella/contracts/turn-plane/turn-start";
import type { JournalCheckpointFirstKept } from "@stella/contracts/journal-checkpoint";
import { PI_BRAIN_ELSEWHERE_CODE, type PiBrainRecord } from "@stella/contracts/turn-plane/pi-brain";
import {
  checkpointToPublish,
  importJournal,
  journalImportAfter,
  noteCheckpointPublished,
  journalSeqOf,
  JournalSyncDoc,
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
  /**
   * Tools an open turn started or finished, so every other device's working
   * indicator follows this computer's run as it goes. Lossy: never throws,
   * never waits, journals nothing.
   */
  tools?(update: { localTurnId: string; leaseToken: string; tools: JournalTool[] }): void;
  /** What a voice call said, outside any turn. */
  appendVoice(append: { appendId: string; role: "user" | "assistant"; payloadJson: string; hidden: boolean }): Promise<void>;
  /**
   * A message the user typed here that another host must answer (this
   * computer's turn was refused: Stella runs elsewhere), sent to the
   * conversation's object as a message from this computer's user, which
   * places it where Stella runs or answers it. Resolves once the cloud took it.
   */
  relay?(message: RelayedMessage): Promise<void>;
};

export type JournalTool = { toolCallId: string; name: string; phase: "start" | "end"; isError?: boolean };

/** The tool calls an assistant entry starts, or the one a tool result ends. */
const toolsOf = (message: Message): JournalTool[] => {
  if (message.role === "toolResult") {
    return message.toolCallId && message.toolName
      ? [{ toolCallId: message.toolCallId, name: message.toolName, phase: "end", isError: message.isError === true }]
      : [];
  }
  if (message.role !== "assistant") return [];
  return message.content.flatMap((block) =>
    block.type === "toolCall" && block.id && block.name
      ? [{ toolCallId: block.id, name: block.name, phase: "start" as const }]
      : [],
  );
};

export type RelayedMessage = {
  clientMsgId: string;
  prompt: string;
  images?: Array<{ mimeType: string; data: string }>;
  files?: Array<{ name?: string; mimeType?: string; path?: string; url?: string }>;
  context?: { text?: string; display?: Record<string, unknown> };
};

/**
 * Notices naming attachments by their paths on this computer, which mean
 * nothing where Stella runs: the attachments themselves go along instead. The
 * second is the notice for images too large to go inline (spilled to disk).
 */
const LOCAL_ATTACHMENT_NOTICE =
  /^The user attached (?:(?:a file|an image): |(?:an image|\d+ images) with this message\. The set was too large to inline)/;

const relayedMessage = (clientMsgId: string, message: PiUserMessage): RelayedMessage | undefined => {
  const { text, display } = piUserView(message);
  const parts = typeof message.content === "string" ? [] : message.content;
  const images = parts.flatMap((part) =>
    part.type === "image" && part.data ? [{ mimeType: part.mimeType, data: part.data }] : [],
  );
  // Files, and images too large to have gone inline: their bytes are only on
  // this computer, at `path`, so they go along as files the cloud uploads.
  const files = (display?.attachments ?? []).flatMap((attachment) =>
    (attachment.kind === "file" && (attachment.path || attachment.url)) ||
    (attachment.kind === "image" && attachment.spilled && attachment.path)
      ? [
          {
            ...(attachment.name ? { name: attachment.name } : {}),
            ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
            ...(attachment.path ? { path: attachment.path } : {}),
            // A spilled image's `url` is its preview; its bytes are at `path`.
            ...(attachment.url && !attachment.spilled ? { url: attachment.url } : {}),
          },
        ]
      : [],
  );
  const contextText = parts
    .flatMap((part) =>
      part.type === "text" && part.stella?.hidden && part.text.trim() && !LOCAL_ATTACHMENT_NOTICE.test(part.text)
        ? [part.text]
        : [],
    )
    .join("\n\n");
  const prompt = text.trim();
  if (!prompt && images.length === 0 && files.length === 0) return undefined;
  return {
    clientMsgId,
    prompt,
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(contextText || display?.context
      ? {
          context: {
            ...(contextText ? { text: contextText } : {}),
            ...(display?.context ? { display: display.context } : {}),
          },
        }
      : {}),
  };
};

/** How long a refused message keeps being sent on before the user is told it did not go. */
const RELAY_DELAYS_MS = [0, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 60_000, 60_000];

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
  /** Messages typed here and sent on to where Stella runs: their journal prompt is the one already shown here. */
  const relayed = new Set<string>();

  /**
   * A message the user typed here is never dropped: refused because Stella
   * runs elsewhere, it goes to the conversation in the cloud, which hands it
   * to her. Only when that never succeeds is the user told, in the chat.
   */
  const relayTyped = async (outgoing: RelayedMessage): Promise<void> => {
    const relay = journal.relay;
    if (!relay) return;
    const clientMsgId = outgoing.clientMsgId;
    let failure: unknown;
    for (const delay of RELAY_DELAYS_MS) {
      if (stopped) return;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        await relay(outgoing);
        return;
      } catch (error) {
        failure = error;
      }
    }
    report(failure);
    relayed.delete(clientMsgId);
    const { model } = await root.agent(context);
    const notice: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Stella runs on another computer right now, and this message couldn't reach her there. Send it again in a moment.",
        },
      ],
      api: "stella-notice",
      provider: model?.provider ?? "stella",
      model: model?.modelId ?? "notice",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    await harness.commit(async (tx) => {
      await tx.appendEntry(root.id, { kind: AssistantEntry.kind, model: [notice] });
      return undefined;
    }, context);
  };

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
    const synced = await doc();
    for (const id of synced.relayed ?? []) relayed.add(id);
    const start = await journalImportAfter(synced, journal.start);
    let after: number = start.after;
    // A first import from the journal's window starts at a prompt: it may
    // open mid-turn, on tool results whose calls it no longer holds. After a
    // checkpoint, its summary comes first.
    let atPrompt = start.seed === undefined || start.seed.checkpoint !== undefined;
    let stoppedElsewhere = false;
    for (;;) {
      const page = await journal.read(after);
      const messages: JournalMessage[] = [];
      for (const record of page.records) {
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
          // Typed here and sent on: this computer already shows it, now numbered.
          if (relayed.has(record.clientMsgId)) {
            if (!record.hidden) await recordMessageId(harness, root.id, record.clientMsgId, record.seq, context);
            atPrompt = true;
            continue;
          }
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
              // beside the holder, and what it holds is now only a cache. A
              // message its user typed goes on to the holder all the same.
              const relayId = journaled.clientMsgId && CLIENT_MSG_ID_PATTERN.test(journaled.clientMsgId)
                ? journaled.clientMsgId
                : localTurnId;
              const typed = journaled.hidden ? undefined : relayedMessage(relayId, message as PiUserMessage);
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
                    if (typed && journal.relay) {
                      relayed.add(relayId);
                      await save((current) => {
                        current.relayed = [...(current.relayed ?? []).filter((id) => id !== relayId), relayId].slice(-50);
                      });
                      void relayTyped(typed).catch(report);
                      await root.abort(context).catch(report);
                    } else {
                      await stopStella(harness, root, context).catch(report);
                    }
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
              const tools = toolsOf(message);
              if (tools.length > 0 && !lost.has(open.localTurnId) && !ending.has(open.localTurnId)) {
                journal.tools?.({ localTurnId: open.localTurnId, leaseToken: open.leaseToken, tools });
              }
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
