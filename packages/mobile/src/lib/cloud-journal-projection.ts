import { reminderMarkOf } from "@stella/contracts/reminders";
import { parseAskUserToolResult, type UserAskRecord } from "@stella/contracts/user-ask-deck";
import { projectMobileLifecycle, type ProjectedTurn } from "./mobile-reply-context";
import {
  journalIndex,
  type JournalIndex,
  type JournalTurn,
  type JournalView,
} from "./journal-index";
import { cloudFileArtifact } from "./cloud-file-payload";
import type { ChatArtifact, ChatMessage } from "../types";
import { splitMessageReplyRefs } from "@stella/contracts/reply-refs";
import {
  journalMessageTimestamp as timestampOf,
  journalRecordReactions,
  journalTerminalNotice,
  resolveJournalReplyRefs,
  storedJournalReplyRefs,
} from "@stella/contracts/conversation-journal-projection";
import { isMapRouteArtifact } from "@stella/contracts/map-artifact";
import { isPiAgentText } from "@stella/contracts/pi-chat";
import type { ToolStep } from "./tool-activity";
import {
  messageText,
  type JournalMessageRecord,
  type JournalRecord,
} from "@stella/contracts/conversation-protocol";
import type { LiveTurn } from "./cloud-conversation-store";
import { withAttachmentPreamble } from "./chat-attachments";
import type { SentMessageAnchors } from "@stella/contracts/sent-message-anchors";
import { replaceEqualDeep } from "./structural-sharing";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const projectedMessageId = (record: JournalMessageRecord): string => {
  const origin = record.role === "user" ? record.payload.originUserMessageId : undefined;
  return (typeof origin === "string" && origin.trim()) ||
    record.clientMsgId || `cloud:${record.turnId}:message:${record.seq}`;
};

const isBlankUserRecord = (
  record: Extract<JournalRecord, { kind: "message" }>,
): boolean => {
  if (record.role !== "user") return false;
  const content = record.payload.content;
  if (typeof content === "string") return content.trim().length === 0;
  if (!Array.isArray(content)) return true;
  return content.every(
    (block) =>
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      !String((block as { text?: unknown }).text ?? "").trim(),
  );
};

const userDisplayContext = (payload: Record<string, unknown>) => {
  const metadata = asRecord(payload.metadata);
  const context = asRecord(metadata?.context);
  const pastedTexts = (Array.isArray(context?.pastedTexts) ? context.pastedTexts : [])
    .flatMap((entry) => {
      const descriptor = asRecord(entry);
      return descriptor &&
        typeof descriptor.lines === "number" &&
        typeof descriptor.chars === "number"
        ? [{ lines: descriptor.lines, chars: descriptor.chars }]
        : [];
    });
  const quotedText =
    typeof context?.quotedText === "string" && context.quotedText.trim()
      ? context.quotedText
      : undefined;
  const displayText =
    typeof metadata?.displayText === "string" ? metadata.displayText : undefined;
  return { pastedTexts, quotedText, displayText };
};

const userAttachmentPresentation = (payload: Record<string, unknown>) => {
  const raw = asRecord(payload.providerContext)?.attachments;
  const attachmentPaths = Array.isArray(raw)
    ? [...new Set(raw.filter((path): path is string => typeof path === "string" && path.length > 0 && path.length <= 400))]
    : [];
  const text = messageText(payload);
  const suffix = attachmentPaths.length ? withAttachmentPreamble("", attachmentPaths) : "";
  const thumbnailUris = attachmentPaths.length ? [] : inlineImageUris(payload);
  const documentNames = attachmentPaths.length ? [] : declaredFileNames(payload);
  return {
    text: !suffix ? text : text === suffix.trimStart() ? "" : text.endsWith(suffix) ? text.slice(0, -suffix.length) : text,
    ...(attachmentPaths.length ? {
      attachmentPaths,
      attachmentPreviews: attachmentPaths.map(path => ({ path, name: path.split("/").at(-1) ?? path })),
    } : {}),
    ...(thumbnailUris.length ? { thumbnailUris, hasImage: true } : {}),
    ...(documentNames.length ? { documentNames } : {}),
  };
};

const INLINE_IMAGE_MAX_BASE64 = 2 * 1024 * 1024;

