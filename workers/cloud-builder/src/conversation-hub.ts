import {
  LEGACY_SOCKET_TOKEN_SUBPROTOCOL_PREFIX,
  SOCKET_TICKET_SUBPROTOCOL_PREFIX,
} from "@stella/contracts/socket-ticket";
import {
  AUTH_GRACE_MS,
  BACKFILL_BATCH_BYTES,
  BACKFILL_BATCH_RECORDS,
  CLOSE_BAD_REQUEST,
  CLOSE_DELETED,
  CLOSE_FRAME_TOO_LARGE,
  CLOSE_FORBIDDEN,
  CLOSE_INTERNAL,
  CLOSE_NOT_FOUND,
  CLOSE_PROTOCOL_VERSION,
  CLOSE_RATE_LIMITED,
  CLOSE_TOO_MANY_SOCKETS,
  CLOSE_UNAUTHENTICATED,
  HEADER_ISSUER,
  INITIAL_WINDOW_RECORDS,
  MAX_CATCH_UP_RECORDS,
  MAX_INCOMING_FRAME_BYTES,
  MAX_RESUME_RECORDS,
  MAX_SOCKETS_PER_CONVERSATION,
  PROTOCOL_VERSION,
  RATE_AUTH_PER_MIN,
  RATE_BACKFILL_PER_MIN,
  RATE_CANCEL_PER_MIN,
  RATE_TOTAL_PER_MIN,
  RE_AUTH_LEAD_MS,
  SOCKET_STALE_MS,
  STELLA_HEADER_PREFIX,
  registerConversationHubFactory,
  utf8Length,
  type ConversationHub,
  type ConversationHubDeps,
  type JournalHead,
  type JournalRecord,
  type LiveTurnSnapshot,
  type SocketIdentity,
  type ToolInput,
} from "./conversation-types.js";
import { READY_RUNNING_AGENTS_LIMIT, type AgentActivityEntry } from "@stella/contracts/conversation-agent-activity";
import { sha256Hex } from "./hash.js";
import { sessionRevokedBy, type SessionRevocations } from "./session-revocation.js";
import type { PiBrainRecord } from "@stella/contracts/turn-plane/pi-brain";

export type ReadyFrame = {
  type: "ready";
  protocol: number;
  conversationId: string;
  epoch: number;
  headSeq: number;
  windowStartSeq: number;
  floorSeq: number;
  title: string;
  activity: "idle" | "running";
  authExpiresAtMs: number;
  serverTimeMs: number;
  live: LiveTurnSnapshot | null;
  agents: AgentActivityEntry[];
};

export type AgentsFrame = { type: "agents"; agents: AgentActivityEntry[]; atMs: number };

export type RecordFrame = { type: "record" } & JournalRecord;

export type BackfillFrame = {
  type: "backfill";
  requestId: string;
  fromSeq: number;
  toSeq: number;
  complete: boolean;
  records: JournalRecord[];
};

export type GapFrame = {
  type: "gap";
  fromSeq: number;
  toSeq: number;
  reason: "compacted";
};

export type ResetFrame = { type: "reset"; reason: "epoch" | "window" };

export type ToolFrame = { type: "tool" } & ToolInput;

export type AuthExpiringFrame = { type: "auth.expiring"; atMs: number };

export type BrainFrame = { type: "brain"; record: PiBrainRecord | null };

export type ErrorFrame = {
  type: "error";
  code: string;
  message: string;
  retryable: boolean;
  ref?: string;
};

export type PiSnapshotFrame = { type: "pi.snapshot"; snapshot: unknown; hasOlder: boolean };
export type PiEventsFrame = { type: "pi.events"; events: readonly unknown[] };
export type PiOlderFrame = { type: "pi.older"; requestId: string; entries: unknown[]; hasOlder: boolean };

export type ServerFrame =
  | PiSnapshotFrame
  | PiEventsFrame
  | PiOlderFrame
  | ReadyFrame
  | AgentsFrame
  | RecordFrame
  | BackfillFrame
  | GapFrame
  | ResetFrame
  | ToolFrame
  | AuthExpiringFrame
  | BrainFrame
  | ErrorFrame;

export type ClientFrame =
  | { type: "auth"; token: string }
  | { type: "backfill"; requestId: string; fromSeq: number; toSeq: number }
  | { type: "cancel"; turnId: string }
  | { type: "pi.older"; requestId: string; beforeEntryId: number };

export {
  HEADER_ISSUER,
  HEADER_OWNER,
  HEADER_SESSION,
  HEADER_SUBJECT,
  HEADER_TOKEN_EXP,
} from "./conversation-types.js";

