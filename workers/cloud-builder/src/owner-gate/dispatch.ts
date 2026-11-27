import {
  type CloudChatHandoff,
  cloudChatHandoffKey,
} from "../cloud-chat-admission.js";
import { cancelCloudAgentAttempt } from "../cloud-agent-dispatch.js";
import { parseDeviceAgentDispatchKey } from "../owner-store/gate-host.js";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import { CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE } from "@stella/contracts/backend/billing";
import {
  DEVICE_PRESENCE_CLOSE,
  DEVICE_PRESENCE_STALE_AFTER_MS,
  type DevicePresenceDeviceFrame,
  type DeviceRemoteExecution,
  DISPATCH_ACCEPTED_LEASE_MS,
  DISPATCH_CLAIM_LEASE_MS,
  DISPATCH_OFFER_WINDOW_MS,
  DISPATCH_RECONNECT_GRACE_MS,
  type DispatchError,
  type DispatchState,
  type ExecutionCapability,
  type ExecutionKind,
} from "@stella/contracts/turn-plane/placement";
import {
  type DevicePresenceState,
  type DeviceRegistration,
  FAILOVER_REASON_PREFIX,
  failsOverToDevices,
  isDispatchTransition,
  isEligibleDevice,
  isOwnScheduledWork,
  isOwnSend,
  runsExecutionOn,
  isTerminalDispatchState,
  MAX_OFFERS_PER_DISPATCH,
} from "../dispatch-policy.js";
import type {
  DispatchPatch,
  DispatchRow,
  DispatchTransition,
} from "./types.js";
import {
  DISPATCH_RECONCILE_MAX_MS,
  DISPATCH_STOP_HOLD_MS,
  DISPATCH_RENEW_WRITE_BELOW_MS,
  ALARM_BACKOFF_KEY,
  ALARM_HOT_STREAK_KEY,
  type AlarmBackoff,
  ALARM_HOT_REARM_MS,
  ALARM_HOT_STREAK_LIMIT,
  ALARM_MAX_BACKOFF_MS,
  ALARM_MIN_DELAY_MS,
} from "./constants.js";
import type { PresenceAttachment } from "./presence.js";
import {
  OwnerGateSnapshotError,
  log,
  snapshotAllowsCloudSandbox,
  dispatchSummary,
  fail,
} from "./support.js";
import { OwnerGateDeviceSockets } from "./device-sockets.js";


const FAILOVER_MAX_DEVICES = 3;

const NEVER_STARTED_STATES: ReadonlySet<DispatchState> = new Set<DispatchState>(["offering", "computer_claimed"]);

export abstract class OwnerGateDispatch extends OwnerGateDeviceSockets {
  protected dispatchRow(dispatchId: string): DispatchRow | undefined {
    return this.ctx.storage.sql
      .exec<DispatchRow>(
        `SELECT * FROM dispatches WHERE dispatch_id = ?`,
        dispatchId,
      )
      .toArray()[0];
  }

  protected notifyExecutor(row: DispatchRow): void {
    if (!row.executor_device_id) return;
    const socket = this.connectedSocket(row.executor_device_id);
    if (!socket) return;
    this.send(socket, { type: "dispatch", dispatch: dispatchSummary(row) });
  }

  protected async transitionDispatch(
    row: DispatchRow,
    to: DispatchState,
    patch: DispatchPatch,
    now: number,
    options: { notifyExecutor?: boolean } = {},
  ): Promise<DispatchTransition> {
    const from = row.state;
    if (!isDispatchTransition(from, to)) {
      log("error", "dispatch_transition_illegal", {
        dispatchId: row.dispatch_id,
        from,
        to,
      });
      return { applied: false, row: this.dispatchRow(row.dispatch_id) ?? row };
    }
    const columns = Object.keys(patch) as Array<keyof DispatchPatch>;
    const next = this.ctx.storage.sql
      .exec<DispatchRow>(
        `UPDATE dispatches SET ${[
          "state = ?",
          ...columns.map((column) => `${column} = ?`),
          "revision = revision + 1",
          "updated_at = ?",
        ].join(", ")}
          WHERE dispatch_id = ? AND state = ?
          RETURNING *`,
        to,
        ...columns.map((column) => patch[column] ?? null),
        now,
        row.dispatch_id,
        from,
      )
      .toArray()[0];
    if (!next) {
      const current = this.dispatchRow(row.dispatch_id) ?? row;
      log("info", "dispatch_transition_lost", {
        dispatchId: row.dispatch_id,
        from,
        to,
        current: current.state,
      });
      return { applied: false, row: current };
    }
    if (options.notifyExecutor !== false) this.notifyExecutor(next);
    if (!isTerminalDispatchState(from) && isTerminalDispatchState(to)) {
      await this.reportDeviceAgentSettled(next);
      await this.reportScheduledRunSettled(next, from);
    }
    return { applied: true, row: next };
  }

  protected setGateHeld(dispatchId: string, held: boolean): void {
    this.ctx.storage.sql.exec(
      `UPDATE dispatches SET gate_held = ?, revision = revision + 1,
         updated_at = ? WHERE dispatch_id = ?`,
      held ? 1 : 0,
      Date.now(),
      dispatchId,
    );
  }