const inlineImageUris = (payload: Record<string, unknown>): string[] =>
  Array.isArray(payload.content)
    ? payload.content.flatMap((value) => {
        const block = asRecord(value);
        return block?.type === "image" &&
          typeof block.data === "string" &&
          block.data.length > 0 &&
          block.data.length <= INLINE_IMAGE_MAX_BASE64 &&
          typeof block.mimeType === "string" &&
          block.mimeType.toLowerCase().startsWith("image/")
          ? [`data:${block.mimeType};base64,${block.data}`]
          : [];
      })
    : [];

const declaredFileNames = (payload: Record<string, unknown>): string[] =>
  Array.isArray(payload.attachments)
    ? payload.attachments.flatMap((value) => {
        const entry = asRecord(value);
        if (entry?.kind !== "file") return [];
        const name =
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : typeof entry.path === "string"
              ? entry.path.split(/[\\/]/).at(-1) ?? ""
              : "";
        return name ? [name] : [];
      })
    : [];

const toolCalls = (
  record: JournalMessageRecord,
): { id: string; name: string; args?: Record<string, string> }[] => {
  if (!Array.isArray(record.payload.content)) return [];
  return record.payload.content.flatMap((value, index) => {
    const block = asRecord(value);
    if (!block || block.type !== "toolCall") return [];
    const name = typeof block.name === "string" ? block.name : "tool";
    const id =
      typeof block.id === "string" && block.id
        ? block.id
        : `cloud:${record.turnId}:tool:${record.seq}:${index}`;
    const rawArgs = asRecord(block.arguments);
    const args = rawArgs
      ? Object.fromEntries(
          Object.entries(rawArgs).flatMap(([key, raw]) =>
            typeof raw === "string" ? [[key, raw]] : [],
          ),
        )
      : undefined;
    return [
      { id, name, ...(args && Object.keys(args).length ? { args } : {}) },
    ];
  });
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];

