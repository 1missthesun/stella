import { Effect } from "effect";
import { DurableObject } from "cloudflare:workers";
import {
  APP_SOURCE_RELEASES_PATH,
  type AppSourceReleaseFrame,
} from "@stella/contracts/backend/app-source";
import { SOCKET_KEEPALIVE_PING, SOCKET_KEEPALIVE_PONG } from "@stella/contracts/backend/protocol";
import type { Env } from "./build-session/shared/env.js";
import { errorMessage, log } from "./build-session/shared/keys.js";

const UPSTREAM_REPO = "upstream";
const OBJECT_NAME = "upstream";
const RECORD_KEY = "published";
const MIN_CHECK_INTERVAL_MS = 2_000;
const STALE_RECORD_MS = 10 * 60_000;

type PublishedRecord = { version: string | null; checkedAt: number };

const frame = (version: string | null) =>
  JSON.stringify({ t: "published", version } satisfies AppSourceReleaseFrame);

export class AppReleaseChannel extends DurableObject<Env> {
  private checking: Promise<PublishedRecord> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(SOCKET_KEEPALIVE_PING, SOCKET_KEEPALIVE_PONG),
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return this.acceptDesktop();
    }
    if (request.method === "POST") {
      const record = await this.check();
      return Response.json({ version: record.version }, { headers: { "cache-control": "no-store" } });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: "GET, POST" } });
  }

  private async acceptDesktop(): Promise<Response> {
    let record = this.record();
    if (!record) record = await this.check().catch(() => null);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    if (record) server.send(frame(record.version));
    if (record && Date.now() - record.checkedAt > STALE_RECORD_MS) {
      this.ctx.waitUntil(this.check().catch(() => {}));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private record(): PublishedRecord | null {
    return this.ctx.storage.kv.get<PublishedRecord>(RECORD_KEY) ?? null;
  }

  private check(): Promise<PublishedRecord> {
    if (this.checking) return this.checking;
    const checking = (async () => {
      const previous = this.record();
      const wait = previous ? previous.checkedAt + MIN_CHECK_INTERVAL_MS - Date.now() : 0;
      if (wait > 0) await Effect.runPromise(Effect.sleep(wait));
      let version: string | null;
      try {
        version = await this.readUpstream();
      } catch (error) {
        log("error", "app_source_release_check_failed", { message: errorMessage(error) });
        throw error;
      }
      const next: PublishedRecord = { version, checkedAt: Date.now() };
      this.ctx.storage.kv.put(RECORD_KEY, next);
      if (version !== (previous?.version ?? null)) {
        const sockets = this.ctx.getWebSockets();
        let sent = 0;
        for (const socket of sockets) {
          if (socket.readyState !== WebSocket.OPEN) continue;
          try {
            socket.send(frame(version));
            sent += 1;
          } catch {
            // Closing; the desktop catches up when it reconnects.
          }
        }
        log("info", "app_source_release_published", {
          version,
          previous: previous?.version ?? null,
          sockets: sent,
        });
      }
      return next;
    })().finally(() => {
      this.checking = null;
    });
    this.checking = checking;
    return checking;
  }

  private async readUpstream(): Promise<string | null> {
    let repo: ArtifactsRepo;
    try {
      repo = await this.env.ARTIFACTS.get(UPSTREAM_REPO);
    } catch (error) {
      if (error instanceof Error && (error as { code?: unknown }).code === "NOT_FOUND") return null;
      throw error;
    }
    try {
      const [tip] = await repo.log({ ref: "main", limit: 1 });
      return tip?.hash ?? null;
    } finally {
      (repo as unknown as { [Symbol.dispose]?: () => void })[Symbol.dispose]?.();
    }
  }

  webSocketMessage(): void {
    // Desktops only send keepalives, which the platform answers.
  }

  webSocketClose(socket: WebSocket, code: number): void {
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, "closed");
    } catch {
      // Already closed.
    }
  }

  webSocketError(socket: WebSocket): void {
    try {
      socket.close(1011, "error");
    } catch {
      // Already closed.
    }
  }
}

export const handleAppSourceReleases = async (
  request: Request,
  env: Env,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== APP_SOURCE_RELEASES_PATH) return null;
  const isSocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  if (!(isSocket && request.method === "GET") && request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: "GET, POST" } });
  }
  const channel = env.APP_RELEASES.get(env.APP_RELEASES.idFromName(OBJECT_NAME));
  try {
    return await channel.fetch(request);
  } catch (error) {
    log("error", "app_source_releases_failed", { message: errorMessage(error) });
    return Response.json(
      { error: "Stella's release channel is not available right now.", retryable: true },
      { status: 503, headers: { "retry-after": "30" } },
    );
  }
};
