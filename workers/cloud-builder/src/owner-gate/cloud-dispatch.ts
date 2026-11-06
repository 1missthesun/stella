import { releasingStub } from "../rpc-release.js";
import {
  type AdmittedCloudChat,
  chatTurnFingerprintSource,
  type CloudChatHandoff,
  cloudChatHandoffKey,
  type CloudChatPreparation,
  cloudChatTurnKey,
} from "../cloud-chat-admission.js";
import {
  HEADER_GATE_ADMITTED,
  HEADER_TURN_AUTH_KIND,
  turnStartErrorResponse,
} from "../turn-start-request.js";
import {
  cancelCloudAgentAttempt,
  type PiAgentExecution,
  runsAsPiAgent,
} from "../cloud-agent-dispatch.js";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import {
  DISPATCH_ACCEPTED_LEASE_MS,
  type DispatchPayload,
  type ExecutionCapability,
} from "@stella/contracts/turn-plane/placement";
import { sha256Hex } from "@stella/contracts/turn-plane/pairing-proof";
import { newAgentThreadId } from "@stella/contracts/backend/agent-threads";
import {
  OWNER_EVENT_VERSION,
  type OwnerEvent,
} from "@stella/contracts/turn-plane/owner-events";
import {
  type CloudAgentTurnStartRequest,
  type CloudAgentTurnStartResponse,
  type CloudTurnStartRequest,
  type CloudTurnStartResponse,
  TURN_OWNER_GENERATION_HEADER,
  TURN_PLANE_PROTOCOL,
} from "@stella/contracts/turn-plane/turn-start";
import {
  cloudUnsupportedCapabilities,
  isTerminalDispatchState,
} from "../dispatch-policy.js";
import type {
  OwnerGateAdmitInput,
  OwnerGateAdmissionWithLease,
  OwnerGateFenceLeaseRequest,
  DispatchPatch,
  DispatchRow,
  DispatchTransition,
} from "./types.js";
import {
  DISPATCH_CLOUD_RETRY_DELAY_MS,
  DISPATCH_CLOUD_MAX_ATTEMPTS,
} from "./constants.js";
import { log } from "./support.js";
import { OwnerGateDispatch } from "./dispatch.js";

const contextOnlyPrompt = (payload: DispatchPayload): string =>
  payload.context?.text ? "(Pasted text)" : "(Attached files)";

export abstract class OwnerGateCloudDispatch extends OwnerGateDispatch {
  protected cloudPayload(row: DispatchRow): DispatchPayload | null {
    if (!row.payload_json) return null;
    try {
      return JSON.parse(row.payload_json) as DispatchPayload;
    } catch {
      return null;
    }
  }

  /** A cloud run just started: it becomes this dispatch's execution unless the dispatch ended meanwhile. */
  protected async markCloudRunning(
    row: DispatchRow,
    patch: DispatchPatch,
    now: number,
  ): Promise<DispatchTransition> {
    const current = this.dispatchRow(row.dispatch_id) ?? row;
    const wanted =
      current.state === "cloud_committed" ||
      (current.state === "reconciliation_required" &&
        !current.cancel_request_id);
    if (!wanted) return { applied: false, row: current };
    return await this.transitionDispatch(
      current,
      "cloud_running",
      {
        placement: "cloud",
        cloud_retry_at: null,
        error_code: null,
        error_message: null,
        payload_json: null,
        payload_expires_at: null,
        lease_expires_at: null,
        started_at: now,
        ...patch,
      },
      now,
    );
  }

