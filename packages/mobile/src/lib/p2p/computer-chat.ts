// A paired computer's own chat on this phone, over the device link. Everything goes to that
// computer: the history (`pi` watch/older), sends (`pi` submit, files first with `file.put`) and
// its live turns (`{t:"pi"}` events). Sends made while it's away wait in an outbox and go out when
// it's back. Modelled on desktop-rune/host/services/p2p/peer-chats.ts, including its id swap: the
// computer's conversation id reads as this phone's id for that chat (`local_p2p-…`) everywhere.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { File } from "expo-file-system";
import {
  P2P_FILE_CHUNK,
  remoteConversationId,
  type P2pComputer,
  type P2pEvent,
  type P2pFilePut,
  type P2pHello,
  type P2pRequest,
} from "@stella/contracts/p2p";
import {
  emptyPiChat,
  mergePiEntries,
  reducePiChat,
  type PiChatEvent,
  type PiChatOlderResult,
  type PiChatRequest,
  type PiChatSend,
  type PiChatState,
  type PiChatWatchResult,
} from "@stella/contracts/pi-chat";
import type { PickedAttachment } from "../chat-attachments";
import { getComputer, p2pTransport, subscribeComputers } from "./link";

export type OutboxItem = {
  requestId: string;
  text: string;
  attachments: PickedAttachment[];
  createdAt: number;
  /** Set when the computer refused it (not when it was away): shown as not sent. */
  failed?: string;
};

export type ComputerChatState = {
  /** This phone's id for the computer's chat (`local_p2p-…`); null until the computer says which. */
  conversationId: string | null;
  /** The computer keeps its chats in the cloud (signed in there): nothing to show over the link. */
  cloudChats: boolean;
  pi: PiChatState;
  loaded: boolean;
  loadingOlder: boolean;
  /** Waiting for their own row to arrive from the computer, oldest first. */
  sent: OutboxItem[];
  outbox: OutboxItem[];
  /** This phone's copies of the pictures it sent, by request: the computer's rows don't carry them. */
  previews: Record<string, string[]>;
};

const CHATS_KEY = "stella-p2p-chats-v1";
const OUTBOX_KEY = (computerId: string) => `stella-p2p-outbox-v1:${computerId}`;
const PREVIEWS_KEY = (computerId: string) => `stella-p2p-previews-v1:${computerId}`;
const PREVIEWS_KEPT = 200;

const awayError = (name: string) => new Error(`${name} is asleep or offline.`);

const random = () => Math.random().toString(36).slice(2, 10);
const newRequestId = () => `p2p-${Date.now().toString(36)}-${random()}`;

let chatsLoaded: Promise<Map<string, string>> | null = null;
const knownChats = () =>
  (chatsLoaded ??= AsyncStorage.getItem(CHATS_KEY)
    .then((raw) => {
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      return new Map(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
    })
    .catch(() => new Map<string, string>()));

const rememberChat = async (computerId: string, conversationId: string | null) => {
  const chats = await knownChats();
  if (conversationId) chats.set(computerId, conversationId);
  else chats.delete(computerId);
  await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(Object.fromEntries(chats))).catch(() => undefined);
};

/**
 * Renames a conversation inside a value, ids built from it included (`pi:<conversation>:<entry>`),
 * so the phone's chat matches its live turns to the computer's saved rows under one name.
 */
function swapIds<T>(value: T, from: string, to: string): T {
  if (typeof value === "string") return (value.includes(from) ? value.split(from).join(to) : value) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const swapped = swapIds(item, from, to);
      if (swapped !== item) changed = true;
      return swapped;
    });
    return (changed ? next : value) as T;
  }
  if (value && typeof value === "object") {
    let next: Record<string, unknown> | null = null;
    for (const [key, item] of Object.entries(value)) {
      const swapped = swapIds(item, from, to);
      if (swapped !== item) (next ??= { ...(value as Record<string, unknown>) })[key] = swapped;
    }
    return (next ?? value) as T;
  }
  return value;
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
};

const send = <T>(computerId: string, body: P2pRequest, timeoutMs = 60_000) =>
  p2pTransport.command<T>("request", { id: computerId, body, timeoutMs });

/** Copies a file from this phone to the computer's inbox for this phone; resolves with its path there. */
const upload = async (computerId: string, attachment: PickedAttachment): Promise<string> => {
  const id = `${Date.now().toString(36)}${random()}`;
  const file = new File(attachment.uri);
  const handle = file.open();
  try {
    const size = handle.size ?? file.size ?? 0;
    let offset = 0;
    for (;;) {
      const bytes = handle.readBytes(Math.min(P2P_FILE_CHUNK, Math.max(0, size - offset)));
      const done = offset + bytes.length >= size;
      const result = await send<P2pFilePut>(computerId, {
        m: "file.put",
        upload: id,
        name: attachment.name,
        ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
        offset,
        data: toBase64(bytes),
        done,
      });
      offset += bytes.length;
      if ("path" in result) return result.path;
      if (bytes.length === 0) throw new Error("Upload stalled.");
    }
  } finally {
    handle.close();
  }
};

