import type { Context } from "@earendil-works/chord";
import type { AssistantMessage, Message, TextContent } from "@earendil-works/pi-ai";
import {
  defineDoc,
  InboxDoc,
  LiveDoc,
  watchEvents,
  type AgentEventStream,
  type Conversation,
  type Cursor,
  type EntryDraft,
  type EntryId,
  type EntryRecord,
  type Harness,
} from "@earendil-works/pi-durable";
import {
  piJournalUserMessage,
  piMessageText,
  piTerminalNotice,
  piUserHidden,
  piUserView,
  type PiUserDisplay,
  type PiUserMessage,
} from "@stella/contracts/pi-chat";
import { splitMessageReplyRefs } from "@stella/contracts/reply-refs";
import { wakePromptOf } from "@stella/contracts/agent-wake-prompt";
import { NO_MESSAGE_ID, recordMessageId } from "../stella/message-ids.ts";

const spawnedThreadId = (details: unknown, text: string): string | undefined => {
  const fromDetails = (details as { thread_id?: unknown } | undefined)?.thread_id;
  if (typeof fromDetails === "string" && fromDetails) return fromDetails;
  try {
    const parsed = (JSON.parse(text) as { thread_id?: unknown } | null)?.thread_id;
    return typeof parsed === "string" && parsed ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export type LocalLogMessage = { id: string; seq: number; role: "user" | "assistant"; text: string; timestamp: number };

export type DesktopLocalLog = {
  read(afterSeq: number, limit: number): Promise<{ messages: LocalLogMessage[]; throughSeq: number; complete: boolean }>;
  write(message: LocalLogWrite): Promise<{ id: string; seq?: number }>;
};

export type LocalLogWrite =
  | {
      key: string;
      role: "user";
      text: string;
      timestamp: number;
      clientMsgId?: string;
      display?: PiUserDisplay;
    }
  | {
      key: string;
      role: "assistant";
      text: string;
      timestamp: number;
      replyTo?: string;
      followedByToolCall?: boolean;
      notice?: true;
    }
  | {
      key: string;
      role: "reaction";
      timestamp: number;
      sequence: number;
      emoji: string;
    }
  | {
      key: string;
      role: "tool_request";
      timestamp: number;
      toolCallId: string;
      toolName: string;
      args?: Record<string, unknown>;
    }
  | {
      key: string;
      role: "lifecycle";
      type: "agent-started" | "agent-completed" | "agent-failed" | "agent-canceled";
      timestamp: number;
      agentId: string;
      payload: Record<string, unknown>;
    }
  | {
      key: string;
      role: "tool_result";
      timestamp: number;
      toolCallId: string;
      toolName: string;
      text: string;
      details?: unknown;
      isError?: boolean;
    };

export type LocalLogMirror = {
  importNow(): Promise<void>;
  stop(): Promise<void>;
};

const LocalLogSyncDoc = defineDoc<{ importedSeq?: number; mirrored?: number; replyTo?: string }>({
  kind: "stella.local-log",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({}),
});

const PAGE = 200;
const RELAY_SCAN_PAGE = 4;
const IMPORT_PAGE = 1000;
type Imported = { message: LocalLogMessage; text: string };
const MIRRORED_EVENTS = new Set(["entry_appended", "message_end", "run_end"]);

const fromLog = (entry: { data?: unknown }): boolean =>
  typeof (entry.data as { localLog?: unknown } | undefined)?.localLog === "string";

export const writtenReply = (text: string, timestamp: number, model: string): AssistantMessage =>
  ({
    role: "assistant",
    content: [{ type: "text", text }],
    api: "stella",
    provider: "stella",
    model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  }) as AssistantMessage;

const userPart = (text: string, seq: number): TextContent => {
  const part = { type: "text" as const, text, stella: { seq } };
  return part;
};

export async function localLogMirror(args: {
  harness: Harness;
  root: Conversation;
  log: DesktopLocalLog;
  report: (error: unknown) => void;
  context: Context;
}): Promise<LocalLogMirror> {
  const { harness, root, log, report, context } = args;
  let stopped = false;

  const doc = async () => (await harness.snapshot(LocalLogSyncDoc, root.id, context)) ?? {};
  const save = (patch: (state: { importedSeq?: number; mirrored?: number; replyTo?: string }) => void) =>
    harness.commit(async (tx) => {
      patch(await tx.doc(LocalLogSyncDoc, root.id));
      return undefined;
    }, context);

  const entryOf = ({ message, text }: Imported): EntryDraft => ({
    kind: message.role === "user" ? "pi.user" : "pi.assistant",
    model: [
      message.role === "user"
        ? ({ role: "user", content: [userPart(text, message.seq)], timestamp: message.timestamp } as Message)
        : writtenReply(text, message.timestamp, "legacy"),
    ],
    data: { localLog: message.id },
  });
  const requestOf = (message: LocalLogMessage) => `legacy:${message.id}`;

  const importPage = (page: Imported[], through: number) =>
    harness.commit(async (tx) => {
      const written = new Set<string>();
      if (page[0] && (await tx.submissionByRequest(root.id, requestOf(page[0].message)))) {
        for (const { message } of page) {
          if (await tx.submissionByRequest(root.id, requestOf(message))) written.add(message.id);
        }
      }
      const last = (await tx.scanEntries({ conversationId: root.id, order: "descending" }, 1)).items[0]?.id ?? 0;
      if ((await tx.doc(LiveDoc, root.id)).run !== undefined || (await tx.doc(InboxDoc, root.id)).items.length > 0) {
        return false;
      }
      const state = await tx.doc(LocalLogSyncDoc, root.id);
      const imported = state.importedSeq ?? -1;
      let newest: number = last;
      for (const item of page) {
        if (item.message.seq <= imported || written.has(item.message.id)) continue;
        newest = (await tx.appendEntry(root.id, entryOf(item))).id;
      }
      if ((state.mirrored ?? 0) >= last) state.mirrored = newest;
      state.importedSeq = Math.max(imported, through);
      return true;
    }, context);

  const advance = (through: number) =>
    save((state) => {
      state.importedSeq = Math.max(state.importedSeq ?? -1, through);
    });

  const submitPage = async (page: Imported[], through: number) => {
    for (const item of page) {
      await root.submit({ type: "write", requestId: requestOf(item.message), entry: entryOf(item) }, context);
    }
    await advance(through);
  };

  let importing: Promise<void> | undefined;
  const importOnce = async () => {
    let after = (await doc()).importedSeq ?? -1;
    for (;;) {
      const read = await log.read(after, IMPORT_PAGE);
      if (read.throughSeq > after) {
        const page = read.messages.flatMap((message) => {
          const text = message.text.trim();
          return text ? [{ message, text }] : [];
        });
        if (page.length === 0) await advance(read.throughSeq);
        else if (!(await importPage(page, read.throughSeq))) await submitPage(page, read.throughSeq);
      }
      if (read.complete || read.throughSeq <= after) break;
      after = read.throughSeq;
    }
  };
  const importNow = () =>
    (importing ??= importOnce().finally(() => {
      importing = undefined;
    }));

  if ((await doc()).mirrored === undefined) {
    const last = await harness.commit(
      async (tx) => (await tx.scanEntries({ conversationId: root.id, order: "descending" }, 1)).items[0],
      context,
    );
    await save((current) => {
      current.mirrored = last?.id ?? 0;
    });
  }

  let running = false;
  let again = false;
  const spawned = new Map<string, string>();
  const unfinishedReplyEnding = (entryId: EntryId) =>
    harness.commit(async (tx): Promise<"pending" | "superseded" | "stands"> => {
      if ((await tx.doc(LiveDoc, root.id)).run !== undefined) return "pending";
      const later = await tx.scanEntries(
        { conversationId: root.id, minEntryId: (entryId + 1) as EntryId, order: "ascending" },
        PAGE,
      );
      for (const next of later.items) {
        if (next.kind === "pi.user") break;
        if (next.kind === "pi.assistant") return "superseded";
      }
      return "stands";
    }, context);
  const taskEnded = (entry: Pick<EntryRecord, "id" | "kind" | "model">): LocalLogWrite | undefined => {
    const message = entry.model?.[0];
    if (entry.kind !== "pi.user" || message?.role !== "user" || !piUserHidden(message as PiUserMessage)) return undefined;
    const wake = wakePromptOf(piJournalUserMessage(message as PiUserMessage).message);
    if (!wake) return undefined;
    return {
      key: `${root.id}:${entry.id}:agent-${wake.outcome}`,
      role: "lifecycle",
      type: wake.outcome === "completed" ? "agent-completed" : wake.outcome === "failed" ? "agent-failed" : "agent-canceled",
      timestamp: message.timestamp,
      agentId: wake.threadId,
      payload: {
        agentId: wake.threadId,
        ...(wake.description ? { description: wake.description } : {}),
        ...(wake.outcome === "completed" ? { result: wake.body } : wake.body ? { error: wake.body } : {}),
      },
    };
  };
  const isReply = (entry: Pick<EntryRecord, "kind" | "model">): boolean => {
    const message = entry.model?.[0];
    return (
      entry.kind === "pi.assistant" &&
      message?.role === "assistant" &&
      splitMessageReplyRefs(message).text.trim().length > 0
    );
  };
  const relayOf = (entryId: EntryId) =>
    harness.commit(async (tx): Promise<"pending" | "relayed" | "none"> => {
      if ((await tx.doc(LiveDoc, root.id)).run !== undefined) return "pending";
      const later = await tx.scanEntries(
        { conversationId: root.id, minEntryId: (entryId + 1) as EntryId, order: "ascending" },
        PAGE,
      );
      for (const next of later.items) {
        if (next.kind === "pi.user") return "none";
        if (isReply(next)) return "relayed";
      }
      return "none";
    }, context);
  const relayedReport = (entryId: EntryId) =>
    harness.commit(async (tx): Promise<LocalLogWrite | undefined> => {
      let cursor: Cursor | undefined;
      let scanned = 0;
      do {
        const earlier = await tx.scanEntries(
          { conversationId: root.id, maxEntryId: (entryId - 1) as EntryId, order: "descending" },
          RELAY_SCAN_PAGE,
          cursor,
        );
        for (const previous of earlier.items) {
          if (previous.kind === "pi.user") return taskEnded(previous);
          if (isReply(previous)) return undefined;
        }
        scanned += earlier.items.length;
        cursor = earlier.next;
      } while (cursor !== undefined && scanned < PAGE);
      return undefined;
    }, context);
  const mirrorOnce = async () => {
    const state = await doc();
    let replyTo = state.replyTo;
    let mirrored = state.mirrored ?? 0;
    let held = false;
    for (;;) {
      const page = await harness.commit(
        async (tx) =>
          (await tx.scanEntries({ conversationId: root.id, minEntryId: (mirrored + 1) as EntryId, order: "ascending" }, PAGE)).items,
        context,
      );
      for (const entry of page) {
        const message = entry.model?.[0];
        if (message && !fromLog(entry)) {
          const key = `${root.id}:${entry.id}`;
          if (entry.kind === "pi.user" && message.role === "user") {
            const { text, display } = piUserView(message as PiUserMessage);
            const hidden = piUserHidden(message as PiUserMessage);
            const ended = taskEnded(entry);
            if (ended) {
              const relay = await relayOf(entry.id);
              if (relay === "pending") {
                held = true;
                break;
              }
              if (relay === "none") await log.write(ended);
            }
            if (!text.trim() && !hidden) {
              const { clientMsgId } = piJournalUserMessage(message as PiUserMessage);
              if (clientMsgId) await recordMessageId(harness, root.id, clientMsgId, NO_MESSAGE_ID, context);
            }
            if (text.trim() && !hidden) {
              const { clientMsgId } = piJournalUserMessage(message as PiUserMessage);
              const row = await log.write({
                key,
                role: "user",
                text: text.trim(),
                timestamp: message.timestamp,
                ...(clientMsgId ? { clientMsgId } : {}),
                ...(display ? { display } : {}),
              });
              replyTo = row.id;
              if (clientMsgId) await recordMessageId(harness, root.id, clientMsgId, row.seq ?? NO_MESSAGE_ID, context);
            }
          } else if (entry.kind === "pi.assistant" && message.role === "assistant") {
            const split = splitMessageReplyRefs(message);
            const text = split.text.trim();
            const calls = message.content.flatMap((part) => (part.type === "toolCall" ? [part] : []));
            for (const reaction of split.reactions) {
              await log.write({
                key: `${key}:react:${reaction.sequence}`,
                role: "reaction",
                timestamp: message.timestamp,
                sequence: reaction.sequence,
                emoji: reaction.emoji,
              });
            }
            if (text) {
              await log.write({
                key,
                role: "assistant",
                text,
                timestamp: message.timestamp,
                ...(replyTo ? { replyTo } : {}),
                ...(calls.length > 0 ? { followedByToolCall: true } : {}),
              });
              const relayed = await relayedReport(entry.id);
              if (relayed) await log.write({ ...relayed, timestamp: Math.max(relayed.timestamp, message.timestamp + 1) });
            }
            for (const [index, call] of calls.entries()) {
              const description = (call.arguments as { description?: unknown } | undefined)?.description;
              if (call.name === "spawn_agent" && typeof description === "string") spawned.set(call.id, description.trim());
              await log.write({
                key: `${key}:tool:${index}`,
                role: "tool_request",
                timestamp: message.timestamp + index + 1,
                toolCallId: call.id,
                toolName: call.name,
                ...(call.arguments ? { args: call.arguments } : {}),
              });
            }
            const terminal = piTerminalNotice(message);
            const ending = terminal ? await unfinishedReplyEnding(entry.id) : "stands";
            if (ending === "pending") {
              held = true;
              break;
            }
            if (terminal && ending === "stands") {
              await log.write({
                key: `${key}:notice`,
                role: "assistant",
                text: terminal.notice,
                timestamp: message.timestamp + calls.length + 1,
                ...(replyTo ? { replyTo } : {}),
                notice: true,
              });
            }
          } else if (entry.kind === "pi.tool-result" && message.role === "toolResult") {
            const text = piMessageText(message);
            await log.write({
              key,
              role: "tool_result",
              timestamp: message.timestamp,
              toolCallId: message.toolCallId,
              toolName: message.toolName,
              text,
              ...(message.details !== undefined ? { details: message.details } : {}),
              ...(message.isError ? { isError: true } : {}),
            });
            const threadId = message.toolName === "spawn_agent" && !message.isError ? spawnedThreadId(message.details, text) : undefined;
            if (threadId) {
              const description =
                spawned.get(message.toolCallId) ??
                (message.details as { description?: unknown } | undefined)?.description;
              spawned.delete(message.toolCallId);
              await log.write({
                key: `${key}:agent-started`,
                role: "lifecycle",
                type: "agent-started",
                timestamp: message.timestamp + 1,
                agentId: threadId,
                payload: {
                  agentId: threadId,
                  agentType: "general",
                  ...(typeof description === "string" && description ? { description } : {}),
                },
              });
            }
          }
        }
        mirrored = entry.id;
      }
      const through = mirrored;
      const reply = replyTo;
      await save((current) => {
        current.mirrored = Math.max(current.mirrored ?? 0, through);
        if (reply) current.replyTo = reply;
      });
      if (held || page.length < PAGE) break;
    }
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
        await mirrorOnce().catch(report);
      } while (again && !stopped);
      running = false;
    })();
  };

  await importNow().catch(report);

  const stream: AgentEventStream = await watchEvents(harness, root.id, context);
  stream.start(async (events) => {
    if ((events as Array<{ type: string }>).some((event) => MIRRORED_EVENTS.has(event.type))) sync();
  });
  sync();

  return {
    importNow,
    async stop() {
      stopped = true;
      await stream.stop().catch(() => undefined);
    },
  };
}
