/// <reference path="../../js/natives.d.ts" />
// Using a computer's Stella from the phone (the direct device link, js/p2p.ts). While the phone
// uses a computer, the chat layer runs the desktop's private-chat path (chat storage "local"),
// exactly as a paired computer does, through chats whose ids are that computer's (`local_p2p-…`)
// and go over the link (desktop-rune/host/services/p2p/peer-chats.ts). Only the chat layer sees
// them (js/build.ts, computerChats); the rest of the app stays the phone's.
// It works signed out. Leaving takes the phone back to its own account, or the sign-in screen.

import { useSyncExternalStore } from "react";
import { isRemoteConversationId, type P2pComputer } from "@stella/contracts/p2p";
import { setChatStorageMode } from "@/features/chat/services/chat-storage-preference";
import { router } from "@/router";
import { phoneP2p } from "../../js/p2p";

const KEY = "stella-phone-computer";

let computerId: string | null = __native.storageGet(KEY);
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

const notHere = () => Promise.reject(new Error("This chat isn't on this phone."));

/** The phone's chats while it uses a computer: only that computer's, through the link. */
function computerApi() {
  const chats = phoneP2p.chats();
  type Call = (args: { conversationId?: string }) => Promise<unknown>;
  // The wrapped API, once built: what a chat asked for early goes through once it can.
  let api: { piChat: { request: Call }; localChat: Record<string, Call> } | null = null;
  /**
   * A computer's chat asked for before the paired computers have loaded (the chat opens at once
   * on launch) waits for them, then goes to that computer; any other chat isn't here.
   */
  const later =
    (call: (wrapped: NonNullable<typeof api>) => Call): Call =>
    async (args) => {
      if (!isRemoteConversationId(args?.conversationId)) return notHere();
      await phoneP2p.loaded();
      if (!api || !chats.resolve(args.conversationId)) return notHere();
      return call(api)(args);
    };
  const defaultConversation = async () => {
    const id = computerId && (await phoneP2p.conversationFor(computerId));
    if (!id) throw new Error("Your computer hasn't said which chat is its own yet. Try again once it's awake.");
    return id;
  };
  const own = {
    piChat: {
      request: later((wrapped) => wrapped.piChat.request),
      onEvents: () => () => {},
    },
    localChat: {
      getOrCreateDefaultConversationId: defaultConversation,
      setActiveConversationId: async () => ({ ok: true as const }),
      listMessages: later((wrapped) => wrapped.localChat.listMessages!),
      listMessagesBefore: later((wrapped) => wrapped.localChat.listMessagesBefore!),
      listMessagesAfter: later((wrapped) => wrapped.localChat.listMessagesAfter!),
      listActivity: later((wrapped) => wrapped.localChat.listActivity!),
      listLineageMessages: later((wrapped) => wrapped.localChat.listLineageMessages!),
      listFiles: later((wrapped) => wrapped.localChat.listFiles!),
      onUpdated: () => () => {},
    },
    system: {
      setCloudSyncEnabled: async () => {},
      getDeviceId: async () => (await phoneP2p.status()).id,
      openExternal: (url: string) => __native.post(JSON.stringify({ cmd: "openURL", url })),
    },
  };
  const wrapped = chats.wrap(own);
  api = wrapped as unknown as NonNullable<typeof api>;
  return wrapped;
}

/** What the chat layer reads in place of `window.electronAPI` (js/build.ts, computerChats). */
type ChatsHolder = { __stellaComputerChats?: ReturnType<typeof computerApi> };

function install() {
  const holder = globalThis as ChatsHolder;
  holder.__stellaComputerChats ??= computerApi();
}

/** Boot: a phone that was using a computer opens straight into its chat. */
export function restoreComputerMode() {
  phoneP2p.start();
  if (computerId) install();
}

export const computerMode = {
  current: () => computerId,

  /** Uses this computer's Stella: its chat is the phone's chat from now on. */
  async enter(computer: P2pComputer, conversationId: string | null) {
    computerId = computer.id;
    __native.storageSet(KEY, computer.id);
    install();
    await setChatStorageMode("local");
    changed();
    const id = conversationId ?? (await phoneP2p.conversationFor(computer.id));
    if (id && isRemoteConversationId(id)) void router.navigate({ to: "/chat", search: { c: id } as never });
  },

  /** Back to the phone's own Stella (its account, or the sign-in screen). */
  async leave() {
    computerId = null;
    __native.storageRemove(KEY);
    await setChatStorageMode("cloud");
    delete (globalThis as ChatsHolder).__stellaComputerChats;
    changed();
    void router.navigate({ to: "/chat", search: {} as never });
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useComputerMode = () => useSyncExternalStore(computerMode.subscribe, computerMode.current, computerMode.current);
