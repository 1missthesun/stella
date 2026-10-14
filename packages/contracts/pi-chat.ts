import type { AgentStatus } from "./agent-status.js";
import type { ChatContext } from "./index.js";
import { parseAgentReportEnvelope, type AgentReportEnvelope } from "./agent-wake-prompt.js";
import { drivePathFromSignedDriveUrl } from "./attachment-content-type.js";
import { stellaUsageLimitText } from "./stella-usage-limit.js";

export type PiPartMarks = {
  hidden?: true;
  display?: PiUserDisplay;
  clientMsgId?: string;
  seq?: number;
  source?: "schedule";
  agentReport?: AgentReportEnvelope;
};

export type PiUserDisplay = {
  attachments?: Array<{
    kind: "image" | "file";
    name?: string;
    mimeType?: string;
    size?: number;
    url?: string;
    path?: string;
    drivePath?: string;
    spilled?: true;
  }>;
  context?: Record<string, unknown>;
};

export type PiContentBlock =
  | { type: "text"; text: string; stella?: PiPartMarks }
  | { type: "thinking"; thinking: string }
  | { type: "image"; data: string; mimeType: string; stella?: PiPartMarks }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

export type PiUserPart = Extract<PiContentBlock, { type: "text" } | { type: "image" }>;

export type PiVoiceMarks = { source?: "voice"; voiceSession?: { durationMs: number } };

export type PiUserMessage = {
  role: "user";
  content: string | PiContentBlock[];
  timestamp: number;
  source?: "voice" | "schedule";
} & Omit<PiVoiceMarks, "source">;
export type PiAssistantMessage = {
  role: "assistant";
  content: PiContentBlock[];
  provider?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  timestamp: number;
  stella?: { hidden?: true };
} & PiVoiceMarks;
export type PiToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: PiContentBlock[];
  details?: unknown;
  isError: boolean;
  timestamp: number;
};
export type PiMessage = PiUserMessage | PiAssistantMessage | PiToolResultMessage | { role: "system"; content: unknown };

export type PiEntry = {
  id: number;
  conversationId: number;
  kind: string;
  model?: PiMessage[];
  data?: unknown;
  head?: number;
};

export type PiToolSlot = {
  callId: string;
  name: string;
  status: "pending" | "running" | "done";
  output?: string;
  entry?: number;
};

export type PiMessageChange =
  | { type: "text_start" | "thinking_start" | "toolcall_start"; contentIndex: number; block: PiContentBlock }
  | { type: "text_delta" | "thinking_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_delta"; contentIndex: number; path: (string | number)[]; delta: string }
  | { type: "block"; contentIndex: number; block: PiContentBlock }
  | { type: "message"; message: PiAssistantMessage };

export type PiSubmission = {
  id: number;
  type: "input" | "write";
  requestId?: string;
  status: "queued" | "placed" | "done" | "unanswered";
  entry?: number;
  answer?: number;
  reason?: string;
};

export type PiChatEvent =
  | {
      type: "snapshot";
      entries: PiEntry[];
      run?: { inputs: number[] };
      generation?: { attempt: number; message?: PiAssistantMessage; retry?: { at: number; error: string } };
      tools: PiToolSlot[];
      inbox: { id: number; mode: string }[];
    }
  | { type: "run_start"; inputs: number[] }
  | { type: "run_end"; inputs: number[] }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "message_start"; message: PiMessage }
  | { type: "message_update"; changes: PiMessageChange[] }
  | { type: "message_end"; entry: PiEntry }
  | { type: "entry_appended"; entry: PiEntry }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      output?: { trimStart?: number; append?: string } | { set: string };
    }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; entry?: PiEntry }
  | { type: "submission"; record: PiSubmission }
  | { type: "auto_retry_start"; attempt: number; at: number; errorMessage: string }
  | { type: "auto_retry_end"; attempt: number }
  | { type: "task_failed"; taskId: number; kind: string; message: string }
  | { type: "compaction_start"; reason: string; blocking: boolean }
  | { type: "compaction_end"; reason: string }
  | { type: "engine_status"; state: "running" | "compacting" | "model-fallback"; text: string }
  | { type: "engine_status"; state: "usage-limit"; text: string; until?: number }
  | { type: "engine_status"; state: "usage-limit-end"; text: string; resumed: boolean }
  | { type: "remote_turns"; turns: PiRemoteTurn[] }
  | { type: "brain"; brain: PiChatBrainResult }
  | { type: "send_failed"; requestId: string; message: string }
  | { type: "send_moved"; requestId: string; userMessageId: string };

