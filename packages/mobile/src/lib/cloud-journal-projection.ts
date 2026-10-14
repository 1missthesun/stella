import { reminderMarkOf } from "@stella/contracts/reminders";
import { parseAskUserToolResult, type UserAskRecord } from "@stella/contracts/user-ask-deck";
import { projectMobileLifecycle } from "./mobile-reply-context";
import { cloudFileArtifact } from "./cloud-file-payload";
import type { ChatArtifact, ChatMessage } from "../types";
import { splitMessageReplyRefs } from "@stella/contracts/reply-refs";
import {
  completeJournalWindowRecords,
  journalMessageTimestamp as timestampOf,
  journalTerminalNotice,
  journalUserReactions,
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
    recordsBySeq: () => ReadonlyMap<number, JournalRecord>;
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

type TurnProjection = {
  records: readonly JournalRecord[];
  reactionsKey: string;
  windowKey: string | null;
  messages: ChatMessage[];
};
const turnProjections = new Map<string, Map<string, TurnProjection>>();
const MAX_CACHED_CONVERSATIONS = 4;

const sameRecords = (
  a: readonly JournalRecord[],
  b: readonly JournalRecord[],
): boolean => a.length === b.length && a.every((record, i) => record === b[i]);

const turnReactionsKey = (
  turn: readonly JournalRecord[],
  reactions: ReadonlyMap<number, { emoji: string; at: number }>,
): string => {
  let key = "";
  for (const record of turn) {
    if (record.kind !== "message" || record.role !== "user") continue;
    const reaction = reactions.get(record.seq);
    if (reaction) key += `${record.seq}:${reaction.emoji}:${reaction.at};`;
  }
  return key;
};

export const projectCloudConversationMessages = (args: {
  conversationId?: string;
  records: readonly JournalRecord[];
  hasOlder?: boolean;
}): ChatMessage[] => {
  const records = completeJournalWindowRecords(
    args.records,
    args.hasOlder === true,
    { dropCardOnly: true },
  );
  let bySeq: Map<number, JournalRecord> | null = null;
  const recordsBySeq = () =>
    (bySeq ??= new Map(args.records.map(record => [record.seq, record])));
  const reactions = journalUserReactions(args.records);
  const byTurn = new Map<string, JournalRecord[]>();
  for (const record of records) {
    const turn = byTurn.get(record.turnId);
    if (turn) turn.push(record);
    else byTurn.set(record.turnId, [record]);
  }

  const cacheKey = args.conversationId ?? "";
  const previous = turnProjections.get(cacheKey);
  const next = new Map<string, TurnProjection>();
  const windowKey = `${args.hasOlder === true}:${args.records[0]?.seq ?? ""}`;
  const messages: ChatMessage[] = [];
  for (const [turnId, turn] of byTurn) {
    const reactionsKey = turnReactionsKey(turn, reactions);
    const cached = previous?.get(turnId);
    let projection: TurnProjection;
    if (
      cached &&
      (cached.windowKey === null || cached.windowKey === windowKey) &&
      cached.reactionsKey === reactionsKey &&
      sameRecords(cached.records, turn)
    ) {
      projection = cached;
    } else {
      let readWindow = false;
      const messages = projectTurn(turnId, turn, {
        conversationId: args.conversationId,
        recordsBySeq: () => {
          readWindow = true;
          return recordsBySeq();
        },
        reactions,
      });
      projection = {
        records: turn,
        reactionsKey,
        windowKey: readWindow ? windowKey : null,
        messages,
      };
    }
    next.set(turnId, projection);
    messages.push(...projection.messages);
  }
  turnProjections.delete(cacheKey);
  turnProjections.set(cacheKey, next);
  while (turnProjections.size > MAX_CACHED_CONVERSATIONS) {
    const oldest = turnProjections.keys().next().value;
    if (oldest === undefined) break;
    turnProjections.delete(oldest);
  }

  return projectMobileLifecycle(
    messages,
    args.records,
    args.conversationId ?? "",
  );
};

export const activeCloudTurnId = (
  records: readonly JournalRecord[],
  live: LiveTurn | null,
): string | null => {
  const phases = new Map<string, string>();
  for (const record of records) {
    if (record.kind === "turn") phases.set(record.turnId, record.phase);
  }
  if (live && (!phases.has(live.turnId) || phases.get(live.turnId) === "started")) {
    return live.turnId;
  }
  for (const [turnId, phase] of [...phases].reverse()) {
    if (phase === "started") return turnId;
  }
  return null;
};

export { journalWorkingActivity as cloudTurnActivity } from "@stella/contracts/journal-working-activity";

export const canonicalCloudDispatchIdForTurn = (
  records: readonly JournalRecord[],
  turnId: string | null,
): string | null => {
  if (!turnId) return null;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;
    if (
      record.turnId === turnId &&
      record.kind === "message" &&
      record.role === "user" &&
      record.clientMsgId
    ) {
      return record.clientMsgId;
    }
  }
  return null;
};

export const canonicalCloudDispatchIds = (
  records: readonly JournalRecord[],
): ReadonlySet<string> =>
  new Set(
    records.flatMap((record) =>
      record.kind === "message" && record.role === "user" && record.clientMsgId
        ? [record.clientMsgId]
        : [],
    ),
  );

export const mergeCanonicalCloudMessages = (args: {
  canonical: readonly ChatMessage[];
  local: readonly ChatMessage[];
  dispatchBindings: ReadonlyMap<string, string | null>;
  acknowledgedDispatchIds: ReadonlySet<string>;
  sentAnchors?: SentMessageAnchors;
}): ChatMessage[] => {
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

export const rebindCanonicalCloudMessages = (
  canonical: readonly ChatMessage[],
  dispatchBindings: ReadonlyMap<string, string | null>,
): ChatMessage[] => {
  const localByDispatch = new Map<string, string>();
  for (const [localId, dispatchId] of dispatchBindings) {
    if (dispatchId) localByDispatch.set(dispatchId, localId);
  }
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
