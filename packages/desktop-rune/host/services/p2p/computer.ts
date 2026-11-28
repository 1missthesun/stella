// The computer's side of the device link: what a paired device asks of this computer's chats
// (read them, watch them, send into them, attach files) runs here, on this computer's runtime,
// and the chats it watches stream back to it. Only private (`local_`) chats are reachable.

import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, stat } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import type { LocalChatUpdatedPayload } from "@stella/contracts/local-chat";
import type { PiChatEventsPayload, PiChatRequest, PiChatSend } from "@stella/contracts/pi-chat";
import {
  P2P_FILE_CHUNK,
  P2P_LOCAL_CHAT_OPS,
  P2P_PI_OPS,
  P2P_PROTOCOL_VERSION,
  isRemoteConversationId,
  peerTag,
  type P2pHello,
  type P2pLocalChatOp,
  type P2pRequest,
  type P2pTransport,
} from "@stella/contracts/p2p";

export type ComputerDeps = {
  name(): string;
  platform: string;
  /** Runs a chat operation on this computer's runtime. */
  piChat(request: PiChatRequest): Promise<unknown>;
  onPiChatEvents(listener: (payload: PiChatEventsPayload) => void): () => void;
  onLocalChatUpdated(listener: (payload: LocalChatUpdatedPayload) => void): () => void;
  /** Fires when the runtime (re)starts, which drops every watch. */
  onRuntimeReady(listener: () => void): () => void;
  localChat(op: P2pLocalChatOp, args: Record<string, unknown>): Promise<unknown>;
  conversationId(): Promise<string | null>;
  signedIn(): Promise<boolean>;
  inboxDir: string;
};

const PI_OPS = new Set<string>(P2P_PI_OPS);
const LOCAL_OPS = new Set<string>(P2P_LOCAL_CHAT_OPS);

const reachable = (id: unknown): id is string =>
  typeof id === "string" && id.startsWith("local_") && !isRemoteConversationId(id);

const safeName = (name: string) => basename(name).replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "file";

/** A device's send, as this computer runs it: the run stays here and keeps its chat private. */
const sendHere = (send: PiChatSend | undefined): PiChatSend | undefined => {
  if (!send) return send;
  const { deviceId: _deviceId, followSender: _follow, failover: _failover, ...rest } = send;
  return { ...rest, storageMode: "local" };
};