export type PiRemoteTurn = {
  turnId: string;
  clientMsgId?: string;
};

export type ChatSendContext = Omit<ChatContext, "regionScreenshots" | "files">;

export const chatSendContext = ({
  regionScreenshots: _regionScreenshots,
  files: _files,
  ...context
}: ChatContext): ChatSendContext => context;

export type PiChatSend = {
  selectedText?: string | null;
  chatContext?: ChatSendContext | null;
  attachments?: unknown[];
  deviceId?: string;
  platform?: string;
  timezone?: string;
  locale?: string;
  mode?: string;
  messageMetadata?: Record<string, unknown>;
  agentType?: string;
  storageMode?: "cloud" | "local";
  followSender?: boolean;
};

export type PiChatPlacedResult = {
  placed: {
    runId: string;
    userMessageId: string;
  };
};

export type PiChatRequest =
  | { op: "submit"; conversationId: string; requestId: string; text: string; send?: PiChatSend }
  | { op: "abort"; conversationId: string; dispatchIds?: string[] }
  | { op: "watch"; conversationId: string }
  | { op: "unwatch"; conversationId: string }
  | { op: "older"; conversationId: string; beforeEntryId: number }
  | { op: "agents"; conversationId: string }
  | { op: "follow"; conversationId: string }
  | { op: "sendFailed"; conversationId: string; requestId: string; message: string }
  | { op: "sendMoved"; conversationId: string; requestId: string; userMessageId: string }
  | { op: "journaled"; conversationId: string; requestId: string }
  | { op: "welcome"; conversationId: string; message: string }
  | { op: "files"; conversationId: string }
  | { op: "journal"; conversationId: string }
  | {
      op: "brain";
      conversationId: string;
      fresh?: boolean;
    }
  | { op: "move"; conversationId: string; target: PiChatMoveTarget };

export type PiChatMoveTarget = { mode: "automatic" } | { mode: "cloud" } | { mode: "device"; deviceId: string };

export type PiChatBrainResult =
  | { here: true }
  | { here: false; target: { mode: "cloud" } | { mode: "device"; deviceId: string }; label?: string };

export type PiChatUsageRequest = {
  op: "usage";
  fromMs?: number;
  toMs?: number;
  conversationId?: string;
  threadId?: string;
  limit?: number;
};

export type PiChatWatchResult = {
  snapshot: Extract<PiChatEvent, { type: "snapshot" }>;
  hasOlder: boolean;
  remote?: PiRemoteTurn[];
};

export type PiChatOlderResult = { entries: PiEntry[]; hasOlder: boolean };

export type PiChatAgent = {
  threadId: string;
  description: string;
  status: "running" | "completed" | "error";
  startedAt: number;
  updatedAt: number;
  assistantMessages: string[];
  error?: string;
  agentStatus?: AgentStatus;
};

export type PiChatAgentsResult = { agents: PiChatAgent[] };

export type PiChatEventsPayload = { conversationId: string; events: PiChatEvent[] };

export type PiChatState = {
  entries: PiEntry[];
  hasOlder: boolean;
  running: boolean;
  streaming?: PiAssistantMessage;
  tools: Record<string, { name: string; status: PiToolSlot["status"]; output?: string }>;
  requestIds: Record<number, string>;
  queued: string[];
  retry?: { at: number; error: string };
  failure?: string;
  compacting: boolean;
  engineStatus?: string;
  remote: PiRemoteTurn[];
};

export const emptyPiChat = (): PiChatState => ({
  entries: [],
  hasOlder: false,
  running: false,
  tools: {},
  requestIds: {},
  queued: [],
  compacting: false,
  remote: [],
});

export const mergePiEntries = (entries: readonly PiEntry[], more: readonly PiEntry[]): PiEntry[] => {
  if (more.length === 0) return entries as PiEntry[];
  const byId = new Map<number, PiEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  for (const entry of more) byId.set(entry.id, entry);
  return [...byId.values()].sort((a, b) => a.id - b.id);
};

