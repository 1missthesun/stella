import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { AssistantMessage, Message, Models, TextContent } from "@earendil-works/pi-ai";
import { calculateContextTokens, estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  AgentDoc,
  CompactionEntry,
  defineExtension,
  GenerationTask,
  hook,
  LiveDoc,
  ProviderDoc,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type Harness,
  type HarnessSettings,
  type HookApi,
} from "@earendil-works/pi-durable";
import {
  CONTEXT_HANDOFF_NOTES_MAX_CHARS,
  CONTEXT_SIZE_DIAGNOSTIC,
  contextHandoffNotesRequest,
  contextHandoffText,
  contextHandoffThreshold,
  isContextHandoffNotesRequest,
  type ContextHandoffRunning,
} from "@stella/contracts/context-handoff";
import { StellaAgentDoc } from "./agent-doc.ts";
import { runningHelpers } from "./agents.ts";
import { isPiCompactionBoundary } from "./handover.ts";

/**
 * Self-written context handoffs, in the background.
 *
 * When a conversation's context crosses the handoff threshold, the request goes out as usual and a background job asks
 * the same model, on the same (cached) prefix, for handoff notes covering everything before the request's latest
 * assistant step. The conversation carries on meanwhile. When the notes are ready, a `pi.compaction` boundary whose
 * head is that step is written through a write submission: placed at once when idle, otherwise at the run's next
 * boundary. The new context is the notes followed, word for word, by that step and everything after it, so messages
 * sent while the notes were written stay. Engine compaction stays as the last-resort ceiling.
 */
export const STELLA_HANDOFF_EXTENSION = "stella-handoff";

const CLI_WINDOW_FLOOR = 10_000_000;
const ENTRY_SCAN_PAGE = 200;
const TURN_SCAN_LIMIT = 2_000;
/** The part a handoff would replace must be at least this share of the threshold, so a fresh context isn't handed on. */
const MIN_PREFIX_FRACTION = 0.25;
const MIN_NOTES_CHARS = 40;
const RETRY_AFTER_FAILURE_MS = 2 * 60_000;
const NOTES_TIMEOUT_MS = 15 * 60_000;

export type StellaHandoffHost = {
  runningCommands?(threadId: string): Promise<{ id: string; command: string }[]>;
  atTokens?: number;
  report?(error: unknown): void;
};

export const contextSizeOf = (message: AssistantMessage): { tokens: number; window?: number } | undefined => {
  const details = message.diagnostics?.findLast((diagnostic) => diagnostic.type === CONTEXT_SIZE_DIAGNOSTIC)?.details;
  const tokens = details?.tokens;
  if (typeof tokens !== "number" || !(tokens > 0)) return undefined;
  // Measured on a CLI session still holding context a newer boundary replaced: it says nothing about this one.
  if (details?.stale === true) return undefined;
  const window = details?.window;
  return { tokens, ...(typeof window === "number" && window > 0 ? { window } : {}) };
};

const textOf = (message: Message | undefined): string => {
  if (!message || message.role === "assistant") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : "")).join("");
};

const replyText = (message: AssistantMessage): string =>
  message.content.map((part) => (part.type === "text" ? part.text : "")).join("");

const lastBoundaryAt = (messages: readonly Message[]): number => messages.findLastIndex((message) => isPiCompactionBoundary(message));

/**
 * The context's size: the newest measured answer plus estimates for what follows it. An answer from before the latest
 * boundary's placement (kept word for word by a background handoff) was measured on the old, larger context, so only
 * answers newer than the boundary count.
 */
const measure = (messages: readonly Message[], cli: boolean): { tokens: number; window?: number } => {
  const boundary = lastBoundaryAt(messages);
  const placedAt = boundary < 0 ? undefined : messages[boundary]!.timestamp;
  let at = -1;
  let measured: { tokens: number; window?: number } | undefined;
  for (let index = messages.length - 1; index >= 0 && measured === undefined; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    if (placedAt !== undefined && message.timestamp <= placedAt) break;
    measured = contextSizeOf(message) ?? (cli || !(calculateContextTokens(message.usage) > 0) ? undefined : { tokens: calculateContextTokens(message.usage) });
    if (measured) at = index;
  }
  let tokens = measured?.tokens ?? 0;
  for (const message of messages.slice(at + 1)) tokens += estimateMessageTokens(message);
  return { tokens, ...(measured?.window !== undefined ? { window: measured.window } : {}) };
};

const entryText = (entry: EntryRecord): string => textOf(entry.model?.[0]);

type Pending = {
  conversationId: ConversationId;
  /** The request's latest assistant step: the first message the fresh context keeps. */
  cutoff: AssistantMessage;
  prefix: readonly Message[];
  tokens: number;
  threshold: number;
  agent: boolean;
  threadId?: string;
  runFirst?: EntryId;
  models: Models;
};

