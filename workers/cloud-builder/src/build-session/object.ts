import { AGENT_STOPPED_REASON, isAgentStopReason } from "@stella/contracts/agent-status";
import { isManagedModelAudience } from "@stella/contracts/gateway/capability";
import { DurableObject } from "cloudflare:workers";
import { parseExactTurnCancellationRequest } from "../execution-placement-turn-cancellation.js";
import { stableValueMarker } from "../hash.js";
import { orchestratorCliSpecDigest } from "../orchestrator-cli-turn-store.js";
import { normalizeOwnerGeneration } from "../owner-generation.js";
import { storageKeks } from "../secret-rotation.js";
import { configureThreadTranscriptCrypto } from "../thread-transcript.js";
import {
  HEADER_GATE_ADMITTED,
  parseCloudAgentTurnStartRequest,
} from "../turn-start-request.js";
import {
  acceptAgentTurn,
  admitAgentTurnThroughOwnerGate,
  turnRequestFromAgentStart,
} from "./admission.js";
import { runScheduledTurnAlarm } from "./alarms-recovery.js";
import { steerContainerAgent } from "./container-turn.js";
import { createBuildSessionHost, type BuildSessionInternals } from "./host.js";
import { retryOwnerFenceLeaseRetirements } from "./owner-fence-leases.js";
import { retryOwnerEventDebt } from "./session-core.js";
import {
  prewarmOrchestratorContainer,
  retryDueSandboxDestroyDebts,
} from "./session-sandbox.js";
import type { Env } from "./shared/env.js";
import {
  AgentTurnAuthorityLostError,
  OwnerPurgeFenceError,
} from "./shared/errors.js";
import {
  builderFallbackTranscriptKey,
  HEADER_BUILD_SESSION_NAME,
  HEADER_TURN_BROKER_ENDPOINT,
  json,
  turnDispatchIdentity,
} from "./shared/keys.js";
import type {
  BuilderFallbackTranscript,
  PendingTerminal,
  TurnRequest,
} from "./shared/types.js";
import {
  cancelExactAgentTurn,
  cancelForOwnerPurge,
  expireCurrentAgentTurn,
  handleAgentAttemptState,
  handleOrchestratorTurnStatus,
} from "./terminal-delivery.js";
import { handleTurnBroker } from "./turn-broker.js";