const appendEntry = (entries: PiEntry[], entry: PiEntry): PiEntry[] => {
  const last = entries[entries.length - 1];
  if (!last || last.id < entry.id) return [...entries, entry];
  return mergePiEntries(entries, [entry]);
};

const applyChange = (message: PiAssistantMessage, change: PiMessageChange): PiAssistantMessage => {
  if (change.type === "message") return change.message;
  const content = [...message.content];
  const at = change.contentIndex;
  switch (change.type) {
    case "text_start":
    case "thinking_start":
    case "toolcall_start":
    case "block":
      content[at] = change.block;
      break;
    case "text_delta": {
      const block = content[at];
      content[at] = { type: "text", text: (block?.type === "text" ? block.text : "") + change.delta };
      break;
    }
    case "thinking_delta": {
      const block = content[at];
      content[at] = { type: "thinking", thinking: (block?.type === "thinking" ? block.thinking : "") + change.delta };
      break;
    }
    case "toolcall_delta":
      return message;
  }
  return { ...message, content };
};

const toolOutput = (
  previous: string | undefined,
  output: Extract<PiChatEvent, { type: "tool_execution_update" }>["output"],
): string | undefined => {
  if (!output) return previous;
  if ("set" in output) return output.set;
  const kept = (previous ?? "").slice(output.trimStart ?? 0);
  return kept + (output.append ?? "");
};

const reduceOne = (state: PiChatState, event: PiChatEvent): PiChatState => {
  switch (event.type) {
    case "snapshot": {
      const tools: PiChatState["tools"] = {};
      for (const slot of event.tools) {
        tools[slot.callId] = { name: slot.name, status: slot.status, ...(slot.output ? { output: slot.output } : {}) };
      }
      const idle = event.run === undefined;
      return {
        ...state,
        entries: mergePiEntries(state.entries, event.entries),
        running: !idle,
        ...(idle && event.inbox.length === 0 ? { queued: [] } : {}),
        ...(idle ? { compacting: false, engineStatus: undefined } : {}),
        ...(event.generation?.message ? { streaming: event.generation.message } : { streaming: undefined }),
        ...(event.generation?.retry ? { retry: event.generation.retry } : { retry: undefined }),
        tools,
      };
    }
    case "run_start":
      return { ...state, running: true, failure: undefined, tools: {} };
    case "run_end":
      return { ...state, running: false, streaming: undefined, retry: undefined, compacting: false, engineStatus: undefined };
    case "message_start":
      return event.message.role === "assistant" ? { ...state, streaming: event.message } : state;
    case "message_update": {
      if (!state.streaming) return state;
      let streaming = state.streaming;
      for (const change of event.changes) streaming = applyChange(streaming, change);
      return { ...state, streaming };
    }
    case "message_end":
      return {
        ...state,
        entries: appendEntry(state.entries, event.entry),
        ...(event.entry.kind === "pi.assistant" ? { streaming: undefined, retry: undefined } : {}),
      };
    case "entry_appended":
      return { ...state, entries: appendEntry(state.entries, event.entry) };
    case "tool_execution_start":
      return { ...state, tools: { ...state.tools, [event.toolCallId]: { name: event.toolName, status: "running" } } };
    case "tool_execution_update": {
      const slot = state.tools[event.toolCallId];
      const output = toolOutput(slot?.output, event.output);
      return {
        ...state,
        tools: {
          ...state.tools,
          [event.toolCallId]: { name: event.toolName, status: slot?.status ?? "running", ...(output ? { output } : {}) },
        },
      };
    }
    case "tool_execution_end":
      return {
        ...state,
        entries: event.entry ? appendEntry(state.entries, event.entry) : state.entries,
        tools: { ...state.tools, [event.toolCallId]: { name: event.toolName, status: "done" } },
      };
    case "submission": {
      const { record } = event;
      if (record.type !== "input" || !record.requestId) return state;
      const requestId = record.requestId;
      const queued = record.status === "queued"
        ? state.queued.includes(requestId) ? state.queued : [...state.queued, requestId]
        : state.queued.filter((id) => id !== requestId);
      const requestIds = record.entry !== undefined && state.requestIds[record.entry] !== requestId
        ? { ...state.requestIds, [record.entry]: requestId }
        : state.requestIds;
      return { ...state, queued, requestIds };
    }
    case "remote_turns":
      return { ...state, remote: event.turns };
    case "auto_retry_start":
      return { ...state, retry: { at: event.at, error: event.errorMessage } };
    case "auto_retry_end":
      return { ...state, retry: undefined };
    case "task_failed":
    case "send_failed":
      return { ...state, failure: event.message };
    case "compaction_start":
      return event.blocking ? { ...state, compacting: true } : state;
    case "compaction_end":
      return { ...state, compacting: false };
    case "engine_status":
      if (event.state === "compacting") return { ...state, compacting: true, engineStatus: event.text };
      if (event.state === "running") {
        return { ...state, compacting: false, engineStatus: event.text === ENGINE_WORKING_TEXT ? undefined : event.text };
      }
      return state;
    default:
      return state;
  }
};

