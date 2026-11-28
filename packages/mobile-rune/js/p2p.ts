/// <reference path="./natives.d.ts" />
// The phone's direct device link (crate stella-p2p in the engine, `p2p.*` commands): a phone is a
// *device*. It pairs to a computer's Stella with the code that computer shows and then uses that
// computer's chat, with no account and no Stella server. The transport, the peer store and the
// chat routing are the desktop host's own (desktop-rune/host/services/p2p/{link,peer-chats}.ts);
// the host role (computer.ts) stays on computers.

import {
  P2P_URL_PREFIX,
  parseRemoteConversationId,
  peerTag,
  type P2pApi,
  type P2pComputer,
  type P2pNodeEvent,
  type P2pPeers,
  type P2pStatus,
  type P2pTransport,
} from "@stella/contracts/p2p";
import { onEngineEvent, request } from "../../desktop-rune/host/bridge";
import { createPeerStore, type PeerStore } from "../../desktop-rune/host/services/p2p/link";
import { createPeerChats, type PeerChats } from "../../desktop-rune/host/services/p2p/peer-chats";

/**
 * What peer-chats.ts uses of Node's Buffer to send an attachment in base64 chunks (`alloc`,
 * `subarray`, `toString("base64")`); the phone's JS has no Node.
 */
class ChunkBuffer extends Uint8Array {
  static alloc(size: number) {
    return new ChunkBuffer(size);
  }
  override toString(encoding?: string): string {
    if (encoding !== "base64") return new TextDecoder().decode(this);
    let binary = "";
    for (let i = 0; i < this.length; i += 0x8000) binary += String.fromCharCode(...this.subarray(i, i + 0x8000));
    return btoa(binary);
  }
}
(globalThis as { Buffer?: unknown }).Buffer ??= ChunkBuffer;

const env = __native.env;

/** The device key and the paired computers live in the app's private storage, out of Documents. */
const dataDir = (() => {
  const container = env.documents.replace(/\/Documents\/?$/, "");
  return env.platform === "ios" ? `${container}/Library/Application Support/p2p` : `${container}/p2p`;
})();

const deviceName = () => {
  const model = (env.model || "").trim();
  return model || (env.platform === "ios" ? "iPhone" : "Android phone");
};

let started: Promise<P2pStatus> | null = null;

const startLink = (): Promise<P2pStatus> =>
  (started ??= request<P2pStatus>("p2p.start", {
    dataDir,
    name: deviceName(),
    platform: env.platform,
    relay: env.env.STELLA_P2P_RELAY || "default",
    // A phone is never a computer: it doesn't answer nearby devices.
    discoverable: false,
    rendezvous: env.env.STELLA_P2P_RENDEZVOUS || "default",
  }).catch((error: unknown) => {
    started = null;
    throw error;
  }));

const transport: P2pTransport = {
  command: async <T>(name: string, args: Record<string, unknown> = {}) => {
    await startLink();
    return await request<T>(`p2p.${name}`, args);
  },
  on: (listener) => onEngineEvent("p2p", ({ t: _t, ...event }) => listener(event as P2pNodeEvent)),
};

/** A computer's short code: 7 Crockford base32 symbols, the dash optional (`K7M-49PX`). */
const SHORT_CODE = /^[0-9A-HJKMNP-TV-Z]{3}-?[0-9A-HJKMNP-TV-Z]{4}$/i;

/** What a person scanned, tapped or typed, as the crate's command for it. */
export const pairingCommand = (input: string): { name: "pair" | "pair.short"; code: string } | null => {
  let text = input.replace(/\s+/g, "");
  if (!text) return null;
  if (text.toLowerCase().startsWith(P2P_URL_PREFIX)) {
    const c = new URL(text.replace(/^stella:\/\//i, "https://stella.invalid/")).searchParams.get("c");
    text = (c ?? "").trim();
  }
  if (SHORT_CODE.test(text)) return { name: "pair.short", code: text.toUpperCase() };
  return text ? { name: "pair", code: text } : null;
};

/** `stella://p2p?c=<code>`, from a QR code or a link. */
export const isPairingLink = (url: string): boolean => url.trim().toLowerCase().startsWith(P2P_URL_PREFIX);

const waitFor = <T>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<null>((done) => setTimeout(() => done(null), ms))]);

const NO_PEERS: P2pPeers = { devices: [], computers: [] };

let store: PeerStore | null = null;
let chats: PeerChats | null = null;
let markLoaded: () => void = () => {};
/** Settles once the paired computers have loaded (or the link failed to start). */
const loaded = new Promise<void>((done) => (markLoaded = done));
/** Watchers of the paired computers, kept before the link starts and moved onto its store. */
const watchers = new Set<() => void>();

// Starting the link opens its network endpoint, which on iOS asks for Local Network access, so it
// starts only once the phone has paired to a computer (this flag) or someone pairs one now.
const PAIRED_KEY = "stella-phone-p2p-paired";
const markPaired = (paired: boolean) => (paired ? __native.storageSet(PAIRED_KEY, "1") : __native.storageRemove(PAIRED_KEY));

/** Starts the link once: the paired computers load and each one connects. */
function live() {
  if (store && chats) return { store, chats };
  store = createPeerStore(transport);
  chats = createPeerChats(transport, store, dataDir);
  const s = store;
  s.subscribe(() => {
    for (const watcher of watchers) watcher();
  });
  void startLink()
    .then(() => s.refresh())
    .finally(markLoaded)
    .then(() => {
      for (const computer of s.get().computers) void transport.command("computer.connect", { id: computer.id }).catch(() => undefined);
    })
    .catch((error: unknown) => console.error("[p2p] the device link didn't start:", error));
  return { store, chats };
}

/** The phone's `P2pApi`: a device's half (pairing to computers and using them). */
export const phoneP2p: P2pApi & { chats(): PeerChats; start(): void; resume(): void; loaded(): Promise<void> } = {
  start: () => void live(),
  /** Boot: the link comes back only on a phone that has paired to a computer. */
  resume: () => {
    if (__native.storageGet(PAIRED_KEY)) live();
  },
  loaded: () => {
    live();
    return loaded;
  },
  chats: () => live().chats,
  status: () => transport.command<P2pStatus>("status"),
  peers: () => store?.get() ?? NO_PEERS,
  subscribe: (listener) => {
    watchers.add(listener);
    return () => {
      watchers.delete(listener);
    };
  },
  createPairing: () => Promise.reject(new Error("A phone pairs to a computer; it doesn't offer codes.")),
  cancelPairing: async () => {},
  onPaired: () => () => {},
  revokeDevice: async () => {},
  async pair(input) {
    const { store, chats } = live();
    const command = pairingCommand(input);
    if (!command) throw new Error("That isn't a pairing code.");
    const paired = await transport.command<{ id: string }>(command.name, { code: command.code });
    markPaired(true);
    await store.refresh();
    await waitFor(chats.untilOnline(paired.id), 15_000);
    const computer = store.get().computers.find((c) => c.id === paired.id);
    if (!computer) throw new Error("Pairing didn't finish.");
    const hello = await chats.hello(computer).catch(() => null);
    return { computer, conversationId: hello?.conversationId ? chats.conversationFor(computer.id) : null };
  },
  async forgetComputer(id) {
    const { store, chats } = live();
    await transport.command("computer.forget", { id });
    chats.forget(id);
    await store.refresh();
    if (!store.get().computers.length) markPaired(false);
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
    void transport.command("computer.retry", computerId ? { id: computerId } : {}).catch(() => undefined);
  },
};

export type { P2pComputer };
