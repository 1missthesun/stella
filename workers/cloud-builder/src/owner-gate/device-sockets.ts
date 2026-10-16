import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import {
  deviceRequestErrorResponse,
  DeviceRequestRelay,
} from "../device-request-relay.js";
import {
  DEVICE_REQUEST_CLOUD_ASKER,
  DEVICE_REQUEST_LIMITS,
  type DeviceRequestDeviceFrame,
  type DeviceRequestErrorCode,
  type DeviceRequestMethod,
  isDeviceRequestMethod,
} from "@stella/contracts/turn-plane/device-requests";
import {
  DEVICE_PRESENCE_CLOSE,
  DEVICE_PRESENCE_PROTOCOL_VERSION,
  DEVICE_PRESENCE_STALE_AFTER_MS,
  type DevicePresenceDeviceFrame,
  type DevicePresenceServerFrame,
  type DeviceRemoteExecution,
  SELECTED_DEVICE_NEEDS_CONSENT,
} from "@stella/contracts/turn-plane/placement";
import {
  type DevicePresenceState,
  MAX_DEVICE_ID_CHARS,
} from "../dispatch-policy.js";
import {
  HEADER_PRESENCE_DEVICE_ID,
  HEADER_DEVICE_REQUEST_MOBILE_ID,
  HEADER_DEVICE_REQUEST_ID,
  HEADER_DEVICE_REQUEST_METHOD,
  AGENT_MESSAGE_OUTCOMES,
  AGENT_STOP_OUTCOMES,
} from "./constants.js";
import {
  type PresenceAttachment,
  presenceTag,
  devicePresenceProofMessage,
  verifyDevicePresenceProof,
  parseAvailability,
  type PresenceRow,
  presenceState,
} from "./presence.js";
import { log, trustedOwnerCaller } from "./support.js";
import { OwnerGateBase } from "./gate-base.js";

const WEBSOCKET_OPEN = 1;

export abstract class OwnerGateDeviceSockets extends OwnerGateBase {
  /**
   * Open sockets, optionally one device's. A socket this side closed stays in
   * `getWebSockets()` until its peer answers the close, and a peer that is
   * gone (a laptop asleep, a phone in the background) never does. Counting
   * those made every alarm drop the same stale socket again and re-arm one
   * second out, which kept the object awake around the clock.
   */
  protected sockets(deviceId?: string): WebSocket[] {
    let sockets: WebSocket[];
    try {
      sockets = deviceId
        ? this.ctx.getWebSockets(presenceTag(deviceId))
        : this.ctx.getWebSockets();
    } catch {
      return [];
    }
    // A proven connection is live only while its device's presence row names
    // it as connected: dropping a socket writes that row, while a socket this
    // side closed can come back from hibernation reporting OPEN with its old
    // attachment (the peer never answered the close). Reading the row keeps a
    // dropped socket from being dropped, and alarmed on, again every wake.
    const current = new Map<string, string | null>();
    const currentConnection = (deviceId: string): string | null => {
      if (!current.has(deviceId)) {
        current.set(
          deviceId,
          this.ctx.storage.sql
            .exec<{ connection_id: string }>(
              `SELECT connection_id FROM device_presence WHERE device_id = ? AND connected = 1`,
              deviceId,
            )
            .toArray()[0]?.connection_id ?? null,
        );
      }
      return current.get(deviceId) ?? null;
    };
    return sockets.filter((socket) => {
      if (socket.readyState !== WEBSOCKET_OPEN) return false;
      const attachment = this.attachment(socket);
      if (!attachment) return true;
      if (attachment.closedAtMs !== undefined) return false;
      return (
        attachment.phase !== "connected" ||
        currentConnection(attachment.deviceId) === attachment.connectionId
      );
    });
  }

