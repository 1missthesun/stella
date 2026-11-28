// The device link in the windowed app: this computer serves the devices paired to it, reaches the
// computers it paired to, and the UI gets both through `stella.host.p2p`. The link stays off at
// launch until there is something to serve or reach (a paired peer, a pairing the person starts, or
// local-network discovery turned on in Settings), so a plain launch never touches the network.

import { join } from "node:path";
import type { PiChatEventsPayload, PiChatRequest } from "@stella/contracts/pi-chat";
import { parseRemoteConversationId, peerTag, type P2pApi, type P2pDevice, type P2pPairing, type P2pPairResult, type P2pPeers, type P2pShortCode, type P2pStatus } from "@stella/contracts/p2p";
import { mainContext } from "../main-context";
import type { ElectronApi } from "../renderer-api";
import { serveDevices } from "./computer";
import { computerName, createPeerStore, engineTransport, hasPairedPeers, linkStarted, localNetworkSetting, p2pDataDir, saveLocalNetworkSetting, startLink, type PeerStore } from "./link";
import { createConfirmStore, createNearbyStore } from "./nearby";
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
let nearby: ReturnType<typeof createNearbyStore> | null = null;
let confirms: ReturnType<typeof createConfirmStore> | null = null;
const pairedListeners = new Set<(device: P2pDevice) => void>();
const shortEndedListeners = new Set<(reason: string) => void>();
const nearbyEndedListeners = new Set<(id: string, reason: string) => void>();
const localListeners = new Set<() => void>();
let localNetwork = false;

/** Starts the link and returns the window's API with paired computers' chats routed to them. */
export function startP2p(api: ElectronApi): ElectronApi {
  const transport = engineTransport;
  store = createPeerStore(transport);
  chats = createPeerChats(transport, store, p2pDataDir());
  nearby = createNearbyStore(transport);
  confirms = createConfirmStore(transport);

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
    } else if (event.kind === "pairing" && event.state === "short_ended") {
      for (const listener of shortEndedListeners) listener(event.reason);
    } else if (event.kind === "nearby" && event.state === "ended" && event.reason !== "paired") {
      for (const listener of nearbyEndedListeners) listener(event.id, event.reason);
    }
  });

  localNetwork = localNetworkSetting();
  if (localNetwork || hasPairedPeers()) {
    void startLink()
      .then(() => store!.refresh())
      .then(() => {
        for (const computer of store!.get().computers) void transport.command("computer.connect", { id: computer.id }).catch(() => undefined);
      })
      .catch((error: unknown) => console.error("[p2p] the device link didn't start:", error));
  }

  return chats.wrap(api);
}

const waitFor = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<null>((done) => setTimeout(() => done(null), ms))]);

const NO_PEERS: P2pPeers = { devices: [], computers: [] };

const listen = <A extends unknown[]>(set: Set<(...args: A) => void>, listener: (...args: A) => void) => {
  set.add(listener);
  return () => void set.delete(listener);
};

/** The person typed a short code (`K7M-49PX`, any case, dash optional) rather than a full one. */
const isShortCode = (code: string) => /^[0-9a-z]{3}[\s-]?[0-9a-z]{4}$/i.test(code.trim());

export function p2pApi(): P2pApi {
  const live = () => {
    if (!store || !chats) throw new Error("The device link isn't running.");
    return { store, chats };
  };
  const finishPairing = async (id: string): Promise<P2pPairResult> => {
    const { store, chats } = live();
    await store.refresh();
    await waitFor(chats.untilOnline(id), 15_000);
    const computer = store.get().computers.find((c) => c.id === id);
    if (!computer) throw new Error("Pairing didn't finish.");
    const hello = await chats.hello(computer).catch(() => null);
    return { computer, conversationId: hello?.conversationId ? chats.conversationFor(computer.id) : null };
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
    createShortCode: () => engineTransport.command<P2pShortCode>("pairing.short"),
    onShortCodeEnded: (listener) => listen(shortEndedListeners, listener),
    async pair(code) {
      const short = isShortCode(code);
      const paired = await engineTransport.command<{ id: string }>(short ? "pair.short" : "pair", { code: code.trim() });
      return await finishPairing(paired.id);
    },
    localNetwork: () => localNetwork,
    subscribeLocalNetwork: (listener) => listen(localListeners, listener),
    async setLocalNetwork(on) {
      if (on === localNetwork) return;
      saveLocalNetworkSetting(on);
      localNetwork = on;
      for (const listener of localListeners) listener();
      // Turning it on starts the link if it wasn't running (it reads the setting); off only has
      // something to stop when the link runs.
      if (on || linkStarted()) await engineTransport.command("local.set", { on }).catch((error: unknown) => console.error("[p2p] local network:", error));
    },
    nearby: () => nearby?.get() ?? [],
    watchNearby: (listener) => nearby?.watch(listener) ?? (() => {}),
    askNearby: async (id) => {
      await engineTransport.command("pair.nearby", { id });
    },
    async confirmNearby(id, digits) {
      const paired = await engineTransport.command<{ id: string }>("pair.nearby.confirm", { id, code: digits });
      return await finishPairing(paired.id);
    },
    cancelNearby(id) {
      void engineTransport.command("pair.nearby.cancel", { id }).catch(() => undefined);
    },
    onNearbyEnded: (listener) => listen(nearbyEndedListeners, listener),
    confirming: () => confirms?.get() ?? null,
    subscribeConfirming: (listener) => confirms?.subscribe(listener) ?? (() => {}),
    denyNearby: async (request) => {
      await engineTransport.command("pairing.deny", { request });
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