export const SUBPROTOCOL = "stella.v1";
export const SUBPROTOCOL_TOKEN_PREFIX = LEGACY_SOCKET_TOKEN_SUBPROTOCOL_PREFIX;

const CALLER_CREDENTIAL_HEADERS = new Set([
  "authorization",
  "cookie",
  "sec-websocket-protocol",
]);

const WEBSOCKET_HANDSHAKE_HEADERS = new Set([
  "upgrade",
  "connection",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
]);

export const trustedInternalRequest = (
  request: Request,
  url: string,
  options: {
    identity: Readonly<Record<string, string>>;
    subprotocol: string;
    headers: "http" | "websocket";
  },
): Request => {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (lower.startsWith(STELLA_HEADER_PREFIX) || CALLER_CREDENTIAL_HEADERS.has(lower)) continue;
    if (options.headers === "websocket" && !WEBSOCKET_HANDSHAKE_HEADERS.has(lower)) continue;
    headers.set(name, value);
  }
  if (request.headers.has("sec-websocket-protocol")) {
    headers.set("sec-websocket-protocol", options.subprotocol);
  }
  for (const [name, value] of Object.entries(options.identity)) headers.set(name, value);
  return new Request(url, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  });
};

const CLOSE_REASONS: Record<number, string> = {
  [CLOSE_BAD_REQUEST]: "bad_request",
  [CLOSE_UNAUTHENTICATED]: "unauthenticated",
  [CLOSE_FORBIDDEN]: "forbidden",
  [CLOSE_NOT_FOUND]: "not_found",
  [CLOSE_PROTOCOL_VERSION]: "protocol_version",
  [CLOSE_DELETED]: "deleted",
  [CLOSE_FRAME_TOO_LARGE]: "frame_too_large",
  [CLOSE_RATE_LIMITED]: "rate_limited",
  [CLOSE_TOO_MANY_SOCKETS]: "too_many_sockets",
  [CLOSE_INTERNAL]: "internal",
};

const closeReason = (code: number): string => CLOSE_REASONS[code] ?? "closed";

/**
 * An HTTP 4xx before the 101 reaches the browser as close code 1006 with no
 * detail. A plain `accept()` consumes no hibernation slot, unlike
 * `ctx.acceptWebSocket()`.
 */
export const refuseUpgrade = (
  request: Request,
  code: number,
  message: string,
  options: { retryable?: boolean; ref?: string; errorCode?: string } = {},
): Response => {
  const pair = new WebSocketPair();
  const server = pair[1]!;
  server.accept();
  try {
    server.send(
      JSON.stringify({
        type: "error",
        code: options.errorCode ?? closeReason(code),
        message,
        retryable: options.retryable ?? false,
        ...(options.ref ? { ref: options.ref } : {}),
      } satisfies ErrorFrame),
    );
  } catch {
  }
  try {
    server.close(code, closeReason(code));
  } catch {
  }
  // Echoing a subprotocol the client never offered fails the handshake in the
  // browser, which would replace our close code with an opaque 1006 — the
  // exact ambiguity this refusal path exists to remove.
  const { offered } = tokenFromSubprotocol(request);
  return new Response(null, {
    status: 101,
    webSocket: pair[0]!,
    headers: offered ? { "sec-websocket-protocol": SUBPROTOCOL } : {},
  });
};

export const isWebSocketUpgrade = (request: Request): boolean =>
  (request.headers.get("upgrade") ?? "").toLowerCase() === "websocket";

export const tokenFromSubprotocol = (
  request: Request,
): { token: string; ticket: string; offered: boolean } => {
  const raw = request.headers.get("sec-websocket-protocol") ?? "";
  let token = "";
  let ticket = "";
  let offered = false;
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value === SUBPROTOCOL) offered = true;
    else if (value.startsWith(SOCKET_TICKET_SUBPROTOCOL_PREFIX)) {
      ticket = value.slice(SOCKET_TICKET_SUBPROTOCOL_PREFIX.length);
    } else if (value.startsWith(SUBPROTOCOL_TOKEN_PREFIX)) {
      token = value.slice(SUBPROTOCOL_TOKEN_PREFIX.length);
    }
  }
  return { token, ticket, offered };
};

type SocketAttachment = {
  v: 1;
  ownerId: string;
  subject: string;
  sessionId: string;
  issuedAtMs?: number;
  issuer: string;
  authExpiresAtMs: number;
  protocol: number;
  connectedAtMs: number;
  rateWindowStartMs: number;
  rateTotal: number;
  rateBackfill: number;
  rateCancel: number;
  rateAuth: number;
  pi?: boolean;
};