  protected attachment(socket: WebSocket): PresenceAttachment | null {
    try {
      const value = socket.deserializeAttachment() as PresenceAttachment | null;
      return value && value.v === 1 ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * When a proven device was last heard from. Current devices' keepalives
   * are answered by the platform without waking this object, so the time of
   * the last auto-response counts alongside the last frame handled here.
   */
  protected lastSeenAt(
    socket: WebSocket,
    attachment: PresenceAttachment,
  ): number {
    let seen = attachment.lastSeenAtMs;
    if (attachment.phase !== "connected") return seen;
    try {
      const answered = this.ctx.getWebSocketAutoResponseTimestamp(socket);
      if (answered) seen = Math.max(seen, answered.getTime());
    } catch {
      // No timestamp; the last handled frame stands.
    }
    return seen;
  }

  protected send(socket: WebSocket, frame: DevicePresenceServerFrame): void {
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      // The peer is gone; the close path cleans up.
    }
  }

  protected closeSocket(socket: WebSocket, code: number, reason: string): void {
    const attachment = this.attachment(socket);
    if (attachment && attachment.closedAtMs === undefined) {
      try {
        socket.serializeAttachment({ ...attachment, closedAtMs: Date.now() });
      } catch {
        // Already gone.
      }
    }
    try {
      socket.close(code, reason);
    } catch {
      // Already gone.
    }
  }

  protected liveSocket(deviceId: string): WebSocket | null {
    const socket = this.connectedSocket(deviceId);
    if (!socket) return null;
    const presence = this.presenceRow(deviceId);
    return presence?.connected &&
      presence.lastSeenAt + DEVICE_PRESENCE_STALE_AFTER_MS > Date.now()
      ? socket
      : null;
  }

  /**
   * The one connected, proven socket for a device, if it has one: the open
   * socket of the connection presence names. A replaced socket stays listed
   * while its close waits on a peer that is gone, still marked connected, and
   * anything sent to it is lost.
   */
  protected connectedSocket(deviceId: string): WebSocket | null {
    const current = this.ctx.storage.sql
      .exec<{ connection_id: string }>(
        `SELECT connection_id FROM device_presence WHERE device_id = ? AND connected = 1`,
        deviceId,
      )
      .toArray()[0]?.connection_id;
    if (!current) return null;
    for (const socket of this.sockets(deviceId)) {
      if (socket.readyState !== WEBSOCKET_OPEN) continue;
      const attachment = this.attachment(socket);
      if (
        attachment?.phase === "connected" &&
        attachment.connectionId === current
      ) {
        return socket;
      }
    }
    return null;
  }

  protected async handleDeviceFrame(
    socket: WebSocket,
    attachment: PresenceAttachment,
    frame: DevicePresenceDeviceFrame,
    now: number,
  ): Promise<void> {
    if (frame.type === "begin") {
      if (attachment.phase !== "challenged") {
        this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
        return;
      }
      const presenceSessionId =
        typeof frame.presenceSessionId === "string"
          ? frame.presenceSessionId.trim()
          : "";
      const availability = parseAvailability(frame.availability);
      if (
        !presenceSessionId ||
        presenceSessionId.length > 128 ||
        frame.protocolVersion !== DEVICE_PRESENCE_PROTOCOL_VERSION ||
        !availability
      ) {
        this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
        return;
      }
      attachment.presenceSessionId = presenceSessionId;
      attachment.availability = availability;
      attachment.phase = "begun";
      attachment.lastSeenAtMs = now;
      socket.serializeAttachment(attachment);
      return;
    }
    if (frame.type === "proof") {
      if (attachment.phase !== "begun" || !attachment.presenceSessionId) {
        this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
        return;
      }
      const signature =
        typeof frame.signature === "string" ? frame.signature.trim() : "";
      let snapshot: OwnerSnapshot;
      try {
        snapshot = await this.snapshot({ now });
      } catch {
        this.closeSocket(
          socket,
          DEVICE_PRESENCE_CLOSE.internal,
          "presence_unavailable",
        );
        return;
      }
      const device = (snapshot.devices ?? []).find(
        (candidate) => candidate.deviceId === attachment.deviceId,
      );
      const verified =
        Boolean(device) &&
        Boolean(signature) &&
        (await verifyDevicePresenceProof({
          publicKey: device!.publicKey,
          message: devicePresenceProofMessage({
            connectionId: attachment.connectionId,
            nonce: attachment.nonce,
          }),
          signature,
        }));
      if (!verified) {
        log("error", "device_presence_proof_rejected", {
          ownerId: this.ownerId(),
          deviceId: attachment.deviceId,
          registered: Boolean(device),
        });
        this.closeSocket(
          socket,
          DEVICE_PRESENCE_CLOSE.proofRejected,
          "device_proof_rejected",
        );
        return;
      }
      for (const other of this.sockets(attachment.deviceId)) {
        if (other === socket) continue;
        this.deviceRequestRelay().onDeviceGone(attachment.deviceId, other);
        this.closeSocket(other, DEVICE_PRESENCE_CLOSE.replaced, "replaced");
      }
      attachment.phase = "connected";
      attachment.lastSeenAtMs = now;
      socket.serializeAttachment(attachment);
      this.writePresence(attachment, now, true);
      this.send(socket, {
        type: "connected",
        presenceSessionId: attachment.presenceSessionId,
        serverTimeMs: now,
      });
      if (attachment.availability?.ready) {
        this.offerAgainTo(attachment, now);
        await this.wakeWaitingSchedules(attachment.deviceId);
      }
      if (device!.remoteExecution === "asking") {
        this.send(socket, {
          type: "consent.request",
          requestedAt: device!.remoteExecutionAskedAt ?? now,
        });
      }
      const flushed = await this.ownerStore().internalCall(
        "agentThreads.flushDeviceMessages",
        { deviceId: attachment.deviceId },
      );
      if (!flushed.ok) {
        log("error", "device_agent_messages_flush_failed", {
          deviceId: attachment.deviceId,
          message: flushed.error.message,
        });
      }
      await this.scheduleAlarm(now);
      return;
    }
    if (attachment.phase !== "connected" || !attachment.presenceSessionId) {
      this.closeSocket(
        socket,
        DEVICE_PRESENCE_CLOSE.unauthorized,
        "unauthorized",
      );
      return;
    }
    attachment.lastSeenAtMs = now;
    if (frame.type === "ping") {
      // Older devices' JSON keepalive. The attachment is where it lands:
      // `presenceRow` reads last-seen from the socket, so this costs no write.
      socket.serializeAttachment(attachment);
      this.send(socket, { type: "pong", serverTimeMs: now });
      return;
    }
    if (frame.type === "availability") {
      const availability = parseAvailability(frame.availability);
      if (!availability) {
        this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
        return;
      }
      const becameReady = availability.ready && !attachment.availability?.ready;
      attachment.availability = availability;
      socket.serializeAttachment(attachment);
      this.writePresence(attachment, now, true);
      if (becameReady) {
        this.offerAgainTo(attachment, now);
        await this.wakeWaitingSchedules(attachment.deviceId);
      }
      return;
    }
    if (frame.type === "consent") {
      if (typeof frame.allow !== "boolean") {
        this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
        return;
      }
      socket.serializeAttachment(attachment);
      const written = await this.ownerStore().internalCall(
        "devices.setRemoteExecution",
        { deviceId: attachment.deviceId, enabled: frame.allow },
      );
      if (!written.ok) {
        log("error", "device_consent_write_failed", {
          deviceId: attachment.deviceId,
          message: written.error.message,
        });
        this.send(socket, {
          type: "error",
          code: written.error.code,
          message: written.error.message,
          retryable: true,
        });
      } else if (frame.allow) {
        await this.wakeWaitingSchedules(attachment.deviceId);
      }
      return;
    }
    socket.serializeAttachment(attachment);
    if (
      frame.type === "response.start" ||
      frame.type === "response.chunk" ||
      frame.type === "response.end" ||
      frame.type === "response.error"
    ) {
      this.deviceRequestRelay().onFrame(
        socket,
        attachment.deviceId,
        frame as DeviceRequestDeviceFrame,
      );
      return;
    }
    if (frame.type === "agent-message.ack") {
      const messageId =
        typeof frame.messageId === "string" ? frame.messageId : "";
      if (!messageId || !AGENT_MESSAGE_OUTCOMES.has(frame.outcome)) {
        this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
        return;
      }
      this.localAgentMessageAcks.get(`${attachment.deviceId}:${messageId}`)?.(
        frame.outcome,
      );
      return;
    }
    if (frame.type === "agent-pause.ack") {
      const commandId =
        typeof frame.commandId === "string" ? frame.commandId : "";
      if (!commandId || !AGENT_STOP_OUTCOMES.has(frame.outcome)) {
        this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
        return;
      }
      this.localAgentStopAcks.get(`${attachment.deviceId}:${commandId}`)?.(
        frame.outcome,
      );
      return;
    }
    await this.handleExecutorFrame(socket, attachment, frame, now);
  }

  protected deviceRequestRelay(): DeviceRequestRelay {
    return (this.deviceRequestRelayState ??= new DeviceRequestRelay({
      liveSocket: (deviceId) => this.liveSocket(deviceId),
      send: (socket, frame) => this.send(socket, frame),
      log: (level, event, fields) =>
        log(level, event, { ownerId: this.ownerId(), ...fields }),
    }));
  }

  protected async handleDeviceRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }
    const caller = trustedOwnerCaller(request);
    if (!caller || caller.ownerId !== this.ownerId()) {
      return deviceRequestErrorResponse(
        "unauthorized",
        "Missing verified identity.",
      );
    }
    const deviceId =
      request.headers.get(HEADER_PRESENCE_DEVICE_ID)?.trim() ?? "";
    const mobileDeviceId =
      request.headers.get(HEADER_DEVICE_REQUEST_MOBILE_ID)?.trim() ?? "";
    const requestId =
      request.headers.get(HEADER_DEVICE_REQUEST_ID)?.trim() ?? "";
    const method =
      request.headers.get(HEADER_DEVICE_REQUEST_METHOD)?.trim() ?? "";
    const paramsJson = await request.text();
    if (
      !deviceId ||
      deviceId.length > MAX_DEVICE_ID_CHARS ||
      !mobileDeviceId ||
      !requestId ||
      requestId.length > DEVICE_REQUEST_LIMITS.requestId ||
      !isDeviceRequestMethod(method) ||
      paramsJson.length > DEVICE_REQUEST_LIMITS.paramsBytes
    ) {
      return deviceRequestErrorResponse(
        "bad_request",
        "Malformed device request.",
      );
    }
    this.ensureSchema();
    return await this.deviceRequestRelay().open({
      deviceId,
      mobileDeviceId,
      requestId,
      method,
      paramsJson,
    });
  }

  async relayCloudDeviceRequest(input: {
    deviceId: string;
    method: DeviceRequestMethod;
    params: Record<string, unknown>;
  }): Promise<
    | { ok: true; value: unknown }
    | { ok: false; code: DeviceRequestErrorCode; message: string }
  > {
    const paramsJson = JSON.stringify(input.params);
    if (paramsJson.length > DEVICE_REQUEST_LIMITS.paramsBytes) {
      return { ok: false, code: "bad_request", message: "The request is too large to send to that computer." };
    }
    this.ensureSchema();
    const response = await this.deviceRequestRelay().open({
      deviceId: input.deviceId,
      mobileDeviceId: DEVICE_REQUEST_CLOUD_ASKER,
      requestId: `cloud:${crypto.randomUUID()}`,
      method: input.method,
      paramsJson,
    });
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      return {
        ok: false,
        code: "failed",
        message: error instanceof Error && error.message ? error.message : "The computer's answer broke off.",
      };
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, code: "failed", message: "The computer sent an answer that is not JSON." };
    }
    if (response.ok) return { ok: true, value: body };
    const error =
      body && typeof body === "object" && "error" in body
        ? ((body as { error?: { code?: unknown; message?: unknown } }).error ?? {})
        : {};
    return {
      ok: false,
      code: typeof error.code === "string" ? (error.code as DeviceRequestErrorCode) : "failed",
      message:
        typeof error.message === "string" && error.message
          ? error.message
          : `The computer could not answer (${response.status}).`,
    };
  }

  protected async dropSocket(
    socket: WebSocket,
    attachment: PresenceAttachment,
    code: number,
    reason: string,
    now: number,
  ): Promise<void> {
    if (attachment.phase === "connected") {
      this.markDisconnected(attachment, now);
    }
    this.deviceRequestRelay().onDeviceGone(attachment.deviceId, socket);
    this.closeSocket(socket, code, reason);
    await this.scheduleAlarm(now);
  }

  /** Scheduled runs that waited for this computer (Free plan) go now. */
  protected async wakeWaitingSchedules(deviceId: string): Promise<void> {
    const woke = await this.ownerStore().internalCall("schedules.computerBack", {
      deviceId,
    });
    if (!woke.ok) {
      log("error", "schedules_computer_back_failed", {
        deviceId,
        message: woke.error.message,
      });
    }
  }

  protected writePresence(
    attachment: PresenceAttachment,
    now: number,
    connected: boolean,
  ): void {
    const availability = attachment.availability ?? {
      ready: false,
      capabilities: [],
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO device_presence (
         device_id, presence_session_id, connection_id, connected, ready,
         chat_slots, agent_slots, capabilities, protocol_version,
         last_seen_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         presence_session_id = excluded.presence_session_id,
         connection_id = excluded.connection_id,
         connected = excluded.connected,
         ready = excluded.ready,
         chat_slots = excluded.chat_slots,
         agent_slots = excluded.agent_slots,
         capabilities = excluded.capabilities,
         protocol_version = excluded.protocol_version,
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`,
      attachment.deviceId,
      attachment.presenceSessionId ?? "",
      attachment.connectionId,
      connected ? 1 : 0,
      availability.ready ? 1 : 0,
      // Retained only for compatibility with existing SQLite tables.
      0,
      0,
      JSON.stringify(availability.capabilities),
      DEVICE_PRESENCE_PROTOCOL_VERSION,
      now,
      now,
    );
    this.ownerStore().wrote(["device_presence"]);
  }

  protected markDisconnected(
    attachment: PresenceAttachment,
    now: number,
  ): void {
    this.ctx.storage.sql.exec(
      `UPDATE device_presence
         SET connected = 0, ready = 0, updated_at = ?
       WHERE device_id = ? AND connection_id = ?`,
      now,
      attachment.deviceId,
      attachment.connectionId,
    );
    this.ownerStore().wrote(["device_presence"]);
  }

  protected presenceRow(deviceId: string): DevicePresenceState | undefined {
    const row = this.ctx.storage.sql
      .exec<PresenceRow>(
        `SELECT device_id, presence_session_id, connection_id, connected, ready,
                chat_slots, agent_slots, capabilities, protocol_version, last_seen_at
           FROM device_presence WHERE device_id = ?`,
        deviceId,
      )
      .toArray()[0];
    if (!row) return undefined;
    const state = presenceState(row);
    if (!state.connected) return state;
    for (const socket of this.sockets(deviceId)) {
      const attachment = this.attachment(socket);
      if (
        attachment?.phase === "connected" &&
        attachment.connectionId === row.connection_id
      ) {
        return {
          ...state,
          lastSeenAt: Math.max(
            state.lastSeenAt,
            this.lastSeenAt(socket, attachment),
          ),
        };
      }
    }
    return state;
  }

  protected selectedDeviceRefusal(args: {
    deviceId: string | null;
    now: number;
    remoteExecution?: DeviceRemoteExecution;
  }): {
    fallbackReason: string;
    errorCode: string;
    errorMessage: string;
  } | null {
    const presence = args.deviceId
      ? this.presenceRow(args.deviceId)
      : undefined;
    if (args.remoteExecution && args.remoteExecution !== "enabled") {
      return {
        fallbackReason: `selected-device-${args.remoteExecution}`,
        errorCode: SELECTED_DEVICE_NEEDS_CONSENT,
        errorMessage:
          args.remoteExecution === "declined"
            ? "That computer is set not to accept work from your other devices. Allow it on that computer, in its device list."
            : "That computer has not agreed to run work sent from elsewhere yet. It is asking on its own screen.",
      };
    }
    if (
      !args.deviceId ||
      !presence?.connected ||
      presence.lastSeenAt + DEVICE_PRESENCE_STALE_AFTER_MS <= args.now
    ) {
      return {
        fallbackReason: "selected-device-offline",
        errorCode: "SELECTED_DEVICE_OFFLINE",
        errorMessage: "The selected computer is offline.",
      };
    }
    if (!presence.ready) {
      return {
        fallbackReason: "selected-device-unavailable",
        errorCode: "SELECTED_DEVICE_UNAVAILABLE",
        errorMessage:
          "The selected computer is online but isn't accepting work right now. It may still be starting up, be signed out, have cloud sync off, or not allow work from other devices.",
      };
    }
    return null;
  }

  protected async requestDeviceConsent(args: {
    deviceId: string;
    remoteExecution: DeviceRemoteExecution;
    requesterLabel?: string;
    now: number;
  }): Promise<void> {
    if (args.remoteExecution === "enabled") return;
    const recorded = await this.ownerStore().internalCall(
      "devices.requestRemoteExecution",
      { deviceId: args.deviceId },
    );
    if (!recorded.ok) {
      log("error", "device_consent_request_failed", {
        deviceId: args.deviceId,
        message: recorded.error.message,
      });
      return;
    }
    this.askDeviceConsent(args.deviceId, args.now, args.requesterLabel);
  }

  protected askDeviceConsent(
    deviceId: string,
    requestedAt: number,
    requesterLabel?: string,
  ): void {
    const socket = this.connectedSocket(deviceId);
    if (!socket) return;
    this.send(socket, {
      type: "consent.request",
      requestedAt,
      ...(requesterLabel ? { requesterLabel } : {}),
    });
  }

  protected async expirePresence(now: number): Promise<void> {
    for (const socket of this.sockets()) {
      const attachment = this.attachment(socket);
      if (!attachment) continue;
      if (attachment.authExpiresAtMs <= now) {
        await this.dropSocket(
          socket,
          attachment,
          DEVICE_PRESENCE_CLOSE.stale,
          "stale",
          now,
        );
        continue;
      }
      if (
        this.lastSeenAt(socket, attachment) + DEVICE_PRESENCE_STALE_AFTER_MS <=
        now
      ) {
        await this.dropSocket(
          socket,
          attachment,
          DEVICE_PRESENCE_CLOSE.stale,
          "stale",
          now,
        );
      }
    }
  }

  abstract snapshot(options?: {
    refresh?: boolean;
    now?: number;
  }): Promise<OwnerSnapshot>;
  protected abstract offerAgainTo(
    attachment: PresenceAttachment,
    now: number,
  ): void;
  protected abstract handleExecutorFrame(
    socket: WebSocket,
    attachment: PresenceAttachment,
    frame: DevicePresenceDeviceFrame,
    now: number,
  ): Promise<void>;
}
