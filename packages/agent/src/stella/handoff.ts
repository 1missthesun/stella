import type { Context } from "@earendil-works/chord/context";
import { getCurrentTools, type AssistantMessage, type Message, type TextContent } from "@earendil-works/pi-ai";
import { calculateContextTokens, estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import { obj, str } from "@earendil-works/pi-schema";
import {
  AgentDoc,
  defineDoc,
  defineExtension,
  defineTool,
  GenerationTask,
  hook,
  LiveDoc,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type HookApi,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import {
  CONTEXT_HANDOFF_DESCRIPTION,
  CONTEXT_HANDOFF_NOTES_DESCRIPTION,
  CONTEXT_HANDOFF_NOTES_MAX_CHARS,
  CONTEXT_HANDOFF_TOOL,
  CONTEXT_HANDOFFS_PER_TURN,
  CONTEXT_SIZE_DIAGNOSTIC,
  contextHandoffNudge,
  contextHandoffOffered,
  contextHandoffText,
  contextHandoffThreshold,
  isContextHandoffText,
  type ContextHandoffRunning,
} from "@stella/contracts/context-handoff";
import { StellaAgentDoc } from "./agent-doc.ts";
import { runningHelpers } from "./agents.ts";
import { boundedReplay } from "./doc-checkpoint.ts";

export const STELLA_HANDOFF_EXTENSION = "stella-handoff";

const CLI_WINDOW_FLOOR = 10_000_000;
const ENTRY_SCAN_PAGE = 200;
const TURN_SCAN_LIMIT = 2_000;

export type StellaHandoffHost = {
  runningCommands?(threadId: string): Promise<{ id: string; command: string }[]>;
  atTokens?: number;
};

type HandoffState = { first?: EntryId; count: number };

const HandoffDoc = defineDoc<HandoffState>({
  kind: "stella.handoff",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ count: 0 }),
  checkpointWhen: boundedReplay,
});

type Sized = { tokens: number; threshold: number };

export const contextSizeOf = (message: AssistantMessage): { tokens: number; window?: number } | undefined => {
  const details = message.diagnostics?.findLast((diagnostic) => diagnostic.type === CONTEXT_SIZE_DIAGNOSTIC)?.details;
  const tokens = details?.tokens;
  if (typeof tokens !== "number" || !(tokens > 0)) return undefined;
  const window = details?.window;
  return { tokens, ...(typeof window === "number" && window > 0 ? { window } : {}) };
};

const measure = (messages: readonly Message[], cli: boolean): { tokens: number; window?: number } => {
  let at = -1;
  let measured: { tokens: number; window?: number } | undefined;
  for (let index = messages.length - 1; index >= 0 && measured === undefined; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    measured = contextSizeOf(message) ?? (cli || !(calculateContextTokens(message.usage) > 0) ? undefined : { tokens: calculateContextTokens(message.usage) });
    if (measured) at = index;
  }
  let tokens = measured?.tokens ?? 0;
  for (const message of messages.slice(at + 1)) tokens += estimateMessageTokens(message);
  return { tokens, ...(measured?.window !== undefined ? { window: measured.window } : {}) };
};

const textOf = (message: Message | undefined): string => {
  if (!message || message.role === "assistant") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : "")).join("");
};

const sinceLastHandoff = (messages: readonly Message[]): readonly Message[] => {
  const at = messages.findLastIndex((message) => message.role === "user" && isContextHandoffText(textOf(message)));
  return at < 0 ? messages : messages.slice(at + 1);
};

const entryText = (entry: EntryRecord): string => textOf(entry.model?.[0]);