export type StellaHandoff = {
  extension: ReturnType<typeof defineExtension>;
  bind(harness: Harness, settings: Pick<HarnessSettings, "stream">): void;
};

export const stellaHandoffExtension = (host: StellaHandoffHost): StellaHandoff => {
  const report = host.report ?? ((error: unknown) => console.error("[stella-handoff]", error));
  let bound: { harness: Harness; settings: Pick<HarnessSettings, "stream"> } | undefined;
  const running = new Map<ConversationId, Promise<void>>();
  const failedAt = new Map<ConversationId, number>();

  const sizing = async (api: Pick<HookApi, "snapshot" | "models" | "conversationId">, messages: readonly Message[], context: Context) => {
    const ref = (await api.snapshot(AgentDoc, api.conversationId, context))?.model;
    const model = ref ? api.models.getModel(ref.provider, ref.modelId) : undefined;
    const modelWindow = model?.contextWindow;
    const cli = !(typeof modelWindow === "number" && modelWindow > 0 && modelWindow < CLI_WINDOW_FLOOR);
    const measured = measure(messages, cli);
    const window = measured.window ?? (cli ? 0 : (modelWindow ?? 0));
    const threshold = contextHandoffThreshold(window, host.atTokens);
    return threshold === undefined ? undefined : { tokens: measured.tokens, threshold };
  };

  const userTexts = async (
    harness: Harness,
    conversationId: ConversationId,
    from: EntryId | undefined,
    before: EntryId,
    context: Context,
  ): Promise<{ task?: string; turn: string[] }> =>
    await harness.commit(async (tx) => {
      const first = await tx.scanEntries({ conversationId, order: "ascending" }, ENTRY_SCAN_PAGE);
      const brief = first.items.find((entry) => entry.kind === "pi.user");
      const turn: string[] = [];
      if (from !== undefined && from < before) {
        let cursor: Parameters<typeof tx.scanEntries>[2];
        let seen = 0;
        scan: do {
          const page = await tx.scanEntries({ conversationId, order: "ascending", minEntryId: from }, ENTRY_SCAN_PAGE, cursor);
          for (const entry of page.items) {
            if (entry.id >= before) break scan;
            if (entry.kind === "pi.user") turn.push(entryText(entry));
          }
          seen += page.items.length;
          cursor = page.next;
        } while (cursor !== undefined && seen < TURN_SCAN_LIMIT);
      }
      return { ...(brief ? { task: entryText(brief) } : {}), turn };
    }, context);

  /** The entry holding `message` in the committed context, found by its role and timestamp. */
  const entryOf = async (harness: Harness, conversationId: ConversationId, message: AssistantMessage, context: Context) => {
    const conversation = await harness.conversation(conversationId, context);
    if (!conversation) return undefined;
    const view = await conversation.context(context);
    for (let index = view.entries.length - 1; index >= 0; index -= 1) {
      const contributed = view.contributions[index] ?? [];
      if (contributed.some((candidate) => candidate.role === "assistant" && candidate.timestamp === message.timestamp)) {
        const entry = view.entries[index]!;
        return entry.id === view.head?.id ? undefined : { conversation, entry };
      }
    }
    return undefined;
  };

  const writeNotes = async (pending: Pending, context: Context): Promise<string> => {
    const { harness, settings } = bound!;
    const agent = await (await harness.conversation(pending.conversationId, context))?.agent(context);
    const ref = agent?.model;
    const model = ref ? pending.models.getModel(ref.provider, ref.modelId) : undefined;
    if (!ref || !model) throw new Error("The conversation has no model to write handoff notes with.");
    const sessionId = (await harness.snapshot(ProviderDoc, pending.conversationId, context))?.sessionId;
    const ask: TextContent & { stella: { hidden: true } } = {
      type: "text",
      text: contextHandoffNotesRequest({ tokens: pending.tokens, threshold: pending.threshold, agent: pending.agent }),
      stella: { hidden: true },
    };
    const messages: Message[] = [...pending.prefix, { role: "user", content: [ask], timestamp: pending.cutoff.timestamp }];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Writing handoff notes timed out.")), NOTES_TIMEOUT_MS);
    try {
      const thinking = agent.thinkingLevel;
      const reply = await pending.models.completeSimple(
        model,
        { messages },
        {
          ...settings.stream,
          signal: controller.signal,
          ...(sessionId ? { sessionId } : {}),
          ...(thinking === "off" ? {} : { reasoning: thinking }),
        },
      );
      if (reply.stopReason === "error" || reply.stopReason === "aborted") {
        throw new Error(`Writing handoff notes failed: ${reply.errorMessage ?? reply.stopReason}`);
      }
      if (reply.content.some((part) => part.type === "toolCall")) throw new Error("The handoff notes reply called a tool.");
      const notes = replyText(reply).trim();
      if (notes.length < MIN_NOTES_CHARS) throw new Error(`The handoff notes reply was too short (${notes.length} characters).`);
      return notes.length > CONTEXT_HANDOFF_NOTES_MAX_CHARS
        ? `${notes.slice(0, CONTEXT_HANDOFF_NOTES_MAX_CHARS)}\n[… ${notes.length - CONTEXT_HANDOFF_NOTES_MAX_CHARS} characters left out …]`
        : notes;
    } finally {
      clearTimeout(timer);
    }
  };

  const handOff = async (pending: Pending, context: Context): Promise<void> => {
    const { harness } = bound!;
    const found = await entryOf(harness, pending.conversationId, pending.cutoff, context);
    if (!found) throw new Error("The handoff cutoff is no longer in the conversation's context.");
    const head = found.entry.id;
    const notes = await writeNotes(pending, context);
    const texts = await userTexts(harness, pending.conversationId, pending.runFirst, head, context);
    const helpers = await runningHelpers(harness, pending.conversationId, context).catch(() => []);
    const commands =
      pending.agent && pending.threadId ? ((await host.runningCommands?.(pending.threadId).catch(() => [])) ?? []) : [];
    const work: ContextHandoffRunning[] = [
      ...helpers.map((helper) => ({ kind: "helper" as const, id: helper.threadId, description: helper.description })),
      ...commands.map((command) => ({ kind: "command" as const, id: command.id, description: command.command })),
    ];
    const text = contextHandoffText({
      notes,
      ...(pending.agent && texts.task ? { task: texts.task } : {}),
      turn: texts.turn,
      running: work,
      kept: true,
    });
    const submission = await found.conversation.submit(
      {
        type: "write",
        requestId: `stella-handoff:${head}`,
        entry: {
          kind: CompactionEntry.kind,
          head,
          model: [{ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }],
          data: { reason: "threshold" },
        },
      },
      context,
    );
    const settled = await submission.wait(context);
    if (settled.status !== "done") {
      throw new Error(`The handoff boundary was not placed (${String((settled as { reason?: unknown }).reason ?? "stale")}).`);
    }
  };

  const start = (pending: Pending) => {
    const job = handOff(pending, BACKGROUND_CONTEXT)
      .then(() => {
        failedAt.delete(pending.conversationId);
      })
      .catch((error: unknown) => {
        failedAt.set(pending.conversationId, Date.now());
        report(error);
      })
      .finally(() => {
        running.delete(pending.conversationId);
      });
    running.set(pending.conversationId, job);
  };

  const trigger = hook(GenerationTask, {
    beforeRequest: async (request, api, context) => {
      if (!bound) return undefined;
      const conversationId = api.conversationId;
      if (running.has(conversationId)) return undefined;
      const failed = failedAt.get(conversationId);
      if (failed !== undefined && Date.now() - failed < RETRY_AFTER_FAILURE_MS) return undefined;
      const messages = request.messages;
      if (isContextHandoffNotesRequest(textOf(messages.at(-1)))) return undefined;
      const sized = await sizing(api, messages, context);
      if (!sized || sized.tokens < sized.threshold) return undefined;
      const cutoffAt = messages.findLastIndex((message) => message.role === "assistant");
      const since = lastBoundaryAt(messages) + 1;
      if (cutoffAt < since) return undefined;
      const replaced = messages.slice(since, cutoffAt);
      if (!replaced.some((message) => message.role === "assistant")) return undefined;
      const replacedTokens = replaced.reduce(
        (sum, message) => sum + ((message.role as string) === "system" ? 0 : estimateMessageTokens(message)),
        0,
      );
      if (replacedTokens < sized.threshold * MIN_PREFIX_FRACTION) return undefined;
      const role = await api.snapshot(StellaAgentDoc, conversationId, context);
      const runFirst = (await api.snapshot(LiveDoc, conversationId, context))?.run?.first;
      const agent = role !== undefined && role.agentType !== "orchestrator";
      start({
        conversationId,
        cutoff: messages[cutoffAt] as AssistantMessage,
        prefix: messages.slice(0, cutoffAt),
        tokens: sized.tokens,
        threshold: sized.threshold,
        agent,
        ...(agent && role?.threadId ? { threadId: role.threadId } : {}),
        ...(runFirst !== undefined ? { runFirst } : {}),
        models: api.models,
      });
      return undefined;
    },
  });

  return {
    extension: defineExtension({
      name: STELLA_HANDOFF_EXTENSION,
      hooks: [trigger],
    }),
    bind: (harness, settings) => {
      bound = { harness, settings };
    },
  };
};