  protected async reportDeviceAgentSettled(row: DispatchRow): Promise<void> {
    const key =
      row.kind === "agent"
        ? parseDeviceAgentDispatchKey(row.idempotency_key)
        : null;
    if (!key) return;
    const response = await this.ownerStore().internalCall(
      "agentThreads.deviceSettled",
      {
        turnId: key.turnId,
        requeue: key.requeue,
        state: row.state,
        ...(row.error_code ? { errorCode: row.error_code } : {}),
        ...(row.result_json ? { resultJson: row.result_json } : {}),
        ...(row.error_message ? { errorMessage: row.error_message } : {}),
      },
    );
    if (!response.ok) {
      log("error", "device_agent_settle_failed", {
        dispatchId: row.dispatch_id,
        message: response.error.message,
      });
    }
  }

  protected async reportScheduledRunSettled(row: DispatchRow, from: DispatchState): Promise<void> {
    if (row.ingress !== "schedule") return;
    const response = await this.ownerStore().internalCall("schedules.runSettled", {
      clientMsgId: row.idempotency_key,
      state: row.state,
      started: row.started_at !== null || !NEVER_STARTED_STATES.has(from),
      ...(row.executor_device_id ? { deviceId: row.executor_device_id } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {}),
      ...(row.error_message ? { errorMessage: row.error_message.slice(0, 2_000) } : {}),
      ...(row.state === "canceled" && row.cancel_request_id ? { onPurpose: true } : {}),
    });
    if (!response.ok) {
      log("error", "scheduled_run_settle_failed", {
        dispatchId: row.dispatch_id,
        message: response.error.message,
      });
    }
  }

  protected openOffers(dispatchId: string): Array<{
    device_id: string;
    presence_session_id: string;
  }> {
    return this.ctx.storage.sql
      .exec<{ device_id: string; presence_session_id: string }>(
        `SELECT device_id, presence_session_id FROM dispatch_offers
          WHERE dispatch_id = ? AND status = 'open'`,
        dispatchId,
      )
      .toArray();
  }

  protected withdrawOffers(
    dispatchId: string,
    keepDeviceId: string | null,
    reason: string,
    now: number,
  ): void {
    for (const offer of this.openOffers(dispatchId)) {
      if (keepDeviceId && offer.device_id === keepDeviceId) continue;
      this.ctx.storage.sql.exec(
        `UPDATE dispatch_offers SET status = 'withdrawn', updated_at = ?
          WHERE dispatch_id = ? AND device_id = ?`,
        now,
        dispatchId,
        offer.device_id,
      );
      const socket = this.connectedSocket(offer.device_id);
      if (socket) {
        this.send(socket, { type: "offer.withdrawn", dispatchId, reason });
      }
    }
  }

  protected eligibleDevices(args: {
    snapshot: OwnerSnapshot;
    deviceIds: readonly string[];
    kind: ExecutionKind;
    requiredCapabilities: readonly ExecutionCapability[];
    now: number;
    ownWorkOf?: string;
  }): DevicePresenceState[] {
    const registrations = new Map<string, DeviceRegistration>();
    for (const device of args.snapshot.devices ?? []) {
      registrations.set(device.deviceId, device);
    }
    const eligible: DevicePresenceState[] = [];
    for (const deviceId of args.deviceIds) {
      const presence = this.presenceRow(deviceId);
      if (
        isEligibleDevice({
          presence,
          device: registrations.get(deviceId),
          kind: args.kind,
          requiredCapabilities: args.requiredCapabilities,
          now: args.now,
          staleAfterMs: DEVICE_PRESENCE_STALE_AFTER_MS,
          ownWork: args.ownWorkOf === deviceId,
        })
      ) {
        eligible.push(presence!);
      }
      if (eligible.length >= MAX_OFFERS_PER_DISPATCH) break;
    }
    return eligible;
  }

  protected offerCandidateIds(
    row: Pick<
      DispatchRow,
      | "ingress"
      | "requesting_device_id"
      | "pair_grant_device_id"
      | "requested_target_mode"
      | "requested_executor_device_id"
    >,
    snapshot: OwnerSnapshot,
  ): string[] {
    if (row.ingress === "mobile" && row.requesting_device_id) {
      return row.pair_grant_device_id ? [row.pair_grant_device_id] : [];
    }
    if (
      (row.ingress === "desktop" ||
        row.ingress === "browser" ||
        row.ingress === "schedule" ||
        row.ingress === "cloud") &&
      row.requested_target_mode === "device" &&
      row.requested_executor_device_id
    ) {
      return [row.requested_executor_device_id];
    }
    return [];
  }