export class BuildSessionObject extends DurableObject<Env> {
  private readonly host: BuildSessionInternals;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    configureThreadTranscriptCrypto(ctx.storage.sql, storageKeks(env));
    this.host = createBuildSessionHost(ctx, env);
  }

  async alarm(): Promise<void> {
    await retryDueSandboxDestroyDebts(this.host);
    await retryOwnerFenceLeaseRetirements(this.host);
    await retryOwnerEventDebt(this.host);
    try {
      await runScheduledTurnAlarm(this.host);
    } finally {
      await this.host.scheduleDurabilityAlarm();
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/turn-broker") {
      return await handleTurnBroker(this.host, request);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }
    if (url.pathname === "/owner-purge-cancel") {
      return cancelForOwnerPurge(this.host, request);
    }
    if (url.pathname === "/expire-agent-turn") {
      return await expireCurrentAgentTurn(this.host, request);
    }
    if (url.pathname === "/attempt-state") {
      return await handleAgentAttemptState(this.host, request);
    }
    if (url.pathname === "/orchestrator-turn/status") {
      return await handleOrchestratorTurnStatus(this.host, request);
    }
    if (url.pathname === "/orchestrator-turn/prewarm") {
      return await prewarmOrchestratorContainer(this.host, request);
    }
    if (url.pathname === "/steer") {
      return await steerContainerAgent(this.host, request);
    }
    if (url.pathname === "/cancel") {
      const raw = await request.json().catch(() => null);
      const cancellation = parseExactTurnCancellationRequest(raw);
      if (!cancellation || cancellation.attemptGeneration === undefined) {
        return json(
          { canceled: false, reason: "exact_turn_identity_required" },
          400,
        );
      }
      const reason =
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        isAgentStopReason((raw as Record<string, unknown>).reason as string | undefined)
          ? AGENT_STOPPED_REASON
          : "The agent was stopped.";
      return await cancelExactAgentTurn(this.host, cancellation, reason);
    }

    if (url.pathname !== "/turn") return json({ error: "Not found." }, 404);
    const raw = (await request.json().catch(() => null)) as unknown;
    let turn: TurnRequest;
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      (raw as { kind?: unknown }).kind === "agent"
    ) {
      const parsed = parseCloudAgentTurnStartRequest(raw);
      if (!parsed.ok) return json({ error: parsed.message }, 400);
      if (parsed.request.execution.engine !== "anthropic") {
        return json({ error: "This agent runs in its conversation." }, 400);
      }
      turn = turnRequestFromAgentStart(parsed.request);
    } else {
      return json({ error: "Unsupported turn kind." }, 400);
    }
    delete turn.turnBrokerRoute;
    delete turn.gateAdmittedByCaller;
    if (request.headers.get(HEADER_GATE_ADMITTED)?.trim() === "1") {
      turn.gateAdmittedByCaller = true;
    }
    if (turn.agentRole === "orchestrator") {
      if (!turn.gateAdmittedByCaller) {
        return json(
          { error: "An orchestrator turn is dispatched by its conversation." },
          403,
        );
      }
      turn.orchestratorCliDigest = await orchestratorCliSpecDigest(
        turn.orchestratorCli!,
      );
    }
    const brokerSessionId =
      request.headers.get(HEADER_BUILD_SESSION_NAME)?.trim() ?? "";
    const brokerEndpoint =
      request.headers.get(HEADER_TURN_BROKER_ENDPOINT)?.trim() ?? "";
    if (brokerSessionId || brokerEndpoint) {
      try {
        const endpoint = new URL(brokerEndpoint);
        const localHttp =
          endpoint.protocol === "http:" &&
          (endpoint.hostname === "127.0.0.1" ||
            endpoint.hostname === "localhost");
        if (
          !brokerSessionId ||
          brokerSessionId.length > 512 ||
          (endpoint.protocol !== "https:" && !localHttp) ||
          endpoint.username ||
          endpoint.password ||
          endpoint.search ||
          endpoint.hash ||
          endpoint.pathname !==
            `/sessions/${encodeURIComponent(brokerSessionId)}/turn-broker`
        ) {
          throw new Error("invalid broker route");
        }
        turn.turnBrokerRoute = {
          sessionId: brokerSessionId,
          endpoint: endpoint.toString(),
        };
      } catch {
        return json({ error: "Trusted turn broker route is required." }, 400);
      }
    }
    const dispatchOwnerGeneration = normalizeOwnerGeneration(
      turn.ownerGeneration,
    );
    if (
      typeof turn.ownerId !== "string" ||
      !turn.ownerId.trim() ||
      typeof turn.turnId !== "string" ||
      !turn.turnId.trim() ||
      !dispatchOwnerGeneration
    ) {
      return json(
        { error: "ownerId, turnId, and ownerGeneration are required." },
        400,
      );
    }
    turn.ownerId = turn.ownerId.trim();
    turn.turnId = turn.turnId.trim();
    turn.ownerGeneration = dispatchOwnerGeneration;
    if (
      !isManagedModelAudience(turn.audience) ||
      typeof turn.budgetMicroCents !== "number" ||
      !Number.isFinite(turn.budgetMicroCents)
    ) {
      return json(
        { error: "audience and budgetMicroCents are required." },
        400,
      );
    }
    turn.threadId = turn.threadId!.trim();
    const storedTurn = await this.ctx.storage.get<TurnRequest>("turn");
    if (storedTurn?.turnId === turn.turnId) {
      const [storedFingerprint, replayFingerprint] = await Promise.all([
        stableValueMarker(turnDispatchIdentity(storedTurn)),
        stableValueMarker(turnDispatchIdentity(turn)),
      ]);
      if (storedFingerprint !== replayFingerprint) {
        await this.host.releaseOwnerGate(turn);
        return json(
          {
            error: "Turn dispatch was replayed with different input.",
            turnId: turn.turnId,
          },
          409,
        );
      }
      try {
        await this.host.assertTurnWritable(storedTurn);
        this.host.assertAgentTurnIdentity(turn);
        if (this.host.agentTurnExecutions.has(turn.turnId)) {
          return this.host.agentTurnAccepted(turn, true, { inProgress: true });
        }
        const [executionMarker, fallbackJournal] = await Promise.all([
          this.host.exactAgentExecutionMarker(storedTurn),
          this.ctx.storage.get<BuilderFallbackTranscript>(
            builderFallbackTranscriptKey(
              storedTurn.turnId,
              storedTurn.attemptGeneration!,
            ),
          ),
        ]);
        if (executionMarker || fallbackJournal) {
          await this.host.setExactTurnAlarm(storedTurn, Date.now());
          return json(
            { accepted: false, replayed: true, recoveryPending: true },
            425,
          );
        }
        const pending: PendingTerminal = {
          turnId: turn.turnId,
          attemptGeneration: turn.attemptGeneration!,
          kind: "failed",
          payload: {
            message:
              "The cloud worker restarted before this agent could finish. Try again.",
          },
          threadError:
            "The cloud worker restarted before this agent could finish.",
          terminateSandbox: true,
        };
        if (!(await this.host.claimTerminalDecision(storedTurn, pending))) {
          await this.host.releaseOwnerGate(turn);
          return json(
            { accepted: false, replayed: true, reason: "superseded" },
            409,
          );
        }
        await this.host.setExactTurnAlarm(storedTurn, Date.now());
        return json(
          { accepted: false, replayed: true, recoveryPending: true },
          425,
        );
      } catch (error) {
        if (error instanceof OwnerPurgeFenceError) {
          return json({ error: "Owner cloud activity is being purged." }, 409);
        }
        if (error instanceof AgentTurnAuthorityLostError) {
          return json(
            { error: "Cloud agent attempt is no longer active." },
            409,
          );
        }
        throw error;
      }
    }
    const gate = await admitAgentTurnThroughOwnerGate(this.host, turn);
    if (!gate.ok) return gate.response;
    try {
      delete turn.ownerPurgeGeneration;
      delete turn.ownerPurgeLeaseId;
      turn.ownerPurgeGeneration = await this.host.registerTurn(turn);
      await this.host.assertTurnWritable(turn);
      this.host.assertAgentTurnIdentity(turn);
      return await acceptAgentTurn(this.host, turn);
    } catch (error) {
      await this.host.unregisterTurn(turn);
      await this.host.releaseOwnerGate(turn);
      if (error instanceof OwnerPurgeFenceError) {
        return json({ error: "Owner cloud activity is being purged." }, 409);
      }
      if (error instanceof AgentTurnAuthorityLostError) {
        return json({ error: "Cloud agent attempt is no longer active." }, 409);
      }
      throw error;
    }
  }}