export const reducePiChat = (state: PiChatState, events: readonly PiChatEvent[]): PiChatState => {
  let next = state;
  for (const event of events) next = reduceOne(next, event);
  return next;
};

export const piMessageText = (message: PiMessage | undefined): string => {
  if (!message || message.role === "system") return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
};

export const piTerminalNotice = (message: {
  stopReason?: string;
  errorMessage?: string;
}): { phase: "failed" | "canceled"; notice: string } | undefined =>
  message.stopReason === "error"
    ? {
        phase: "failed",
        notice:
          stellaUsageLimitText(message.errorMessage) ??
          `Stella couldn't answer: ${message.errorMessage?.replace(ENGINE_ERROR_MARK, "").trim() || "the model request failed."}`,
      }
    : message.stopReason === "aborted"
      ? { phase: "canceled", notice: "Stopped." }
      : undefined;

const ENGINE_ERROR_MARK = /^\s*\[[a-z-]+\/[a-z-]+\]\s*/;
const ENGINE_WORKING_TEXT = "Working";

export const PI_REPORT_RE = /^\[(Agent completed|Task failed|Task canceled|Subagent paused)\]/;
const LEADING_SYSTEM_REMINDER_RE = /^<system-reminder>[\s\S]*?<\/system-reminder>\s*/;