const readAttachment = (ws: WebSocket): SocketAttachment | null => {
  try {
    const raw = ws.deserializeAttachment() as SocketAttachment | null;
    if (!raw || raw.v !== 1 || typeof raw.ownerId !== "string") return null;
    return raw;
  } catch {
    return null;
  }
};

const rollRateWindow = (attachment: SocketAttachment, nowMs: number): void => {
  if (nowMs - attachment.rateWindowStartMs < 60_000) return;
  attachment.rateWindowStartMs = nowMs;
  attachment.rateTotal = 0;
  attachment.rateBackfill = 0;
  attachment.rateCancel = 0;
  attachment.rateAuth = 0;
};

const MAX_TRACKED_TURNS = 4;
const MAX_TRACKED_TOOLS = 16;

type TurnToolState = {
  turnId: string;
  tools: Map<string, ToolInput>;
};

const WEBSOCKET_OPEN = 1;

class ConversationHubImpl implements ConversationHub {
  private readonly turns = new Map<string, TurnToolState>();
  private readonly warned = new WeakMap<WebSocket, number>();

  constructor(private readonly deps: ConversationHubDeps) {
    try {
      this.deps.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong"),
      );
    } catch (error) {
      this.deps.log("error", "conversation_autoresponse_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async upgrade(request: Request, identity: SocketIdentity): Promise<Response> {
    const conversationId = this.deps.conversationId();
    if (!isWebSocketUpgrade(request)) {
      return Response.json(
        { error: "This endpoint speaks WebSocket only." },
        { status: 426, headers: { "cache-control": "no-store" } },
      );
    }
    const url = new URL(request.url);
    const protocolParam = url.searchParams.get("protocol");
    if (protocolParam !== null && Number(protocolParam) !== PROTOCOL_VERSION) {
      return refuseUpgrade(
        request,
        CLOSE_PROTOCOL_VERSION,
        "This app is out of date. Reload to keep chatting.",
      );
    }

    let head = this.deps.reader.head();
    if (head.deleted) {
      return refuseUpgrade(
        request,
        CLOSE_DELETED,
        "This conversation was deleted.",
      );
    }

    let ownerId = this.deps.reader.ownerId();
    if (!ownerId) {
      let record: Awaited<ReturnType<typeof this.deps.lookupOwner>>;
      try {
        record = await this.deps.lookupOwner(identity);
      } catch (error) {
        this.deps.log("error", "conversation_owner_lookup_failed", {
          conversationId,
          message: error instanceof Error ? error.message : String(error),
        });
        return refuseUpgrade(
          request,
          CLOSE_INTERNAL,
          "Stella couldn't open this conversation. Try again.",
          { retryable: true },
        );
      }
      if (!record) {
        return refuseUpgrade(
          request,
          CLOSE_NOT_FOUND,
          "That conversation no longer exists.",
        );
      }
      this.deps.reader.bindOwner(record);
      ownerId = record.ownerId;
      head = this.deps.reader.head();
    }
    if (ownerId !== identity.ownerId) {
      return refuseUpgrade(
        request,
        CLOSE_NOT_FOUND,
        "That conversation no longer exists.",
      );
    }

    if (!this.reserveSocketSlot()) {
      return refuseUpgrade(
        request,
        CLOSE_TOO_MANY_SOCKETS,
        "Too many devices are watching this conversation. Close one and try again.",
        { retryable: true },
      );
    }

    const pi =
      url.searchParams.get("pi") === "1" &&
      (await this.deps.pi?.enabled().catch(() => false)) === true;

    // The raw `${issuer}|${sub}` can exceed the platform's 256-char tag limit.
    const tag = `o:${(await sha256Hex(ownerId)).slice(0, 32)}`;

    const opening = await this.openingWindow(
      head,
      url.searchParams.get("since"),
      url.searchParams.get("epoch"),
    );

    if (
      this.deps.ctx.getWebSockets().length >= MAX_SOCKETS_PER_CONVERSATION
    ) {
      return refuseUpgrade(
        request,
        CLOSE_TOO_MANY_SOCKETS,
        "Too many devices are watching this conversation. Close one and try again.",
        { retryable: true },
      );
    }

    const pair = new WebSocketPair();
    const client = pair[0]!;
    const server = pair[1]!;
    const now = Date.now();
    const attachment: SocketAttachment = {
      v: 1,
      ownerId,
      subject: identity.subject,
      sessionId: identity.sessionId ?? "",
      ...(identity.issuedAtMs !== undefined ? { issuedAtMs: identity.issuedAtMs } : {}),
      issuer: request.headers.get(HEADER_ISSUER)?.trim() ?? "",
      authExpiresAtMs: identity.authExpiresAtMs,
      protocol: PROTOCOL_VERSION,
      connectedAtMs: now,
      rateWindowStartMs: now,
      rateTotal: 0,
      rateBackfill: 0,
      rateCancel: 0,
      rateAuth: 0,
      ...(pi ? { pi: true } : {}),
    };

    this.deps.ctx.acceptWebSocket(server, [tag]);
    server.serializeAttachment(attachment);
    this.deps.onSocketAuthenticated(ownerId);
    this.warned.set(server, attachment.authExpiresAtMs);

    const fresh = this.deps.reader.head();
    const records = opening.records;
    let delivered = records.length > 0 ? records[records.length - 1]!.seq : -1;
    if (delivered >= 0 && fresh.headSeq > delivered) {
      for (const record of this.deps.reader.newest(INITIAL_WINDOW_RECORDS)) {
        if (record.seq <= delivered) continue;
        if (record.seq !== delivered + 1) break;
        records.push(record);
        delivered = record.seq;
      }
    }

    this.sendFrame(server, {
      type: "ready",
      protocol: PROTOCOL_VERSION,
      conversationId,
      epoch: fresh.epoch,
      headSeq: fresh.headSeq,
      windowStartSeq: records[0]?.seq ?? fresh.headSeq + 1,
      floorSeq: fresh.floorSeq,
      title: fresh.title,
      activity: fresh.activity,
      authExpiresAtMs: attachment.authExpiresAtMs,
      serverTimeMs: now,
      live: this.liveSnapshot(),
      agents: this.runningAgents(),
    });
    if (opening.reset) {
      this.sendFrame(server, { type: "reset", reason: opening.reset });
    }
    if (opening.gap) this.sendFrame(server, opening.gap);
    for (const record of records) {
      this.sendFrame(server, { type: "record", ...record });
    }
    this.warned.delete(server);

    try {
      this.deps.onConnect();
    } catch (error) {
      this.deps.log("error", "conversation_on_connect_failed", {
        conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    this.deps.log("info", "conversation_socket_opened", {
      conversationId,
      headSeq: fresh.headSeq,
      delivered: records.length,
      reset: opening.reset ?? undefined,
      ...(pi ? { pi } : {}),
    });
    if (pi) this.deps.ctx.waitUntil(this.sendPiSnapshot(server));

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": SUBPROTOCOL },
    });
  }

  private reserveSocketSlot(): boolean {
    let sockets = this.deps.ctx.getWebSockets();
    if (sockets.length < MAX_SOCKETS_PER_CONVERSATION) return true;
    const now = Date.now();

    const candidates = sockets
      .map((ws) => {
        const seen = this.deps.ctx.getWebSocketAutoResponseTimestamp(ws);
        return {
          ws,
          lastAliveMs:
            seen?.getTime() ?? readAttachment(ws)?.connectedAtMs ?? now,
        };
      })
      .filter((entry) => now - entry.lastAliveMs > SOCKET_STALE_MS)
      .sort((a, b) => a.lastAliveMs - b.lastAliveMs);

    let freed = 0;
    const needed = sockets.length - MAX_SOCKETS_PER_CONVERSATION + 1;
    for (const entry of candidates) {
      if (freed >= needed) break;
      try {
        entry.ws.close(1001, "stale");
        freed += 1;
      } catch {
        freed += 1;
      }
    }
    sockets = this.deps.ctx.getWebSockets();
    return sockets.length < MAX_SOCKETS_PER_CONVERSATION;
  }

  private async openingWindow(
    head: JournalHead,
    sinceRaw: string | null,
    epochRaw: string | null,
  ): Promise<{
    records: JournalRecord[];
    reset: "epoch" | "window" | null;
    gap: GapFrame | null;
  }> {
    const newest = () => ({
      records: this.deps.reader.newest(INITIAL_WINDOW_RECORDS),
      reset: null as "epoch" | "window" | null,
      gap: null as GapFrame | null,
    });
    if (sinceRaw === null) return newest();
    const since = Number(sinceRaw);
    if (!Number.isFinite(since) || !Number.isInteger(since) || since < -1) {
      return newest();
    }
    if (epochRaw !== null && Number(epochRaw) !== head.epoch) {
      return { ...newest(), reset: "epoch" };
    }
    if (since > head.headSeq) return { ...newest(), reset: "epoch" };
    if (since + 1 < head.floorSeq) return { ...newest(), reset: "window" };
    if (head.headSeq - since > MAX_CATCH_UP_RECORDS) {
      return { ...newest(), reset: "window" };
    }
    if (since >= head.headSeq) {
      return { records: [], reset: null, gap: null };
    }
    const range = await this.deps.reader.readRange(
      since + 1,
      head.headSeq,
      MAX_RESUME_RECORDS,
    );
    const gap =
      range.missingBelowSeq !== undefined && range.missingBelowSeq > since + 1
        ? ({
            type: "gap",
            fromSeq: since + 1,
            toSeq: range.missingBelowSeq - 1,
            reason: "compacted",
          } satisfies GapFrame)
        : null;
    return { records: range.records, reset: null, gap };
  }

  private rawSend(ws: WebSocket, payload: string): void {
    try {
      ws.send(payload);
    } catch {
      // A closing socket throws on send.
    }
  }

  private sendFrame(ws: WebSocket, frame: ServerFrame): void {
    this.sendSerialized(ws, JSON.stringify(frame));
  }

  private sendSerialized(
    ws: WebSocket,
    payload: string,
    attachment: SocketAttachment | null = readAttachment(ws),
  ): void {
    if (!attachment) {
      try {
        ws.close(CLOSE_INTERNAL, closeReason(CLOSE_INTERNAL));
      } catch {
      }
      return;
    }
    const now = Date.now();
    if (now > attachment.authExpiresAtMs + AUTH_GRACE_MS) {
      this.rawSend(
        ws,
        JSON.stringify({
          type: "error",
          code: "token_expired",
          message: "Your session needs a refresh. Reconnecting…",
          retryable: true,
        } satisfies ErrorFrame),
      );
      try {
        ws.close(CLOSE_UNAUTHENTICATED, "token_expired");
      } catch {
      }
      return;
    }
    if (
      now > attachment.authExpiresAtMs - RE_AUTH_LEAD_MS &&
      this.warned.get(ws) !== attachment.authExpiresAtMs
    ) {
      this.warned.set(ws, attachment.authExpiresAtMs);
      this.rawSend(
        ws,
        JSON.stringify({
          type: "auth.expiring",
          atMs: attachment.authExpiresAtMs,
        } satisfies AuthExpiringFrame),
      );
    }
    this.rawSend(ws, payload);
  }

  private broadcast(frame: ServerFrame): void {
    const sockets = this.deps.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const payload = JSON.stringify(frame);
    for (const ws of sockets) this.sendSerialized(ws, payload);
  }

  private piSockets(): WebSocket[] {
    return this.deps.ctx.getWebSockets().filter((ws) => readAttachment(ws)?.pi === true);
  }

  piSocketCount(): number {
    return this.piSockets().length;
  }

  private async sendPiSnapshot(ws: WebSocket): Promise<void> {
    try {
      const view = await this.deps.pi!.attach();
      this.sendFrame(ws, { type: "pi.snapshot", ...view });
    } catch (error) {
      this.deps.log("error", "conversation_pi_snapshot_failed", {
        conversationId: this.deps.conversationId(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  broadcastPi(events: readonly unknown[]): void {
    try {
      let payload: string | undefined;
      for (const ws of this.deps.ctx.getWebSockets()) {
        const attachment = readAttachment(ws);
        if (attachment?.pi !== true) continue;
        payload ??= JSON.stringify({ type: "pi.events", events } satisfies PiEventsFrame);
        this.sendSerialized(ws, payload, attachment);
      }
    } catch (error) {
      this.deps.log("error", "conversation_pi_broadcast_failed", {
        conversationId: this.deps.conversationId(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handlePiOlder(
    ws: WebSocket,
    attachment: SocketAttachment,
    frame: { requestId?: unknown; beforeEntryId?: unknown },
  ): Promise<void> {
    const requestId = typeof frame.requestId === "string" ? frame.requestId.slice(0, 128) : "";
    const before = frame.beforeEntryId;
    if (!attachment.pi || !this.deps.pi || typeof before !== "number" || !Number.isSafeInteger(before) || before < 1) {
      this.closeWith(ws, CLOSE_BAD_REQUEST, "Unsupported message.");
      return;
    }
    const page = await this.deps.pi.older(before);
    this.sendFrame(ws, { type: "pi.older", requestId, ...page });
  }

  broadcastRecord(record: JournalRecord): void {
    try {
      if (record.kind === "turn" && record.phase === "started") {
        this.turnState(record.turnId);
      }
      this.broadcast({ type: "record", ...record });
      this.agentsChanged();
      if (record.kind === "turn" && record.phase !== "started") {
        this.endTurn(record.turnId);
      }
    } catch (error) {
      this.deps.log("error", "conversation_broadcast_failed", {
        conversationId: this.deps.conversationId(),
        seq: record.seq,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private agentsHeard: string | undefined;

  agentsChanged(): void {
    try {
      if (this.deps.ctx.getWebSockets().length === 0) {
        this.agentsHeard = undefined;
        return;
      }
      const agents = this.runningAgents();
      const heard = JSON.stringify(agents.map((agent) => [agent.agentId, agent.attemptGeneration ?? 0, agent.title]));
      if (heard === this.agentsHeard) return;
      this.agentsHeard = heard;
      this.broadcast({ type: "agents", agents, atMs: Date.now() });
    } catch (error) {
      this.deps.log("error", "conversation_agents_frame_failed", {
        conversationId: this.deps.conversationId(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  broadcastBrain(record: PiBrainRecord | null): void {
    try {
      this.broadcast({ type: "brain", record });
    } catch (error) {
      this.deps.log("error", "conversation_brain_frame_failed", {
        conversationId: this.deps.conversationId(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  broadcastTool(tool: ToolInput): void {
    try {
      const turn = this.turnState(tool.turnId);
      if (tool.phase === "end") turn.tools.delete(tool.toolCallId);
      else {
        if (turn.tools.size >= MAX_TRACKED_TOOLS) {
          const oldest = turn.tools.keys().next();
          if (!oldest.done) turn.tools.delete(oldest.value);
        }
        turn.tools.set(tool.toolCallId, tool);
      }
      this.broadcast({ type: "tool", ...tool });
    } catch (error) {
      this.deps.log("error", "conversation_tool_frame_failed", {
        turnId: tool.turnId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  endTurn(turnId: string): void {
    try {
      this.turns.delete(turnId);
    } catch {
    }
  }

  private turnState(turnId: string): TurnToolState {
    const existing = this.turns.get(turnId);
    if (existing) return existing;
    while (this.turns.size >= MAX_TRACKED_TURNS) {
      const oldest = this.turns.keys().next();
      if (oldest.done) break;
      this.endTurn(oldest.value);
    }
    const created: TurnToolState = { turnId, tools: new Map() };
    this.turns.set(turnId, created);
    return created;
  }

  private liveSnapshot(): LiveTurnSnapshot | null {
    const live = this.deps.reader.liveTurn();
    if (!live) return null;
    const turn = this.turns.get(live.turnId);
    const tools =
      live.tools.length > 0 ? live.tools : [...(turn?.tools.values() ?? [])];
    return {
      turnId: live.turnId,
      streamId: live.streamId,
      partialText: "",
      tools,
    };
  }

  private runningAgents(): AgentActivityEntry[] {
    try {
      return this.deps.reader.runningAgents(READY_RUNNING_AGENTS_LIMIT);
    } catch (error) {
      this.deps.log("error", "conversation_running_agents_failed", {
        conversationId: this.deps.conversationId(),
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async onMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      await this.handleMessage(ws, message);
    } catch (error) {
      this.deps.log("error", "conversation_socket_message_failed", {
        conversationId: this.deps.conversationId(),
        message: error instanceof Error ? error.message : String(error),
      });
      this.closeWith(
        ws,
        CLOSE_INTERNAL,
        "Something went wrong on that request. Reconnecting…",
        true,
      );
    }
  }

  private async handleMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    // "ping" never arrives here — the platform auto-response answers it
    // without waking the object. Anything binary is not part of this protocol.
    if (typeof message !== "string") {
      this.closeWith(ws, CLOSE_BAD_REQUEST, "Unsupported message.");
      return;
    }
    if (
      message.length > MAX_INCOMING_FRAME_BYTES ||
      utf8Length(message) > MAX_INCOMING_FRAME_BYTES
    ) {
      this.closeWith(ws, CLOSE_FRAME_TOO_LARGE, "That request was too large.");
      return;
    }
    const attachment = readAttachment(ws);
    if (!attachment) {
      this.closeWith(
        ws,
        CLOSE_INTERNAL,
        "This connection lost its session. Reconnecting…",
        true,
      );
      return;
    }
    const now = Date.now();
    rollRateWindow(attachment, now);
    attachment.rateTotal += 1;
    if (attachment.rateTotal > RATE_TOTAL_PER_MIN) {
      this.closeWith(
        ws,
        CLOSE_RATE_LIMITED,
        "Too many requests. Reconnecting in a moment.",
        true,
      );
      return;
    }

    let frame: ClientFrame;
    try {
      frame = JSON.parse(message) as ClientFrame;
    } catch {
      this.closeWith(ws, CLOSE_BAD_REQUEST, "Unreadable message.");
      return;
    }
    if (typeof frame !== "object" || frame === null) {
      this.closeWith(ws, CLOSE_BAD_REQUEST, "Unreadable message.");
      return;
    }

    switch (frame.type) {
      case "auth": {
        attachment.rateAuth += 1;
        if (attachment.rateAuth > RATE_AUTH_PER_MIN) {
          this.closeWith(
            ws,
            CLOSE_RATE_LIMITED,
            "Too many sign-in refreshes. Reconnecting in a moment.",
            true,
          );
          return;
        }
        ws.serializeAttachment(attachment);
        await this.handleAuth(ws, attachment, frame.token);
        return;
      }
      case "backfill": {
        attachment.rateBackfill += 1;
        if (attachment.rateBackfill > RATE_BACKFILL_PER_MIN) {
          this.closeWith(
            ws,
            CLOSE_RATE_LIMITED,
            "Too many history requests. Reconnecting in a moment.",
            true,
          );
          return;
        }
        ws.serializeAttachment(attachment);
        await this.handleBackfill(ws, frame);
        return;
      }
      case "cancel": {
        attachment.rateCancel += 1;
        if (attachment.rateCancel > RATE_CANCEL_PER_MIN) {
          this.closeWith(
            ws,
            CLOSE_RATE_LIMITED,
            "Too many stop requests. Reconnecting in a moment.",
            true,
          );
          return;
        }
        ws.serializeAttachment(attachment);
        await this.handleCancel(ws, frame);
        return;
      }
      case "pi.older": {
        attachment.rateBackfill += 1;
        if (attachment.rateBackfill > RATE_BACKFILL_PER_MIN) {
          this.closeWith(
            ws,
            CLOSE_RATE_LIMITED,
            "Too many history requests. Reconnecting in a moment.",
            true,
          );
          return;
        }
        ws.serializeAttachment(attachment);
        await this.handlePiOlder(ws, attachment, frame);
        return;
      }
      default:
        this.closeWith(ws, CLOSE_BAD_REQUEST, "Unsupported message.");
    }
  }

  private async handleAuth(
    ws: WebSocket,
    attachment: SocketAttachment,
    token: unknown,
  ): Promise<void> {
    if (typeof token !== "string" || token.length === 0) {
      this.closeWith(ws, CLOSE_BAD_REQUEST, "Missing sign-in token.");
      return;
    }
    if (!attachment.issuer) {
      this.deps.log("error", "conversation_reauth_no_issuer", {
        conversationId: this.deps.conversationId(),
      });
      this.closeWith(
        ws,
        CLOSE_INTERNAL,
        "Stella couldn't refresh this session. Reconnecting…",
        true,
      );
      return;
    }
    const verified = await this.deps.verifyToken(token);
    if (!verified.ok) {
      this.deps.log("error", "conversation_reauth_rejected", {
        conversationId: this.deps.conversationId(),
        reason: verified.reason,
      });
      this.closeWith(
        ws,
        verified.retryable ? CLOSE_INTERNAL : CLOSE_UNAUTHENTICATED,
        verified.retryable
          ? "Stella couldn't refresh this session. Reconnecting…"
          : "Your session needs a refresh. Reconnecting…",
        true,
      );
      return;
    }
    if (
      verified.token.subject !== attachment.subject ||
      verified.token.ownerId !== attachment.ownerId
    ) {
      this.closeWith(ws, CLOSE_FORBIDDEN, "That sign-in doesn't match.");
      return;
    }
    attachment.authExpiresAtMs = verified.token.expiresAtMs;
    attachment.sessionId = verified.token.sessionId;
    attachment.issuedAtMs = verified.token.issuedAtMs;
    ws.serializeAttachment(attachment);
    this.warned.delete(ws);
    this.deps.onSocketAuthenticated(attachment.ownerId);
  }

  private async handleBackfill(
    ws: WebSocket,
    frame: { requestId?: unknown; fromSeq?: unknown; toSeq?: unknown },
  ): Promise<void> {
    const requestId =
      typeof frame.requestId === "string" ? frame.requestId.slice(0, 64) : "";
    const fromRaw = Number(frame.fromSeq);
    const toRaw = Number(frame.toSeq);
    if (!requestId || !Number.isInteger(fromRaw) || !Number.isInteger(toRaw)) {
      this.closeWith(ws, CLOSE_BAD_REQUEST, "Malformed history request.");
      return;
    }
    const head = this.deps.reader.head();
    let from = Math.max(0, fromRaw);
    const to = Math.min(toRaw, head.headSeq);
    if (from > to) {
      this.sendFrame(ws, {
        type: "backfill",
        requestId,
        fromSeq: from,
        toSeq: to,
        complete: true,
        records: [],
      });
      return;
    }
    if (from < head.floorSeq) {
      this.sendFrame(ws, {
        type: "gap",
        fromSeq: from,
        toSeq: Math.min(to, head.floorSeq - 1),
        reason: "compacted",
      });
      from = head.floorSeq;
      if (from > to) {
        this.sendFrame(ws, {
          type: "backfill",
          requestId,
          fromSeq: from,
          toSeq: to,
          complete: true,
          records: [],
        });
        return;
      }
    }
    const range = await this.deps.reader.readRange(
      from,
      to,
      BACKFILL_BATCH_RECORDS,
    );
    if (range.missingBelowSeq !== undefined && range.missingBelowSeq > from) {
      this.sendFrame(ws, {
        type: "gap",
        fromSeq: from,
        toSeq: range.missingBelowSeq - 1,
        reason: "compacted",
      });
    }
    const records: JournalRecord[] = [];
    let bytes = 0;
    let truncated = false;
    for (const record of range.records) {
      const size = utf8Length(JSON.stringify(record));
      if (records.length > 0 && bytes + size > BACKFILL_BATCH_BYTES) {
        truncated = true;
        break;
      }
      bytes += size;
      records.push(record);
    }
    const last = records.length > 0 ? records[records.length - 1]!.seq : to;
    this.sendFrame(ws, {
      type: "backfill",
      requestId,
      fromSeq: from,
      toSeq: last,
      complete: range.complete && !truncated,
      records,
    });
  }

  private async handleCancel(
    ws: WebSocket,
    frame: { turnId?: unknown },
  ): Promise<void> {
    const turnId =
      typeof frame.turnId === "string" ? frame.turnId.slice(0, 128) : "";
    if (!turnId) {
      this.closeWith(ws, CLOSE_BAD_REQUEST, "Malformed stop request.");
      return;
    }
    try {
      await this.deps.cancelTurn(turnId);
    } catch (error) {
      this.deps.log("error", "conversation_cancel_failed", {
        conversationId: this.deps.conversationId(),
        turnId,
        message: error instanceof Error ? error.message : String(error),
      });
      this.sendFrame(ws, {
        type: "error",
        code: "cancel_failed",
        message: "Stella couldn't stop that. Try again.",
        retryable: true,
      });
    }
  }

  async onClose(
    ws: WebSocket,
    code: number,
    _reason: string,
    wasClean: boolean,
  ): Promise<void> {
    // 1006 is synthetic and 1001–1015 are reserved for the protocol itself.
    try {
      ws.close(code >= 3000 && code <= 4999 ? code : 1000, "");
    } catch {
    }
    this.warned.delete(ws);
    if (readAttachment(ws)?.pi && this.piSockets().every((socket) => socket === ws)) {
      try {
        this.deps.pi?.detach();
      } catch {
      }
    }
    if (!wasClean) {
      this.deps.log("info", "conversation_socket_closed", {
        conversationId: this.deps.conversationId(),
        code,
        clean: false,
      });
    }
  }

  async onError(ws: WebSocket, error: unknown): Promise<void> {
    this.warned.delete(ws);
    this.deps.log("error", "conversation_socket_error", {
      conversationId: this.deps.conversationId(),
      message: error instanceof Error ? error.message : String(error),
    });
  }

  closeAll(code: number): void {
    for (const ws of this.deps.ctx.getWebSockets()) {
      this.closeWith(
        ws,
        code,
        code === CLOSE_DELETED
          ? "This conversation was deleted."
          : "This connection was closed.",
      );
    }
    this.turns.clear();
  }

  closeRevokedSockets(revocations: SessionRevocations): { closed: number; open: number } {
    const counts = { closed: 0, open: 0 };
    for (const ws of this.deps.ctx.getWebSockets()) {
      if (ws.readyState !== WEBSOCKET_OPEN) continue;
      const attachment = readAttachment(ws);
      if (attachment && !sessionRevokedBy(revocations, attachment)) {
        counts.open += 1;
        continue;
      }
      this.closeWith(ws, CLOSE_UNAUTHENTICATED, "You were signed out.");
      counts.closed += 1;
    }
    return counts;
  }

  private closeWith(
    ws: WebSocket,
    code: number,
    message: string,
    retryable = false,
  ): void {
    this.rawSend(
      ws,
      JSON.stringify({
        type: "error",
        code: closeReason(code),
        message,
        retryable,
      } satisfies ErrorFrame),
    );
    try {
      ws.close(code, closeReason(code));
    } catch {
    }
    this.warned.delete(ws);
  }
}

registerConversationHubFactory((deps: ConversationHubDeps) =>
  new ConversationHubImpl(deps),
);
