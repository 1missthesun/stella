// The device link in the windowed app: this computer serves the devices paired to it, reaches the
// computers it paired to, and the UI gets both through `stella.host.p2p`.

import { join } from "node:path";
import type { PiChatEventsPayload, PiChatRequest } from "@stella/contracts/pi-chat";
import { parseRemoteConversationId, peerTag, type P2pApi, type P2pDevice, type P2pPairing, type P2pPeers, type P2pStatus } from "@stella/contracts/p2p";
import { mainContext } from "../main-context";
import type { ElectronApi } from "../renderer-api";
import { serveDevices } from "./computer";
import { computerName, createPeerStore, engineTransport, p2pDataDir, startLink, type PeerStore } from "./link";
import { createPeerChats, type PeerChats } from "./peer-chats";

type Runner = {
  piChat(request: PiChatRequest): Promise<unknown>;
  waitUntilConnected(ms: number): Promise<unknown>;
};

const runner = () => (mainContext()?.state.stellaHostRunner as Runner | null | undefined) ?? null;
const services = () => mainContext()?.services ?? {};

const runHere = async (request: PiChatRequest) => {
  const current = runner();
  if (!current) throw new Error("Stella runtime not available");
  await current.waitUntilConnected(request.op === "submit" ? 30_000 : 5_000);
  return await current.piChat(request);
};

let store: PeerStore | null = null;
let chats: PeerChats | null = null;
const pairedListeners = new Set<(device: P2pDevice) => void>();

/** Starts the link and returns the window's API with paired computers' chats routed to them. */
export function startP2p(api: ElectronApi): ElectronApi {
  const transport = engineTransport;
  store = createPeerStore(transport);
  chats = createPeerChats(transport, store, p2pDataDir());

  serveDevices(transport, {
    name: computerName,
    platform: process.platform,
    piChat: runHere,
    onPiChatEvents: (listener) => api.piChat.onEvents(listener as (payload: PiChatEventsPayload) => void),
    onLocalChatUpdated: (listener) => api.localChat.onUpdated((payload) => payload && listener(payload)),
    onRuntimeReady: (listener) => {
      let ready = true;
      return api.agent.onAvailability((snapshot) => {
        const now = Boolean(snapshot.connected && snapshot.ready);
        if (now && !ready) listener();
        ready = now;
      });
    },
    localChat: async (op, args) => {
      const history = services().localChatHistoryService as Record<string, (args: Record<string, unknown>) => unknown> | undefined;
      if (!history?.[op]) throw new Error("Chat history isn't available.");
      return await history[op]!.call(history, args);
    },
    conversationId: async () => {
      const history = services().localChatHistoryService as { getOrCreateDefaultConversationId(): string | Promise<string> } | undefined;
      return history ? await history.getOrCreateDefaultConversationId() : null;
    },
    signedIn: async () => {
      const auth = services().authService as { getAuthToken(): Promise<string | null> } | undefined;
      return Boolean(await auth?.getAuthToken().catch(() => null));
    },
    inboxDir: join(p2pDataDir(), "inbox"),
  });

  transport.on((event) => {
    if (event.kind === "device" && event.state === "paired" && event.device) {
      const device = { ...event.device, connected: false };
      for (const listener of pairedListeners) listener(device);
    }
  });

  void startLink()
    .then(() => store!.refresh())
    .then(() => {
      for (const computer of store!.get().computers) void transport.command("computer.connect", { id: computer.id }).catch(() => undefined);
    })
    .catch((error: unknown) => console.error("[p2p] the device link didn't start:", error));

  return chats.wrap(api);
}

const waitFor = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<null>((done) => setTimeout(() => done(null), ms))]);

const NO_PEERS: P2pPeers = { devices: [], computers: [] };

export function p2pApi(): P2pApi {
  const live = () => {
    if (!store || !chats) throw new Error("The device link isn't running.");
    return { store, chats };
  };
  return {
    status: () => engineTransport.command<P2pStatus>("status"),
    peers: () => store?.get() ?? NO_PEERS,
    subscribe: (listener) => store?.subscribe(listener) ?? (() => {}),
    createPairing: () => engineTransport.command<P2pPairing>("pairing.create"),
    cancelPairing: () => engineTransport.command<void>("pairing.cancel"),
    onPaired(listener) {
      pairedListeners.add(listener);
      return () => pairedListeners.delete(listener);
    },
    revokeDevice: async (id) => {
      await engineTransport.command("device.revoke", { id });
      await store?.refresh();
    },
    async pair(code) {
      const { store, chats } = live();
      const paired = await engineTransport.command<{ id: string }>("pair", { code: code.trim() });
      await store.refresh();
      await waitFor(chats.untilOnline(paired.id), 15_000);
      const computer = store.get().computers.find((c) => c.id === paired.id);
      if (!computer) throw new Error("Pairing didn't finish.");
      const hello = await chats.hello(computer).catch(() => null);
      return { computer, conversationId: hello?.conversationId ? chats.conversationFor(computer.id) : null };
    },
    async forgetComputer(id) {
      const { store, chats } = live();
      await engineTransport.command("computer.forget", { id });
      chats.forget(id);
      await store.refresh();
    },
    async conversationFor(computerId) {
      const { store, chats } = live();
      const known = chats.conversationFor(computerId);
      if (known) return known;
      const computer = store.get().computers.find((c) => c.id === computerId);
      if (computer?.link.state === "online") await chats.hello(computer).catch(() => null);
      return chats.conversationFor(computerId);
    },
    computerForConversation(conversationId) {
      const parsed = parseRemoteConversationId(conversationId);
      return parsed ? (store?.get().computers.find((c) => peerTag(c.id) === parsed.tag) ?? null) : null;
    },
    retry(computerId) {
      void engineTransport.command("computer.retry", computerId ? { id: computerId } : {}).catch(() => undefined);
    },
  };
}
