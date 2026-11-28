// A device's side of the device link: a computer this device paired to shows its chats here under
// their own ids (`local_p2p-…`), and everything the UI does with one of them (watch, send, read
// history, attach files) goes to that computer instead of this one's runtime.

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, open, rename, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidenceCardSet } from "@stella/contracts/chat-evidence";
import type { LocalChatUpdatedPayload } from "@stella/contracts/local-chat";
import { extractLocalFileLinkPaths } from "@stella/contracts/local-file-links";
import type { PiChatEventsPayload, PiChatRequest, PiChatSend } from "@stella/contracts/pi-chat";
import {
  P2P_FILE_CHUNK,
  P2P_LOCAL_CHAT_OPS,
  parseRemoteConversationId,
  peerTag,
  remoteConversationId,
  type P2pComputer,
  type P2pEvent,
  type P2pFileChunk,
  type P2pFilePut,
  type P2pHello,
  type P2pLocalChatOp,
  type P2pRequest,
  type P2pTransport,
} from "@stella/contracts/p2p";
import type { PeerStore } from "./link";

/** The outbox keeps a send it can't deliver yet when the error says the runtime is away. */
const awayError = (name: string) => new Error(`Stella runtime not available: ${name} is asleep or offline.`);

const CONNECTING_GRACE_MS = 15_000;

type Remote = { computer: P2pComputer; conversationId: string; remoteId: string };