export function createComputerChat(computerId: string) {
  let state: ComputerChatState = {
    conversationId: null,
    cloudChats: false,
    pi: emptyPiChat(),
    loaded: false,
    loadingOlder: false,
    sent: [],
    outbox: [],
    previews: {},
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ComputerChatState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  /** The computer's own id for its chat (a `local_` id). */
  let theirs: string | null = null;
  let watching = 0;
  let watched = false;
  let flushing: Promise<void> | null = null;
  const disposers: (() => void)[] = [];

  const computer = (): P2pComputer | null => getComputer(computerId);
  const online = () => computer()?.link.state === "online";
  const name = () => computer()?.name ?? "Your computer";

  const adopt = (conversationId: string | null) => {
    if (conversationId === theirs) return;
    theirs = conversationId;
    set({
      conversationId: conversationId ? remoteConversationId(computerId, conversationId) : null,
      cloudChats: !conversationId,
      ...(conversationId ? {} : { loaded: true }),
    });
  };

  const hello = async () => {
    const result = await send<P2pHello>(computerId, { m: "hello" }, 15_000);
    adopt(result.conversationId);
    await rememberChat(computerId, result.conversationId);
    return result;
  };

  const ours = <T>(value: T): T => (theirs && state.conversationId ? swapIds(value, theirs, state.conversationId) : value);
  const toTheirs = <T>(value: T): T => (theirs && state.conversationId ? swapIds(value, state.conversationId, theirs) : value);

  const pi = async <T>(request: PiChatRequest, timeoutMs?: number): Promise<T> => {
    if (!online()) throw awayError(name());
    return ours(await send<T>(computerId, { m: "pi", request: toTheirs(request) }, timeoutMs ?? (request.op === "submit" ? 120_000 : 60_000)));
  };

  const watch = async () => {
    if (!theirs || !online() || watching === 0) return;
    try {
      const result = await pi<PiChatWatchResult>({ op: "watch", conversationId: state.conversationId! });
      watched = true;
      const fresh = reducePiChat(state.loaded ? state.pi : emptyPiChat(), [result.snapshot]);
      set({ pi: { ...fresh, hasOlder: result.hasOlder }, loaded: true });
      settleSent();
    } catch {
      // The next reconnect (or `ready`) watches again.
    }
  };

  /** Rows the computer has now: drop their stand-ins. */
  const settleSent = () => {
    if (state.sent.length === 0) return;
    const placed = new Set(Object.values(state.pi.requestIds));
    for (const entry of state.pi.entries) {
      const message = entry.model?.[0];
      if (message?.role !== "user" || typeof message.content === "string") continue;
      for (const part of message.content) {
        if ((part.type === "text" || part.type === "image") && part.stella?.clientMsgId) placed.add(part.stella.clientMsgId);
      }
    }
    const sent = state.sent.filter((item) => !placed.has(item.requestId));
    if (sent.length !== state.sent.length) set({ sent });
  };

  const keepPreviews = (item: OutboxItem) => {
    const uris = item.attachments.filter((a) => a.kind === "image").map((a) => a.uri);
    if (uris.length === 0) return;
    const previews = Object.fromEntries([...Object.entries(state.previews), [item.requestId, uris] as const].slice(-PREVIEWS_KEPT));
    set({ previews });
    void AsyncStorage.setItem(PREVIEWS_KEY(computerId), JSON.stringify(previews)).catch(() => undefined);
  };

  const saveOutbox = (outbox: OutboxItem[]) => {
    void AsyncStorage.setItem(OUTBOX_KEY(computerId), JSON.stringify(outbox)).catch(() => undefined);
  };

  const setOutbox = (outbox: OutboxItem[]) => {
    set({ outbox });
    saveOutbox(outbox);
  };

  /** Sends what waits, in order, while the computer stays online. */
  const flush = (): Promise<void> =>
    (flushing ??= (async () => {
      try {
        if (!theirs && online()) await hello().catch(() => undefined);
        for (;;) {
          const item = state.outbox.find((entry) => !entry.failed);
          if (!item || !online() || !theirs) return;
          try {
            const attachments = await Promise.all(
              item.attachments.map(async (attachment) => {
                const path = await upload(computerId, attachment);
                return {
                  url: path,
                  path,
                  name: attachment.name,
                  mimeType: attachment.mimeType,
                  kind: attachment.kind === "image" ? "image" : "file",
                  size: attachment.sizeBytes,
                };
              }),
            );
            const sendInfo: PiChatSend = {
              platform: "mobile",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              locale: Intl.DateTimeFormat().resolvedOptions().locale,
              ...(attachments.length > 0 ? { attachments } : {}),
            };
            await pi({ op: "submit", conversationId: state.conversationId!, requestId: item.requestId, text: item.text, send: sendInfo });
            keepPreviews(item);
            set({ sent: [...state.sent, item] });
            setOutbox(state.outbox.filter((entry) => entry.requestId !== item.requestId));
            settleSent();
          } catch (error) {
            // Away again: it stays queued for the next reconnect. Anything else won't go better on a retry.
            if (!online()) return;
            const message = error instanceof Error ? error.message : String(error);
            setOutbox(state.outbox.map((entry) => (entry.requestId === item.requestId ? { ...entry, failed: message } : entry)));
          }
        }
      } finally {
        flushing = null;
      }
    })());

  let wasOnline = false;
  const onPeers = () => {
    const now = online();
    if (now && !wasOnline) {
      wasOnline = true;
      watched = false;
      void hello()
        .catch(() => undefined)
        .then(() => watch())
        .then(() => flush());
    } else if (!now && wasOnline) {
      wasOnline = false;
      watched = false;
      // Nothing streams from a computer that's gone; its turn shows where it got to.
      if (state.pi.running || state.pi.streaming) set({ pi: { ...state.pi, running: false, streaming: undefined } });
    }
  };

  const onEvent = (event: Parameters<Parameters<typeof p2pTransport.on>[0]>[0]) => {
    if (event.kind !== "event" || event.from !== computerId) return;
    const body = event.body as P2pEvent;
    if (body?.t === "pi") {
      if (!theirs || body.payload.conversationId !== theirs) return;
      const events = ours(body.payload.events) as PiChatEvent[];
      set({ pi: reducePiChat(state.pi, events) });
      settleSent();
    } else if (body?.t === "ready") {
      watched = false;
      void watch();
    }
  };

  const start = async () => {
    const [chats, rawOutbox, rawPreviews] = await Promise.all([
      knownChats(),
      AsyncStorage.getItem(OUTBOX_KEY(computerId)).catch(() => null),
      AsyncStorage.getItem(PREVIEWS_KEY(computerId)).catch(() => null),
    ]);
    if (rawPreviews) {
      try {
        const previews = JSON.parse(rawPreviews) as Record<string, string[]>;
        if (previews && typeof previews === "object") set({ previews: { ...previews, ...state.previews } });
      } catch {}
    }
    const known = chats.get(computerId);
    if (known && !theirs) adopt(known);
    if (rawOutbox) {
      try {
        const outbox = JSON.parse(rawOutbox) as OutboxItem[];
        if (Array.isArray(outbox) && outbox.length > 0) set({ outbox: [...outbox, ...state.outbox.filter((o) => !outbox.some((x) => x.requestId === o.requestId))] });
      } catch {}
    }
    disposers.push(subscribeComputers(onPeers), p2pTransport.on(onEvent));
    onPeers();
  };
  const ready = start();

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** While the chat is on screen: history and live turns. */
    open() {
      watching += 1;
      void ready.then(() => {
        if (!watched) void watch();
      });
      return () => {
        watching -= 1;
        if (watching === 0 && watched && theirs && online()) {
          watched = false;
          void pi({ op: "unwatch", conversationId: state.conversationId! }).catch(() => undefined);
        }
      };
    },
    async loadOlder() {
      const first = state.pi.entries[0];
      if (!first || !state.pi.hasOlder || state.loadingOlder || !online()) return;
      set({ loadingOlder: true });
      try {
        const result = await pi<PiChatOlderResult>({ op: "older", conversationId: state.conversationId!, beforeEntryId: first.id });
        set({ pi: { ...state.pi, entries: mergePiEntries(state.pi.entries, result.entries), hasOlder: result.hasOlder } });
      } finally {
        set({ loadingOlder: false });
      }
    },
    /** Queues a send; it goes out now if the computer is online, else when it's back. */
    send(text: string, attachments: PickedAttachment[] = []): string {
      const item: OutboxItem = { requestId: newRequestId(), text, attachments, createdAt: Date.now() };
      setOutbox([...state.outbox, item]);
      void ready.then(flush);
      return item.requestId;
    },
    discard(requestId: string) {
      setOutbox(state.outbox.filter((entry) => entry.requestId !== requestId));
    },
    async stop() {
      if (!state.conversationId || !online()) return;
      await pi({ op: "abort", conversationId: state.conversationId }).catch(() => undefined);
    },
    async forget() {
      await rememberChat(computerId, null);
      await AsyncStorage.multiRemove([OUTBOX_KEY(computerId), PREVIEWS_KEY(computerId)]).catch(() => undefined);
    },
    dispose() {
      for (const dispose of disposers.splice(0)) dispose();
      listeners.clear();
    },
  };
}

export type ComputerChat = ReturnType<typeof createComputerChat>;

const chats = new Map<string, ComputerChat>();

/** One chat per computer for the life of the app, so its outbox keeps going between screens. */
export const computerChat = (computerId: string): ComputerChat => {
  let chat = chats.get(computerId);
  if (!chat) chats.set(computerId, (chat = createComputerChat(computerId)));
  return chat;
};

export const dropComputerChat = async (computerId: string) => {
  const chat = chats.get(computerId) ?? createComputerChat(computerId);
  chats.delete(computerId);
  await chat.forget();
  chat.dispose();
};
