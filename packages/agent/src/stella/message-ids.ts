import type { Context } from "@earendil-works/chord";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import { defineDoc, GenerationTask, hook, type ConversationId, type Harness } from "@earendil-works/pi-durable";
import { piUserHidden, type PiPartMarks, type PiUserMessage } from "@stella/contracts/pi-chat";
import { appendMessageRefTag, formatMessageRefTag } from "@stella/contracts/reply-refs";

const MAX_IDS = 2_000;
const RECORD_WAIT_MS = 5_000;
const RECORD_POLL_MS = 50;
const TAGGED_RE = /<system-reminder>message #\d+<\/system-reminder>/;

export const NO_MESSAGE_ID = -1;

export const StellaMessageIdsDoc = defineDoc<{ ids: Record<string, number> }>({
  kind: "stella.message-ids",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ ids: {} }),
});

export async function recordMessageId(
  harness: Harness,
  conversationId: ConversationId,
  clientMsgId: string,
  seq: number,
  context: Context,
): Promise<void> {
  await harness.commit(async (tx) => {
    const doc = await tx.doc(StellaMessageIdsDoc, conversationId);
    if (doc.ids[clientMsgId] === seq || (seq === NO_MESSAGE_ID && doc.ids[clientMsgId] !== undefined)) return undefined;
    doc.ids[clientMsgId] = seq;
    const keys = Object.keys(doc.ids);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_IDS))) delete doc.ids[key];
    return undefined;
  }, context);
}

const marksOf = (message: UserMessage): PiPartMarks[] =>
  typeof message.content === "string"
    ? []
    : message.content.flatMap((part) => {
        const marks = (part as { stella?: PiPartMarks }).stella;
        return marks ? [marks] : [];
      });

const textOf = (message: UserMessage): string =>
  typeof message.content === "string"
    ? message.content
    : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");

const untagged = (message: Message): { seq?: number; clientMsgId?: string } | undefined => {
  if (message.role !== "user" || piUserHidden(message as PiUserMessage) || TAGGED_RE.test(textOf(message))) {
    return undefined;
  }
  const marks = marksOf(message);
  const seq = marks.find((mark) => typeof mark.seq === "number")?.seq;
  const clientMsgId = marks.find((mark) => typeof mark.clientMsgId === "string")?.clientMsgId;
  if (seq === undefined && clientMsgId === undefined) return undefined;
  return { ...(seq === undefined ? {} : { seq }), ...(clientMsgId ? { clientMsgId } : {}) };
};

const tagged = (message: UserMessage, seq: number): UserMessage => {
  if (typeof message.content === "string") return { ...message, content: appendMessageRefTag(message.content, seq) };
  const at = message.content.findLastIndex((part) => part.type === "text" && part.text.trim().length > 0);
  if (at < 0) return { ...message, content: [...message.content, { type: "text", text: formatMessageRefTag(seq) }] };
  return {
    ...message,
    content: message.content.map((part, index) =>
      index === at && part.type === "text" ? { ...part, text: appendMessageRefTag(part.text, seq) } : part,
    ),
  };
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const messageIdsHook = hook(GenerationTask, {
  beforeRequest: async (request, api, context) => {
    const pending = request.messages.map(untagged);
    if (!pending.some(Boolean)) return undefined;
    const read = async () => (await api.snapshot(StellaMessageIdsDoc, api.conversationId, context))?.ids ?? {};
    let ids = await read();
    const lastAnswered = request.messages.findLastIndex((message) => message.role === "assistant");
    const waitFor = pending.flatMap((entry, index) =>
      index > lastAnswered && entry?.seq === undefined && entry?.clientMsgId && ids[entry.clientMsgId] === undefined
        ? [entry.clientMsgId]
        : [],
    );
    if (waitFor.length > 0 && (await api.memo<boolean>(`message-ids:${waitFor.join(",")}`, context)) !== true) {
      for (let waited = 0; waited < RECORD_WAIT_MS && waitFor.some((id) => ids[id] === undefined); waited += RECORD_POLL_MS) {
        await sleep(RECORD_POLL_MS);
        ids = await read();
      }
      await api.memo(`message-ids:${waitFor.join(",")}`, true, context);
    }
    let changed = false;
    const messages = request.messages.map((message, index) => {
      const entry = pending[index];
      const seq = entry?.seq ?? (entry?.clientMsgId ? ids[entry.clientMsgId] : undefined);
      if (seq === undefined || seq === NO_MESSAGE_ID || message.role !== "user") return message;
      changed = true;
      return tagged(message, seq);
    });
    return changed ? { messages } : undefined;
  },
});
