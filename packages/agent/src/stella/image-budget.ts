import type { Context } from "@earendil-works/chord";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type ImageContent,
  type Message,
  type Models,
  type TextContent,
  type ToolCall,
} from "@earendil-works/pi-ai";
import {
  defineDoc,
  GenerationTask,
  hook,
  ProviderDoc,
  type ConversationId,
  type Harness,
  type HookRegistration,
} from "@earendil-works/pi-durable";
import { DURABLE_OBJECT_READ_IMAGE_CAPS } from "@stella/runtime/kernel/shared/image-caps";
import { isImageRef } from "@stella/runtime/kernel/shared/image-ref";

/**
 * How many images one model request carries. Every image a conversation has
 * seen stays in its transcript, and every request resends them: past a
 * provider's limit (the gateway's 24 MiB body, a provider's 30 MB of downloaded
 * image URLs, Anthropic's 2000px rule above 20 images) every later turn fails
 * the same way. Older images are set aside as a text placeholder that names
 * the file, so the model can open it again.
 *
 * Changing an old message breaks the provider's prompt cache from that point,
 * so the set aside images move in batches: nothing changes until a request
 * would cross the high mark, then the oldest go at once until the rest fit the
 * low mark. The decision is replayed over the transcript in order, so a
 * conversation decides the same way on every turn, after a restart, and on any
 * computer, and placeholders render byte for byte the same each time.
 */
export const IMAGE_BUDGET = {
  highBytes: 16 * 1024 * 1024,
  lowBytes: 8 * 1024 * 1024,
  highCount: 20,
  lowCount: 10,
} as const;

/**
 * A stored image's bytes are not in the request; the cloud stores every one
 * fitted under this, base64-measured, so it is the bound to count.
 */
const STORED_IMAGE_COST = DURABLE_OBJECT_READ_IMAGE_CAPS.maxBytes;

const COMPACTION_SUMMARY_PREFIX = "The conversation history before this point was compacted into the following summary:";

/** Images before this timestamp were set aside after a provider refused a request for its images. */
export const StellaImageBudgetDoc = defineDoc<{ floorAt: number }>({
  kind: "stella.image-budget",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ floorAt: 0 }),
});

type Block = TextContent | ImageContent;

type Slot = { message: number; part: number; cost: number };

type Batch = { message: number; at: number; slots: Slot[] };

const imageCost = (image: ImageContent): number => {
  const length = image.data.length;
  return isImageRef(image.data) ? STORED_IMAGE_COST : length;
};

const blocksOf = (message: Message): readonly Block[] | undefined =>
  (message.role === "user" || message.role === "toolResult") && typeof message.content !== "string"
    ? (message.content as readonly Block[])
    : undefined;

const textOf = (message: Message): string =>
  (blocksOf(message) ?? []).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

const isSummary = (message: Message | undefined): boolean =>
  message?.role === "user" &&
  (typeof message.content === "string" ? message.content : textOf(message)).startsWith(COMPACTION_SUMMARY_PREFIX);

const batchesOf = (messages: readonly Message[]): Batch[] =>
  messages.flatMap((message, index) => {
    const blocks = blocksOf(message);
    if (!blocks) return [];
    const slots = blocks.flatMap((block, part) =>
      block.type === "image" ? [{ message: index, part, cost: imageCost(block) }] : [],
    );
    return slots.length > 0 ? [{ message: index, at: message.timestamp ?? 0, slots }] : [];
  });

