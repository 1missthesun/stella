import type { Context } from "@earendil-works/chord/context";
import type { Op } from "@earendil-works/chord/delta";
import type { WatchEnd } from "@earendil-works/chord/watch";
import type {
  CommitObservation,
  Conversation,
  ConversationView,
  ConversationWindow,
  EntryRecord,
  Harness,
  InboxState,
  LiveState,
  RunFailure,
  SubmissionRecord,
  ToolSlot,
} from "@earendil-works/pi-durable";
import type {
  PiAssistantMessage,
  PiChatEvent,
  PiContentBlock,
  PiEntry,
  PiMessageChange,
  PiSubmission,
  PiToolSlot,
} from "@stella/contracts/pi-chat";

/**
 * Stella's chat clients (the desktop window, cloud chats seen from any app
 * version) speak `PiChatEvent`: a snapshot, then one batch of events per
 * change. pi-durable stopped producing events in 1.5 and publishes the
 * conversation's state instead: a view (an entry window and the `pi.live`,
 * `pi.inbox` documents) whose watch carries the ops between values. This keeps
 * Stella's wire protocol stable across versions by deriving the same events
 * from that state: what changed between the previous view and the new one,
 * with the ops supplying the streamed deltas (text and argument appends, tool
 * output trims and appends). Submissions are table records, not view state, so
 * they come from the Session's stored commits.
 */

export type PiChatSnapshot = Extract<PiChatEvent, { type: "snapshot" }>;

export interface ConversationEvents {
  /** The snapshot at attachment. */
  readonly snapshot: PiChatSnapshot;
  /** The newest view delivered, for readers of state (the transcript window, `pi.live`). */
  readonly view: ConversationView;
  start(listener: (events: PiChatEvent[], view: ConversationView, context: Context) => Promise<void>): void;
  stop(): Promise<WatchEnd>;
  readonly closed: Promise<WatchEnd>;
}

type Parts = { live: LiveState; inbox: InboxState | undefined };

const parts = (view: ConversationView): Parts => ({
  live: (view.docs["pi.live"] ?? {}) as unknown as LiveState,
  inbox: view.docs["pi.inbox"] as unknown as InboxState | undefined,
});

const asEntry = (entry: EntryRecord): PiEntry => entry as unknown as PiEntry;

/** Started and not ended: running, or parked (sleeping or waiting) until it is woken to run again. */
const inProgress = (status: ToolSlot["status"] | undefined): boolean =>
  status === "running" || status === "sleeping" || status === "waiting";

const toolSlots = (live: LiveState): PiToolSlot[] =>
  (live.tools ?? []).map((slot) => ({
    callId: slot.callId,
    name: slot.name,
    status: slot.status,
    ...(slot.output === undefined ? {} : { output: slot.output }),
    ...(slot.entry === undefined ? {} : { entry: slot.entry }),
  }));

export const snapshotOf = (view: ConversationView): PiChatSnapshot => {
  const { live, inbox } = parts(view);
  const generation = live.generation;
  return {
    type: "snapshot",
    entries: view.entries.map(asEntry),
    ...(live.run === undefined ? {} : { run: { inputs: [...live.run.inputs] } }),
    ...(generation === undefined
      ? {}
      : {
          generation: {
            attempt: generation.attempt,
            ...(generation.message === undefined ? {} : { message: generation.message as unknown as PiAssistantMessage }),
            ...(generation.retry === undefined ? {} : { retry: generation.retry }),
          },
        }),
    tools: toolSlots(live),
    inbox: (inbox?.items ?? []).map((item) => ({ id: item.id, mode: item.mode })),
  };
};

const newestId = (view: ConversationView): number => view.entries.at(-1)?.id ?? view.before ?? 0;

/**
 * Text a client shows when a run ended without an answer and the transcript
 * says nothing about it. A model error already left its error reply, and an
 * abort, a reset or an empty continue are not failures the user should see.
 */
export const runFailureText = (failure: Pick<RunFailure, "reason" | "detail">): string | undefined => {
  const detail = failure.detail?.trim();
  switch (failure.reason) {
    case "no_model":
      return detail ? `No model was available to answer (${detail}).` : "No model was available to answer.";
    case "faulted":
      return detail ? `The reply stopped on an internal error: ${detail}` : "The reply stopped on an internal error.";
    case "orphaned":
      return detail ? `The reply couldn't continue (${detail}).` : "The reply couldn't continue.";
    case "interrupted":
      return "Stella was stopped while the model was answering, more often than it retries, so this reply was given up.";
    case "restart_limit":
      return "This reply kept being cut off by restarts, so Stella stopped it rather than try again.";
    case "turn_limit":
      return detail ? `The reply reached its limit of tool rounds (${detail}).` : "The reply reached its limit of tool rounds.";
    case "model_error":
    case "aborted":
    case "reset":
    case "nothing_to_answer":
      return undefined;
  }
};