const generatedImageArtifacts = (args: {
  record: JournalMessageRecord;
  conversationId: string;
  toolResults: ReadonlyMap<
    string,
    { error: boolean; payload: Record<string, unknown> }
  >;
  terminal: Extract<JournalRecord, { kind: "turn" }> | undefined;
  createdAt: number;
}): ChatArtifact[] => {
  const artifacts: ChatArtifact[] = [];
  for (const call of toolCalls(args.record)) {
    if (call.name.split("__").at(-1) !== "image_gen") continue;
    const result = args.toolResults.get(call.id);
    const details =
      asRecord(result?.payload.details) ?? asRecord(result?.payload.result);
    const drivePaths = stringList(details?.drivePaths);
    const filePaths =
      drivePaths.length > 0 ? drivePaths : stringList(details?.filePaths);
    const status = typeof details?.status === "string" ? details.status : "";
    const generationState: "running" | "completed" | "failed" | "canceled" =
      result
        ? !result.error && filePaths.length > 0
          ? "completed"
          : status === "canceled"
            ? "canceled"
            : "failed"
        : args.terminal
          ? args.terminal.phase === "canceled"
            ? "canceled"
            : "failed"
          : "running";
    const prompt =
      (typeof details?.prompt === "string" && details.prompt) ||
      call.args?.prompt;
    const aspectRatio =
      (typeof details?.aspectRatio === "string" && details.aspectRatio) ||
      call.args?.aspectRatio;
    artifacts.push({
      id: `cloud:${args.record.turnId}:image:${call.id}`,
      conversationId: args.conversationId,
      payload: {
        kind: "media",
        asset: { kind: "image", filePaths },
        createdAt: args.createdAt,
        presentation: "inline-image",
        toolCallId: call.id,
        generationState,
        ...(drivePaths.length ? { driveBacked: true } : {}),
        ...(prompt ? { prompt } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(typeof details?.capability === "string"
          ? { capability: details.capability }
          : {}),
      },
    });
  }
  return artifacts;
};

const MAX_MAP_CARDS_PER_TURN = 3;

const mapRouteArtifacts = (args: {
  record: JournalMessageRecord;
  conversationId: string;
  toolResults: ReadonlyMap<
    string,
    { error: boolean; payload: Record<string, unknown> }
  >;
  createdAt: number;
}): ChatArtifact[] => {
  const artifacts: ChatArtifact[] = [];
  for (const call of toolCalls(args.record)) {
    if (call.name !== "map" && call.name !== "code") continue;
    const result = args.toolResults.get(call.id);
    if (!result || result.error) continue;
    const details = asRecord(result.payload.details);
    const candidates = Array.isArray(details?.maps)
      ? details.maps
      : [details?.map];
    candidates.forEach((candidate, index) => {
      if (artifacts.length >= MAX_MAP_CARDS_PER_TURN) return;
      if (!isMapRouteArtifact(candidate)) return;
      artifacts.push({
        id: `cloud:${args.record.turnId}:map:${call.id}:${index}`,
        conversationId: args.conversationId,
        payload: {
          kind: "map-route",
          version: 1,
          ...(candidate.title ? { title: candidate.title } : {}),
          markers: candidate.markers,
          ...(candidate.route ? { route: candidate.route } : {}),
        },
      });
    });
  }
  return artifacts;
};

export type DestinationSwitch = {
  toolCallId: string;
  destination: string;
  at: number;
};

export const latestDestinationSwitch = (
  records: readonly JournalRecord[],
): DestinationSwitch | null => {
  const results = new Map<string, number>();
  for (const record of records) {
    if (record.kind !== "message" || record.role !== "toolResult") continue;
    const id = record.payload.toolCallId;
    if (typeof id === "string" && id && record.payload.isError !== true) {
      results.set(id, timestampOf(record));
    }
  }
  let latest: DestinationSwitch | null = null;
  for (const record of records) {
    if (record.kind !== "message" || record.role !== "assistant") continue;
    for (const call of toolCalls(record)) {
      if (call.name !== "switch_destination") continue;
      const at = results.get(call.id);
      const destination = call.args?.destination?.trim();
      if (at === undefined || !destination) continue;
      if (!latest || at >= latest.at) {
        latest = { toolCallId: call.id, destination, at };
      }
    }
  }
  return latest;
};

const projectTurn = (
  turnId: string,
  turn: readonly JournalRecord[],
  context: {
    conversationId?: string;
    recordsBySeq: () => Pick<ReadonlyMap<number, JournalRecord>, "get">;
    reactions: ReadonlyMap<number, { emoji: string; at: number }>;
  },
): ChatMessage[] => {
  const { recordsBySeq, reactions } = context;
  const args = { conversationId: context.conversationId };
  const out: ChatMessage[] = [];
  const reminderRecord = turn.find(
    (record): record is Extract<JournalRecord, { kind: "card" }> =>
      record.kind === "card" && record.card.type === "reminder",
  );
  if (reminderRecord && reminderRecord.card.type === "reminder") {
    const card = reminderRecord.card;
    out.push({
      id: `cloud:${turnId}:reminder:${reminderRecord.seq}`,
      role: "assistant",
      text: card.text,
      createdAt: reminderRecord.createdAtMs,
      canonicalCreatedAt: reminderRecord.createdAtMs,
      sequence: reminderRecord.seq,
      reminder: reminderMarkOf(card),
    });
    return out;
  }
  let userMessageId = `cloud:${turnId}:user`;
  let turnUserRecord: JournalMessageRecord | undefined;
  let terminal: Extract<JournalRecord, { kind: "turn" }> | undefined;
  const toolResults = new Map<
    string,
    { error: boolean; payload: Record<string, unknown> }
  >();
  for (const record of turn) {
    if (record.kind === "turn" && record.phase !== "started") {
      terminal = record;
    }
    if (record.kind === "message" && record.role === "toolResult") {
      const id =
        typeof record.payload.toolCallId === "string"
          ? record.payload.toolCallId
          : "";
      if (id) {
        toolResults.set(id, {
          error: record.payload.isError === true,
          payload: record.payload,
        });
      }
    }
  }

  for (const record of turn) {
    if (record.kind !== "message") continue;
    const createdAt = timestampOf(record);
    if (record.role === "user") {
      turnUserRecord = record;
      userMessageId = projectedMessageId(record);
      const display = userDisplayContext(record.payload);
      const hasDisplayContext =
        display.pastedTexts.length > 0 || Boolean(display.quotedText);
      if (
        record.hidden ||
        (isBlankUserRecord(record) && !hasDisplayContext) ||
        isPiAgentText(display.displayText ?? messageText(record.payload))
      ) {
        continue;
      }
      const presentation = userAttachmentPresentation(record.payload);
      const reaction = reactions.get(record.seq);
      out.push({
        id: userMessageId,
        canonicalId: `cloud:${turnId}:message:${record.seq}`,
        role: "user",
        ...presentation,
        ...(display.displayText !== undefined
          ? { text: display.displayText }
          : {}),
        ...(display.pastedTexts.length > 0
          ? { pastedTexts: display.pastedTexts }
          : {}),
        ...(display.quotedText ? { quotedText: display.quotedText } : {}),
        ...(reaction ? { reaction: reaction.emoji, reactionAt: reaction.at } : {}),
        createdAt,
        canonicalCreatedAt: record.createdAtMs,
        sequence: record.seq,
      });
      continue;
    }
    if (record.role !== "assistant" || record.hidden) continue;
    const spawnedThreadIds: string[] = [];
    const spawnedDescriptions: string[] = [];
    const tools: ToolStep[] = toolCalls(record).flatMap((call) => {
      const result = toolResults.get(call.id);
      if (!result) return [];
      if (call.name === "spawn_agent" || call.name === "send_message") {
        const details = result.payload.details;
        const threadId = details && typeof details === "object" && "thread_id" in details ? details.thread_id : undefined;
        const argThreadId = call.args && "thread_id" in call.args ? call.args.thread_id : undefined;
        for (const candidate of [threadId, argThreadId]) {
          if (typeof candidate === "string" && candidate && !spawnedThreadIds.includes(candidate)) spawnedThreadIds.push(candidate);
        }
        const description = call.name === "spawn_agent" && call.args && "description" in call.args ? call.args.description : undefined;
        if (typeof description === "string" && description.trim() && !spawnedDescriptions.includes(description.trim())) spawnedDescriptions.push(description.trim());
      }
      return [
        {
          id: call.id,
          toolName: call.name,
          status: result.error ? "error" : "completed",
          ...(call.args ? { args: call.args } : {}),
        },
      ];
    });
    const split = splitMessageReplyRefs(record.payload);
    const value = split.text;
    const storedRefs = storedJournalReplyRefs(record.payload);
    const replyRefs = storedRefs.length
      ? storedRefs
      : split.refs.length === 0
        ? []
        : resolveJournalReplyRefs({
          raw: split.refs,
          recordsBySeq: recordsBySeq(),
          turnUserRecord,
          messageId: projectedMessageId,
        });
    const artifacts = [
      ...mapRouteArtifacts({
        record,
        conversationId: args.conversationId ?? "",
        toolResults,
        createdAt,
      }),
      ...generatedImageArtifacts({
        record,
        conversationId: args.conversationId ?? "",
        toolResults,
        terminal,
        createdAt,
      }),
    ];
    const askRecords = toolCalls(record).flatMap((call): UserAskRecord[] => {
      if (call.name !== "ask_user" && call.name !== "request_secure_input") return [];
      const result = toolResults.get(call.id);
      if (!result || result.error) return [];
      const content = Array.isArray(result.payload.content)
        ? result.payload.content
            .map((part) => asRecord(part))
            .map((part) => (typeof part?.text === "string" ? part.text : ""))
            .join("")
        : undefined;
      const parsed =
        parseAskUserToolResult(result.payload.details) ??
        parseAskUserToolResult(content);
      return parsed
        ? [{ id: `cloud:${turnId}:ask:${call.id}`, toolCallId: call.id, createdAt, ...parsed }]
        : [];
    });
    if (!value && !tools.length && !artifacts.length) continue;
    out.push({
      id: `cloud:${turnId}:message:${record.seq}`,
      requestId: userMessageId,
      role: "assistant",
      text: value,
      ...(replyRefs.length ? { replyRefs } : {}),
      createdAt,
      canonicalCreatedAt: record.createdAtMs,
      sequence: record.seq,
      ...(tools.length ? { toolSteps: tools } : {}),
      ...(spawnedThreadIds.length ? { spawnedThreadIds } : {}),
      ...(spawnedDescriptions.length ? { spawnedDescriptions } : {}),
      ...(artifacts.length ? { artifacts } : {}),
      ...(askRecords.length ? { askRecords } : {}),
    });
  }

  const ownOutputPaths = new Set<string>();
  for (const { payload } of toolResults.values()) {
    const toolName =
      typeof payload.toolName === "string"
        ? (payload.toolName.split("__").at(-1) ?? payload.toolName)
        : "";
    const details = asRecord(payload.details);
    if (toolName === "html" && typeof details?.filePath === "string") {
      ownOutputPaths.add(details.filePath);
    }
  }
  const files = turn.flatMap((record) =>
    record.kind === "card" && record.card.type === "files"
      ? record.card.files.filter((file) => ownOutputPaths.has(file.path))
      : [],
  );
  if (files.length) {
    const createdAt = turn.at(-1)?.createdAtMs ?? 0;
    const artifacts: ChatArtifact[] = files.map((file) =>
      cloudFileArtifact(file, args.conversationId ?? "", createdAt),
    );
    const lastAssistantIndex = out.findLastIndex(
      (message) =>
        message.role === "assistant" && message.requestId === userMessageId,
    );
    if (lastAssistantIndex >= 0) {
      const assistant = out[lastAssistantIndex]!;
      out[lastAssistantIndex] = {
        ...assistant,
        artifacts: [...(assistant.artifacts ?? []), ...artifacts],
      };
    } else {
      out.push({
        id: `cloud:${turnId}:files`,
        requestId: userMessageId,
        role: "assistant",
        text: "",
        artifacts,
        createdAt: turn.at(-1)?.createdAtMs,
        sequence: turn.at(-1)?.seq,
      });
    }
  }

  const notice = journalTerminalNotice(turn);
  if (notice) {
    out.push({
      id: `cloud:${turnId}:notice:${notice.seq}`,
      requestId: userMessageId,
      role: "assistant",
      text: notice.notice,
      createdAt: notice.createdAtMs,
      canonicalCreatedAt: notice.createdAtMs,
      sequence: notice.seq,
      ...(notice.phase === "canceled" ? { stopped: true } : {}),
    });
  }
  return out;
};

type TurnProjection = ProjectedTurn & {
  reactionsKey: string;
  lookups: readonly (readonly [number, JournalRecord | undefined])[];
};

const REACTORS: JournalView = {
  id: "reactors",
  test: (record) =>
    record.kind === "message" &&
    record.role === "assistant" &&
    !record.hidden &&
    journalRecordReactions(record).length > 0,
};

type WindowReactions = {
  bySeq: Map<number, { emoji: string; at: number }>;
  keyByTurn: Map<string, string>;
};

const NO_REACTIONS: WindowReactions = { bySeq: new Map(), keyByTurn: new Map() };

/**
 * Reactions on visible user messages, as `journalUserReactions` reads them,
 * from just the assistant records that carry one.
 */
const reactionsByView = new WeakMap<
  readonly JournalRecord[],
  { first: JournalRecord | undefined; reactions: WindowReactions }
>();

const windowReactions = (index: JournalIndex): WindowReactions => {
  const reactors = index.view(REACTORS);
  if (!reactors.length) return NO_REACTIONS;
  const cached = reactionsByView.get(reactors);
  if (cached && cached.first === index.records[0]) return cached.reactions;
  const reactions = collectWindowReactions(index, reactors);
  reactionsByView.set(reactors, { first: index.records[0], reactions });
  return reactions;
};

const collectWindowReactions = (
  index: JournalIndex,
  reactors: readonly JournalRecord[],
): WindowReactions => {
  const bySeq = new Map<number, { emoji: string; at: number }>();
  for (const record of reactors) {
    if (record.kind !== "message") continue;
    for (const reaction of journalRecordReactions(record)) {
      const target = index.recordAt(reaction.sequence);
      if (
        !target ||
        target.kind !== "message" ||
        target.role !== "user" ||
        target.hidden ||
        target.seq >= record.seq
      ) {
        continue;
      }
      bySeq.set(reaction.sequence, {
        emoji: reaction.emoji,
        at: timestampOf(record),
      });
    }
  }
  const keyByTurn = new Map<string, string>();
  for (const seq of [...bySeq.keys()].sort((a, b) => a - b)) {
    const reaction = bySeq.get(seq)!;
    const turnId = index.recordAt(seq)!.turnId;
    keyByTurn.set(
      turnId,
      `${keyByTurn.get(turnId) ?? ""}${seq}:${reaction.emoji}:${reaction.at};`,
    );
  }
  return { bySeq, keyByTurn };
};

const leadingTurnLacksPrompt = (turn: JournalTurn): boolean =>
  !turn.records.some(
    (record) =>
      (record.kind === "message" && record.role === "user") ||
      (record.kind === "card" && record.card.type === "reminder"),
  );

/** The turns a window shows: all but a leading turn cut off from its prompt. */
export const displayedJournalTurns = (
  index: JournalIndex,
  hasOlder: boolean,
): readonly JournalTurn[] => {
  const first = index.turns[0];
  return hasOlder && first && leadingTurnLacksPrompt(first)
    ? index.turns.slice(1)
    : index.turns;
};

const projectionOf = (
  turn: JournalTurn,
  index: JournalIndex,
  conversationId: string | undefined,
  reactions: WindowReactions,
): TurnProjection => {
  const reactionsKey = reactions.keyByTurn.get(turn.turnId) ?? "";
  const cached = turn.memo.projection as TurnProjection | undefined;
  if (
    cached &&
    cached.reactionsKey === reactionsKey &&
    cached.lookups.every(([seq, record]) => index.recordAt(seq) === record)
  ) {
    return cached;
  }
  const lookups: (readonly [number, JournalRecord | undefined])[] = [];
  const tracked = {
    get: (seq: number) => {
      const record = index.recordAt(seq);
      lookups.push([seq, record]);
      return record;
    },
  };
  const messages = projectTurn(turn.turnId, turn.records, {
    conversationId,
    recordsBySeq: () => tracked,
    reactions: reactions.bySeq,
  });
  const memo = turn.memo as {
    projection?: TurnProjection;
    prior?: { projection?: TurnProjection };
  };
  const before = (cached ?? memo.prior?.projection)?.messages;
  delete memo.prior;
  const projection: TurnProjection = {
    turnId: turn.turnId,
    reactionsKey,
    lookups,
    messages: before ? shareUnchanged(before, messages) : messages,
  };
  memo.projection = projection;
  return projection;
};

/** Keeps the previous object for each message of a re-projected turn that didn't change. */
const shareUnchanged = (
  before: readonly ChatMessage[],
  after: ChatMessage[],
): ChatMessage[] =>
  after.map((message) => {
    const prior = before.find((candidate) => candidate.id === message.id);
    return prior ? replaceEqualDeep(prior, message) : message;
  });

export const projectCloudConversationMessages = (args: {
  conversationId?: string;
  records: readonly JournalRecord[];
  hasOlder?: boolean;
}): ChatMessage[] => {
  const index = journalIndex(args.conversationId ?? "", args.records);
  const reactions = windowReactions(index);
  const displayed = displayedJournalTurns(index, args.hasOlder === true);
  const dropped = displayed === index.turns ? undefined : index.turns[0];
  const turns: ProjectedTurn[] = displayed.map((turn) =>
    projectionOf(turn, index, args.conversationId, reactions));
  return projectMobileLifecycle(turns, index, args.conversationId ?? "", (turnId) => {
    const turn = index.turn(turnId);
    return turn && turn !== dropped
      ? (turn.memo as { projection?: TurnProjection }).projection
      : undefined;
  });
};

type TurnPhases = { last?: string; firstAt: number; failed: boolean };

const turnPhases = (turn: JournalTurn): TurnPhases => {
  const memo = turn.memo as { phases?: TurnPhases };
  if (!memo.phases) {
    const phases: TurnPhases = { firstAt: Infinity, failed: false };
    for (const record of turn.records) {
      if (record.kind !== "turn") continue;
      if (phases.last === undefined) phases.firstAt = record.seq;
      phases.last = record.phase;
      if (record.phase !== "started" && record.phase !== "completed") phases.failed = true;
    }
    memo.phases = phases;
  }
  return memo.phases;
};

/** Whether the turn ended in anything other than completion. */
export const journalTurnUnsuccessful = (index: JournalIndex, turnId: string): boolean => {
  const turn = index.turn(turnId);
  return turn ? turnPhases(turn).failed : false;
};

export const activeCloudTurnId = (
  index: JournalIndex,
  live: LiveTurn | null,
): string | null => {
  if (live) {
    const turn = index.turn(live.turnId);
    const last = turn ? turnPhases(turn).last : undefined;
    if (last === undefined || last === "started") return live.turnId;
  }
  let active: { turnId: string; at: number } | null = null;
  for (const turn of index.turns) {
    const phases = turnPhases(turn);
    if (phases.last === "started" && (!active || phases.firstAt > active.at)) {
      active = { turnId: turn.turnId, at: phases.firstAt };
    }
  }
  return active?.turnId ?? null;
};

export { journalWorkingActivity as cloudTurnActivity } from "@stella/contracts/journal-working-activity";

export const canonicalCloudDispatchIdForTurn = (
  index: JournalIndex,
  turnId: string | null,
): string | null => {
  const records = turnId ? index.turn(turnId)?.records : undefined;
  if (!records) return null;
  for (let at = records.length - 1; at >= 0; at -= 1) {
    const record = records[at]!;
    if (record.kind === "message" && record.role === "user" && record.clientMsgId) {
      return record.clientMsgId;
    }
  }
  return null;
};

const turnDispatchIds = (turn: JournalTurn): readonly string[] => {
  const memo = turn.memo as { dispatchIds?: readonly string[] };
  return (memo.dispatchIds ??= turn.records.flatMap((record) =>
    record.kind === "message" && record.role === "user" && record.clientMsgId
      ? [record.clientMsgId]
      : []));
};

/** The bound dispatch ids the journal already holds a user record for. */
export const acknowledgedCloudDispatchIds = (
  index: JournalIndex,
  dispatchBindings: ReadonlyMap<string, string | null>,
): ReadonlySet<string> => {
  const wanted = new Set<string>();
  for (const dispatchId of dispatchBindings.values()) {
    if (dispatchId) wanted.add(dispatchId);
  }
  const found = new Set<string>();
  for (let at = index.turns.length - 1; at >= 0 && found.size < wanted.size; at -= 1) {
    for (const id of turnDispatchIds(index.turns[at]!)) {
      if (wanted.has(id)) found.add(id);
    }
  }
  return found;
};

const SWITCH_RECORDS: JournalView = {
  id: "destination-switches",
  test: (record) => {
    if (record.kind !== "message") return false;
    if (record.role === "assistant") {
      return toolCalls(record).some((call) => call.name === "switch_destination");
    }
    if (record.role !== "toolResult") return false;
    const toolName = record.payload.toolName;
    return typeof toolName !== "string" || toolName.includes("switch_destination");
  },
};

const switches = new WeakMap<readonly JournalRecord[], DestinationSwitch | null>();

export const latestJournalDestinationSwitch = (
  index: JournalIndex,
): DestinationSwitch | null => {
  const records = index.view(SWITCH_RECORDS);
  let latest = switches.get(records);
  if (latest === undefined) {
    latest = latestDestinationSwitch(records);
    switches.set(records, latest);
  }
  return latest;
};

export const mergeCanonicalCloudMessages = (args: {
  canonical: readonly ChatMessage[];
  local: readonly ChatMessage[];
  dispatchBindings: ReadonlyMap<string, string | null>;
  acknowledgedDispatchIds: ReadonlySet<string>;
  sentAnchors?: SentMessageAnchors;
}): ChatMessage[] => {
  if (
    args.local.length === 0 &&
    !args.sentAnchors?.size &&
    ownersPrecede(args.canonical)
  ) {
    return args.canonical as ChatMessage[];
  }
  const canonicalIds = new Set(args.canonical.map((message) => message.id));
  const canonicalAssistantOwners = new Set(
    args.canonical.flatMap((message) =>
      message.role === "assistant" && message.requestId
        ? [message.requestId]
        : [],
    ),
  );
  const pendingLocalIds = new Set(
    [...args.dispatchBindings].flatMap(([localId, dispatchId]) =>
      dispatchId && args.acknowledgedDispatchIds.has(dispatchId)
        ? []
        : [localId],
    ),
  );
  const trackedLocalIds = new Set(args.dispatchBindings.keys());
  const optimistic = args.local.filter((message) => {
    if (canonicalIds.has(message.id)) return false;
    if (message.role === "user") return pendingLocalIds.has(message.id);
    const owner = message.requestId;
    return Boolean(
      owner &&
        trackedLocalIds.has(owner) &&
        !canonicalAssistantOwners.has(owner),
    );
  });
  const localById = new Map(args.local.map(message => [message.id, message]));
  const canonical = args.canonical.map(message => {
    const local = localById.get(message.id);
    if (message.role !== "user" || local?.role !== "user") return message;
    return {
      ...message,
      ...(message.attachmentPaths?.length ? {
        attachmentPreviews: message.attachmentPaths.map(path =>
          local.attachmentPreviews?.find(preview => preview.path === path)
          ?? message.attachmentPreviews?.find(preview => preview.path === path)
          ?? { path, name: path.split("/").at(-1) ?? path }),
      } : {}),
      ...(!message.thumbnailUris?.length && local.thumbnailUris?.length
        ? { thumbnailUris: local.thumbnailUris, hasImage: true } : {}),
      ...(!message.documentNames?.length && local.documentNames?.length
        ? { documentNames: local.documentNames } : {}),
      ...(!message.quotedText && local.quotedText ? { quotedText: local.quotedText } : {}),
    };
  });
  const anchors = args.sentAnchors;
  for (const message of optimistic) {
    if (message.role === "user") anchors?.note(message.id, message.createdAt);
  }
  const anchorOf = (message: ChatMessage) =>
    message.role === "user" ? anchors?.anchorOf(message.id) : undefined;
  const timestamp = (message: ChatMessage) =>
    anchorOf(message) ?? message.createdAt ?? Infinity;
  const anchoredIds = new Set(
    canonical.flatMap((message) =>
      anchorOf(message) === undefined ? [] : [message.id],
    ),
  );
  const fixed = anchoredIds.size
    ? canonical.filter((message) => !anchoredIds.has(message.id))
    : canonical;
  const pending = [
    ...optimistic,
    ...canonical.filter((message) => anchoredIds.has(message.id)),
  ].sort((a, b) => timestamp(a) - timestamp(b));
  const upcoming = new Set([...canonicalIds, ...pending.map((message) => message.id)]);
  const merged: ChatMessage[] = [];
  const placed = new Set<string>();
  const waiting = new Map<string, ChatMessage[]>();
  const place = (message: ChatMessage) => {
    const owner = message.requestId;
    if (owner && upcoming.has(owner) && !placed.has(owner)) {
      const queue = waiting.get(owner);
      if (queue) queue.push(message);
      else waiting.set(owner, [message]);
      return;
    }
    merged.push(message);
    placed.add(message.id);
    const followers = waiting.get(message.id);
    if (!followers) return;
    waiting.delete(message.id);
    for (const follower of followers) place(follower);
  };
  let index = 0;
  for (const message of fixed) {
    while (index < pending.length) {
      const next = pending[index]!;
      if (timestamp(next) > timestamp(message)) break;
      place(next);
      index += 1;
    }
    place(message);
  }
  for (const message of pending.slice(index)) place(message);
  for (const followers of waiting.values()) {
    for (const follower of followers) {
      merged.push(follower);
      placed.add(follower.id);
    }
  }
  return merged;
};

/**
 * Whether every reply already follows the message it answers, so placing
 * replies after their owners leaves the order as it is.
 */
const ownersPrecede = (messages: readonly ChatMessage[]): boolean => {
  const positions = new Map<string, number>();
  messages.forEach((message, at) => positions.set(message.id, at));
  return messages.every((message, at) => {
    const owner = message.requestId;
    if (!owner) return true;
    const ownerAt = positions.get(owner);
    return ownerAt === undefined || ownerAt < at;
  });
};

export const rebindCanonicalCloudMessages = (
  canonical: readonly ChatMessage[],
  dispatchBindings: ReadonlyMap<string, string | null>,
): ChatMessage[] => {
  const localByDispatch = new Map<string, string>();
  for (const [localId, dispatchId] of dispatchBindings) {
    if (dispatchId) localByDispatch.set(dispatchId, localId);
  }
  if (localByDispatch.size === 0) return canonical as ChatMessage[];
  return canonical.map((message) => {
    const localId = localByDispatch.get(message.id);
    const localRequestId = message.requestId
      ? localByDispatch.get(message.requestId)
      : undefined;
    if (!localId && !localRequestId) return message;
    return {
      ...message,
      ...(localId
        ? {
            id: localId,
            canonicalId: message.canonicalId ?? message.id,
          }
        : {}),
      ...(localRequestId ? { requestId: localRequestId } : {}),
    };
  });
};