const USER_IMAGE_NOTICE =
  /The user attached an image: ("(?:[^"\\]|\\.)*") \([^)]*\)\. It is already attached to this message, and the same bytes are saved locally at ("(?:[^"\\]|\\.)*")/g;

const parsed = (quoted: string): string => {
  try {
    return String(JSON.parse(quoted));
  } catch {
    return quoted.slice(1, -1);
  }
};

const SET_ASIDE = "shown earlier, set aside to keep this chat within the model's image limit.";

const pathArgument = (call: ToolCall | undefined): string | undefined => {
  const args = (call?.arguments ?? {}) as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath", "drivePath"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

const findCall = (messages: readonly Message[], before: number, id: string): ToolCall | undefined => {
  for (let index = before - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    const call = message.content.find((block): block is ToolCall => block.type === "toolCall" && block.id === id);
    if (call) return call;
  }
  return undefined;
};

/** The placeholder for the `ordinal`-th image of `messages[index]`; a function of the transcript alone. */
const placeholder = (messages: readonly Message[], index: number, ordinal: number, total: number): string => {
  const message = messages[index]!;
  if (message.role === "toolResult") {
    const path = pathArgument(findCall(messages, index, message.toolCallId));
    if (path) return `[image: ${path} — ${SET_ASIDE} Read that file to see it again.]`;
    return `[image from ${message.toolName} — ${SET_ASIDE} Run ${message.toolName} again if you need to see it.]`;
  }
  const text = textOf(message);
  const notices = [...text.matchAll(USER_IMAGE_NOTICE)];
  if (notices.length === total) {
    const [, name, path] = notices[ordinal]!;
    return `[image: ${parsed(name!)} — ${SET_ASIDE} The same bytes are saved at ${path}; Read that path to see it again.]`;
  }
  const where = text.includes("<attached-files>")
    ? "Its file is listed in this message's attached files; Read it to see it again."
    : "Ask the user to share it again if you need to see it.";
  return `[image attached by the user — ${SET_ASIDE} ${where}]`;
};

/**
 * Which images of `messages` stay: the replay of the high/low watermark over
 * every message with images, in order. Images up to `floorAt` are set aside
 * outright; a compaction summary trims what it carried forward to the low mark,
 * since its new prefix breaks the cache anyway; and the images of the message
 * being added are the last to go, only while that message alone is over the
 * high mark.
 */
const plan = (messages: readonly Message[], floorAt: number): { setAside: Set<Slot>; kept: Slot[] } => {
  const setAside = new Set<Slot>();
  const kept: Slot[] = [];
  let bytes = 0;
  const drop = (slot: Slot) => {
    setAside.add(slot);
    bytes -= slot.cost;
  };
  const trimOlder = (before: number, maxBytes: number, maxCount: number) => {
    while (kept.length > 0 && kept[0]!.message < before && (bytes > maxBytes || kept.length > maxCount)) {
      drop(kept.shift()!);
    }
  };
  const summaryAt = isSummary(messages[0]) ? messages[0]!.timestamp ?? 0 : undefined;
  let carried = summaryAt !== undefined;
  for (const batch of batchesOf(messages)) {
    if (batch.at <= floorAt) {
      for (const slot of batch.slots) setAside.add(slot);
      continue;
    }
    if (carried && batch.at > summaryAt!) {
      trimOlder(Number.POSITIVE_INFINITY, IMAGE_BUDGET.lowBytes, IMAGE_BUDGET.lowCount);
      carried = false;
    }
    kept.push(...batch.slots);
    bytes += batch.slots.reduce((sum, slot) => sum + slot.cost, 0);
    if (bytes > IMAGE_BUDGET.highBytes || kept.length > IMAGE_BUDGET.highCount) {
      trimOlder(batch.message, IMAGE_BUDGET.lowBytes, IMAGE_BUDGET.lowCount);
      while (kept.length > 1 && (bytes > IMAGE_BUDGET.highBytes || kept.length > IMAGE_BUDGET.highCount)) {
        drop(kept.shift()!);
      }
    }
  }
  if (carried) trimOlder(Number.POSITIVE_INFINITY, IMAGE_BUDGET.lowBytes, IMAGE_BUDGET.lowCount);
  return { setAside, kept };
};

export type ImageBudgetResult = { messages: readonly Message[]; kept: number; keptBytes: number; setAside: number };

/** `messages` with the images the budget sets aside replaced by their placeholders; the same array when none is. */
export const budgetImages = (messages: readonly Message[], floorAt = 0): ImageBudgetResult => {
  const { setAside, kept } = plan(messages, floorAt);
  const keptBytes = kept.reduce((sum, slot) => sum + slot.cost, 0);
  if (setAside.size === 0) return { messages, kept: kept.length, keptBytes, setAside: 0 };
  const byMessage = new Map<number, Set<number>>();
  for (const slot of setAside) {
    const parts = byMessage.get(slot.message) ?? new Set<number>();
    parts.add(slot.part);
    byMessage.set(slot.message, parts);
  }
  const next = messages.map((message, index) => {
    const parts = byMessage.get(index);
    const blocks = parts && blocksOf(message);
    if (!blocks) return message;
    const total = blocks.filter((block) => block.type === "image").length;
    let ordinal = -1;
    const content = blocks.map((block, part): Block => {
      if (block.type !== "image") return block;
      ordinal += 1;
      return parts.has(part) ? { type: "text", text: placeholder(messages, index, ordinal, total) } : block;
    });
    return { ...message, content } as Message;
  });
  return { messages: next, kept: kept.length, keptBytes, setAside: setAside.size };
};

/**
 * The floor that sets aside more of the images `messages` still carries after
 * a provider refused it for them. The newest message's images stay while
 * older ones remain; those keep at most the low mark, and at most half of what
 * was sent, so each refusal makes progress. When only the newest message has
 * images, they go too. Undefined when nothing is left to set aside.
 */
export const emergencyFloor = (messages: readonly Message[]): number | undefined => {
  const batches = batchesOf(messages);
  const costOf = (batch: Batch) => batch.slots.reduce((sum, slot) => sum + slot.cost, 0);
  const newest = batches.at(-1);
  if (newest === undefined) return undefined;
  if (batches.length === 1) return newest.at;
  const sent = batches.reduce((sum, batch) => sum + costOf(batch), 0);
  const count = batches.reduce((sum, batch) => sum + batch.slots.length, 0);
  const maxBytes = Math.min(IMAGE_BUDGET.lowBytes, Math.floor(sent / 2));
  const maxCount = Math.min(IMAGE_BUDGET.lowCount, Math.floor(count / 2));
  let bytes = costOf(newest);
  let images = newest.slots.length;
  for (let index = batches.length - 2; index > 0; index--) {
    const batch = batches[index]!;
    bytes += costOf(batch);
    images += batch.slots.length;
    if (bytes > maxBytes || images > maxCount) return batch.at;
  }
  return batches[0]!.at;
};

const IMAGE_LIMIT_ERROR =
  /\b413\b|request_too_large|body_too_large|request (?:body )?(?:is )?too large|payload too large|image[^.]*(?:exceed|too (?:large|big|many)|maximum|limit|at most)|(?:exceed|too many|maximum|limit)[^.]*image/i;

export const isImageLimitError = (message: AssistantMessage): boolean =>
  message.stopReason === "error" && IMAGE_LIMIT_ERROR.test(message.errorMessage ?? "");

const STILL_REFUSED =
  "The model refused this chat's images even after Stella set older ones aside. Send your message again and Stella will set aside more; if it keeps failing, start a new chat.";

const withRefusalNote = (message: AssistantMessage): AssistantMessage => ({
  ...message,
  errorMessage: `${STILL_REFUSED} (${message.errorMessage ?? "request refused"})`,
});

type StreamArgs = Parameters<Models["streamSimple"]>;

export type ImageBudget = {
  hook: HookRegistration;
  models(models: Models): Models;
  bind(harness: Harness): void;
};

/**
 * The image budget of one harness: the request hook that applies it, and the
 * models wrapper that, when a provider still refuses a request for its images,
 * sets aside more and sends it once more. The floor that retry used is
 * recorded on the conversation, so later turns start from it instead of being
 * refused first.
 */
export function createImageBudget(): ImageBudget {
  let harness: Harness | undefined;
  const floors = new Map<string, number>();

  const stream = (models: Models, [model, context, options]: StreamArgs) => {
    const out = createAssistantMessageEventStream();
    const first = models.streamSimple(model, context, options);
    void (async () => {
      const held: AssistantMessageEvent[] = [];
      let streaming = false;
      for await (const event of first) {
        if (streaming) {
          out.push(event);
          continue;
        }
        if (event.type === "error") {
          const floor = isImageLimitError(event.error) ? emergencyFloor(context.messages) : undefined;
          if (floor === undefined || options?.signal?.aborted) {
            for (const queued of held) out.push(queued);
            out.push(event);
            continue;
          }
          if (options?.sessionId) floors.set(options.sessionId, floor);
          const retried = budgetImages(context.messages, floor);
          const second = models.streamSimple(model, { ...context, messages: [...retried.messages] }, options);
          for await (const next of second) {
            out.push(next.type === "error" && isImageLimitError(next.error) ? { ...next, error: withRefusalNote(next.error) } : next);
          }
          const result = await second.result();
          out.end(isImageLimitError(result) ? withRefusalNote(result) : result);
          return;
        }
        held.push(event);
        if (event.type === "done" || ("partial" in event && event.partial.content.length > 0)) {
          streaming = true;
          for (const queued of held) out.push(queued);
        }
      }
      out.end(await first.result());
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      out.push({
        type: "error",
        reason: "error",
        error: {
          role: "assistant",
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "error",
          errorMessage: message,
          timestamp: Date.now(),
        },
      });
      out.end();
    });
    return out;
  };

  const recordFloor = async (conversationId: ConversationId, floor: number, context: Context) => {
    await harness?.commit(async (tx) => {
      const doc = await tx.doc(StellaImageBudgetDoc, conversationId);
      if (floor > doc.floorAt) doc.floorAt = floor;
      return undefined;
    }, context);
  };

  return {
    hook: hook(GenerationTask, {
      beforeRequest: async (request, api, context) => {
        const floorAt = (await api.snapshot(StellaImageBudgetDoc, api.conversationId, context))?.floorAt ?? 0;
        const budgeted = budgetImages(request.messages, floorAt);
        return budgeted.setAside === 0 ? undefined : { messages: budgeted.messages };
      },
      afterResponse: async (_message, api, context) => {
        if (floors.size === 0) return;
        const sessionId = (await api.snapshot(ProviderDoc, api.conversationId, context))?.sessionId;
        const floor = sessionId === undefined ? undefined : floors.get(sessionId);
        if (sessionId === undefined || floor === undefined) return;
        floors.delete(sessionId);
        await recordFloor(api.conversationId, floor, context);
      },
    }),
    models: (models) =>
      new Proxy(models, {
        get(target, key, receiver) {
          if (key === "streamSimple") return (...args: StreamArgs) => stream(target, args);
          const value = Reflect.get(target, key, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    bind(next) {
      harness = next;
    },
  };
}