const PARTIAL_PATH = ["docs", "pi.live", "generation", "message"] as const;

const startsWith = (path: readonly (string | number)[], prefix: readonly (string | number)[]): boolean =>
  path.length >= prefix.length && prefix.every((part, index) => path[index] === part);

const opPath = (op: Op): readonly (string | number)[] => (op[0] === "r" ? [] : (op[1] as readonly (string | number)[]));

/** The ops on the in-flight message as message changes; a change the ops can't express sends the whole message. */
export const messageChanges = (ops: readonly Op[], message: PiAssistantMessage): PiMessageChange[] => {
  const whole: PiMessageChange[] = [{ type: "message", message }];
  const changes: PiMessageChange[] = [];
  const replaced = new Set<number>();
  for (const op of ops) {
    const path = opPath(op);
    if (!startsWith(path, PARTIAL_PATH)) {
      // An op on an ancestor (the generation or the whole view) replaced the message.
      if (startsWith(PARTIAL_PATH, path)) return whole;
      continue;
    }
    const rest = path.slice(PARTIAL_PATH.length);
    if (rest[0] === "usage") continue;
    if (rest[0] !== "content") return whole;
    if (rest.length === 1) {
      if (op[0] !== "p" || op[3] !== 0) return whole;
      for (const [offset, block] of (op[4] as unknown as PiContentBlock[]).entries()) {
        const type = block.type === "text" ? "text_start" : block.type === "thinking" ? "thinking_start" : "toolcall_start";
        changes.push({ type, contentIndex: op[2] + offset, block } as PiMessageChange);
      }
      continue;
    }
    const contentIndex = rest[1] as number;
    if (replaced.has(contentIndex)) continue;
    const field = rest[2];
    if (op[0] === "a" && rest.length === 3 && (field === "text" || field === "thinking")) {
      changes.push({ type: field === "text" ? "text_delta" : "thinking_delta", contentIndex, delta: op[2] });
    } else if (op[0] === "a" && field === "arguments") {
      changes.push({ type: "toolcall_delta", contentIndex, path: rest.slice(3) as (string | number)[], delta: op[2] });
    } else {
      const block = message.content[contentIndex];
      if (block === undefined) return whole;
      replaced.add(contentIndex);
      changes.push({ type: "block", contentIndex, block });
    }
  }
  return changes;
};

/** A running tool's output change: a front trim then an append when the new text continues the old, else the text. */
export const outputChange = (
  before: string | undefined,
  after: string | undefined,
): { trimStart?: number; append?: string } | { set: string } | undefined => {
  const previous = before ?? "";
  const next = after ?? "";
  if (previous === next) return undefined;
  if (next.startsWith(previous)) return { append: next.slice(previous.length) };
  // The retained window dropped its front: find where the old text still lines up.
  for (let trim = 1; trim <= previous.length; trim += 1) {
    if (next.startsWith(previous.slice(trim))) {
      const append = next.slice(previous.length - trim);
      return append ? { trimStart: trim, append } : { trimStart: trim };
    }
  }
  return { set: next };
};

/** A tool call's arguments, from the answer that made it. */
export const toolCallArguments = (entries: readonly EntryRecord[], callId: string): Record<string, unknown> => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index]!.model?.[0] as { role?: string; content?: unknown } | undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content as Array<{ type?: string; id?: string; arguments?: unknown }>) {
      if (block.type === "toolCall" && block.id === callId) {
        return (block.arguments ?? {}) as Record<string, unknown>;
      }
    }
  }
  return {};
};

/** The result entry of one tool call among `entries`. */
export const resultEntryFor = (entries: readonly EntryRecord[], callId: string): EntryRecord | undefined =>
  entries.find((entry) => {
    const message = entry.model?.[0] as { role?: string; toolCallId?: string } | undefined;
    return message?.role === "toolResult" && message.toolCallId === callId;
  });

