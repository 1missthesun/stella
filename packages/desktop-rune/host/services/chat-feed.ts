// The default conversation of the real runtime, mirrored into the host store's `messages`
// (streaming replies included), and `send` placing a turn through piChat, as desktop-ui's chat
// does. It lets a Rune UI show and drive real chat before it binds desktop-ui's own chat stores.

import type { PiChatEvent, PiContentBlock, PiEntry, PiMessage } from "@stella/contracts/pi-chat";
import type { Message, Store } from "../store";
import type { ElectronApi } from "./renderer-api";

const visibleText = (content: PiContentBlock[] | string | undefined) => {
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter((block): block is Extract<PiContentBlock, { type: "text" }> => block.type === "text" && !(block as { stella?: { hidden?: boolean } }).stella?.hidden)
    .map((block) => block.text)
    .join("");
};

const clock = (at: number | undefined) => new Date(at ?? Date.now()).toTimeString().slice(0, 5);

const toMessage = (id: string, message: PiMessage): Message | null => {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const text = visibleText(message.content as PiContentBlock[] | string);
  if (!text) return null;
  return { id, role: message.role, text, at: clock((message as { timestamp?: number }).timestamp) };
};

export type ChatFeed = { conversationId: string; send(text: string): Promise<void>; dispose(): void };

export async function startChatFeed(api: ElectronApi, store: Store): Promise<ChatFeed> {
  const backendUrl = process.env.VITE_STELLA_BACKEND_URL;
  if (backendUrl) await api.system.configurePiRuntime({ backendUrl });
  const conversationId = await api.localChat.getOrCreateDefaultConversationId();
  await api.ui.setState({ conversationId });

  const entries = new Map<number, Message[]>();
  let streaming: { text: string[] } | null = null;

  const publish = () => {
    const ordered = [...entries.keys()].sort((a, b) => a - b).flatMap((id) => entries.get(id)!);
    if (streaming) ordered.push({ id: "streaming", role: "assistant", text: streaming.text.join(""), at: clock(undefined) });
    store.set({ messages: ordered });
  };

  const upsert = (entry: PiEntry) => {
    const messages = (entry.model ?? []).map((m, i) => toMessage(`e${entry.id}.${i}`, m)).filter((m): m is Message => m !== null);
    if (messages.length) entries.set(entry.id, messages);
  };

  const apply = (event: PiChatEvent) => {
    switch (event.type) {
      case "snapshot":
        entries.clear();
        for (const entry of event.entries) upsert(entry);
        streaming = null;
        break;
      case "entry_appended":
      case "message_end":
        upsert(event.entry);
        if (event.type === "message_end") streaming = null;
        break;
      case "message_start":
        if (event.message.role === "assistant") streaming = { text: [] };
        break;
      case "message_update":
        if (!streaming) break;
        for (const change of event.changes) {
          if (change.type === "text_delta") streaming.text[change.contentIndex] = (streaming.text[change.contentIndex] ?? "") + change.delta;
          if (change.type === "text_start" && change.block.type === "text") streaming.text[change.contentIndex] = change.block.text;
        }
        break;
      default:
        return;
    }
    publish();
  };

  const off = api.piChat.onEvents((payload) => {
    if (payload.conversationId !== conversationId) return;
    for (const event of payload.events) apply(event);
  });
  const watch = async () => {
    await api.piChat.request({ op: "watch", conversationId });
    publish();
  };
  let runtimeReady = false;
  const offAvailability = api.agent.onAvailability((snapshot) => {
    const ready = snapshot.connected && snapshot.ready;
    if (ready && !runtimeReady) {
      void api.piChat.request({ op: "unwatch", conversationId }).catch(() => undefined).then(watch).catch((err) => console.error("[host] chat feed watch failed:", err));
    }
    runtimeReady = ready;
  });
  await watch().catch(() => undefined);

  return {
    conversationId,
    async send(text) {
      await api.piChat.request({ op: "submit", conversationId, requestId: `rune-${Date.now().toString(36)}`, text });
    },
    dispose() {
      off();
      offAvailability();
      void api.piChat.request({ op: "unwatch", conversationId });
    },
  };
}