export function createPeerChats(transport: P2pTransport, store: PeerStore, dataDir: string) {
  const chatsFile = join(dataDir, "chats.json");
  const chats = new Map<string, string>(readChats(chatsFile));
  const watches = new Map<string, number>();
  const piListeners = new Set<(payload: PiChatEventsPayload) => void>();
  const localListeners = new Set<(payload: LocalChatUpdatedPayload) => void>();
  const onlineWaiters = new Map<string, Set<() => void>>();
  const pendingWatches = new Set<string>();
  /** Paths on the computer that each of its chats (by its id here) links to: an image it made, say. */
  const linked = new Map<string, Set<string>>();
  /** Local copies, by computer and path. */
  const fetched = new Map<string, Promise<string | null>>();
  const cacheDir = join(dataDir, "cache");

  const noteLinks = (remoteId: string, value: unknown, depth = 0) => {
    if (depth > 12) return;
    if (typeof value === "string") {
      if (value.length < 4 || !(value.includes("](") || value.includes("file://"))) return;
      for (const path of extractLocalFileLinkPaths(value)) {
        let paths = linked.get(remoteId);
        if (!paths) linked.set(remoteId, (paths = new Set()));
        paths.add(path);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) noteLinks(remoteId, item, depth + 1);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) noteLinks(remoteId, item, depth + 1);
    }
  };

  /** A local copy of a file on a computer, fetched over the link once; null when it can't be. */
  const fetchLinked = (computer: P2pComputer, path: string): Promise<string | null> => {
    const key = `${computer.id}\0${path}`;
    const known = fetched.get(key);
    if (known) return known;
    if (!online(computer.id)) return Promise.resolve(null);
    const work = (async () => {
      const dir = join(cacheDir, peerTag(computer.id));
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const target = join(dir, `${createHash("sha256").update(path).digest("hex").slice(0, 12)}-${basename(path).replace(/[^\w.-]+/g, "_").slice(-80)}`);
      if (await stat(target).then((s) => s.isFile(), () => false)) return target;
      const partial = `${target}.part`;
      const file = await open(partial, "w", 0o600);
      try {
        for (let offset = 0; ; ) {
          const chunk = await send<P2pFileChunk>(computer, { m: "file.read", path, offset, length: P2P_FILE_CHUNK });
          const data = Buffer.from(chunk.data, "base64");
          await file.write(data, 0, data.length, offset);
          offset += data.length;
          if (chunk.done) break;
          if (data.length === 0) throw new Error("Download stalled.");
        }
      } finally {
        await file.close();
      }
      await rename(partial, target);
      return target;
    })().catch(() => {
      fetched.delete(key);
      return null;
    });
    fetched.set(key, work);
    return work;
  };

  const computerByTag = (tag: string) => store.get().computers.find((c) => peerTag(c.id) === tag) ?? null;

  const resolve = (id: string | null | undefined): Remote | null => {
    const parsed = parseRemoteConversationId(id);
    const computer = parsed ? computerByTag(parsed.tag) : null;
    return parsed && computer ? { computer, conversationId: parsed.conversationId, remoteId: id! } : null;
  };

  const online = (id: string) => store.get().computers.find((c) => c.id === id)?.link.state === "online";

  const untilOnline = (id: string) =>
    online(id)
      ? Promise.resolve()
      : new Promise<void>((done) => {
          let waiters = onlineWaiters.get(id);
          if (!waiters) onlineWaiters.set(id, (waiters = new Set()));
          waiters.add(done);
        });

  const send = <T>(computer: P2pComputer, body: P2pRequest, timeoutMs = 60_000) =>
    transport.command<T>("request", { id: computer.id, body, timeoutMs });

  const hello = async (computer: P2pComputer): Promise<P2pHello> => {
    const result = await send<P2pHello>(computer, { m: "hello" }, 15_000);
    if (result.conversationId) {
      chats.set(computer.id, result.conversationId);
      writeChats(chatsFile, chats);
    }
    return result;
  };

  const upload = async (computer: P2pComputer, path: string, name: string, mimeType?: string): Promise<string> => {
    const id = randomUUID();
    const { size } = await stat(path);
    const file = await open(path, "r");
    try {
      let offset = 0;
      for (;;) {
        const chunk = Buffer.alloc(Math.min(P2P_FILE_CHUNK, size - offset));
        const { bytesRead } = await file.read(chunk, 0, chunk.length, offset);
        const done = offset + bytesRead >= size;
        const result = await send<P2pFilePut>(computer, {
          m: "file.put",
          upload: id,
          name,
          ...(mimeType ? { mimeType } : {}),
          offset,
          data: chunk.subarray(0, bytesRead).toString("base64"),
          done,
        });
        offset += bytesRead;
        if ("path" in result) return result.path;
        if (bytesRead === 0) throw new Error("Upload stalled.");
      }
    } finally {
      await file.close();
    }
  };

  const localPath = (value: unknown): string | null => {
    if (typeof value !== "string" || !value) return null;
    if (value.startsWith("file://")) return fileURLToPath(value);
    return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) ? value : null;
  };

  /** Files this device attached go to the computer first; the send then names its copies. */
  const sendFor = async (computer: P2pComputer, send: PiChatSend | undefined): Promise<PiChatSend | undefined> => {
    if (!send) return send;
    const moved = new Map<string, string>();
    const place = async (path: string | null, name?: string, mimeType?: string) => {
      if (!path) return null;
      if (!moved.has(path)) moved.set(path, await upload(computer, path, name || basename(path), mimeType));
      return moved.get(path)!;
    };
    const attachments = await Promise.all(
      (send.attachments ?? []).map(async (raw) => {
        const attachment = raw as { url?: string; path?: string; name?: string; mimeType?: string; previewUrl?: string };
        const there = await place(localPath(attachment.path) ?? localPath(attachment.url), attachment.name, attachment.mimeType);
        return there ? { ...attachment, url: there, ...(attachment.path ? { path: there } : {}) } : raw;
      }),
    );
    const context = send.chatContext as { files?: { path?: string; name?: string; mimeType?: string }[]; regionScreenshots?: { filePath?: string }[] } | null | undefined;
    const chatContext = context
      ? {
          ...context,
          ...(context.files
            ? { files: await Promise.all(context.files.map(async (f) => ({ ...f, ...(f.path ? { path: (await place(f.path, f.name, f.mimeType))! } : {}) }))) }
            : {}),
          ...(context.regionScreenshots
            ? { regionScreenshots: await Promise.all(context.regionScreenshots.map(async (s) => ({ ...s, ...(s.filePath ? { filePath: (await place(s.filePath))! } : {}) }))) }
            : {}),
        }
      : context;
    return { ...send, attachments, chatContext: chatContext as PiChatSend["chatContext"] };
  };

  /** Waits out a link that is still coming up; a computer known to be away fails at once. */
  const reachable = async (computer: P2pComputer) => {
    if (online(computer.id)) return true;
    const state = store.get().computers.find((c) => c.id === computer.id)?.link.state;
    if (state !== "idle" && state !== "connecting") return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>((done) => (timer = setTimeout(done, CONNECTING_GRACE_MS)));
    await Promise.race([untilOnline(computer.id), late]).finally(() => clearTimeout(timer));
    return online(computer.id);
  };

  const pi = async (remote: Remote, request: PiChatRequest): Promise<unknown> => {
    const { computer, conversationId } = remote;
    if (request.op === "watch") {
      watches.set(remote.remoteId, (watches.get(remote.remoteId) ?? 0) + 1);
      if (!online(computer.id)) {
        pendingWatches.add(remote.remoteId);
        await untilOnline(computer.id).finally(() => pendingWatches.delete(remote.remoteId));
      }
    } else if (request.op === "unwatch") {
      const watching = watches.get(remote.remoteId) ?? 0;
      if (watching > 1) {
        // Another view of this chat still watches it, and the computer keeps one watch per chat.
        watches.set(remote.remoteId, watching - 1);
        return null;
      }
      watches.delete(remote.remoteId);
      if (watching === 0 || !online(computer.id)) return null;
    } else if (!(await reachable(computer))) {
      // Nothing runs where nobody can see it, so an away computer simply has no tasks to show.
      if (request.op === "agents") return { agents: [] };
      throw awayError(computer.name);
    }
    const mapped = swapIds({ ...request }, remote.remoteId, conversationId) as PiChatRequest;
    if (mapped.op === "submit") mapped.send = await sendFor(computer, mapped.send);
    const result = await send(computer, { m: "pi", request: mapped }, mapped.op === "submit" ? 120_000 : 60_000);
    noteLinks(remote.remoteId, result);
    return swapIds(result, conversationId, remote.remoteId);
  };

  const localChat = async (remote: Remote, op: P2pLocalChatOp, args: Record<string, unknown>) => {
    if (!(await reachable(remote.computer))) throw awayError(remote.computer.name);
    const result = await send(remote.computer, { m: "localChat", op, args: swapIds({ ...args }, remote.remoteId, remote.conversationId) });
    noteLinks(remote.remoteId, result);
    return swapIds(result, remote.conversationId, remote.remoteId);
  };

  /** Back online: the computer forgot this device's watches, so ask again and catch up. */
  const rewatch = (computer: P2pComputer) => {
    const tag = peerTag(computer.id);
    for (const remoteId of watches.keys()) {
      const parsed = parseRemoteConversationId(remoteId);
      if (parsed?.tag !== tag || pendingWatches.has(remoteId)) continue;
      void send<{ snapshot: PiChatEventsPayload["events"][number] }>(computer, { m: "pi", request: { op: "watch", conversationId: parsed.conversationId } })
        .then((result) => {
          noteLinks(remoteId, result.snapshot);
          const events = [swapIds(result.snapshot, parsed.conversationId, remoteId)];
          for (const listener of piListeners) listener({ conversationId: remoteId, events });
        })
        .catch(() => undefined);
    }
  };

  const wasOnline = new Set<string>();
  store.subscribe(() => {
    for (const computer of store.get().computers) {
      const isOnline = computer.link.state === "online";
      if (isOnline && !wasOnline.has(computer.id)) {
        wasOnline.add(computer.id);
        void hello(computer).catch(() => undefined);
        rewatch(computer);
        const waiters = onlineWaiters.get(computer.id);
        onlineWaiters.delete(computer.id);
        for (const done of waiters ?? []) done();
      } else if (!isOnline) {
        wasOnline.delete(computer.id);
      }
    }
  });

  transport.on((event) => {
    if (event.kind !== "event") return;
    const computer = store.get().computers.find((c) => c.id === event.from);
    if (!computer) return;
    const body = event.body as P2pEvent;
    if (body?.t === "pi") {
      const id = body.payload.conversationId;
      noteLinks(remoteConversationId(computer.id, id), body.payload);
      const payload = swapIds(body.payload, id, remoteConversationId(computer.id, id));
      for (const listener of piListeners) listener(payload);
    } else if (body?.t === "localChat") {
      const id = body.payload.conversationId;
      const payload = id ? swapIds(body.payload, id, remoteConversationId(computer.id, id)) : body.payload;
      for (const listener of localListeners) listener(payload);
    } else if (body?.t === "ready") {
      rewatch(computer);
    }
  });

  return {
    resolve,
    hello,
    conversationFor: (computerId: string) => {
      const id = chats.get(computerId);
      return id ? remoteConversationId(computerId, id) : null;
    },
    untilOnline,
    forget(computerId: string) {
      chats.delete(computerId);
      writeChats(chatsFile, chats);
      const tag = peerTag(computerId);
      for (const remoteId of [...linked.keys()]) if (parseRemoteConversationId(remoteId)?.tag === tag) linked.delete(remoteId);
      for (const key of [...fetched.keys()]) if (key.startsWith(`${computerId}\0`)) fetched.delete(key);
    },

    /** The window's ElectronApi with a paired computer's chats routed to it. */
    wrap<A extends WrappableApi>(api: A): A {
      const { piChat, localChat: local } = api;
      const routed: Record<string, unknown> = {};
      for (const op of P2P_LOCAL_CHAT_OPS) {
        const own = (local as unknown as Record<string, (args: Record<string, unknown>) => Promise<unknown>>)[op];
        if (!own) continue;
        routed[op] = (args: Record<string, unknown>) => {
          const remote = resolve(args?.conversationId as string | undefined);
          return remote ? localChat(remote, op, args) : own(args);
        };
      }
      const evidence = api.chatEvidence;
      return {
        ...api,
        ...(evidence
          ? {
              chatEvidence: {
                ...evidence,
                // A computer's chat links to files on that computer; show local copies of them, and
                // only in that chat, so no chat can stand a computer's file in for one of this device's.
                cards: async (filePaths: string[], options?: { conversationId?: string | null }) => {
                  const remote = resolve(options?.conversationId);
                  const paths = remote ? linked.get(remote.remoteId) : undefined;
                  if (!remote || !paths) return await evidence.cards(filePaths);
                  const local = await Promise.all(filePaths.map(async (path) => (paths.has(path) ? ((await fetchLinked(remote.computer, path)) ?? path) : path)));
                  return await evidence.cards(local);
                },
              },
            }
          : null),
        piChat: {
          ...piChat,
          request: ((request: PiChatRequest) => {
            const remote = resolve(request?.conversationId);
            return remote ? pi(remote, request) : piChat.request(request as never);
          }) as A["piChat"]["request"],
          onEvents: ((listener: (payload: PiChatEventsPayload) => void) => {
            const own = piChat.onEvents(listener as never);
            piListeners.add(listener);
            return () => {
              own();
              piListeners.delete(listener);
            };
          }) as A["piChat"]["onEvents"],
        },
        localChat: {
          ...local,
          ...routed,
          // A computer's chat isn't this device's own: opening one leaves this device's chat as it is.
          setActiveConversationId: ((args: { conversationId: string }) =>
            parseRemoteConversationId(args?.conversationId) ? Promise.resolve() : local.setActiveConversationId(args as never)) as A["localChat"]["setActiveConversationId"],
          onUpdated: ((listener: (payload: LocalChatUpdatedPayload) => void) => {
            const own = local.onUpdated(listener as never);
            localListeners.add(listener);
            return () => {
              own();
              localListeners.delete(listener);
            };
          }) as A["localChat"]["onUpdated"],
        },
      };
    },
  };
}

export type PeerChats = ReturnType<typeof createPeerChats>;

type WrappableApi = {
  chatEvidence?: { cards(filePaths: string[], options?: { conversationId?: string | null }): Promise<EvidenceCardSet> };
  piChat: { request(...args: never[]): Promise<unknown>; onEvents(listener: never): () => void };
  localChat: {
    setActiveConversationId(...args: never[]): Promise<unknown>;
    onUpdated(listener: never): () => void;
  };
};

/**
 * Renames a conversation inside a value, ids built from it included (`pi:<conversation>:<entry>`),
 * so the device's chat matches its live turns to the computer's saved rows under one name.
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

function readChats(file: string): [string, string][] {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    return Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  } catch {
    return [];
  }
}

function writeChats(file: string, chats: Map<string, string>) {
  try {
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(Object.fromEntries(chats), null, 2), { mode: 0o600 });
  } catch {}
}