/** Every client event one view change causes, in the order the clients expect them. */
export const eventsBetween = (before: ConversationView, after: ConversationView, ops: readonly Op[]): PiChatEvent[] => {
  if (ops.some((op) => op[0] === "r")) return [snapshotOf(after)];
  const was = parts(before);
  const now = parts(after);
  const events: PiChatEvent[] = [];
  const newestBefore = newestId(before);
  const added = after.entries.filter((entry) => entry.id > newestBefore);

  // Progress: tool starts, the in-flight message, tool output, retry backoff.
  const slotsBefore = new Map<string, ToolSlot>((was.live.tools ?? []).map((slot) => [slot.callId, slot]));
  const slots = now.live.tools ?? [];
  for (const slot of slots) {
    if (!inProgress(slot.status) || inProgress(slotsBefore.get(slot.callId)?.status)) continue;
    events.push({
      type: "tool_execution_start",
      toolCallId: slot.callId,
      toolName: slot.name,
      args: toolCallArguments(after.entries, slot.callId),
    });
  }
  const partialBefore = was.live.generation?.message as unknown as PiAssistantMessage | undefined;
  const partial = now.live.generation?.message as unknown as PiAssistantMessage | undefined;
  if (partial !== undefined && partialBefore === undefined) events.push({ type: "message_start", message: partial });
  else if (partial !== undefined && partial !== partialBefore) {
    const changes = messageChanges(ops, partial);
    if (changes.length > 0) events.push({ type: "message_update", changes });
  }
  for (const slot of slots) {
    const previous = slotsBefore.get(slot.callId);
    if (slot.status !== "running" || !previous || !inProgress(previous.status)) continue;
    const output = outputChange(previous.output, slot.output);
    if (output !== undefined) {
      events.push({ type: "tool_execution_update", toolCallId: slot.callId, toolName: slot.name, output });
    }
  }
  const retry = now.live.generation?.retry;
  const retryBefore = was.live.generation?.retry;
  if (retry !== undefined && (retryBefore === undefined || retryBefore.at !== retry.at)) {
    events.push({
      type: "auto_retry_start",
      attempt: now.live.generation!.attempt,
      at: retry.at,
      errorMessage: retry.error,
    });
  }
  if (retryBefore !== undefined && retry === undefined) {
    events.push({ type: "auto_retry_end", attempt: was.live.generation!.attempt });
  }

  // Tools that ended: a slot that turned done, one created done (a call not offered), or an unfinished one gone with
  // its round. A done slot that vanished ended earlier.
  const toolEnds: Array<{ event: Extract<PiChatEvent, { type: "tool_execution_end" }>; entryId?: number }> = [];
  const endTool = (callId: string, name: string, entryId: number | undefined) => {
    const entry = entryId === undefined ? undefined : after.entries.find((candidate) => candidate.id === entryId);
    toolEnds.push({
      event: { type: "tool_execution_end", toolCallId: callId, toolName: name, ...(entry ? { entry: asEntry(entry) } : {}) },
      ...(entry ? { entryId: entry.id } : {}),
    });
  };
  for (const previous of slotsBefore.values()) {
    if (previous.status === "done") continue;
    const slot = slots.find((candidate) => candidate.callId === previous.callId);
    if (slot?.status === "done") endTool(previous.callId, previous.name, slot.entry);
    else if (slot === undefined) endTool(previous.callId, previous.name, resultEntryFor(added, previous.callId)?.id);
  }
  for (const slot of slots) {
    if (slot.status === "done" && !slotsBefore.has(slot.callId)) endTool(slot.callId, slot.name, slot.entry);
  }

  // Entries in append order; a tool's end directly precedes its result's message.
  let assistantAppended = false;
  for (const entry of added) {
    for (const end of toolEnds) if (end.entryId === entry.id) events.push(end.event);
    const message = entry.model?.[0] as { role?: string } | undefined;
    if (message === undefined) {
      events.push({ type: "entry_appended", entry: asEntry(entry) });
      continue;
    }
    // A streamed answer already started with its first partial.
    const streamed = message.role === "assistant" && partialBefore !== undefined && !assistantAppended;
    if (message.role === "assistant") assistantAppended = true;
    if (!streamed) events.push({ type: "message_start", message: entry.model![0] as unknown as PiAssistantMessage });
    events.push({ type: "message_end", entry: asEntry(entry) });
  }
  // Ends without a result entry in this change: a faulted or orphaned tool, or one whose round ended.
  for (const end of toolEnds) {
    if (end.entryId === undefined || !added.some((entry) => entry.id === end.entryId)) events.push(end.event);
  }

  // Compactions, why a run failed, then run ends and starts.
  const compactionsBefore = was.live.compactions ?? [];
  const compactions = now.live.compactions ?? [];
  for (const status of compactionsBefore) {
    if (!compactions.some((current) => current.taskId === status.taskId)) {
      events.push({ type: "compaction_end", reason: status.trigger });
    }
  }
  const failure = now.live.runFailure;
  if (failure !== undefined && failure !== was.live.runFailure && failure.taskId !== was.live.runFailure?.taskId) {
    const message = runFailureText(failure);
    if (message !== undefined) events.push({ type: "task_failed", taskId: failure.taskId, kind: failure.reason, message });
  }
  const run = now.live.run;
  const runBefore = was.live.run;
  const runChanged = run?.inputs[0] !== runBefore?.inputs[0] || (run === undefined) !== (runBefore === undefined);
  if (runBefore !== undefined && runChanged) events.push({ type: "run_end", inputs: [...runBefore.inputs] });
  for (const status of compactions) {
    if (!compactionsBefore.some((previous) => previous.taskId === status.taskId)) {
      events.push({ type: "compaction_start", reason: status.trigger, blocking: status.blocking });
    }
  }
  if (run !== undefined && runChanged) events.push({ type: "run_start", inputs: [...run.inputs] });
  return events;
};