  protected async stopUnwantedCloudAgent(
    row: DispatchRow,
    threadId: string,
    turnId: string,
  ): Promise<void> {
    await cancelCloudAgentAttempt({
      env: this.env as unknown as Cloudflare.Env,
      conversationId: row.conversation_id,
      threadId,
      ownerId: this.ownerId(),
      ownerGeneration: row.owner_generation,
      turnId,
      attemptGeneration: 1,
      cancelRequestId: row.cancel_request_id ?? `dispatch-ended:${row.dispatch_id}`,
      reason: row.cancel_reason ?? "The turn was stopped.",
    }).catch((error: unknown) => {
      log("error", "dispatch_unwanted_cloud_agent_stop_failed", {
        dispatchId: row.dispatch_id,
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  protected async runCloudBranch(
    row: DispatchRow,
    now: number,
  ): Promise<DispatchRow> {
    if (row.state !== "cloud_committed") return row;
    const required = JSON.parse(
      row.required_capabilities,
    ) as ExecutionCapability[];
    const unsupported = cloudUnsupportedCapabilities(required);
    if (unsupported.length > 0) {
      const failed = await this.transitionDispatch(
        row,
        "failed",
        {
          payload_json: null,
          payload_expires_at: null,
          lease_expires_at: null,
          error_code: "CLOUD_CAPABILITY_UNAVAILABLE",
          error_message: `The cloud sandbox cannot provide the required device capability: ${unsupported.join(", ")}.`,
        },
        now,
      );
      if (failed.applied) await this.releaseGate(failed.row);
      return failed.row;
    }
    const payload = this.cloudPayload(row);
    if (!payload) {
      const failed = await this.transitionDispatch(
        row,
        "failed",
        {
          lease_expires_at: null,
          error_code: "CLOUD_PAYLOAD_UNAVAILABLE",
          error_message: "The dispatch payload is no longer available.",
        },
        now,
      );
      if (failed.applied) await this.releaseGate(failed.row);
      return failed.row;
    }
    const attempt = await this.transitionDispatch(
      row,
      "cloud_committed",
      { cloud_attempts: row.cloud_attempts + 1, cloud_retry_at: null },
      now,
      { notifyExecutor: false },
    );
    if (!attempt.applied) return attempt.row;
    const attempting = attempt.row;
    try {
      return row.kind === "chat"
        ? await this.startCloudChat(attempting, payload, now)
        : await this.startCloudAgent(attempting, payload, now);
    } catch (error) {
      log("error", "dispatch_cloud_start_unresolved", {
        dispatchId: row.dispatch_id,
        kind: row.kind,
        message: error instanceof Error ? error.message : String(error),
      });
      return this.dispatchRow(row.dispatch_id) ?? row;
    }
  }

  protected async cloudRefusal(
    row: DispatchRow,
    response: Response,
    now: number,
  ): Promise<DispatchRow> {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: unknown; message?: unknown };
    } | null;
    const code =
      typeof body?.error?.code === "string" ? body.error.code : "internal";
    const message =
      typeof body?.error?.message === "string"
        ? body.error.message
        : `The cloud refused this dispatch (${response.status}).`;
    if (
      response.status === 503 &&
      row.cloud_attempts < DISPATCH_CLOUD_MAX_ATTEMPTS
    ) {
      const retrying = await this.transitionDispatch(
        row,
        "cloud_committed",
        {
          cloud_retry_at: now + DISPATCH_CLOUD_RETRY_DELAY_MS,
          lease_expires_at: now + DISPATCH_ACCEPTED_LEASE_MS,
          error_code: code,
          error_message: message,
        },
        now,
        { notifyExecutor: false },
      );
      if (retrying.applied) await this.scheduleAlarm(now);
      else if (isTerminalDispatchState(retrying.row.state)) {
        await this.releaseGate(retrying.row);
      }
      return retrying.row;
    }
    const failed = await this.transitionDispatch(
      row,
      "failed",
      {
        payload_json: null,
        payload_expires_at: null,
        lease_expires_at: null,
        error_code: code,
        error_message: message,
      },
      now,
    );
    if (isTerminalDispatchState(failed.row.state)) {
      await this.releaseGate(failed.row);
    }
    return failed.row;
  }

  protected async startCloudChat(
    row: DispatchRow,
    payload: DispatchPayload,
    now: number,
  ): Promise<DispatchRow> {
    this.prepareGatewayOwner();
    const sessions = this.env.ORCHESTRATOR_SESSIONS;
    if (!sessions)
      throw new Error("Orchestrator session namespace is not bound.");
    const preparedReader = this.prepareCloudChatReader(
      sessions,
      row.conversation_id,
    );
    const request: CloudTurnStartRequest = {
      protocol: TURN_PLANE_PROTOCOL,
      clientMsgId: row.dispatch_id,
      ...(payload.userMessageEventId
        ? { originUserMessageId: payload.userMessageEventId }
        : {}),
      prompt: payload.prompt || contextOnlyPrompt(payload),
      lane: "chat",
      source: row.ingress === "schedule" ? "schedule" : "placement",
      ...(payload.locale ? { locale: payload.locale } : {}),
      ...(payload.attachments ? { attachments: payload.attachments } : {}),
      ...(payload.context && row.ingress !== "schedule"
        ? { context: payload.context }
        : {}),
      ...(payload.execution ? { execution: payload.execution } : {}),
      ...(payload.handoff || row.ingress === "schedule"
        ? { hiddenMessage: true }
        : {}),
      ...(row.ingress === "schedule" && payload.scheduledAgent
        ? {
            piAgent: {
              op: "start" as const,
              threadId: `thr-${row.dispatch_id.replace(/[^A-Za-z0-9]/g, "").slice(-24)}`,
              description: payload.scheduledAgent.description.slice(0, 1_000),
            },
          }
        : {}),
    };
    const handoffKey = cloudChatHandoffKey(row.dispatch_id);
    let handoff = await this.ctx.storage.get<CloudChatHandoff>(handoffKey);
    // Old unresolved dispatches may already have a conversation-created turn.
    // Only a new dispatch starts the owner-created identity protocol.
    if (!handoff && row.cloud_attempts === 1) {
      const allocating: CloudChatHandoff = {
        phase: "allocating",
        turnId: crypto.randomUUID(),
        leaseId: crypto.randomUUID(),
      };
      await this.ctx.storage.transaction(async (txn) => {
        await txn.put(handoffKey, allocating);
        await txn.put(cloudChatTurnKey(allocating.turnId), row.dispatch_id);
      });
      handoff = allocating;
    }
    let preparation: CloudChatPreparation = {};
    if (handoff?.phase === "retired")
      return this.cloudRefusal(
        row,
        turnStartErrorResponse(
          "owner_purged",
          "This cloud admission was retired.",
          false,
        ),
        now,
      );
    if (handoff?.phase === "allocating") {
      const startedAt = performance.now();
      const result = await this.admitWithFenceLease({
        admission: {
          lane: "chat",
          turnId: handoff.turnId,
          conversationId: row.conversation_id,
          expectedGeneration: row.owner_generation,
        },
        lease: {
          leaseId: handoff.leaseId,
          turnId: handoff.turnId,
          ownerGeneration: row.owner_generation,
          sessionId: sessions.idFromName(row.conversation_id).toString(),
          namespace: "orchestrator",
          role: "orchestrator",
        },
        includeHomeContext: true,
      });
      if (!result.admission.ok)
        return this.cloudRefusal(
          row,
          turnStartErrorResponse(
            result.admission.code,
            result.admission.message,
            result.admission.retryable,
            result.admission.retryAfterMs,
          ),
          now,
        );
      this.setGateHeld(row.dispatch_id, true);
      row.gate_held = 1;
      if (result.lease.status !== "registered")
        return this.cloudRefusal(
          row,
          turnStartErrorResponse(
            "owner_purged",
            "This account's cloud admission is unavailable.",
            false,
          ),
          now,
        );
      const authority: AdmittedCloudChat = {
        version: 1,
        ownerId: this.ownerId(),
        ownerGeneration: row.owner_generation,
        conversationId: row.conversation_id,
        clientMsgId: request.clientMsgId,
        turnId: handoff.turnId,
        leaseId: handoff.leaseId,
        fenceGeneration: result.lease.generation,
        admittedAt: Date.now(),
        snapshot: result.admission.snapshot,
        fingerprint: await sha256Hex(
          chatTurnFingerprintSource(
            this.ownerId(),
            row.conversation_id,
            request,
          ),
        ),
      };
      if ("homeContext" in result && result.homeContext) {
        const preparedReaderId = await preparedReader;
        const reader = preparedReaderId
          ? { readerId: preparedReaderId }
          : await this.modelGrants().latestReader(row.conversation_id);
        if (reader) {
          authority.ownerModelGrant = await this.issueModelGrant({
            ownerId: authority.ownerId,
            ownerGeneration: authority.ownerGeneration,
            conversationId: authority.conversationId,
            readerId: reader.readerId,
            turnId: authority.turnId,
            leaseId: authority.leaseId,
            fenceGeneration: authority.fenceGeneration,
            policy: result.homeContext.memory.preference,
            expiresAt: result.lease.expiresAt,
          });
        }
      }
      handoff = { phase: "registered", authority };
      const latest = await this.ctx.storage.get<CloudChatHandoff>(handoffKey);
      if (latest?.phase === "retired") {
        await this.release({ turnId: authority.turnId });
        return this.cloudRefusal(
          row,
          turnStartErrorResponse(
            "owner_purged",
            "This cloud admission was retired.",
            false,
          ),
          now,
        );
      }
      await this.ctx.storage.put(handoffKey, handoff);
      preparation = {
        ...("homeContext" in result ? { homeContext: result.homeContext } : {}),
        ...("destinations" in result
          ? { destinations: result.destinations }
          : {}),
      };
      log("info", "owner_chat_admission_timing", {
        dispatchId: row.dispatch_id,
        turnId: authority.turnId,
        totalMs: Math.round(performance.now() - startedAt),
      });
    }
    if (handoff?.phase === "registered") {
      const current = this.dispatchRow(row.dispatch_id);
      const named =
        current?.state === "cloud_committed"
          ? await this.transitionDispatch(
              current,
              "cloud_committed",
              { cloud_turn_id: handoff.authority.turnId },
              now,
              { notifyExecutor: false },
            )
          : null;
      if (!named?.applied) {
        await this.retireCloudChatHandoff(handoff.authority);
        await this.releaseGate(row);
        return this.dispatchRow(row.dispatch_id) ?? row;
      }
      row = named.row;
    }
    const response =
      handoff?.phase === "registered"
        ? await sessions
            .getByName(row.conversation_id)
            .startAdmittedChat(request, handoff.authority, preparation)
        : await sessions
            .getByName(row.conversation_id)
            .fetch("https://orchestrator-session/turn", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-stella-owner": this.ownerId(),
                [HEADER_TURN_AUTH_KIND]: "service",
                "x-stella-conversation-id": row.conversation_id,
                [TURN_OWNER_GENERATION_HEADER]: row.owner_generation,
              },
              body: JSON.stringify(request),
            });
    if (!response.ok) {
      if (
        handoff?.phase === "registered" &&
        response.status >= 400 &&
        response.status < 500
      ) {
        await this.retireCloudChatHandoff(handoff.authority);
      }
      return await this.cloudRefusal(row, response, now);
    }
    const started = (await response.json()) as CloudTurnStartResponse;
    if (
      handoff?.phase === "registered" &&
      started.turnId !== handoff.authority.turnId
    )
      throw new Error("Cloud admission response identity changed.");
    const running = await this.markCloudRunning(
      row,
      { cloud_turn_id: started.turnId },
      now,
    );
    return running.row;
  }

  protected async retireCloudChatHandoff(a: AdmittedCloudChat): Promise<void> {
    const sessions = this.env.ORCHESTRATOR_SESSIONS;
    if (!sessions) throw new Error("Orchestrator sessions unavailable.");
    const retired = await this.ownerFenceCall("unregister", {
      ownerId: a.ownerId,
      ownerGeneration: a.ownerGeneration,
      leaseId: a.leaseId,
      turnId: a.turnId,
      sessionId: sessions.idFromName(a.conversationId).toString(),
      generation: a.fenceGeneration,
    });
    if (!retired.ok) throw new Error("Cloud admission retirement is pending.");
    await this.modelGrants().retireExactTurnLease({
      ownerGeneration: a.ownerGeneration,
      conversationId: a.conversationId,
      turnId: a.turnId,
      leaseId: a.leaseId,
    });
    await this.ctx.storage.put(cloudChatHandoffKey(a.clientMsgId), {
      phase: "retired",
      turnId: a.turnId,
      leaseId: a.leaseId,
    } satisfies CloudChatHandoff);
  }

  protected async startCloudAgent(
    row: DispatchRow,
    payload: DispatchPayload,
    now: number,
  ): Promise<DispatchRow> {
    const sessions = this.env.BUILD_SESSIONS;
    if (!sessions) throw new Error("Build session namespace is not bound.");
    const snapshot = await this.snapshot({ now });
    const threadId = newAgentThreadId();
    const request: CloudAgentTurnStartRequest = {
      protocol: TURN_PLANE_PROTOCOL,
      kind: "agent",
      ownerId: this.ownerId(),
      ownerGeneration: row.owner_generation,
      conversationId: row.conversation_id,
      threadId,
      agentDepth: 1,
      attemptGeneration: 1,
      turnId: row.dispatch_id,
      prompt: payload.prompt,
      description: payload.description ?? "Placed agent run",
      execution: payload.execution ?? snapshot.execution,
      audience: snapshot.allowance.audience,
      budgetMicroCents: snapshot.allowance.budgetMicroCents,
      source: "placement",
      clientMsgId: row.dispatch_id,
      ...(row.parent_turn_id ? { parentTurnId: row.parent_turn_id } : {}),
    };
    if (runsAsPiAgent(request.execution)) {
      const started = await this.startPiPlacedAgent(
        row,
        {
          ...request,
          execution: request.execution,
        },
        now,
      );
      if (started.state === "cloud_running") {
        await this.recordPlacedAgent(started, request, now);
      }
      return started;
    }
    const response = await sessions
      .getByName(threadId)
      .fetch("https://build-session/turn", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HEADER_GATE_ADMITTED]: "1",
        },
        body: JSON.stringify(request),
      });
    if (!response.ok) return await this.cloudRefusal(row, response, now);
    const started = (await response.json()) as CloudAgentTurnStartResponse;
    const running = await this.markCloudRunning(
      row,
      {
        cloud_turn_id: started.turnId ?? row.dispatch_id,
        cloud_thread_id: started.threadId ?? threadId,
      },
      now,
    );
    if (!running.applied) {
      await this.stopUnwantedCloudAgent(
        running.row,
        started.threadId ?? threadId,
        started.turnId ?? row.dispatch_id,
      );
      return running.row;
    }
    await this.recordPlacedAgent(
      running.row,
      { ...request, threadId: started.threadId ?? threadId },
      now,
    );
    return running.row;
  }

  protected async startPiPlacedAgent(
    row: DispatchRow,
    request: CloudAgentTurnStartRequest & { execution: PiAgentExecution },
    now: number,
  ): Promise<DispatchRow> {
    const sessions = this.env.ORCHESTRATOR_SESSIONS;
    if (!sessions) throw new Error("Orchestrator sessions unavailable.");
    await releasingStub(sessions.getByName(row.conversation_id)).startPiThread({
      ownerId: request.ownerId,
      ownerGeneration: request.ownerGeneration,
      conversationId: row.conversation_id,
      audience: request.audience as ManagedModelAudience,
      budgetMicroCents: request.budgetMicroCents,
      execution: request.execution,
      prompt: request.prompt,
      attempt: {
        threadId: request.threadId,
        description: request.description,
        turnId: row.dispatch_id,
        attemptGeneration: 1,
        lineage: { depth: 1 },
      },
    });
    const running = await this.markCloudRunning(
      row,
      { cloud_turn_id: row.dispatch_id, cloud_thread_id: request.threadId },
      now,
    );
    if (!running.applied) {
      await this.stopUnwantedCloudAgent(
        running.row,
        request.threadId,
        row.dispatch_id,
      );
    }
    await this.releaseGate(running.row);
    return running.row;
  }

  /**
   * The owner's agent threads learn of an agent placed in the cloud, which
   * runs as its BuildSession or pi agent reports it: without the row, its
   * completion would land nowhere. The session does not record it itself,
   * since this gate admitted it. Best effort: the agent already started.
   */
  protected async recordPlacedAgent(
    row: DispatchRow,
    request: CloudAgentTurnStartRequest,
    now: number,
  ): Promise<void> {
    try {
      await this.applyOwnerEvents([
        {
          v: OWNER_EVENT_VERSION,
          key: `${request.threadId}:1`,
          ownerId: this.ownerId(),
          ownerGeneration: row.owner_generation,
          emittedAt: now,
          kind: "thread.spawned",
          threadId: request.threadId,
          conversationId: row.conversation_id,
          parentTurnId: row.parent_turn_id ?? row.dispatch_id,
          agentDepth: 1,
          attemptGeneration: 1,
          description: request.description,
          prompt: request.prompt,
          execution: request.execution,
          placement: "cloud",
          createdAt: now,
        },
      ]);
    } catch (error) {
      log("error", "dispatch_cloud_agent_record_failed", {
        dispatchId: row.dispatch_id,
        threadId: request.threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  abstract applyOwnerEvents(events: OwnerEvent[]): Promise<void>;
  abstract admitWithFenceLease(input: {
    admission: OwnerGateAdmitInput;
    lease: OwnerGateFenceLeaseRequest;
    includeHomeContext?: boolean;
  }): Promise<OwnerGateAdmissionWithLease>;
}
