// Direct device link (no account, no Stella server): a device paired to a computer reads and
// drives that computer's chats on this computer over an Iroh QUIC link (Rust crate stella-p2p in
// packages/desktop-rune/p2p, the same on desktop and phone engines). This is the wire contract
// between the computer's service and a device's client, plus the shapes the UI sees.

import type { PiChatEventsPayload, PiChatRequest } from "./pi-chat.js";
import type { LocalChatUpdatedPayload } from "./local-chat.js";

export const P2P_PROTOCOL_VERSION = 1;

/** QR codes carry `stella://p2p?c=<code>`; the code alone is `stella-p2p1.<…>`. */
export const P2P_CODE_PREFIX = "stella-p2p1.";
export const P2P_URL_PREFIX = "stella://p2p?c=";

export const looksLikeP2pCode = (text: string): boolean => {
  const cleaned = text.replace(/\s+/g, "");
  return cleaned.startsWith(P2P_CODE_PREFIX) || cleaned.startsWith(P2P_URL_PREFIX + P2P_CODE_PREFIX);
};

/**
 * A computer's chat as a device shows it: `local_p2p-<first 16 hex of the computer's id>-<rest
 * of its local_ id>`. It stays a private (`local_`) chat to the UI, and the device routes it to
 * that computer.
 */
const REMOTE_PREFIX = "local_p2p-";
const REMOTE_ID = /^local_p2p-([0-9a-f]{16})-(.+)$/;

export const peerTag = (computerId: string): string => computerId.slice(0, 16).toLowerCase();

export const remoteConversationId = (computerId: string, conversationId: string): string =>
  `${REMOTE_PREFIX}${peerTag(computerId)}-${conversationId.replace(/^local_/, "")}`;

export const parseRemoteConversationId = (id: string | null | undefined): { tag: string; conversationId: string } | null => {
  const match = typeof id === "string" ? REMOTE_ID.exec(id) : null;
  return match ? { tag: match[1]!, conversationId: `local_${match[2]}` } : null;
};

export const isRemoteConversationId = (id: string | null | undefined): boolean => typeof id === "string" && id.startsWith(REMOTE_PREFIX);

/** The chat operations a paired device may run on the computer's chats. */
export const P2P_PI_OPS = [
  "submit",
  "abort",
  "watch",
  "unwatch",
  "older",
  "agents",
  "follow",
  "journaled",
  "files",
  "journal",
  "safeguard",
  "resumeUsageLimit",
  "brain",
  "sendFailed",
] as const satisfies readonly PiChatRequest["op"][];

export const P2P_LOCAL_CHAT_OPS = [
  "listMessages",
  "listMessagesBefore",
  "listMessagesAfter",
  "listActivity",
  "listLineageMessages",
  "listFiles",
] as const;
export type P2pLocalChatOp = (typeof P2P_LOCAL_CHAT_OPS)[number];

/** Bytes of a file read or written per request. */
export const P2P_FILE_CHUNK = 512 * 1024;

export type P2pRequest =
  | { m: "hello" }
  | { m: "pi"; request: PiChatRequest }
  | { m: "localChat"; op: P2pLocalChatOp; args: Record<string, unknown> }
  | { m: "file.read"; path: string; offset: number; length: number }
  | { m: "file.put"; upload: string; name: string; mimeType?: string; offset: number; data: string; done: boolean };

export type P2pHello = {
  v: number;
  name: string;
  platform: string;
  /** The computer's own chat (a `local_` id); null while it keeps its chats in the cloud. */
  conversationId: string | null;
  signedIn: boolean;
};

export type P2pFileChunk = { data: string; size: number; offset: number; done: boolean; mimeType?: string };
export type P2pFilePut = { path: string } | { received: number };

/** What a computer pushes to a device that watches one of its chats. */
export type P2pEvent =
  | { t: "pi"; payload: PiChatEventsPayload }
  | { t: "localChat"; payload: LocalChatUpdatedPayload }
  | { t: "ready"; ready: boolean };

export type P2pDevice = {
  id: string;
  name: string;
  platform: string;
  pairedAt: number;
  lastSeenAt?: number;
  connected: boolean;
};

export type P2pComputerState =
  | { state: "idle" | "connecting" }
  | { state: "online"; path?: { kind: "direct" | "relay" } | null }
  | { state: "offline"; since?: number; reason?: string }
  | { state: "revoked" | "not_paired" };

export type P2pComputer = {
  id: string;
  name: string;
  platform: string;
  pairedAt: number;
  lastSeenAt?: number;
  link: P2pComputerState;
};

export type P2pPeers = { devices: P2pDevice[]; computers: P2pComputer[] };

export type P2pPairing = { code: string; url: string; expiresAt: number };

export type P2pStatus = { id: string; name: string; platform: string; relay: string | null; addrs: string[] };

/** What the UI reaches (Rune: `stella.host.p2p`). */
export type P2pApi = {
  status(): Promise<P2pStatus>;
  peers(): P2pPeers;
  subscribe(listener: () => void): () => void;
  /** A one-time code for this computer, good for 10 minutes; a new one withdraws the last. */
  createPairing(): Promise<P2pPairing>;
  cancelPairing(): Promise<void>;
  /** Fires when a device pairs with the code on screen. */
  onPaired(listener: (device: P2pDevice) => void): () => void;
  revokeDevice(id: string): Promise<void>;
  /** Pairs this device to the computer whose code this is; resolves with its chat. */
  pair(code: string): Promise<{ computer: P2pComputer; conversationId: string | null }>;
  forgetComputer(id: string): Promise<void>;
  /** The computer's chat on this device, once it has said which it is. */
  conversationFor(computerId: string): Promise<string | null>;
  computerForConversation(conversationId: string | null | undefined): P2pComputer | null;
  retry(computerId?: string): void;
};

/** What the engine's device link sends to TS (crate stella-p2p's events). */
export type P2pNodeEvent =
  | { kind: "request"; req: number; from: string; body: unknown }
  | { kind: "event"; from: string; body: unknown }
  | { kind: "device"; id: string; state: "paired" | "connected" | "disconnected" | "revoked" | "rejected"; device?: Omit<P2pDevice, "connected"> }
  | ({ kind: "computer"; id: string; name?: string } & (P2pComputerState | { state: "paired" | "forgotten" }))
  | { kind: "pairing"; state: "used" | "expired" | "withdrawn" };

/** The device link as the desktop engine and the phone engine expose it: `p2p.<name>` commands and their events. */
export type P2pTransport = {
  command<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  on(listener: (event: P2pNodeEvent) => void): () => void;
};
