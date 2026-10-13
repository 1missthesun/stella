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
  isEligibleDevice,
  isTerminalDispatchState,
  MAX_OFFERS_PER_DISPATCH,
} from "../dispatch-policy.js";
import type { DispatchRow } from "./types.js";
import {
  DISPATCH_RENEW_WRITE_BELOW_MS,
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

/**
 * Dispatch placement: offers to devices, executor frames and claims, and the
 * alarm that expires them.
 */
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

  /** Every transition goes through here: one revision bump. */
  protected async patchDispatch(
    row: DispatchRow,
    patch: Record<string, string | number | null>,
    now: number,
    options: { notifyExecutor?: boolean } = {},
  ): Promise<DispatchRow> {
    const columns = Object.keys(patch);
    const assignments = [
      ...columns.map((column) => `${column} = ?`),
      "revision = revision + 1",
      "updated_at = ?",
    ];
    this.ctx.storage.sql.exec(
      `UPDATE dispatches SET ${assignments.join(", ")} WHERE dispatch_id = ?`,
      ...columns.map((column) => patch[column] ?? null),
      now,
      row.dispatch_id,
    );
    const next = this.dispatchRow(row.dispatch_id)!;
    if (options.notifyExecutor !== false) this.notifyExecutor(next);
    if (
      !isTerminalDispatchState(row.state as DispatchState) &&
      isTerminalDispatchState(next.state as DispatchState)
    ) {
      await this.reportDeviceAgentSettled(next);
    }
    return next;
  }

  /**
   * A device attempt of an owner agent thread ended: hand the outcome to the
   * thread ledger, which records it and wakes a cloud requester.
   */
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
        })
      ) {
        eligible.push(presence!);
      }
      if (eligible.length >= MAX_OFFERS_PER_DISPATCH) break;
    }
    return eligible;
  }

  /**
   * The devices an offer for this dispatch may reach, before eligibility is
   * consulted. One function so a submit and a re-offer after a release can
   * never disagree about who the work was ever for.
   */
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
      return [
        ...new Set(
          (snapshot.pairedDevices ?? [])
            .filter(
              (pairing) =>
                pairing.mobileDeviceId === row.requesting_device_id &&
                (!row.pair_grant_device_id ||
                  pairing.desktopDeviceId === row.pair_grant_device_id),
            )
            .map((pairing) => pairing.desktopDeviceId),
        ),
      ];
    }
    if (
      (row.ingress === "desktop" ||
        row.ingress === "browser" ||
        row.ingress === "schedule" ||
        // A cloud agent spawned onto a named device (agent threads only;
        // the public submit route never admits cloud ingress).
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

  /** The stored consent for a device id, defaulted for pre-consent rows. */
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
    return (
      device.remoteExecution ??
      (device.remoteExecutionEnabled ? "enabled" : "unconfigured")
    );
  }

  /**
   * A device that (re)connects ready gets the offers still open to it, bound
   * to its new session. One sent to the session it had before never arrived
   * or can no longer be claimed, so without this the work would wait out the
   * window and fall back while the computer it was for is right here.
   */
  protected offerAgainTo(attachment: PresenceAttachment, now: number): void {
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
    for (const row of rows) {
      const deadline = Math.max(
        row.offer_deadline_at ?? 0,
        now + DISPATCH_OFFER_WINDOW_MS,
      );
      if (deadline !== row.offer_deadline_at) {
        this.ctx.storage.sql.exec(
          `UPDATE dispatches SET offer_deadline_at = ? WHERE dispatch_id = ?`,
          deadline,
          row.dispatch_id,
        );
        row.offer_deadline_at = deadline;
      }
      this.openOffer(row.dispatch_id, presence, deadline, now);
      this.pushOffer(row, attachment.deviceId, deadline);
      log("info", "dispatch_offered_again", {
        dispatchId: row.dispatch_id,
        deviceId: attachment.deviceId,
      });
    }
  }

  /**
   * The named computer of a dispatch when it is between connections: its
   * presence dropped within the reconnect grace and it was eligible as it
   * stood. Work aimed at it waits for it rather than falling back at once.
   * A computer that is connected but not taking work is not waited for.
   */
  protected reconnectingDevice(args: {
    snapshot: OwnerSnapshot;
    deviceId: string;
    kind: ExecutionKind;
    requiredCapabilities: readonly ExecutionCapability[];
    now: number;
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
    });
    return eligible ? presence : null;
  }

  /**
   * An offer to one named computer that lapsed while that computer had no
   * live presence (it is reconnecting): how long to keep it open for it,
   * or null to take the fallback now.
   */
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
    if (row.gate_held !== 1) return;
    const handoff = await this.ctx.storage.get<CloudChatHandoff>(
      cloudChatHandoffKey(row.dispatch_id),
    );
    await this.release({
      turnId:
        handoff?.phase === "registered"
          ? handoff.authority.turnId
          : (handoff?.turnId ?? row.dispatch_id),
    });
    this.ctx.storage.sql.exec(
      `UPDATE dispatches SET gate_held = 0 WHERE dispatch_id = ?`,
      row.dispatch_id,
    );
    row.gate_held = 0;
  }

  /**
   * The one legal local-to-cloud transition. Callers must prove the local
   * executor has not acknowledged durable ownership before entering here: an
   * accepted dispatch is never rerouted, it is reconciled.
   */
  protected async resolveUnaccepted(
    row: DispatchRow,
    now: number,
    fallbackReason: string,
  ): Promise<DispatchRow> {
    if (row.state !== "offering" && row.state !== "computer_claimed") {
      return row;
    }
    this.withdrawOffers(row.dispatch_id, null, fallbackReason, now);
    if (row.on_no_eligible_computer === "cloud" && row.kind === "agent") {
      const snapshot = await this.snapshot({ now }).catch(() => null);
      if (snapshot && !snapshotAllowsCloudSandbox(snapshot)) {
        const refused = await this.patchDispatch(
          row,
          {
            state: "blocked",
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
        await this.releaseGate(refused);
        return refused;
      }
    }
    if (row.on_no_eligible_computer === "cloud") {
      const committed = await this.patchDispatch(
        row,
        {
          state: "cloud_committed",
          placement: "cloud",
          executor_device_id: null,
          executor_presence_session_id: null,
          offer_deadline_at: null,
          lease_expires_at: now + DISPATCH_ACCEPTED_LEASE_MS,
          fallback_reason: fallbackReason,
        },
        now,
      );
      return await this.runCloudBranch(committed, now);
    }
    const explicitDevice = row.requested_target_mode === "device";
    // No consent prompt is raised here. Reaching this path means an offer did
    // go out, so the device had agreed at submit; a refusal now is the owner
    // having just revoked it, and asking them again on the spot would be
    // arguing with them. The message still says what happened.
    const refusal = explicitDevice
      ? this.selectedDeviceRefusal({
          deviceId: row.requested_executor_device_id,
          now,
          ...(await this.deviceRemoteExecution(
            row.requested_executor_device_id,
            now,
          ).then((state) => (state ? { remoteExecution: state } : {}))),
        })
      : null;
    const blocked = await this.patchDispatch(
      row,
      {
        state: "blocked",
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
    await this.releaseGate(blocked);
    return blocked;
  }

  // ── The cloud branch ──────────────────────────────────────────────────

  /**
   * The owner checks a dispatch needs even when it takes no admission: the
   * write fence and the generation the caller pinned. Same verdicts `admit`
   * would have produced, without consuming a start or a slot.
   */
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
        // The cache can lag a rotation whose push was lost. One forced
        // refresh separates "stale cache" from "stale caller".
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
      // The dispatch stays `cancel_pending`; the executing side's terminal
      // still settles it, and the operator sees why the stop did not land.
      log("error", "dispatch_cloud_cancel_failed", {
        dispatchId: row.dispatch_id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── Executor frames ───────────────────────────────────────────────────

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
    // Everything past a claim is bound to the exact proven session that holds
    // it: a second device, or the same device after a reconnect, cannot move
    // work it does not own.
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
      const released = await this.patchDispatch(
        row,
        {
          state: "offering",
          executor_device_id: null,
          executor_presence_session_id: null,
          lease_expires_at: null,
        },
        now,
        { notifyExecutor: false },
      );
      // Its own offer is spent, and a claim already withdrew everyone else's,
      // so the dispatch takes the fallback the policy chose rather than
      // re-offering the work to the computer that just declined it.
      this.ctx.storage.sql.exec(
        `UPDATE dispatch_offers SET status = 'withdrawn', updated_at = ?
          WHERE dispatch_id = ? AND device_id = ?`,
        now,
        released.dispatch_id,
        attachment.deviceId,
      );
      await this.resolveUnaccepted(
        released,
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
      await this.patchDispatch(
        row,
        {
          state: "computer_accepted",
          placement: "computer",
          // The desktop's local inbox is now the only copy.
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
      await this.patchDispatch(
        row,
        {
          state: "computer_running",
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
      const state =
        row.state === "reconciliation_required"
          ? row.started_at
            ? "computer_running"
            : "computer_accepted"
          : row.state;
      // The computer renews every 25 s. A lease with most of its time left
      // is answered without rewriting the row, which was a large share of
      // the owner object's writes while agents ran; it is extended once it
      // falls below three quarters, so it never drops under a minute here.
      if (
        state === row.state &&
        row.lease_expires_at !== null &&
        row.lease_expires_at - now > DISPATCH_RENEW_WRITE_BELOW_MS
      ) {
        this.notifyExecutor(row);
        return;
      }
      await this.patchDispatch(
        row,
        { state, lease_expires_at: now + DISPATCH_ACCEPTED_LEASE_MS },
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
      if (isTerminalDispatchState(row.state as DispatchState)) {
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
      const terminal = await this.patchDispatch(
        row,
        {
          state: outcome,
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
      await this.releaseGate(terminal);
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
    this.ctx.storage.sql.exec(
      `UPDATE dispatch_offers SET status = 'claimed', updated_at = ?
        WHERE dispatch_id = ? AND device_id = ?`,
      now,
      row.dispatch_id,
      attachment.deviceId,
    );
    this.withdrawOffers(row.dispatch_id, attachment.deviceId, "claimed", now);
    const claimExpiresAt = now + DISPATCH_CLAIM_LEASE_MS;
    await this.patchDispatch(
      row,
      {
        state: "computer_claimed",
        executor_device_id: attachment.deviceId,
        executor_presence_session_id: attachment.presenceSessionId ?? "",
        lease_expires_at: claimExpiresAt,
      },
      now,
      { notifyExecutor: false },
    );
    this.send(socket, {
      type: "claimed",
      dispatchId: row.dispatch_id,
      claimExpiresAt,
      replayed: false,
    });
    await this.scheduleAlarm(now);
  }

  // ── Alarms ────────────────────────────────────────────────────────────

  /**
   * Arm the one alarm at the earliest deadline this object holds. Every
   * deadline comes from live state: open sockets (`sockets()` and the owner
   * store's `liveSockets()` leave out sockets this side closed), rows, and
   * pending retries. A deadline the alarm cannot clear would otherwise re-arm
   * it at the floor forever, which is what kept owners awake around the
   * clock; after `ALARM_HOT_STREAK_LIMIT` alarm runs in a row that each
   * re-armed within `ALARM_HOT_REARM_MS`, the re-arm backs off exponentially
   * to `ALARM_MAX_BACKOFF_MS` and the stuck deadline is logged by name.
   */
  protected async scheduleAlarm(
    now: number,
    options: {
      fenceDeadline?: number | null;
      preserveExisting?: boolean;
      /** Set by `alarm()` for its own re-arm, the only place a loop can form. */
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
    add("owner_fence", options.fenceDeadline);
    if (await this.memoryPolicy().pending()) add("memory_policy", now + 5_000);
    if (await this.modelGrants().pendingFenceBarrier()) {
      add("grant_fence_barrier", now + 5_000);
    }
    add("owner_store", this.ownerStore().nextDeadline());
    // A proven device going quiet needs no wake while nobody watches the
    // device list: request-time readers check staleness against
    // `presenceRow`, in-flight device calls have their own deadlines, and
    // waking to re-check would undo hibernation. While `devices.list` is
    // watched, a connection left half-open (a laptop asleep, its network
    // gone) is reaped when it goes stale, so the pushed list shows it offline.
    const watched = this.ownerStore().watching("devices.list");
    for (const socket of this.sockets()) {
      const attachment = this.attachment(socket);
      if (!attachment) continue;
      add("presence_auth", attachment.authExpiresAtMs);
      if (attachment.phase !== "connected") {
        add(
          "presence_handshake",
          attachment.lastSeenAtMs + DEVICE_PRESENCE_STALE_AFTER_MS,
        );
      } else if (watched) {
        add(
          "presence_stale",
          this.lastSeenAt(socket, attachment) + DEVICE_PRESENCE_STALE_AFTER_MS,
        );
      }
    }
    // Each column is one `MIN` seek into a partial index, so a wake reads a
    // handful of rows no matter how many terminal dispatches this object has
    // accumulated. Leases are asked for per state because a range over a state
    // set cannot be answered by one seek, and scalar subqueries are used rather
    // than a compound SELECT, whose term limit this storage enforces.
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
           (SELECT MIN(cloud_retry_at) FROM dispatches
              WHERE state = 'cloud_committed' AND cloud_retry_at IS NOT NULL) AS retry,
           (SELECT MIN(payload_expires_at) FROM dispatches
              WHERE payload_json IS NOT NULL AND payload_expires_at IS NOT NULL) AS payload`,
      )
      .toArray()[0];
    for (const [column, at] of Object.entries(rows ?? {})) {
      add(`dispatch_${column}`, at);
    }
    let next = Number.POSITIVE_INFINITY;
    for (const [, at] of deadlines) next = Math.min(next, at);
    const existingAlarm = await this.ctx.storage.getAlarm();
    if (options.preserveExisting !== false && existingAlarm !== null) {
      next = Math.min(next, existingAlarm);
    }
    if (options.afterAlarm) {
      if (Number.isFinite(next) && next - now <= ALARM_HOT_REARM_MS) {
        this.alarmHotStreak += 1;
        const over = this.alarmHotStreak - ALARM_HOT_STREAK_LIMIT;
        if (over > 0) {
          next = Math.max(
            next,
            now +
              Math.min(ALARM_MAX_BACKOFF_MS, ALARM_MIN_DELAY_MS * 2 ** over),
          );
          // Once per doubling, so a stuck deadline is found without flooding logs.
          if ((over & (over - 1)) === 0) {
            log("error", "owner_alarm_hot_loop", {
              ownerId: this.ownerId(),
              streak: this.alarmHotStreak,
              sources: deadlines
                .filter(([, at]) => at - now <= ALARM_HOT_REARM_MS)
                .map(([source]) => source),
            });
          }
        }
      } else {
        this.alarmHotStreak = 0;
      }
    }
    if (!Number.isFinite(next)) return;
    const at = Math.max(now + ALARM_MIN_DELAY_MS, next);
    if (existingAlarm === at || (existingAlarm !== null && existingAlarm > now && existingAlarm === next)) return;
    try {
      await this.ctx.storage.setAlarm(at);
    } catch {
      // Alarms are unavailable in some test harnesses; leases still expire on
      // the next call that reads them.
    }
  }

  /**
   * Leases, in one pass. An accepted or running computer dispatch whose lease
   * lapses becomes `reconciliation_required` and stays there: rerouting work
   * a computer has taken durable ownership of would run it twice.
   */
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
                           'cancel_pending')
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
          this.ctx.storage.sql.exec(
            `UPDATE dispatches SET offer_deadline_at = ? WHERE dispatch_id = ?`,
            waitUntil,
            row.dispatch_id,
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
      // A start the builder refused as unavailable, retried once. This is the
      // one case where `cloud_committed` is known not to have started, so
      // replaying it cannot double-run a turn.
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
        await this.patchDispatch(
          row,
          {
            state: "reconciliation_required",
            lease_expires_at: null,
            fallback_reason: `${row.state}-lease-expired`,
          },
          now,
          { notifyExecutor: false },
        );
        continue;
      }
      if (row.payload_json !== null) {
        this.ctx.storage.sql.exec(
          `UPDATE dispatches SET payload_json = NULL, payload_expires_at = NULL
            WHERE dispatch_id = ?`,
          row.dispatch_id,
        );
      }
    }
  }

  // Implemented further up the chain.
  abstract release(input: { turnId: string }): Promise<void>;
  protected abstract runCloudBranch(
    row: DispatchRow,
    now: number,
  ): Promise<DispatchRow>;
}