const asSubmission = (record: SubmissionRecord): PiSubmission => record as unknown as PiSubmission;

/**
 * Attach to one conversation for Stella's clients: the snapshot now, then the
 * events of each later change. The context governs the attachment's lifetime,
 * as it does for the underlying watch.
 */
export async function watchConversationEvents(
  harness: Harness,
  conversation: Conversation,
  context: Context,
  window?: ConversationWindow,
): Promise<ConversationEvents> {
  // Submission records are table rows: forward the stored ones of this conversation in commit order.
  const submissions: SubmissionRecord[] = [];
  let wake: (() => void) | undefined;
  const commits: CommitObservation = harness.observeCommits({
    advance: (publication) => {
      for (const change of publication.changes) {
        if (change.type === "submission" && change.value.conversationId === conversation.id) {
          submissions.push(change.value);
        }
      }
      if (submissions.length > 0) wake?.();
    },
    end: () => undefined,
  });
  let watch;
  try {
    watch = await conversation.watch(context, window);
  } catch (error) {
    commits.detach();
    throw error;
  }
  let current = watch.value;
  const snapshot = snapshotOf(current);
  let listener: ((events: PiChatEvent[], view: ConversationView, context: Context) => Promise<void>) | undefined;
  let draining = Promise.resolve();
  const drainSubmissions = (deliveryContext: Context) => {
    if (submissions.length === 0 || !listener) return;
    const events: PiChatEvent[] = submissions.splice(0).map((record) => ({ type: "submission", record: asSubmission(record) }));
    const deliver = listener;
    draining = draining.then(() => deliver(events, current, deliveryContext)).catch(() => undefined);
  };
  void watch.closed.finally(() => commits.detach());
  return {
    snapshot,
    get view() {
      return current;
    },
    start(next) {
      listener = next;
      wake = () => drainSubmissions(context);
      watch.start(async (call, deliveryContext) => {
        if (call.kind !== "value") return;
        const before = current;
        current = call.value;
        const events = eventsBetween(before, current, call.ops);
        const pending = submissions.splice(0).map(
          (record): PiChatEvent => ({ type: "submission", record: asSubmission(record) }),
        );
        await draining;
        if (events.length + pending.length > 0) await next([...events, ...pending], current, deliveryContext);
      });
      drainSubmissions(context);
    },
    stop: async () => {
      commits.detach();
      return await watch.stop();
    },
    closed: watch.closed,
  };
}

/**
 * Call `onChange` with the views before and after each change of one
 * conversation: for readers that act on state (new entries, a run that ended)
 * rather than render it. Returns how to stop.
 */
export async function onConversationChange(
  conversation: Conversation,
  context: Context,
  onChange: (before: ConversationView, after: ConversationView, context: Context) => Promise<void> | void,
  window?: ConversationWindow,
): Promise<{ view: ConversationView; stop(): Promise<WatchEnd>; closed: Promise<WatchEnd> }> {
  const watch = await conversation.watch(context, window);
  let current = watch.value;
  watch.start(async (call, deliveryContext) => {
    if (call.kind !== "value") return;
    const before = current;
    current = call.value;
    await onChange(before, current, deliveryContext);
  });
  return {
    get view() {
      return current;
    },
    stop: () => watch.stop(),
    closed: watch.closed,
  };
}

/** Entries a change appended (by ID, so a window that dropped its oldest still counts only new ones). */
export const appendedEntries = (before: ConversationView, after: ConversationView): EntryRecord[] => {
  const newest = newestId(before);
  return after.entries.filter((entry) => entry.id > newest);
};

/** Whether a run ended (or a different one took over) between two views. */
export const runEnded = (before: ConversationView, after: ConversationView): boolean => {
  const was = parts(before).live.run;
  const now = parts(after).live.run;
  return was !== undefined && (now === undefined || now.taskId !== was.taskId || now.inputs[0] !== was.inputs[0]);
};

/** Whether a tool call of the current round finished between two views. */
export const toolFinished = (before: ConversationView, after: ConversationView): boolean => {
  const slotsBefore = new Map((parts(before).live.tools ?? []).map((slot) => [slot.callId, slot.status]));
  const slots = parts(after).live.tools ?? [];
  for (const slot of slots) if (slot.status === "done" && slotsBefore.get(slot.callId) !== "done") return true;
  for (const [callId, status] of slotsBefore) if (status !== "done" && !slots.some((slot) => slot.callId === callId)) return true;
  return false;
};