  protected openOffer(
    dispatchId: string,
    device: DevicePresenceState,
    expiresAt: number,
    now: number,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO dispatch_offers (
         dispatch_id, device_id, presence_session_id, status, expires_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'open', ?, ?, ?)
       ON CONFLICT(dispatch_id, device_id) DO UPDATE SET
         presence_session_id = excluded.presence_session_id,
         status = 'open',
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
      dispatchId,
      device.deviceId,
      device.presenceSessionId,
      expiresAt,
      now,
      now,
    );
  }

  protected async deviceRemoteExecution(
    deviceId: string | null,
    now: number,
  ): Promise<DeviceRemoteExecution | undefined> {
    if (!deviceId) return undefined;
    const snapshot = await this.snapshot({ now });
    const device = (snapshot.devices ?? []).find(
      (candidate) => candidate.deviceId === deviceId,
    );
    if (!device) return undefined;
    return device.remoteExecution;
  }

  protected async offerAgainTo(
    attachment: PresenceAttachment,
    now: number,
  ): Promise<void> {
    const presence = this.presenceRow(attachment.deviceId);
    if (!presence?.connected || !presence.ready) return;
    const rows = this.ctx.storage.sql
      .exec<DispatchRow>(
        `SELECT d.* FROM dispatches d
           JOIN dispatch_offers o ON o.dispatch_id = d.dispatch_id
          WHERE o.device_id = ? AND o.status = 'open'
            AND d.state = 'offering' AND d.offer_deadline_at IS NOT NULL`,
        attachment.deviceId,
      )
      .toArray();
    for (let row of rows) {
      const deadline = Math.max(
        row.offer_deadline_at ?? 0,
        now + DISPATCH_OFFER_WINDOW_MS,
      );
      if (deadline !== row.offer_deadline_at) {
        const moved = await this.transitionDispatch(
          row,
          "offering",
          { offer_deadline_at: deadline },
          now,
          { notifyExecutor: false },
        );
        if (!moved.applied) continue;
        row = moved.row;
      }
      this.openOffer(row.dispatch_id, presence, deadline, now);
      this.pushOffer(row, attachment.deviceId, deadline);
      log("info", "dispatch_offered_again", {
        dispatchId: row.dispatch_id,
        deviceId: attachment.deviceId,
      });
    }
  }

  protected reconnectingDevice(args: {
    snapshot: OwnerSnapshot;
    deviceId: string;
    kind: ExecutionKind;
    requiredCapabilities: readonly ExecutionCapability[];
    now: number;
    ownWork?: boolean;
  }): DevicePresenceState | null {
    const presence = this.presenceRow(args.deviceId);
    if (!presence || presence.connected) return null;
    const droppedAt = this.ctx.storage.sql
      .exec<{ updated_at: number }>(
        `SELECT updated_at FROM device_presence WHERE device_id = ?`,
        args.deviceId,
      )
      .toArray()[0]?.updated_at;
    if (!droppedAt || droppedAt + DISPATCH_RECONNECT_GRACE_MS <= args.now) {
      return null;
    }
    const device = (args.snapshot.devices ?? []).find(
      (candidate) => candidate.deviceId === args.deviceId,
    );
    const eligible = isEligibleDevice({
      presence: { ...presence, connected: true, ready: true, lastSeenAt: args.now },
      device,
      kind: args.kind,
      requiredCapabilities: args.requiredCapabilities,
      now: args.now,
      staleAfterMs: DEVICE_PRESENCE_STALE_AFTER_MS,
      ...(args.ownWork ? { ownWork: true } : {}),
    });
    return eligible ? presence : null;
  }

  protected reconnectDeadline(row: DispatchRow, now: number): number | null {
    if (
      row.requested_target_mode !== "device" ||
      !row.requested_executor_device_id
    ) {
      return null;
    }
    const until = row.created_at + DISPATCH_RECONNECT_GRACE_MS;
    if (until <= now) return null;
    const offered = this.openOffers(row.dispatch_id).some(
      (offer) => offer.device_id === row.requested_executor_device_id,
    );
    if (!offered) return null;
    const presence = this.presenceRow(row.requested_executor_device_id);
    if (presence?.connected && presence.ready) return null;
    return until;
  }

  protected pushOffer(
    row: DispatchRow,
    deviceId: string,
    offerExpiresAt: number,
  ): void {
    const socket = this.connectedSocket(deviceId);
    if (!socket) return;
    this.send(socket, {
      type: "offer",
      dispatch: dispatchSummary(row),
      payloadJson: row.payload_json ?? "",
      payloadHash: row.payload_hash,
      offerExpiresAt,
    });
  }

  protected async releaseGate(row: DispatchRow): Promise<void> {
    if (this.dispatchRow(row.dispatch_id)?.gate_held !== 1) return;
    const handoff = await this.ctx.storage.get<CloudChatHandoff>(
      cloudChatHandoffKey(row.dispatch_id),
    );
    await this.release({
      turnId:
        handoff?.phase === "registered"
          ? handoff.authority.turnId
          : (handoff?.turnId ?? row.dispatch_id),
    });
    this.setGateHeld(row.dispatch_id, false);
    row.gate_held = 0;
  }

  protected failoverCandidates(
    row: Pick<
      DispatchRow,
      | "dispatch_id"
      | "kind"
      | "subject"
      | "ingress"
      | "requested_target_mode"
      | "requested_executor_device_id"
      | "requesting_device_id"
      | "required_capabilities"
      | "on_no_eligible_computer"
    >,
    snapshot: OwnerSnapshot,
    now: number,
  ): DevicePresenceState[] {
    if (!failsOverToDevices(row)) return [];
    const offered = this.ctx.storage.sql
      .exec<{ device_id: string }>(
        `SELECT device_id FROM dispatch_offers WHERE dispatch_id = ?`,
        row.dispatch_id,
      )
      .toArray()
      .map((offer) => offer.device_id)
      .filter((deviceId) => deviceId !== row.requested_executor_device_id);
    if (offered.length >= FAILOVER_MAX_DEVICES) return [];
    const skip = new Set([...offered, row.requested_executor_device_id]);
    const required = JSON.parse(row.required_capabilities) as ExecutionCapability[];
    const ranked: Array<{ presence: DevicePresenceState; rank: number[] }> = [];
    for (const device of snapshot.devices ?? []) {
      if (skip.has(device.deviceId)) continue;
      const presence = this.presenceRow(device.deviceId);
      if (!presence?.capabilities.includes("chat-failover")) continue;
      const own = isOwnSend(row, device.deviceId);
      if (
        !isEligibleDevice({
          presence,
          device,
          kind: row.kind as ExecutionKind,
          requiredCapabilities: required,
          now,
          staleAfterMs: DEVICE_PRESENCE_STALE_AFTER_MS,
          ownWork: own,
        })
      ) {
        continue;
      }
      ranked.push({
        presence,
        rank: [
          runsExecutionOn(presence, snapshot.execution) ? 1 : 0,
          device.brainHome ? 1 : 0,
          own ? 1 : 0,
          presence.lastSeenAt,
        ],
      });
    }
    ranked.sort((a, b) => {
      for (let index = 0; index < a.rank.length; index += 1) {
        const order = b.rank[index]! - a.rank[index]!;
        if (order !== 0) return order;
      }
      return 0;
    });
    return ranked.map((entry) => entry.presence);
  }

  protected async offerFailover(
    row: DispatchRow,
    now: number,
    fallbackReason: string,
  ): Promise<DispatchRow | null> {
    if (!failsOverToDevices(row)) return null;
    const snapshot = await this.snapshot({ now }).catch(() => null);
    const next = snapshot ? this.failoverCandidates(row, snapshot, now)[0] : undefined;
    if (!next) return null;
    const deadline = now + DISPATCH_OFFER_WINDOW_MS;
    const reason = fallbackReason.startsWith(FAILOVER_REASON_PREFIX)
      ? fallbackReason
      : `${FAILOVER_REASON_PREFIX}${fallbackReason}`;
    const moved = await this.transitionDispatch(
      row,
      "offering",
      {
        executor_device_id: null,
        executor_presence_session_id: null,
        lease_expires_at: null,
        offer_deadline_at: deadline,
        fallback_reason: reason.slice(0, 200),
      },
      now,
      { notifyExecutor: false },
    );
    if (!moved.applied) return null;
    this.openOffer(row.dispatch_id, next, deadline, now);
    this.pushOffer(moved.row, next.deviceId, deadline);
    log("info", "dispatch_failover_offered", {
      dispatchId: row.dispatch_id,
      fromDeviceId: row.requested_executor_device_id,
      deviceId: next.deviceId,
      reason: fallbackReason,
    });
    await this.scheduleAlarm(now);
    return moved.row;
  }

  protected async resolveUnaccepted(
    row: DispatchRow,
    now: number,
    fallbackReason: string,
  ): Promise<DispatchRow> {
    if (row.state !== "offering" && row.state !== "computer_claimed") {
      return row;
    }
    this.withdrawOffers(row.dispatch_id, null, fallbackReason, now);
    const failedOver = await this.offerFailover(row, now, row.fallback_reason?.startsWith(FAILOVER_REASON_PREFIX) ? row.fallback_reason : fallbackReason);
    if (failedOver) return failedOver;
    if (row.on_no_eligible_computer === "cloud" && row.kind === "agent") {
      const snapshot = await this.snapshot({ now }).catch(() => null);
      if (snapshot && !snapshotAllowsCloudSandbox(snapshot)) {
        const refused = await this.transitionDispatch(
          row,
          "blocked",
          {
            executor_device_id: null,
            executor_presence_session_id: null,
            offer_deadline_at: null,
            lease_expires_at: null,
            payload_json: null,
            payload_expires_at: null,
            fallback_reason: "subscription-required",
            error_code: "SUBSCRIPTION_REQUIRED",
            error_message: CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE,
          },
          now,
        );
        if (refused.applied) await this.releaseGate(refused.row);
        return refused.row;
      }
    }
    if (row.on_no_eligible_computer === "cloud") {
      const committed = await this.transitionDispatch(
        row,
        "cloud_committed",
        {
          placement: "cloud",
          executor_device_id: null,
          executor_presence_session_id: null,
          offer_deadline_at: null,
          lease_expires_at: now + DISPATCH_ACCEPTED_LEASE_MS,
          fallback_reason: fallbackReason,
        },
        now,
      );
      return committed.applied
        ? await this.runCloudBranch(committed.row, now)
        : committed.row;
    }
    const explicitDevice = row.requested_target_mode === "device";
    const ownWork = isOwnScheduledWork(row, row.requested_executor_device_id);
    const refusal = explicitDevice
      ? this.selectedDeviceRefusal({
          deviceId: row.requested_executor_device_id,
          now,
          ...(ownWork
            ? {}
            : await this.deviceRemoteExecution(
                row.requested_executor_device_id,
                now,
              ).then((state) => (state ? { remoteExecution: state } : {}))),
        })
      : null;
    const blocked = await this.transitionDispatch(
      row,
      "blocked",
      {
        executor_device_id: null,
        executor_presence_session_id: null,
        offer_deadline_at: null,
        lease_expires_at: null,
        payload_json: null,
        payload_expires_at: null,
        fallback_reason: refusal
          ? refusal.fallbackReason
          : explicitDevice
            ? "selected-device-unavailable"
            : "no-eligible-paired-computer",
        error_code: refusal
          ? refusal.errorCode
          : explicitDevice
            ? "SELECTED_DEVICE_UNAVAILABLE"
            : "COMPUTER_REQUIRED_UNAVAILABLE",
        error_message: refusal
          ? refusal.errorMessage
          : explicitDevice
            ? "The selected computer did not accept the request."
            : "This work requires your paired computer, but no eligible computer is reachable.",
      },
      now,
    );
    if (blocked.applied) await this.releaseGate(blocked.row);
    return blocked.row;
  }

  protected async submitSnapshot(
    expectedGeneration: string | undefined,
    now: number,
  ): Promise<
    | { ok: true; snapshot: OwnerSnapshot }
    | { ok: false; error: DispatchError["error"] }
  > {
    let snapshot: OwnerSnapshot;
    try {
      snapshot = await this.snapshot({ now });
      if (
        expectedGeneration &&
        expectedGeneration !== snapshot.ownerGeneration
      ) {
        snapshot = await this.snapshot({ refresh: true, now });
      }
    } catch (error) {
      const purged =
        error instanceof OwnerGateSnapshotError &&
        error.code === "owner_purged";
      log("error", "dispatch_snapshot_unavailable", {
        ownerId: this.ownerId(),
        message: error instanceof Error ? error.message : String(error),
      });
      return purged
        ? fail(
            "owner_purged",
            "This account's cloud data is no longer available.",
            false,
          )
        : fail(
            "internal",
            "Stella can't check your plan right now. Try again shortly.",
            true,
          );
    }
    if (expectedGeneration && expectedGeneration !== snapshot.ownerGeneration) {
      return fail(
        "generation_stale",
        "This cloud owner generation is no longer current.",
        false,
      );
    }
    if (snapshot.enforcement?.status === "suspended") {
      return fail(
        "owner_suspended",
        "This account can't use Stella's cloud right now.",
        false,
      );
    }
    if (!snapshot.writable) {
      return fail(
        "owner_purged",
        "This account's cloud data is being reset or deleted.",
        false,
      );
    }
    return { ok: true, snapshot };
  }

  protected async cancelCloudDispatch(
    row: DispatchRow,
    cancelRequestId: string,
    reason: string,
  ): Promise<void> {
    const body = {
      turnId: row.cloud_turn_id,
      cancelRequestId,
      ownerId: this.ownerId(),
      ownerGeneration: row.owner_generation,
      ...(row.kind === "agent" ? { attemptGeneration: 1 } : {}),
      ...(reason ? { reason } : {}),
    };
    try {
      if (row.kind === "chat") {
        await this.env.ORCHESTRATOR_SESSIONS?.getByName(
          row.conversation_id,
        ).fetch("https://orchestrator-session/cancel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } else if (row.cloud_thread_id && row.cloud_turn_id) {
        await cancelCloudAgentAttempt({
          env: this.env as unknown as Cloudflare.Env,
          conversationId: row.conversation_id,
          threadId: row.cloud_thread_id,
          ownerId: this.ownerId(),
          ownerGeneration: row.owner_generation,
          turnId: row.cloud_turn_id,
          attemptGeneration: 1,
          cancelRequestId,
          reason,
        });
      }
    } catch (error) {
      log("error", "dispatch_cloud_cancel_failed", {
        dispatchId: row.dispatch_id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  protected async handleExecutorFrame(
    socket: WebSocket,
    attachment: PresenceAttachment,
    frame: DevicePresenceDeviceFrame,
    now: number,
  ): Promise<void> {
    const dispatchId =
      "dispatchId" in frame && typeof frame.dispatchId === "string"
        ? frame.dispatchId.trim()
        : "";
    if (!dispatchId) {
      this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
      return;
    }
    const row = this.dispatchRow(dispatchId);
    if (!row) {
      this.send(socket, {
        type: "error",
        code: "not_found",
        message: "Dispatch not found.",
        retryable: false,
      });
      return;
    }
    const deny = (code: string, message: string) =>
      this.send(socket, { type: "error", code, message, retryable: false });
    if (frame.type === "steer.ack") {
      if (row.executor_device_id === attachment.deviceId) {
        this.steerAcks.get(`${dispatchId}:${frame.messageId}`)?.(
          frame.delivered === true,
        );
      }
      return;
    }
    if (frame.type === "claim") {
      await this.handleClaim(socket, attachment, row, frame, now);
      return;
    }
    if (
      row.executor_device_id !== attachment.deviceId ||
      row.executor_presence_session_id !== attachment.presenceSessionId
    ) {
      deny("forbidden", "This runtime session does not own the dispatch.");
      return;
    }
    if (frame.type === "release") {
      if (row.state !== "computer_claimed") {
        deny(
          "conflict",
          "A durably accepted execution cannot be released or rerouted.",
        );
        return;
      }
      const released = await this.transitionDispatch(
        row,
        "offering",
        {
          executor_device_id: null,
          executor_presence_session_id: null,
          lease_expires_at: null,
        },
        now,
        { notifyExecutor: false },
      );
      if (!released.applied) return;
      this.ctx.storage.sql.exec(
        `UPDATE dispatch_offers SET status = 'withdrawn', updated_at = ?
          WHERE dispatch_id = ? AND device_id = ?`,
        now,
        released.row.dispatch_id,
        attachment.deviceId,
      );
      await this.resolveUnaccepted(
        released.row,
        now,
        `computer-claim-released:${(frame.reason ?? "").slice(0, 160)}`,
      );
      return;
    }
    if (frame.type === "ack") {
      if (
        row.state === "computer_accepted" ||
        row.state === "computer_running" ||
        row.state === "reconciliation_required"
      ) {
        return;
      }
      if (
        row.state !== "computer_claimed" ||
        row.lease_expires_at === null ||
        row.lease_expires_at <= now
      ) {
        deny("conflict", "Claim expired before durable local acceptance.");
        return;
      }
      await this.transitionDispatch(
        row,
        "computer_accepted",
        {
          placement: "computer",
          payload_json: null,
          payload_expires_at: null,
          lease_expires_at: now + DISPATCH_ACCEPTED_LEASE_MS,
        },
        now,
      );
      return;
    }
    if (frame.type === "running") {
      if (
        row.state !== "computer_accepted" &&
        row.state !== "computer_running" &&
        row.state !== "reconciliation_required"
      ) {
        deny("conflict", "Only an accepted computer execution can start.");
        return;
      }
      await this.transitionDispatch(
        row,
        row.cancel_request_id ? "cancel_pending" : "computer_running",
        {
          started_at: row.started_at ?? now,
          lease_expires_at: now + DISPATCH_ACCEPTED_LEASE_MS,
        },
        now,
      );
      return;
    }
    if (frame.type === "renew") {
      if (
        row.state !== "computer_accepted" &&
        row.state !== "computer_running" &&
        row.state !== "cancel_pending" &&
        row.state !== "reconciliation_required"
      ) {
        deny("conflict", "Execution is not renewable.");
        return;
      }
      const state: DispatchState =
        row.state === "reconciliation_required"
          ? row.cancel_request_id
            ? "cancel_pending"
            : row.started_at
              ? "computer_running"
              : "computer_accepted"
          : row.state;
      if (
        state === row.state &&
        row.lease_expires_at !== null &&
        row.lease_expires_at - now > DISPATCH_RENEW_WRITE_BELOW_MS
      ) {
        this.notifyExecutor(row);
        return;
      }
      await this.transitionDispatch(
        row,
        state,
        { lease_expires_at: now + DISPATCH_ACCEPTED_LEASE_MS },
        now,
      );
      return;
    }
    if (frame.type === "complete") {
      const outcome = frame.outcome;
      if (
        outcome !== "completed" &&
        outcome !== "failed" &&
        outcome !== "canceled"
      ) {
        deny("bad_request", "A completion needs a terminal outcome.");
        return;
      }
      if (isTerminalDispatchState(row.state)) {
        this.notifyExecutor(row);
        return;
      }
      if (
        row.state !== "computer_accepted" &&
        row.state !== "computer_running" &&
        row.state !== "cancel_pending" &&
        row.state !== "reconciliation_required"
      ) {
        deny(
          "conflict",
          "Execution is not owned by an accepted computer claim.",
        );
        return;
      }
      const terminal = await this.transitionDispatch(
        row,
        outcome,
        {
          result_json:
            typeof frame.resultJson === "string" ? frame.resultJson : null,
          payload_json: null,
          payload_expires_at: null,
          lease_expires_at: null,
          ...(frame.errorCode
            ? { error_code: frame.errorCode.slice(0, 128) }
            : {}),
          ...(frame.errorMessage
            ? { error_message: frame.errorMessage.slice(0, 1024) }
            : {}),
        },
        now,
      );
      if (terminal.applied) await this.releaseGate(terminal.row);
      await this.scheduleAlarm(now);
      return;
    }
    this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
  }

  protected async handleClaim(
    socket: WebSocket,
    attachment: PresenceAttachment,
    row: DispatchRow,
    frame: Extract<DevicePresenceDeviceFrame, { type: "claim" }>,
    now: number,
  ): Promise<void> {
    const claimRequestId =
      typeof frame.claimRequestId === "string"
        ? frame.claimRequestId.trim().slice(0, 128)
        : "";
    if (!claimRequestId) {
      this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
      return;
    }
    const sameClaim =
      row.state === "computer_claimed" &&
      row.executor_device_id === attachment.deviceId &&
      row.executor_presence_session_id === attachment.presenceSessionId &&
      row.cancel_request_id === null;
    if (sameClaim) {
      this.send(socket, {
        type: "claimed",
        dispatchId: row.dispatch_id,
        claimExpiresAt: row.lease_expires_at ?? now,
        replayed: true,
      });
      return;
    }
    if (
      row.state !== "offering" ||
      row.offer_deadline_at === null ||
      row.offer_deadline_at <= now
    ) {
      this.send(socket, {
        type: "error",
        code: "conflict",
        message: "Execution offer is no longer claimable.",
        retryable: false,
      });
      return;
    }
    const offered = this.openOffers(row.dispatch_id).some(
      (offer) =>
        offer.device_id === attachment.deviceId &&
        offer.presence_session_id === attachment.presenceSessionId,
    );
    if (!offered) {
      this.send(socket, {
        type: "error",
        code: "forbidden",
        message: "This runtime session was not offered the execution.",
        retryable: false,
      });
      return;
    }
    const snapshot = await this.snapshot({ now });
    const required = JSON.parse(
      row.required_capabilities,
    ) as ExecutionCapability[];
    const eligible = this.eligibleDevices({
      snapshot,
      deviceIds: [attachment.deviceId],
      kind: row.kind as ExecutionKind,
      requiredCapabilities: required,
      now,
      ...(isOwnScheduledWork(row, attachment.deviceId) ||
      (failsOverToDevices(row) && isOwnSend(row, attachment.deviceId))
        ? { ownWorkOf: attachment.deviceId }
        : {}),
    });
    if (eligible.length === 0) {
      this.send(socket, {
        type: "error",
        code: "conflict",
        message: "This runtime is no longer eligible for the execution.",
        retryable: false,
      });
      return;
    }
    const claimExpiresAt = now + DISPATCH_CLAIM_LEASE_MS;
    const claimed = await this.transitionDispatch(
      row,
      "computer_claimed",
      {
        executor_device_id: attachment.deviceId,
        executor_presence_session_id: attachment.presenceSessionId ?? "",
        lease_expires_at: claimExpiresAt,
      },
      now,
      { notifyExecutor: false },
    );
    if (!claimed.applied) {
      this.send(socket, {
        type: "error",
        code: "conflict",
        message: "Execution offer is no longer claimable.",
        retryable: false,
      });
      return;
    }
    this.ctx.storage.sql.exec(
      `UPDATE dispatch_offers SET status = 'claimed', updated_at = ?
        WHERE dispatch_id = ? AND device_id = ?`,
      now,
      row.dispatch_id,
      attachment.deviceId,
    );
    this.withdrawOffers(row.dispatch_id, attachment.deviceId, "claimed", now);
    this.send(socket, {
      type: "claimed",
      dispatchId: row.dispatch_id,
      claimExpiresAt,
      replayed: false,
    });
    await this.scheduleAlarm(now);
  }

  protected async scheduleAlarm(
    now: number,
    options: {
      preserveExisting?: boolean;
      afterAlarm?: boolean;
    } = {},
  ): Promise<void> {
    this.ensureSchema();
    const deadlines: Array<[string, number]> = [];
    const add = (source: string, at: number | null | undefined) => {
      if (typeof at === "number" && Number.isFinite(at)) {
        deadlines.push([source, at]);
      }
    };
    if (await this.memoryPolicy().pending()) add("memory_policy", now + 5_000);
    if (await this.modelGrants().pendingFenceBarrier()) {
      add("grant_fence_barrier", now + 5_000);
    }
    const handledAt = options.afterAlarm ? now : undefined;
    const addSocket = (source: string, at: number) => {
      if (handledAt !== undefined && at <= handledAt) return;
      add(source, at);
    };
    add("owner_store", this.ownerStore().nextDeadline());
    const watched = this.ownerStore().watching("devices.list");
    for (const socket of this.sockets()) {
      const attachment = this.attachment(socket);
      if (!attachment) continue;
      addSocket("presence_auth", attachment.authExpiresAtMs);
      if (attachment.phase !== "connected") {
        addSocket(
          "presence_handshake",
          attachment.lastSeenAtMs + DEVICE_PRESENCE_STALE_AFTER_MS,
        );
      } else if (watched) {
        addSocket(
          "presence_stale",
          this.lastSeenAt(socket, attachment) + DEVICE_PRESENCE_STALE_AFTER_MS,
        );
      }
    }
    // Scalar subqueries rather than a compound SELECT, whose term limit Durable Object SQLite enforces.
    const rows = this.ctx.storage.sql
      .exec<Record<string, number | null>>(
        `SELECT
           (SELECT MIN(offer_deadline_at) FROM dispatches
              WHERE state = 'offering' AND offer_deadline_at IS NOT NULL) AS offer,
           (SELECT MIN(lease_expires_at) FROM dispatches
              WHERE state = 'computer_claimed' AND lease_expires_at IS NOT NULL) AS claimed,
           (SELECT MIN(lease_expires_at) FROM dispatches
              WHERE state = 'computer_accepted' AND lease_expires_at IS NOT NULL) AS accepted,
           (SELECT MIN(lease_expires_at) FROM dispatches
              WHERE state = 'computer_running' AND lease_expires_at IS NOT NULL) AS running,
           (SELECT MIN(lease_expires_at) FROM dispatches
              WHERE state = 'cloud_committed' AND lease_expires_at IS NOT NULL) AS committed,
           (SELECT MIN(lease_expires_at) FROM dispatches
              WHERE state = 'cancel_pending' AND lease_expires_at IS NOT NULL) AS canceling,
           (SELECT MIN(lease_expires_at) FROM dispatches
              WHERE state = 'reconciliation_required' AND lease_expires_at IS NOT NULL) AS reconciling,
           (SELECT MIN(cloud_retry_at) FROM dispatches
              WHERE state = 'cloud_committed' AND cloud_retry_at IS NOT NULL) AS retry,
           (SELECT MIN(payload_expires_at) FROM dispatches
              WHERE payload_json IS NOT NULL AND payload_expires_at IS NOT NULL) AS payload`,
      )
      .toArray()[0];
    for (const [column, at] of Object.entries(rows ?? {})) {
      add(`dispatch_${column}`, at);
    }
    const backoff =
      (await this.ctx.storage.get<AlarmBackoff>(ALARM_BACKOFF_KEY)) ?? null;
    const heldUntil = (source: string): number =>
      backoff && backoff.until > now && backoff.sources.includes(source)
        ? backoff.until
        : Number.NEGATIVE_INFINITY;
    let next = Number.POSITIVE_INFINITY;
    for (const [source, at] of deadlines) {
      next = Math.min(next, Math.max(at, heldUntil(source)));
    }
    const existingAlarm = await this.ctx.storage.getAlarm();
    if (options.preserveExisting !== false && existingAlarm !== null) {
      next = Math.min(next, existingAlarm);
    }
    if (options.afterAlarm) {
      const stored =
        (await this.ctx.storage.get<number>(ALARM_HOT_STREAK_KEY)) ?? 0;
      if (Number.isFinite(next) && next - now < ALARM_HOT_REARM_MS) {
        const streak = stored + 1;
        await this.ctx.storage.put(ALARM_HOT_STREAK_KEY, streak);
        const over = streak - ALARM_HOT_STREAK_LIMIT;
        if (over > 0) {
          const hot = deadlines
            .filter(([, at]) => at - now <= ALARM_HOT_REARM_MS)
            .map(([source]) => source);
          const until =
            now + Math.min(ALARM_MAX_BACKOFF_MS, ALARM_MIN_DELAY_MS * 2 ** over);
          next = Math.max(next, until);
          await this.ctx.storage.put(ALARM_BACKOFF_KEY, {
            until,
            sources: [...new Set([...hot, ...(backoff?.sources ?? [])])],
          } satisfies AlarmBackoff);
          if ((over & (over - 1)) === 0) {
            log("error", "owner_alarm_hot_loop", {
              ownerId: this.ownerId(),
              streak,
              sources: hot,
            });
          }
        }
      } else if (stored > 0 || backoff) {
        await this.ctx.storage.delete([ALARM_HOT_STREAK_KEY, ALARM_BACKOFF_KEY]);
      }
    }
    if (!Number.isFinite(next)) return;
    const at = Math.max(now + ALARM_MIN_DELAY_MS, next);
    if (existingAlarm === at || (existingAlarm !== null && existingAlarm > now && existingAlarm === next)) return;
    try {
      await this.ctx.storage.setAlarm(at);
    } catch {
    }
  }

  protected async expireDispatches(now: number): Promise<void> {
    const expired = this.ctx.storage.sql
      .exec<DispatchRow>(
        `SELECT * FROM dispatches
          WHERE (state = 'offering' AND offer_deadline_at IS NOT NULL
                 AND offer_deadline_at <= ?)
             OR (state = 'cloud_committed' AND cloud_retry_at IS NOT NULL
                 AND cloud_retry_at <= ?)
             OR (state IN ('computer_claimed', 'computer_accepted',
                           'computer_running', 'cloud_committed',
                           'cancel_pending', 'reconciliation_required')
                 AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
             OR (payload_json IS NOT NULL AND payload_expires_at IS NOT NULL
                 AND payload_expires_at <= ?)
          ORDER BY updated_at ASC
          LIMIT 64`,
        now,
        now,
        now,
        now,
      )
      .toArray();
    for (const row of expired) {
      const offerLapsed =
        row.state === "offering" &&
        row.offer_deadline_at !== null &&
        row.offer_deadline_at <= now;
      const leaseLapsed =
        row.lease_expires_at !== null && row.lease_expires_at <= now;
      if (offerLapsed) {
        const waitUntil = this.reconnectDeadline(row, now);
        if (waitUntil !== null) {
          await this.transitionDispatch(
            row,
            "offering",
            { offer_deadline_at: waitUntil },
            now,
            { notifyExecutor: false },
          );
          log("info", "dispatch_offer_awaits_reconnect", {
            dispatchId: row.dispatch_id,
            deviceId: row.requested_executor_device_id,
          });
          continue;
        }
        await this.resolveUnaccepted(
          row,
          now,
          "computer-offer-expired-unaccepted",
        );
        continue;
      }
      if (
        row.state === "cloud_committed" &&
        row.cloud_retry_at !== null &&
        row.cloud_retry_at <= now
      ) {
        await this.runCloudBranch(row, now);
        continue;
      }
      if (row.state === "computer_claimed" && leaseLapsed) {
        await this.resolveUnaccepted(row, now, "computer-claim-expired");
        continue;
      }
      if (
        leaseLapsed &&
        (row.state === "computer_accepted" ||
          row.state === "computer_running" ||
          row.state === "cloud_committed" ||
          row.state === "cancel_pending")
      ) {
        if (row.kind === "agent" && row.executor_device_id && row.state !== "cloud_committed") {
          this.noteDeviceLost(row.executor_device_id);
        }
        await this.transitionDispatch(
          row,
          "reconciliation_required",
          {
            lease_expires_at: now + DISPATCH_RECONCILE_MAX_MS,
            fallback_reason: `${row.state}-lease-expired`,
          },
          now,
          { notifyExecutor: false },
        );
        continue;
      }
      if (
        leaseLapsed &&
        row.state === "reconciliation_required" &&
        row.kind === "agent" &&
        row.executor_device_id &&
        !row.cancel_request_id
      ) {
        await this.transitionDispatch(
          row,
          "reconciliation_required",
          {
            payload_json: null,
            payload_expires_at: null,
            lease_expires_at: now + DISPATCH_RECONCILE_MAX_MS,
          },
          now,
          { notifyExecutor: false },
        );
        continue;
      }
      if (
        leaseLapsed &&
        row.state === "reconciliation_required" &&
        row.kind === "agent" &&
        row.executor_device_id &&
        row.cancel_request_id &&
        now < row.updated_at + DISPATCH_STOP_HOLD_MS &&
        !this.liveSocket(row.executor_device_id)
      ) {
        this.ctx.storage.sql.exec(
          `UPDATE dispatches SET lease_expires_at = ?
            WHERE dispatch_id = ? AND state = 'reconciliation_required'`,
          Math.min(now + DISPATCH_RECONCILE_MAX_MS, row.updated_at + DISPATCH_STOP_HOLD_MS),
          row.dispatch_id,
        );
        continue;
      }
      if (leaseLapsed && row.state === "reconciliation_required") {
        const ended = await this.transitionDispatch(
          row,
          row.cancel_request_id ? "canceled" : "failed",
          row.cancel_request_id
            ? {
                payload_json: null,
                payload_expires_at: null,
                lease_expires_at: null,
              }
            : {
                payload_json: null,
                payload_expires_at: null,
                lease_expires_at: null,
                error_code: "RECONCILIATION_EXPIRED",
                error_message: "The device running this never reported how it ended.",
              },
          now,
        );
        if (ended.applied) await this.releaseGate(ended.row);
        continue;
      }
      if (row.payload_json !== null) {
        await this.transitionDispatch(
          row,
          row.state,
          { payload_json: null, payload_expires_at: null },
          now,
          { notifyExecutor: false },
        );
      }
    }
  }

  abstract release(input: { turnId: string }): Promise<void>;
  protected abstract runCloudBranch(
    row: DispatchRow,
    now: number,
  ): Promise<DispatchRow>;
}