export const stellaHandoffExtension = (host: StellaHandoffHost) => {
  const sizes = new Map<ConversationId, Sized>();

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

  const handoffsThisTurn = async (api: Pick<HookApi, "snapshot" | "conversationId">, context: Context): Promise<number> => {
    const first = (await api.snapshot(LiveDoc, api.conversationId, context))?.run?.first;
    const state = await api.snapshot(HandoffDoc, api.conversationId, context);
    return first !== undefined && state?.first === first ? state.count : 0;
  };

  const nudgeHook = hook(GenerationTask, {
    beforeRequest: async (request, api, context) => {
      const messages = request.messages;
      if (!getCurrentTools(messages).some((tool) => tool.name === CONTEXT_HANDOFF_TOOL)) return undefined;
      const sized = await sizing(api, messages, context);
      if (!sized) return undefined;
      sizes.set(api.conversationId, sized);
      if (sized.tokens < sized.threshold) return undefined;
      if (!sinceLastHandoff(messages).some((message) => message.role === "assistant")) return undefined;
      if ((await handoffsThisTurn(api, context)) >= CONTEXT_HANDOFFS_PER_TURN) return undefined;
      const last = messages.at(-1);
      const nudge: TextContent & { stella: { hidden: true } } = {
        type: "text",
        text: contextHandoffNudge(sized),
        stella: { hidden: true },
      };
      return { messages: [...messages, { role: "user", content: [nudge], timestamp: (last?.timestamp ?? 0) + 1 }] };
    },
  });

  const userTexts = async (
    api: Pick<ToolExecutionApi, "commit" | "conversationId">,
    from: EntryId | undefined,
    context: Context,
  ): Promise<{ task?: string; turn: string[] }> =>
    await api.commit(async (tx) => {
      const first = await tx.scanEntries({ conversationId: api.conversationId, order: "ascending" }, ENTRY_SCAN_PAGE);
      const brief = first.items.find((entry) => entry.kind === "pi.user");
      const turn: string[] = [];
      if (from !== undefined) {
        let cursor: Parameters<typeof tx.scanEntries>[2];
        let seen = 0;
        do {
          const page = await tx.scanEntries({ conversationId: api.conversationId, order: "ascending", minEntryId: from }, ENTRY_SCAN_PAGE, cursor);
          for (const entry of page.items) if (entry.kind === "pi.user") turn.push(entryText(entry));
          seen += page.items.length;
          cursor = page.next;
        } while (cursor !== undefined && seen < TURN_SCAN_LIMIT);
      }
      return { ...(brief ? { task: entryText(brief) } : {}), turn };
    }, context);

  const handoff = defineTool({
    name: CONTEXT_HANDOFF_TOOL,
    description: CONTEXT_HANDOFF_DESCRIPTION,
    parameters: obj({
      notes: str({ description: CONTEXT_HANDOFF_NOTES_DESCRIPTION }),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const notes = args.notes.trim();
      if (!notes) throw new Error("Write your handoff notes in `notes`.");
      if (notes.length > CONTEXT_HANDOFF_NOTES_MAX_CHARS) {
        throw new Error(
          `Your notes are ${notes.length} characters; keep them under ${CONTEXT_HANDOFF_NOTES_MAX_CHARS}, the points the work still needs, and call ${CONTEXT_HANDOFF_TOOL} again.`,
        );
      }
      const conversationId = api.conversationId;
      const sized = sizes.get(conversationId);
      if (sized && !contextHandoffOffered(sized.tokens, sized.threshold)) {
        throw new Error(`Your context is only about ${Math.round(sized.tokens / 1000)}k tokens, so no handoff is needed yet; carry on.`);
      }
      const first = (await api.snapshot(LiveDoc, conversationId, context))?.run?.first;
      if ((await handoffsThisTurn(api, context)) >= CONTEXT_HANDOFFS_PER_TURN) {
        throw new Error(`You already handed off ${CONTEXT_HANDOFFS_PER_TURN} times in this turn; carry on without another one.`);
      }
      const role = await api.snapshot(StellaAgentDoc, conversationId, context);
      const agent = role !== undefined && role.agentType !== "orchestrator";
      const texts = await userTexts(api, first, context);
      const helpers = await runningHelpers(api, conversationId, context).catch(() => []);
      const commands =
        agent && role?.threadId ? ((await host.runningCommands?.(role.threadId).catch(() => [])) ?? []) : [];
      const running: ContextHandoffRunning[] = [
        ...helpers.map((helper) => ({ kind: "helper" as const, id: helper.threadId, description: helper.description })),
        ...commands.map((command) => ({ kind: "command" as const, id: command.id, description: command.command })),
      ];
      const text = contextHandoffText({
        notes,
        ...(agent && texts.task ? { task: texts.task } : {}),
        turn: texts.turn,
        running,
      });
      await api.commit(async (tx) => {
        const state = await tx.doc(HandoffDoc, conversationId);
        if (state.first !== first) {
          if (first === undefined) delete state.first;
          else state.first = first;
          state.count = 0;
        }
        state.count += 1;
        return undefined;
      }, context);
      sizes.delete(conversationId);
      return {
        output: [{ type: "text", text: "Handed off: your fresh context starts from these notes." }],
        control: { handoff: text },
      };
    },
  });

  return defineExtension({
    name: STELLA_HANDOFF_EXTENSION,
    hooks: [nudgeHook],
    tools: [handoff],
  });
};
