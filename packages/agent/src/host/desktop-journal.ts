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

export type JournalReadRecord = {
  seq: number;
  kind: string;
  turnId: string;
  createdAtMs?: number;
  phase?: string;
  role?: "user" | "assistant" | "toolResult";
  hidden?: boolean;
  payload?: unknown;
  card?: unknown;
  clientMsgId?: string;
};

const AGENT_OPERATION = /^pia:/;

export type DesktopJournal = {
  deviceId: string;
  start(): Promise<JournalStart>;
  publishCheckpoint(checkpoint: { summary: string; firstKept: JournalCheckpointFirstKept }): Promise<void>;
  read(afterSeq: number): Promise<{ records: JournalReadRecord[]; complete: boolean }>;
  usageLimitHolds?(): Promise<
    Array<{ threadId?: string; until?: number; deviceId?: string; monthly?: true; createdAtMs: number }>
  >;
  ownTurn(turnId: string): boolean;
  begin(turn: {
    localTurnId: string;
    clientMsgId: string;
    userMessageJson: string;
    hidden: boolean;
    adopt?: boolean;
    ownerGeneration?: string;
    onLeaseLost?: (reason: string) => void;
  }): Promise<{
    leaseToken: string;
    ownerGeneration: string;
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
  tools?(update: { localTurnId: string; leaseToken: string; tools: JournalTool[] }): void;
  appendVoice(append: { appendId: string; role: "user" | "assistant"; payloadJson: string; hidden: boolean }): Promise<void>;
  appendHistory?(append: {
    appendId: string;
    records: Array<{ role: "user" | "assistant"; payloadJson: string }>;
  }): Promise<void>;
  relay?(message: RelayedMessage): Promise<void>;
};

export type JournalTool = { toolCallId: string; name: string; phase: "start" | "end"; isError?: boolean };

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

const LOCAL_ATTACHMENT_NOTICE =
  /^The user attached (?:(?:a file|an image): |(?:an image|\d+ images) with this message\. The set was too large to inline)/;

const relayedMessage = (clientMsgId: string, message: PiUserMessage): RelayedMessage | undefined => {
  const { text, display } = piUserView(message);
  const parts = typeof message.content === "string" ? [] : message.content;
  const images = parts.flatMap((part) =>
    part.type === "image" && part.data ? [{ mimeType: part.mimeType, data: part.data }] : [],
  );
  const files = (display?.attachments ?? []).flatMap((attachment) =>
    (attachment.kind === "file" && (attachment.path || attachment.url)) ||
    (attachment.kind === "image" && attachment.spilled && attachment.path)
      ? [
          {
            ...(attachment.name ? { name: attachment.name } : {}),
            ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
            ...(attachment.path ? { path: attachment.path } : {}),
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

const RELAY_DELAYS_MS = [0, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 60_000, 60_000];

export type JournalMirror = {
  importNow(): Promise<void>;
  remoteTurns(): PiRemoteTurn[];
  turnOpen(): boolean;
  standing: Promise<boolean>;
  sync(): void;
  stop(): Promise<void>;
};

const PAGE = 100;
const REMOTE_TURN_STALE_MS = 30 * 60_000;
const MIRRORED_EVENTS = new Set(["entry_appended", "message_end", "tool_execution_end", "run_end"]);
const LEASE_SILENCE = "lease_renewal_silence";
const CONFIRM_RETRY_MS = 10_000;

const REFUSED_STOP_WAIT_MS = 30_000;

const abortOf = (signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

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
  onRemoteTurns?: (turns: PiRemoteTurn[]) => void;
  onUsageLimit?: (card: ClaudeUsageLimitCard, createdAtMs: number) => void;
  readBrain?: () => Promise<PiBrainRecord | null>;
  resumed: boolean;
  context: Context;
}): Promise<JournalMirror> {
  const { harness, root, journal, report, context } = args;
  const remote = new Map<string, number>();
  const prompts = new Map<string, string>();
  const remoteTurns = (): PiRemoteTurn[] =>
    [...remote].flatMap(([turnId, at]) => {
      const clientMsgId = prompts.get(turnId);
      if (Date.now() - at >= REMOTE_TURN_STALE_MS || AGENT_OPERATION.test(clientMsgId ?? "")) return [];
      return [{ turnId, ...(clientMsgId ? { clientMsgId } : {}) }];
    });
  let remoteSeen = "[]";
  const held = new Set<string>();
  const ending = new Set<string>();
  const lost = new Set<string>();
  const adoptions = new Map<string, Promise<string | undefined>>();
  let running = false;
  let again = false;
  let stopped = false;
  const relayed = new Set<string>();

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
            ...(hold.deviceId ? { deviceId: hold.deviceId } : {}),
            ...(hold.monthly ? { monthly: true as const } : {}),
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
          if (record.kind === "message" && record.role === "user" && record.clientMsgId && !record.hidden) {
            await recordMessageId(harness, root.id, record.clientMsgId, record.seq, context);
          }
          const open = [...held].some(
            (localTurnId) => !ending.has(localTurnId) && record.turnId.endsWith(`:${localTurnId}`),
          );
          if (open && record.kind === "turn" && record.phase === "canceled") stoppedElsewhere = true;
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
              const relayId = journaled.clientMsgId && CLIENT_MSG_ID_PATTERN.test(journaled.clientMsgId)
                ? journaled.clientMsgId
                : localTurnId;
              const typed = journaled.hidden ? undefined : relayedMessage(relayId, message as PiUserMessage);
              const ack = await journal
                .begin({
                  localTurnId,
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
      idle = await idleNow();
    }
    await publishCheckpoint(syncId).catch(report);
  };

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