const AGENT_NOTE_RE = /^<agent-message from="[^"\n]*" thread_id="[^"\n]*"(?: relation="[^"\n]*")?>\n[\s\S]*\n<\/agent-message>$/;

export const PI_LATE_ANSWER_PREFIX = "[Late answer]";

export const isPiAgentText = (text: string): boolean => {
  const body = text.trimStart().replace(LEADING_SYSTEM_REMINDER_RE, "");
  return (
    PI_REPORT_RE.test(body) ||
    body.startsWith(PI_LATE_ANSWER_PREFIX) ||
    AGENT_NOTE_RE.test(text.trim())
  );
};

export const isPiAgentInput = (message: PiUserMessage): boolean =>
  typeof message.content === "string"
    ? isPiAgentText(message.content)
    : message.content.some((part) => part.type === "text" && isPiAgentText(part.text));

export const isPiScheduledInput = (message: PiUserMessage): boolean =>
  message.source === "schedule" ||
  (typeof message.content !== "string" &&
    message.content.some((part) => (part.type === "text" || part.type === "image") && part.stella?.source === "schedule"));

export const piUserHidden = (message: PiUserMessage): boolean => {
  const { text, display } = piUserView(message);
  return (
    isPiScheduledInput(message) ||
    isPiAgentText(piMessageText(message)) ||
    isPiAgentText(text) ||
    (!text.trim() && !display)
  );
};

export const piAgentReport = (message: PiUserMessage): AgentReportEnvelope | null => {
  if (typeof message.content === "string") return null;
  for (const part of message.content) {
    if (part.type !== "text") continue;
    const envelope = parseAgentReportEnvelope(part.stella?.agentReport);
    if (envelope) return envelope;
  }
  return null;
};

export const piJournalUserMessage = (
  message: PiUserMessage,
): { message: Record<string, unknown>; hidden: boolean; clientMsgId?: string } => {
  const { text, display } = piUserView(message);
  const clientMsgId =
    typeof message.content === "string"
      ? undefined
      : message.content.flatMap((part) =>
          (part.type === "text" || part.type === "image") && part.stella?.clientMsgId ? [part.stella.clientMsgId] : [],
        )[0];
  const hidden = piUserHidden(message);
  const agentReport = hidden ? piAgentReport(message) : null;
  const images: PiContentBlock[] = [];
  const files: Array<Record<string, unknown>> = [];
  const drivePaths: string[] = [];
  for (const attachment of display?.attachments ?? []) {
    const drivePath = attachment.drivePath ?? drivePathFromSignedDriveUrl(attachment.url);
    if (drivePath) {
      if (!drivePaths.includes(drivePath)) drivePaths.push(drivePath);
      continue;
    }
    const match = attachment.kind === "image" ? /^data:([^;,]+);base64,(.+)$/s.exec(attachment.url ?? "") : null;
    if (match) images.push({ type: "image", mimeType: match[1]!, data: match[2]! });
    else if (attachment.kind === "file") files.push({ ...attachment, kind: "file" });
  }
  const providerAttachments = [
    ...new Set([...piProviderAttachmentPaths(message), ...drivePaths]),
  ];
  return {
    hidden,
    ...(clientMsgId ? { clientMsgId } : {}),
    message: {
      role: "user",
      content: [{ type: "text", text: hidden ? piMessageText(message) : text }, ...images],
      timestamp: message.timestamp,
      ...(message.source
        ? { source: message.source }
        : isPiScheduledInput(message)
          ? { source: "schedule" }
          : {}),
      ...(message.voiceSession ? { voiceSession: message.voiceSession } : {}),
      ...(files.length > 0 ? { attachments: files } : {}),
      ...(providerAttachments.length > 0 ? { providerContext: { attachments: providerAttachments } } : {}),
      ...(display?.context ? { metadata: { context: display.context } } : {}),
      ...(agentReport ? { agentReport } : {}),
    },
  };
};

export const piProviderAttachmentPaths = (message: PiUserMessage): string[] => {
  const raw = (message as { providerContext?: { attachments?: unknown } }).providerContext?.attachments;
  return Array.isArray(raw)
    ? raw.filter((path): path is string => typeof path === "string" && path.length > 0 && path.length <= 400)
    : [];
};

export const piUserView = (message: PiUserMessage): { text: string; display?: PiUserDisplay } => {
  if (typeof message.content === "string") return { text: message.content };
  let display: PiUserDisplay | undefined;
  const text: string[] = [];
  for (const part of message.content) {
    if ((part.type === "text" || part.type === "image") && part.stella?.display) display ??= part.stella.display;
    if (part.type === "text" && !part.stella?.hidden) text.push(part.text);
  }
  return { text: text.join("\n"), ...(display ? { display } : {}) };
};

const isHostOnly = (entry: PiEntry | undefined): boolean => entry?.kind === "pi.system";

const unsigned = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value, (key, field) => (key === "thinkingSignature" || key === "textSignature" ? undefined : field))) as T;

export const piEventsForClients = (events: readonly PiChatEvent[]): PiChatEvent[] => {
  const out: PiChatEvent[] = [];
  for (const event of events) {
    switch (event.type) {
      case "snapshot":
        out.push(unsigned({ ...event, entries: event.entries.filter((entry) => !isHostOnly(entry)) }));
        break;
      case "message_end":
      case "entry_appended":
        if (!isHostOnly(event.entry)) out.push(unsigned(event));
        break;
      case "message_start":
      case "message_update":
      case "tool_execution_end":
        out.push(unsigned(event));
        break;
      default:
        out.push(event);
    }
  }
  return out;
};

export const piEntriesForClients = (
  entries: readonly PiEntry[],
  maxBytes: number,
): { entries: PiEntry[]; trimmed: boolean } => {
  const kept: PiEntry[] = [];
  let bytes = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (isHostOnly(entry)) continue;
    const clean = unsigned(entry);
    bytes += JSON.stringify(clean).length;
    if (bytes > maxBytes && kept.length > 0) return { entries: kept.reverse(), trimmed: true };
    kept.push(clean);
  }
  return { entries: kept.reverse(), trimmed: false };
};