export function serveDevices(transport: P2pTransport, deps: ComputerDeps) {
  const watching = new Map<string, Set<string>>();
  const uploads = new Map<string, { path: string; size: number }>();

  const inboxOf = (device: string) => join(deps.inboxDir, peerTag(device));

  const unwatchAll = (device: string) => {
    const conversations = watching.get(device);
    watching.delete(device);
    for (const conversationId of conversations ?? []) void deps.piChat({ op: "unwatch", conversationId }).catch(() => undefined);
  };

  const emitTo = (conversationId: string | undefined, body: unknown) => {
    if (!conversationId) return;
    for (const [device, conversations] of watching) {
      if (conversations.has(conversationId)) void transport.command("emit", { id: device, body }).catch(() => undefined);
    }
  };

  const readable = async (device: string, path: string): Promise<string | null> => {
    const real = await realpath(path).catch(() => null);
    if (!real) return null;
    const inbox = await realpath(inboxOf(device)).catch(() => inboxOf(device));
    if (real.startsWith(inbox + sep)) return real;
    for (const conversationId of watching.get(device) ?? []) {
      const files = (await deps.piChat({ op: "files", conversationId }).catch(() => null)) as { paths?: string[] } | null;
      for (const listed of files?.paths ?? []) {
        if (listed === path || (await realpath(listed).catch(() => null)) === real) return real;
      }
    }
    return null;
  };

  const handle = async (device: string, body: P2pRequest): Promise<unknown> => {
    switch (body?.m) {
      case "hello": {
        const hello: P2pHello = {
          v: P2P_PROTOCOL_VERSION,
          name: deps.name(),
          platform: deps.platform,
          conversationId: await deps.conversationId().catch(() => null),
          signedIn: await deps.signedIn().catch(() => false),
        };
        return hello;
      }
      case "pi": {
        const request = body.request;
        if (!request || !PI_OPS.has(request.op)) throw new Error("That isn't available from another device.");
        if (!reachable(request.conversationId)) throw new Error("Only this computer's private chats are reachable.");
        if (request.op === "submit") return await deps.piChat({ ...request, send: sendHere(request.send) });
        // A device holds one watch per chat: an unwatch it never watched mustn't end someone else's.
        if (request.op === "unwatch" && !watching.get(device)?.has(request.conversationId)) return null;
        const result = await deps.piChat(request);
        if (request.op === "watch") {
          let conversations = watching.get(device);
          if (!conversations) watching.set(device, (conversations = new Set()));
          if (conversations.has(request.conversationId)) void deps.piChat({ op: "unwatch", conversationId: request.conversationId }).catch(() => undefined);
          conversations.add(request.conversationId);
        } else if (request.op === "unwatch") {
          watching.get(device)?.delete(request.conversationId);
        }
        return result;
      }
      case "localChat": {
        if (!LOCAL_OPS.has(body.op)) throw new Error("That isn't available from another device.");
        if (!reachable(body.args?.conversationId)) throw new Error("Only this computer's private chats are reachable.");
        return await deps.localChat(body.op, body.args);
      }
      case "file.read": {
        const path = typeof body.path === "string" ? await readable(device, body.path) : null;
        if (!path) throw new Error("That file isn't shared with this device.");
        const length = Math.max(0, Math.min(P2P_FILE_CHUNK, Math.floor(body.length) || P2P_FILE_CHUNK));
        const offset = Math.max(0, Math.floor(body.offset) || 0);
        const { size } = await stat(path);
        const file = await open(path, "r");
        try {
          const chunk = Buffer.alloc(Math.min(length, Math.max(0, size - offset)));
          const { bytesRead } = await file.read(chunk, 0, chunk.length, offset);
          return { data: chunk.subarray(0, bytesRead).toString("base64"), size, offset, done: offset + bytesRead >= size };
        } finally {
          await file.close();
        }
      }
      case "file.put": {
        if (typeof body.upload !== "string" || !/^[\w-]{8,64}$/.test(body.upload)) throw new Error("Bad upload.");
        const key = `${device}:${body.upload}`;
        const data = Buffer.from(typeof body.data === "string" ? body.data : "", "base64");
        if (data.length > P2P_FILE_CHUNK * 2) throw new Error("Upload chunk too large.");
        let upload = uploads.get(key);
        if (!upload || body.offset === 0) {
          const dir = inboxOf(device);
          await mkdir(dir, { recursive: true, mode: 0o700 });
          upload = { path: join(dir, `${randomUUID().slice(0, 8)}-${safeName(body.name)}`), size: 0 };
          uploads.set(key, upload);
          await (await open(upload.path, "w", 0o600)).close();
        }
        if (body.offset !== upload.size) throw new Error("Upload out of order.");
        const file = await open(upload.path, "a");
        try {
          await file.write(data);
        } finally {
          await file.close();
        }
        upload.size += data.length;
        if (!body.done) return { received: upload.size };
        uploads.delete(key);
        return { path: upload.path };
      }
      default:
        throw new Error("Unknown request.");
    }
  };

  const unsubscribe = [
    transport.on((event) => {
      if (event.kind === "request") {
        void handle(event.from, event.body as P2pRequest).then(
          (body) => transport.command("respond", { req: event.req, ok: true, body: body ?? null }),
          (error: unknown) =>
            transport.command("respond", { req: event.req, ok: false, error: error instanceof Error ? error.message : String(error) }),
        ).catch(() => undefined);
      } else if (event.kind === "device" && (event.state === "disconnected" || event.state === "revoked")) {
        unwatchAll(event.id);
      }
    }),
    deps.onPiChatEvents((payload) => emitTo(payload.conversationId, { t: "pi", payload })),
    deps.onLocalChatUpdated((payload) => emitTo(payload.conversationId, { t: "localChat", payload })),
    deps.onRuntimeReady(() => {
      for (const conversations of watching.values()) {
        for (const conversationId of conversations) void deps.piChat({ op: "watch", conversationId }).catch(() => undefined);
      }
      for (const device of watching.keys()) void transport.command("emit", { id: device, body: { t: "ready", ready: true } }).catch(() => undefined);
    }),
  ];

  return () => {
    for (const off of unsubscribe) off();
    for (const device of [...watching.keys()]) unwatchAll(device);
  };
}
