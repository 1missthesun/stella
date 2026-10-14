import { AGENT_STOP_WIRE_REASON, AGENT_STOPPED_REASON } from "@stella/contracts/agent-status";
import {
  agentAttemptOutcomeOf,
  type AgentAttemptOutcome,
} from "@stella/contracts/agent-status";
import type {
  AdmittedCloudChat,
  CloudChatPreparation,
} from "../cloud-chat-admission.js";
import { PLACEMENT_PROTOCOL } from "@stella/contracts/turn-plane/placement";
import type { CloudTurnContext } from "@stella/contracts/turn-plane/turn-start";
import {
  claimFreePiBrain,
  decidePiBrainClaim,
  homePiBrain,
  samePiBrainHost,
  movePiBrain,
  piBrainHandoffPrompt,
  piBrainHostName,
  renewPiBrainLease,
  takeOverPiBrain,
  type PiBrainClaimDecision,
  type PiBrainHost,
  type PiBrainRecord,
} from "@stella/contracts/turn-plane/pi-brain";
import { guardedModelFetch } from "../guarded-model-fetch.js";
import {
  AGENT_MESSAGE_FRAMED_MAX_CHARS,
  type AgentMessagingCaller,
  stopAgentThread,
  readAgentDirectory,
  sendAgentMessage,
} from "../agent-messaging.js";
import {
  type LocalOwnerModelGrantExpectation,
  releaseOwnerModelGrantAfterBody,
} from "../local-owner-model-grants.js";
import type { AgentActivityEntry } from "@stella/contracts/conversation-agent-activity";
import {
  OWNER_EVENT_VERSION,
  type OwnerEvent,
} from "@stella/contracts/turn-plane/owner-events";
import { CLOUD_HISTORY_TOKEN_BUDGET } from "@stella/executor-cloud/prune-history";
import {
  type JournalCheckpoint,
  type JournalCheckpointFirstKept,
  parseJournalCheckpoint,
} from "@stella/contracts/journal-checkpoint";
import type { JournalStart } from "@stella/agent/stella/journal-sync";
import {
  cancelDeviceAgent,
  continueDeviceAgent,
  type DeviceAgentCaller,
  spawnDeviceAgent,
} from "../device-agent-tools.js";
import {
  agentLifecycleReport,
  dispatchCloudAgentTurn,
  isCloudAgentControlActive,
  steerContainerAgent,
  toolScopedId,
  type CloudAgentControlReceipt,
  type PiHarnessAgentControl,
  type PiHarnessAgentControlResult,
  type PiThreadStop,
  type PiThreadStopResult,
  type PiThreadStart,
  type PiThreadSteer,
  type PiThreadSteerResult,
} from "../cloud-agent-dispatch.js";
import {
  type CloudCodeSourceAgentTool,
  createCloudCodeAgentTool,
} from "../cloud-code-tool.js";
import type { CloudBrowserClient } from "../cloud-browser.js";
import { createCloudWebTool } from "../cloud-web-tool.js";
import { createCloudImageGenTool } from "../cloud-image-gen-tool.js";
import { createCloudVideoGenTool } from "../cloud-video-gen-tool.js";
import { unwrapRpc } from "../owner-store/errors.js";
import { sha256Hex } from "../hash.js";
import {
  CloudConnectorDirectory,
  ownerMcpSource,
  createCloudConnectClient,
} from "../cloud-connect-client.js";
import {
  listIntegrationActions,
  listIntegrationCatalog,
} from "../integrations/catalog.js";
import { sleepWithAbort } from "@stella/runtime/kernel/tools/effect-runtime.js";
import { utf8Length } from "../conversation-types.js";
import { localTurnId as makeLocalTurnId } from "../local-turn-protocol.js";
import type {
  OwnerFencedTurn,
  PiThreadOutcome,
  PiThreadRecord,
  BrainHandoff,
  AgentsView,
  LocalTurnLease,
} from "./types.js";
import {
  BROWSER_HANDOFF_POLL_MS,
  BROWSER_HANDOFF_GRACE_MS,
  AGENT_RUNTIME_KEY,
  PI_DEVICE_AGENT_PREFIX,
  piThreadKey,
  PI_LIVE_KEY,
  PI_BRAIN_KEY,
  LOCAL_TURN_LEASE_KEY,
  JOURNAL_CHECKPOINT_KEY,
  BRAIN_HANDOFF_KEY,
  AGENT_RECONCILE_INTERVAL_MS,
  AGENTS_VIEW_KEY,
  AGENTS_UNOWNED_SETTLED_KEY,
  AGENT_OWNER_RECORD_LAG_MS,
  PI_HEARTBEAT_MS,
} from "./constants.js";
import {
  OwnerPurgeFenceError,
  piReportOutcome,
  cloudExecutionContext,
  piModelSpec,
  errorMessage,
  log,
} from "./support.js";
import {
  isSlackConversationId,
  SLACK_CONNECTOR_SOURCE,
} from "../slack/workspace.js";
import { OrchestratorCloudAgents } from "./cloud-agents.js";
import { resolveCloudSpawnExecution } from "../cloud-spawn-model.js";

export abstract class OrchestratorPi extends OrchestratorCloudAgents {
  protected abstract claudeCodeTransport(): import("./claude-code-transport.js").CloudClaudeCodeTransport;

  protected async acquireOwnerModelGrant(
    expected: LocalOwnerModelGrantExpectation,
  ) {
    const freezeEpoch = this.localOwnerModelGrants.freezeEpoch(expected);
    const issued = await this.ownerGate(expected.ownerId).acquireModelGrant({
      ownerId: expected.ownerId,
      ownerGeneration: expected.ownerGeneration,
      conversationId: expected.conversationId,
      readerId: this.isolateId,
      turnId: expected.turnId,
      leaseId: expected.leaseId,
      fenceGeneration: expected.fenceGeneration,
      policy: expected.memoryPolicy,
    });
    const grant = this.localOwnerModelGrants.validAfter(
      issued,
      expected,
      freezeEpoch,
    );
    if (!grant) throw new OwnerPurgeFenceError();
    return { grant, expected };
  }

  protected async piAgentGuard(
    authority: import("../pi-runtime.js").PiAuthority,
    turnId: string,
  ): Promise<import("../pi-runtime.js").PiAgentGuard> {
    const fenced: OwnerFencedTurn = {
      ownerId: authority.ownerId,
      ownerGeneration: authority.ownerGeneration,
      turnId,
    };
    const fenceGeneration = await this.registerOwnerTurn(fenced);
    const leaseId = fenced.ownerPurgeLeaseId;
    try {
      if (!leaseId) throw new OwnerPurgeFenceError();
      const { memory } = await this.ownerGate(authority.ownerId).homeContext(
        authority.ownerGeneration,
        fenceGeneration,
      );
      const expected: LocalOwnerModelGrantExpectation = {
        ownerId: authority.ownerId,
        ownerGeneration: authority.ownerGeneration,
        conversationId: authority.conversationId,
        turnId,
        leaseId,
        fenceGeneration,
        memoryPolicy: memory.preference,
      };
      let grantWork = this.acquireOwnerModelGrant(expected);
      void grantWork.catch(() => undefined);
      const currentGrant = async () => {
        const current = await grantWork;
        if (
          !this.localOwnerModelGrants.valid(current.grant, current.expected)
        ) {
          throw new OwnerPurgeFenceError();
        }
        if (current.grant.expiresAt - Date.now() > 60_000) return current;
        grantWork = this.acquireOwnerModelGrant(expected);
        void grantWork.catch(() => undefined);
        return await grantWork;
      };
      const gateway = this.env.MODEL_GATEWAY;
      if (!gateway) throw new Error("Model gateway is not configured.");
      return {
        fetch: async (request) => {
          const current = await currentGrant();
          const active = this.localOwnerModelGrants.begin(
            current.grant,
            current.expected,
            request.signal,
          );
          try {
            const response = await guardedModelFetch({
              request: new Request(request, { signal: active.requestSignal }),
              fetch: (value) => gateway.fetch(value),
              mode: "authorize-before-fetch",
              authorize: async () => {
                if (this.purged()) throw new OwnerPurgeFenceError();
                active.assertValid();
              },
            });
            return releaseOwnerModelGrantAfterBody(response, active.release);
          } catch (error) {
            active.release();
            throw error;
          }
        },
        release: async () => {
          await this.unregisterOwnerTurn(fenced);
        },
      };
    } catch (error) {
      await this.unregisterOwnerTurn(fenced).catch(() => undefined);
      throw error;
    }
  }

  protected piGatewayOrigin(): string {
    return this.env.MODEL_GATEWAY_URL?.trim() ?? "";
  }

  protected async attachPiClients(): Promise<{
    snapshot: unknown;
    hasOlder: boolean;
  }> {
    const attaching = this.piClientsAttaching;
    this.piClientsAttaching = true;
    try {
      const runtime = await this.openPiRuntime(this.piGatewayOrigin());
      const { contextFor } = await import("../pi-runtime.js");
      return await runtime.watchForClients(
        (events) => this.hub.broadcastPi(events),
        contextFor(),
      );
    } finally {
      this.piClientsAttaching = attaching;
    }
  }

  protected async openPiRuntime(
    gatewayOrigin: string,
  ): Promise<import("../pi-runtime.js").PiConversationRuntime> {
    const slack = isSlackConversationId(this.conversationId());
    this.piRuntime ??= import("../pi-runtime.js").then(
      ({ PiConversationRuntime }) =>
        new PiConversationRuntime({
          storage: this.ctx.storage,
          env: this.env,
          gatewayOrigin,
          journalStart: () => this.journalStart(),
          archivedEntries: {
            read: (piConversationId, options) =>
              this.archive.readPiEntries(piConversationId, options),
            has: (piConversationId, beforeId) =>
              this.archive.hasArchivedPiEntries(piConversationId, beforeId),
          },
          waitUntil: (work) => this.ctx.waitUntil(work),
          report: (error) =>
            log("error", "pi_runtime_report", { message: errorMessage(error) }),
          log: (event, fields) => log("info", event, fields),
          deliverNote: (note, authority) =>
            this.deliverPiAgentNote(note, authority),
          deliverThreadReport: (report) => this.deliverPiThreadReport(report),
          noteLedgerReport: (report, turnId, agent) => {
            if (!agent.running) {
              this.publishPiAgentTerminal(
                report.threadId,
                agent,
                piReportOutcome(report),
              );
            }
            if (agent.files?.length) {
              this.publishTurnFilesCard(
                turnId,
                `pi-files:${report.requestId}`,
                agent.files,
              );
            }
          },
          agentStarted: (event) =>
            this.publishAgentLifecycleCard(event.turnId, Date.now(), {
              type: "agent-lifecycle",
              eventId: `pi-agent:${event.threadId}:${event.attempt}:started`,
              event: {
                type: "agent-started",
                payload: {
                  agentId: event.threadId,
                  attemptGeneration: event.attempt,
                  description: event.description,
                  agentType: "general",
                  ...(event.attempt > 1 ? { isFollowUp: true } : {}),
                },
              },
            }),
          agentStopped: (event) =>
            this.publishPiAgentTerminal(
              event.threadId,
              event,
              { kind: "canceled", body: AGENT_STOPPED_REASON },
              event.turnId,
            ),
          agentsChanged: () => this.refreshAgentsSoon(),
          agentLedger: (event) => {
            void this.recordPiAgentRun(event).catch((error: unknown) => {
              log("error", "pi_agent_record_failed", {
                threadId: event.threadId,
                message: errorMessage(error),
              });
            });
          },
          agentTools: (authority, browser, history, delivery) =>
            this.createPiAgentTools(authority, browser, history, delivery),
          ...(slack
            ? {}
            : {
                browserHandoff: (
                  handoff: Parameters<OrchestratorPi["awaitPiBrowserHandoff"]>[0],
                  signal: AbortSignal | undefined,
                ) => this.awaitPiBrowserHandoff(handoff, signal),
                deviceAgents: this.piDeviceAgents(),
                threadAgents: this.piThreadAgents(),
              }),
          claudeCode: this.claudeCodeTransport(),
          agentGuard: (authority, turnId) =>
            this.piAgentGuard(authority, turnId),
          moveBrain: slack ? undefined : async (authority, host, brief) => {
            const handoff: BrainHandoff = {
              turnId: this.activeTurnId ?? "",
              ownerId: authority.ownerId,
              ownerGeneration: authority.ownerGeneration,
              deviceId: host.deviceId,
              clientMsgId: `handoff-${crypto.randomUUID()}`,
              prompt: piBrainHandoffPrompt("the cloud", brief),
            };
            if (this.activeTurnId) {
              await this.putTurnState({ [BRAIN_HANDOFF_KEY]: handoff });
              await this.setPiBrain(host);
              return;
            }
            await this.setPiBrain(host);
            await this.placeOnPiBrain({ ...handoff, handoff: true });
          },
          agentDirectory: {
            list: async (authority, threadIds) =>
              await readAgentDirectory(
                this.piOwnerCaller(authority),
                authority.conversationId,
                threadIds,
              ),
            message: async (authority, args) =>
              await sendAgentMessage(this.piOwnerCaller(authority), {
                ...args,
                conversationId: authority.conversationId,
              }),
            stop: async (authority, args) =>
              await stopAgentThread(this.piOwnerCaller(authority), {
                ...args,
                conversationId: authority.conversationId,
              }),
          },
          heartbeat: () => {
            void (async () => {
              await this.ctx.storage.put(PI_LIVE_KEY, true);
              await this.armAlarmNoLaterThan(Date.now() + PI_HEARTBEAT_MS);
            })().catch(() => undefined);
          },
        }),
    );
    const runtime = await this.piRuntime;
    await runtime.open();
    if (!this.agentsView) {
      this.agentsView = { pi: [], owner: [] };
      this.refreshAgentsSoon();
    }
    if (
      !runtime.watchingForClients &&
      !this.piClientsAttaching &&
      this.hub.piSocketCount() > 0
    ) {
      this.piClientsAttaching = true;
      void import("../pi-runtime.js")
        .then(async ({ contextFor }) => {
          const view = await runtime.watchForClients(
            (events) => this.hub.broadcastPi(events),
            contextFor(),
          );
          this.hub.broadcastPi([view.snapshot]);
        })
        .catch((error: unknown) => {
          log("error", "pi_clients_attach_failed", {
            message: errorMessage(error),
          });
        })
        .finally(() => {
          this.piClientsAttaching = false;
        });
    }
    return runtime;
  }

  protected piOwnerCaller(
    authority: import("../pi-runtime.js").PiAuthority,
  ): AgentMessagingCaller {
    return {
      ownerGeneration: authority.ownerGeneration,
      ownerInternal: async (name, args) =>
        unwrapRpc(
          await this.ownerGate(authority.ownerId).ownerInternal({
            name,
            args,
            ownerGeneration: authority.ownerGeneration,
          }),
        ),
    };
  }

  protected piDeviceAgents(): import("../pi-runtime.js").PiDeviceAgents {
    type Authority = import("../pi-runtime.js").PiAuthority;
    const caller = (
      authority: Authority,
      parentTurnId: string,
    ): DeviceAgentCaller => ({
      ownerInternal: async (name, args) =>
        unwrapRpc(
          await this.ownerGate(authority.ownerId).ownerInternal({
            name,
            args,
            ownerGeneration: authority.ownerGeneration,
          }),
        ),
      ownerGeneration: authority.ownerGeneration,
      conversationId: authority.conversationId,
      parentTurnId,
    });
    const receiptKey = (threadId: string) =>
      `${PI_DEVICE_AGENT_PREFIX}${threadId}`;
    const receipt = async (
      threadId: string,
    ): Promise<CloudAgentControlReceipt> => {
      const prior = await this.ctx.storage.get<CloudAgentControlReceipt>(
        receiptKey(threadId),
      );
      if (!prior) throw new Error(`No agent ${threadId} here.`);
      return prior;
    };
    const requestId = (authority: Authority, key: string) =>
      `pi:${authority.conversationId}:${key}`.slice(0, 128);
    return {
      start: async (args, authority, parentTurnId) => {
        const started = await spawnDeviceAgent(
          {
            ...caller(authority, parentTurnId),
            ...(args.parentThreadId ? { parentThreadId: args.parentThreadId } : {}),
          },
          {
            clientMsgId: requestId(authority, args.key),
            targetDeviceId: args.deviceId,
            description: args.description,
            prompt: args.prompt,
            ...(args.model ? { model: args.model } : {}),
          },
        );
        await this.ctx.storage.put(receiptKey(started.threadId), started);
        return { threadId: started.threadId, ...(started.waitingForDevice ? { waiting: true } : {}) };
      },
      message: async (args, authority, parentTurnId) => {
        const { receipt: next, delivery } = await continueDeviceAgent(
          caller(authority, parentTurnId),
          await receipt(args.threadId),
          {
            controlRequestId: requestId(authority, args.key),
            message: args.message,
          },
        );
        await this.ctx.storage.put(receiptKey(args.threadId), next);
        return delivery;
      },
      stop: async (args, authority, parentTurnId) => {
        const next = await cancelDeviceAgent(
          caller(authority, parentTurnId),
          await receipt(args.threadId),
          requestId(authority, args.key),
        );
        await this.ctx.storage.put(receiptKey(args.threadId), next);
      },
    };
  }

  protected piThreadAgents(): import("../pi-runtime.js").PiThreadAgents {
    type Authority = import("../pi-runtime.js").PiAuthority;
    const executionOf = (model: string, authority: Authority) =>
      resolveCloudSpawnExecution(model, authority.execution);
    const scopedId = (
      authority: Authority,
      parentTurnId: string,
      purpose: "thread" | "turn" | "message",
      key: string,
    ) =>
      toolScopedId({
        ownerGeneration: authority.ownerGeneration,
        parentTurnId: `pi:${authority.conversationId}`,
        purpose,
        toolCallId: `${purpose === "thread" ? "" : parentTurnId}:${key}`,
      });
    const dispatch = async (
      authority: Authority,
      parentTurnId: string,
      attempt: Parameters<typeof dispatchCloudAgentTurn>[0]["attempt"],
    ) =>
      await this.rememberCloudAgentControlReceipt(
        await dispatchCloudAgentTurn({
          dependencies: {
            env: this.env,
            ownerGateAdmit: async (input) =>
              await this.ownerGateAdmit(input.ownerId, {
                lane: "agent",
                turnId: input.turnId,
                conversationId: input.conversationId,
                expectedGeneration: input.expectedGeneration,
              }),
            releaseOwnerGate: async (input) => await this.releaseOwnerGate(input),
            deliverOwnerEvents: async (events) =>
              await this.deferOwnerEvents([...events]),
            startPiThread: async (input) => await this.startPiThread(input),
          },
          caller: {
            ownerId: authority.ownerId,
            ownerGeneration: authority.ownerGeneration,
            conversationId: authority.conversationId,
            parentTurnId,
            agentDepth: 0,
          },
          attempt,
        }),
      );
    return {
      check: (model, authority) => {
        executionOf(model, authority);
      },
      start: async (args, authority, parentTurnId) => {
        const threadId = await scopedId(authority, parentTurnId, "thread", args.key);
        const turnId = await scopedId(authority, parentTurnId, "turn", args.key);
        const control = await dispatch(authority, parentTurnId, {
          threadId,
          attemptGeneration: 1,
          turnId,
          clientMsgId: turnId,
          description: args.description,
          prompt: args.prompt,
          execution: executionOf(args.model, authority),
          ...(args.workspace ? { workspace: args.workspace } : {}),
        });
        return { threadId: control.threadId };
      },
      message: async (args, authority, parentTurnId) => {
        const prior = await this.requireCloudAgentControlReceipt(args.threadId, "any");
        if (isCloudAgentControlActive(prior.status)) {
          const steer = {
            ownerId: authority.ownerId,
            ownerGeneration: authority.ownerGeneration,
            threadId: prior.threadId,
            messageId: await scopedId(authority, parentTurnId, "message", args.key),
            text: args.message,
          };
          const piSteered = await this.steerPiThread(steer);
          const steered =
            piSteered.accepted || piSteered.reason === "not_running"
              ? piSteered
              : await steerContainerAgent({ ...steer, env: this.env });
          if (!steered.accepted && steered.reason === "busy") {
            throw new Error(
              `${prior.threadId} is starting up or just finishing in its container. Send the message again in a moment.`,
            );
          }
          if (steered.accepted) {
            await this.rememberCloudAgentControlReceipt({
              ...prior,
              turnId: steered.turnId,
              status: "running",
              threadUpdatedAt: Math.max(Date.now(), prior.threadUpdatedAt + 1),
            });
            return;
          }
        }
        const turnId = await scopedId(authority, parentTurnId, "turn", args.key);
        await dispatch(authority, parentTurnId, {
          threadId: prior.threadId,
          attemptGeneration: prior.attemptGeneration + 1,
          turnId,
          clientMsgId: turnId,
          description: prior.description ?? "Continued task",
          prompt: args.message,
          execution: prior.execution ?? authority.execution,
        });
      },
      stop: async (args, authority, parentTurnId) => {
        const control = await this.requireCloudAgentControlReceipt(args.threadId, "any");
        if (!isCloudAgentControlActive(control.status) || !control.turnId) return;
        const stopped = await this.stopPiThread({
          ownerId: authority.ownerId,
          ownerGeneration: authority.ownerGeneration,
          threadId: control.threadId,
          turnId: control.turnId,
          attemptGeneration: control.attemptGeneration,
        });
        if (stopped !== "unknown") return;
        const teardown = await this.env.BUILD_SESSIONS.getByName(control.threadId).fetch(
          "https://build-session/cancel",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ownerId: authority.ownerId,
              ownerGeneration: authority.ownerGeneration,
              turnId: control.turnId,
              attemptGeneration: control.attemptGeneration,
              cancelRequestId: await scopedId(authority, parentTurnId, "message", args.key),
              reason: AGENT_STOP_WIRE_REASON,
            }),
          },
        );
        await teardown.body?.cancel().catch(() => undefined);
        if (!teardown.ok && teardown.status !== 409) {
          throw new Error(`Could not stop ${control.threadId}. Try again.`);
        }
      },
    };
  }

  protected async deliverPiAgentNote(
    note: import("@stella/agent/stella/agents").AgentNote,
    authority: import("../pi-runtime.js").PiAuthority,
  ): Promise<void> {
    unwrapRpc(
      await this.ownerGate(authority.ownerId).ownerInternal({
        name: "agentReports.note",
        args: {
          noteId: `note:${(await sha256Hex(`${authority.conversationId}:${note.requestId}`)).slice(0, 48)}`,
          conversationId: authority.conversationId,
          ownerGeneration: authority.ownerGeneration,
          fromThreadId: note.threadId,
          text: note.text.slice(0, AGENT_MESSAGE_FRAMED_MAX_CHARS),
        },
        ownerGeneration: authority.ownerGeneration,
      }),
    );
    log("info", "pi_agent_note_queued", {
      conversationId: authority.conversationId,
      threadId: note.threadId,
      requestId: note.requestId,
    });
  }

  protected async recordPiAgentRun(
    event: import("../pi-runtime.js").PiAgentLedgerEvent,
  ): Promise<void> {
    const { authority } = event;
    const now = Date.now();
    const base = (key: string) => ({
      v: OWNER_EVENT_VERSION,
      key,
      ownerId: authority.ownerId,
      ownerGeneration: authority.ownerGeneration,
      emittedAt: now,
    });
    const events: OwnerEvent[] = [
      {
        ...base(`pi:${event.threadId}:${event.attempt}`),
        kind: "thread.spawned",
        threadId: event.threadId,
        conversationId: authority.conversationId,
        parentTurnId: event.turnId,
        ...(event.parentThreadId ? { parentThreadId: event.parentThreadId } : {}),
        agentDepth: event.depth,
        attemptGeneration: event.attempt,
        description: event.description,
        prompt: "",
        execution: authority.execution,
        placement: "cloud",
        harness: "pi",
        createdAt: now,
      },
    ];
    if (event.ended) {
      const { outcome, text } = event.ended;
      events.push({
        ...base(`pi:${event.threadId}:${event.attempt}:ended`),
        kind: "thread.completed",
        threadId: event.threadId,
        conversationId: authority.conversationId,
        turnId: event.turnId,
        attemptGeneration: event.attempt,
        status: outcome,
        ...(outcome === "completed" && text
          ? { resultJson: JSON.stringify({ finalText: text.slice(0, 30_000) }) }
          : {}),
        ...(outcome === "failed"
          ? { errorMessage: (text || "The agent failed.").slice(0, 2_000) }
          : {}),
        ...(outcome === "canceled"
          ? { errorMessage: (text || AGENT_STOPPED_REASON).slice(0, 2_000) }
          : {}),
        completedAt: now,
      });
    }
    await this.deferOwnerEvents(events);
  }

  protected publishPiAgentTerminal(
    threadId: string,
    agent: import("../pi-runtime.js").PiAgentInfo,
    outcome: { kind: AgentAttemptOutcome; body: string },
    turnId = `pi-agent:${threadId}`,
  ): void {
    this.publishAgentLifecycleCard(
      turnId,
      Date.now(),
      this.piAgentTerminalCard(threadId, agent, outcome),
    );
  }

  protected piAgentTerminalCard(
    threadId: string,
    agent: import("../pi-runtime.js").PiAgentInfo,
    outcome: { kind: AgentAttemptOutcome; body: string },
  ): import("@stella/contracts/cloud-agent-lifecycle").CloudAgentLifecycleCard {
    const identity = { agentId: threadId, attemptGeneration: agent.attempt };
    return {
      type: "agent-lifecycle",
      eventId: `pi-agent:${threadId}:${agent.attempt}:${outcome.kind}`,
      event:
        outcome.kind === "completed"
          ? {
              type: "agent-completed",
              payload: { ...identity, result: outcome.body, status: "completed" },
            }
          : {
              type:
                outcome.kind === "failed" ? "agent-failed" : "agent-canceled",
              payload: {
                ...identity,
                ...(outcome.body ? { error: outcome.body } : {}),
                status: outcome.kind,
              },
            },
    };
  }

  async startPiThread(input: PiThreadStart): Promise<void> {
    const { attempt } = input;
    if (this.purged()) throw new Error("This conversation was deleted.");
    const owner = this.journal.meta().owner_id;
    if (owner && owner !== input.ownerId) {
      throw new Error("This conversation belongs to another account.");
    }
    let record =
      (await this.ctx.storage.get<PiThreadRecord>(
        piThreadKey(attempt.threadId),
      )) ??
      ({
        ownerId: input.ownerId,
        ownerGeneration: input.ownerGeneration,
        threadId: attempt.threadId,
        description: attempt.description,
        ...(attempt.originDeviceId
          ? { originDeviceId: attempt.originDeviceId }
          : {}),
        attempts: [],
        settledThrough: 0,
      } satisfies PiThreadRecord);
    if (attempt.attemptGeneration <= record.settledThrough) return;
    let open = record.attempts.find(
      (entry) => entry.attemptGeneration === attempt.attemptGeneration,
    );
    if (!open) {
      open = {
        turnId: attempt.turnId,
        attemptGeneration: attempt.attemptGeneration,
      };
      record = { ...record, attempts: [...record.attempts, open] };
      await this.ctx.storage.put(piThreadKey(attempt.threadId), record);
    }
    if (open.pausing) {
      await this.settlePiThreadAttempts(record, attempt.attemptGeneration, {
        status: "canceled",
        errorMessage: AGENT_STOPPED_REASON,
      });
      return;
    }
    if (open.handedOff) return;
    const [runtime, { contextFor }, destinations] = await Promise.all([
      this.openPiRuntime(this.piGatewayOrigin()),
      import("../pi-runtime.js"),
      this.ownerGate(input.ownerId)
        .devices()
        .catch(() => null),
    ]);
    await runtime.threadAttempt(
      {
        threadId: attempt.threadId,
        description: attempt.description,
        attemptGeneration: attempt.attemptGeneration,
        lineage: attempt.lineage,
        authority: {
          ownerId: input.ownerId,
          ownerGeneration: input.ownerGeneration,
          conversationId: input.conversationId,
          audience: input.audience,
          budgetMicroCents: input.budgetMicroCents,
          execution: input.execution,
        },
        ...(input.execution.engine === "stella"
          ? { model: piModelSpec("general", input.execution, input.audience) }
          : {}),
        executionContext: cloudExecutionContext(input, destinations),
      },
      input.prompt,
      contextFor(),
    );
    const now = Date.now();
    const handed = await this.updatePiThreadRecord(
      attempt.threadId,
      (current) => ({
        ...current,
        attempts: current.attempts.map((entry) =>
          entry.attemptGeneration === attempt.attemptGeneration
            ? { ...entry, handedOff: true }
            : entry,
        ),
      }),
    );
    await this.deferOwnerEvents([
      {
        v: OWNER_EVENT_VERSION,
        key: attempt.turnId,
        ownerId: input.ownerId,
        ownerGeneration: input.ownerGeneration,
        emittedAt: now,
        kind: "turn.started",
        turnId: attempt.turnId,
        turnKind: "agent",
        conversationId: input.conversationId,
        sessionId: attempt.threadId,
        lane: "agent",
        source: "agent-thread",
        threadId: attempt.threadId,
        attemptGeneration: attempt.attemptGeneration,
        agentType: "general",
        execution: input.execution,
        prompt: input.prompt,
        createdAt: now,
      },
    ]);
    if (
      handed?.attempts.find(
        (entry) => entry.attemptGeneration === attempt.attemptGeneration,
      )?.pausing
    ) {
      await runtime.stopThreadAgent(attempt.threadId, contextFor());
    }
    await this.piHeartbeat().catch(() => undefined);
    log("info", "pi_thread_attempt_started", {
      threadId: attempt.threadId,
      attemptTurnId: attempt.turnId,
      attemptGeneration: attempt.attemptGeneration,
    });
  }

  protected async updatePiThreadRecord(
    threadId: string,
    change: (record: PiThreadRecord) => PiThreadRecord,
  ): Promise<PiThreadRecord | undefined> {
    return await this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.ctx.storage.get<PiThreadRecord>(
        piThreadKey(threadId),
      );
      if (!current) return undefined;
      const next = change(current);
      await this.ctx.storage.put(piThreadKey(threadId), next);
      return next;
    });
  }

  protected async deliverPiThreadReport(
    report: import("../pi-runtime.js").PiThreadReport,
  ): Promise<void> {
    const record = await this.ctx.storage.get<PiThreadRecord>(
      piThreadKey(report.threadId),
    );
    const handedOff = record?.attempts.filter((entry) => entry.handedOff) ?? [];
    const answered =
      report.attemptGeneration ?? handedOff.at(-1)?.attemptGeneration;
    const attempt = record?.attempts.find(
      (entry) => entry.attemptGeneration === answered,
    );
    if (!record || !attempt) {
      log("info", "pi_thread_report_unmatched", {
        threadId: report.threadId,
        requestId: report.requestId,
        attemptGeneration: report.attemptGeneration ?? null,
      });
      return;
    }
    let outcome: PiThreadOutcome;
    if (report.settled) {
      if (!attempt.pausing && report.status !== "canceled") return;
      outcome = { status: "canceled", errorMessage: AGENT_STOPPED_REASON };
    } else {
      const parsed = piReportOutcome(report);
      outcome =
        parsed.kind === "completed"
          ? {
              status: "completed",
              resultJson: JSON.stringify({ finalText: parsed.body }),
            }
          : {
              status: parsed.kind,
              errorMessage:
                parsed.body ||
                (parsed.kind === "canceled"
                  ? "The agent was stopped."
                  : "The agent hit a problem and stopped."),
            };
    }
    await this.settlePiThreadAttempts(record, attempt.attemptGeneration, {
      ...outcome,
      ...(report.files?.length ? { files: report.files } : {}),
    });
  }

  protected async settlePiThreadAttempts(
    record: PiThreadRecord,
    attemptGeneration: number,
    outcome: PiThreadOutcome,
  ): Promise<void> {
    const decided = await this.ctx.blockConcurrencyWhile(async () => {
      const current =
        (await this.ctx.storage.get<PiThreadRecord>(
          piThreadKey(record.threadId),
        )) ?? record;
      const merged = current.attempts.some(
        (entry) => entry.attemptGeneration === attemptGeneration,
      )
        ? current
        : {
            ...current,
            attempts: [
              ...current.attempts,
              ...record.attempts.filter(
                (entry) => entry.attemptGeneration === attemptGeneration,
              ),
            ],
          };
      const settling = merged.attempts.filter(
        (entry) => entry.attemptGeneration <= attemptGeneration,
      );
      if (settling.length === 0) return undefined;
      const terminal = settling.find(
        (entry) => entry.attemptGeneration === attemptGeneration,
      )?.terminal ?? { ...outcome, completedAt: Date.now() };
      const next: PiThreadRecord = {
        ...merged,
        attempts: merged.attempts.map((entry) =>
          entry.attemptGeneration <= attemptGeneration
            ? { ...entry, terminal: entry.terminal ?? terminal }
            : entry,
        ),
      };
      await this.ctx.storage.put(piThreadKey(record.threadId), next);
      return { next, terminal };
    });
    if (!decided) return;
    const { next, terminal } = decided;
    const settling = next.attempts.filter(
      (entry) => entry.attemptGeneration <= attemptGeneration,
    );
    const latest = settling.find(
      (entry) => entry.attemptGeneration === attemptGeneration,
    )!;
    const base = (key: string) => ({
      v: OWNER_EVENT_VERSION,
      key,
      ownerId: next.ownerId,
      ownerGeneration: next.ownerGeneration,
      emittedAt: terminal.completedAt,
    });
    const events: OwnerEvent[] = [];
    if (terminal.files?.length) {
      events.push({
        ...base(`${latest.turnId}:${latest.attemptGeneration}:1`),
        kind: "turn.event",
        turnId: latest.turnId,
        attemptGeneration: latest.attemptGeneration,
        sessionId: next.threadId,
        eventSeq: 1,
        eventKind: "output_files",
        payload: { files: terminal.files },
        terminal: false,
        createdAt: terminal.completedAt,
      });
    }
    for (const entry of settling) {
      const settled = entry.terminal ?? terminal;
      events.push({
        ...base(`${entry.turnId}:${entry.attemptGeneration}:2`),
        kind: "turn.event",
        turnId: entry.turnId,
        attemptGeneration: entry.attemptGeneration,
        sessionId: next.threadId,
        eventSeq: 2,
        eventKind: settled.status,
        payload:
          settled.status === "completed"
            ? { finalText: agentLifecycleReport(settled) }
            : { message: settled.errorMessage ?? "The agent stopped." },
        terminal: true,
        terminalStatus: settled.status,
        ...(settled.resultJson ? { resultJson: settled.resultJson } : {}),
        ...(settled.errorMessage ? { errorMessage: settled.errorMessage } : {}),
        createdAt: settled.completedAt,
      });
    }
    events.push({
      ...base(`${next.threadId}:${latest.turnId}:${latest.attemptGeneration}`),
      kind: "thread.completed",
      threadId: next.threadId,
      turnId: latest.turnId,
      attemptGeneration: latest.attemptGeneration,
      status: agentAttemptOutcomeOf({ status: terminal.status }),
      ...(terminal.resultJson ? { resultJson: terminal.resultJson } : {}),
      ...(terminal.errorMessage ? { errorMessage: terminal.errorMessage } : {}),
      completedAt: terminal.completedAt,
    });
    await this.deferOwnerEvents(events);
    await this.updatePiThreadRecord(next.threadId, (current) => ({
      ...current,
      attempts: current.attempts.filter(
        (entry) => entry.attemptGeneration > attemptGeneration,
      ),
      settledThrough: Math.max(current.settledThrough, attemptGeneration),
    }));
    log("info", "pi_thread_attempt_settled", {
      threadId: next.threadId,
      attemptGeneration,
      status: terminal.status,
      woke: !next.originDeviceId,
    });
  }

  async steerPiThread(input: PiThreadSteer): Promise<PiThreadSteerResult> {
    const record = await this.ctx.storage.get<PiThreadRecord>(
      piThreadKey(input.threadId),
    );
    if (
      !record ||
      record.ownerId !== input.ownerId ||
      record.ownerGeneration !== input.ownerGeneration
    ) {
      return { accepted: false, reason: "unknown" };
    }
    const running = record.attempts
      .filter((entry) => entry.handedOff && !entry.terminal && !entry.pausing)
      .at(-1);
    if (!running) return { accepted: false, reason: "not_running" };
    const runtime = await this.openPiRuntime(this.piGatewayOrigin());
    const { contextFor } = await import("../pi-runtime.js");
    await runtime.steerThreadAgent(
      {
        threadId: input.threadId,
        attemptGeneration: running.attemptGeneration,
        messageId: input.messageId,
        text: input.text,
      },
      contextFor(),
    );
    return {
      accepted: true,
      turnId: running.turnId,
      attemptGeneration: running.attemptGeneration,
    };
  }

  async stopPiThread(input: PiThreadStop): Promise<PiThreadStopResult> {
    const decided = await this.ctx.blockConcurrencyWhile(
      async (): Promise<PiThreadStopResult | "stop"> => {
        const record = await this.ctx.storage.get<PiThreadRecord>(
          piThreadKey(input.threadId),
        );
        if (
          !record ||
          record.ownerId !== input.ownerId ||
          record.ownerGeneration !== input.ownerGeneration
        ) {
          return "unknown";
        }
        if (input.attemptGeneration <= record.settledThrough) return "terminal";
        const attempt = record.attempts.find(
          (entry) => entry.attemptGeneration === input.attemptGeneration,
        );
        if (attempt && attempt.turnId !== input.turnId) return "changed";
        if (
          record.attempts.some(
            (entry) => entry.attemptGeneration > input.attemptGeneration,
          )
        ) {
          return "changed";
        }
        if (attempt?.terminal) return "terminal";
        await this.ctx.storage.put(piThreadKey(input.threadId), {
          ...record,
          attempts: attempt
            ? record.attempts.map((entry) =>
                entry === attempt ? { ...entry, pausing: true } : entry,
              )
            : [
                ...record.attempts,
                {
                  turnId: input.turnId,
                  attemptGeneration: input.attemptGeneration,
                  pausing: true,
                },
              ],
        } satisfies PiThreadRecord);
        return attempt?.handedOff ? "stop" : "stopped";
      },
    );
    if (decided !== "stop") return decided;
    const runtime = await this.openPiRuntime(this.piGatewayOrigin());
    const { contextFor } = await import("../pi-runtime.js");
    await runtime.stopThreadAgent(input.threadId, contextFor());
    return "stopped";
  }

  async controlPiHarnessAgent(
    input: PiHarnessAgentControl,
  ): Promise<PiHarnessAgentControlResult> {
    if (
      !this.piRuntime &&
      (await this.ctx.storage.get<string>(AGENT_RUNTIME_KEY)) !== "pi" &&
      !(await this.ctx.storage.get<boolean>(PI_LIVE_KEY))
    ) {
      return "not_found";
    }
    const runtime = await this.openPiRuntime(this.piGatewayOrigin());
    const { contextFor } = await import("../pi-runtime.js");
    return await runtime.controlHarnessAgent(input, contextFor());
  }

  protected async piHeartbeat(): Promise<void> {
    const live = await this.ctx.storage.get<boolean>(PI_LIVE_KEY);
    if (!this.piRuntime && !live) return;
    const reopening = !this.piRuntime;
    const gatewayOrigin = this.env.MODEL_GATEWAY_URL?.trim() ?? "";
    const runtime = await this.openPiRuntime(gatewayOrigin);
    const { contextFor } = await import("../pi-runtime.js");
    const busy = await runtime.busy(contextFor());
    if (reopening) log("info", "pi_heartbeat_reopened", { busy });
    if (busy !== Boolean(live)) {
      if (busy) await this.ctx.storage.put(PI_LIVE_KEY, true);
      else await this.ctx.storage.delete(PI_LIVE_KEY);
    }
    if (busy) await this.armAlarmNoLaterThan(Date.now() + PI_HEARTBEAT_MS);
  }

  protected async abortPiConversation(): Promise<void> {
    if ((await this.ctx.storage.get<string>(AGENT_RUNTIME_KEY)) !== "pi")
      return;
    const gatewayOrigin = this.env.MODEL_GATEWAY_URL?.trim() ?? "";
    const runtime = await this.openPiRuntime(gatewayOrigin);
    const { root } = await runtime.open();
    const { contextFor } = await import("../pi-runtime.js");
    runtime.stopClaudeCode();
    await root.abort(contextFor());
  }

  protected async placeBrainHandoff(
    turnId: string,
    stopped: boolean,
  ): Promise<void> {
    const handoff = await this.getTurnState<BrainHandoff>(BRAIN_HANDOFF_KEY);
    if (!handoff) return;
    if (this.ctx.storage.kv) this.ctx.storage.kv.delete(BRAIN_HANDOFF_KEY);
    else await this.ctx.storage.delete(BRAIN_HANDOFF_KEY);
    if (handoff.turnId !== turnId || stopped) return;
    try {
      const dispatchId = await this.placeOnPiBrain({
        ownerId: handoff.ownerId,
        ownerGeneration: handoff.ownerGeneration,
        deviceId: handoff.deviceId,
        clientMsgId: handoff.clientMsgId,
        prompt: handoff.prompt,
        handoff: true,
      });
      log("info", "pi_brain_handoff_placed", {
        turnId,
        deviceId: handoff.deviceId,
        dispatchId,
      });
    } catch (error) {
      log("error", "pi_brain_handoff_failed", {
        turnId,
        deviceId: handoff.deviceId,
        message: errorMessage(error),
      });
    }
  }

  protected async journalCheckpoint(): Promise<JournalCheckpoint | undefined> {
    const stored = await this.ctx.storage.get<
      JournalCheckpoint & { epoch: number }
    >(JOURNAL_CHECKPOINT_KEY);
    const meta = this.journal.meta();
    if (
      !stored ||
      stored.epoch !== meta.epoch ||
      stored.throughSeq + 1 < meta.hot_min_seq
    ) {
      return undefined;
    }
    return parseJournalCheckpoint(stored);
  }

  protected async journalStart(): Promise<JournalStart> {
    const checkpoint = await this.journalCheckpoint();
    return {
      contextStartSeq: this.journal.contextStartSeq(
        "",
        CLOUD_HISTORY_TOKEN_BUDGET,
      ),
      ...(checkpoint ? { checkpoint } : {}),
    };
  }

  protected async storeJournalCheckpoint(
    summary: string,
    firstKept: JournalCheckpointFirstKept,
    deviceId?: string,
  ): Promise<number | undefined> {
    const keptSeq =
      "seq" in firstKept
        ? firstKept.seq
        : this.journal.turnStartSeq(
            "turnId" in firstKept
              ? firstKept.turnId
              : makeLocalTurnId(deviceId ?? "", firstKept.localTurnId),
          );
    const meta = this.journal.meta();
    if (keptSeq === undefined || keptSeq < 1 || keptSeq >= meta.next_seq)
      return undefined;
    const throughSeq = keptSeq - 1;
    const current = await this.journalCheckpoint();
    if (current && current.throughSeq >= throughSeq) return current.throughSeq;
    await this.ctx.storage.put(JOURNAL_CHECKPOINT_KEY, {
      summary,
      throughSeq,
      epoch: meta.epoch,
    });
    log("info", "journal_checkpoint_stored", {
      conversationId: this.conversationId(),
      throughSeq,
      summaryBytes: utf8Length(summary),
      from: deviceId ? "device" : "cloud",
    });
    return throughSeq;
  }

  protected async storePiBrain(record: PiBrainRecord): Promise<void> {
    const prior = await this.ctx.storage.get<PiBrainRecord>(PI_BRAIN_KEY);
    await this.ctx.storage.put(PI_BRAIN_KEY, record);
    if (
      !prior ||
      prior.epoch !== record.epoch ||
      !samePiBrainHost(prior, record) ||
      (prior.host === "device" &&
        record.host === "device" &&
        prior.label !== record.label)
    ) {
      this.hub.broadcastBrain(record);
    }
  }

  protected async setPiBrain(host: PiBrainHost): Promise<PiBrainRecord> {
    const prior = await this.ctx.storage.get<PiBrainRecord>(PI_BRAIN_KEY);
    const record = movePiBrain(prior, host, Date.now());
    await this.storePiBrain(record);
    this.notePiBrainLease("moved", record);
    return record;
  }

  protected async piBrainHolderState(
    ownerId: string,
    deviceId: string,
  ): Promise<{ refusal?: string; seenAt?: number; gone?: true }> {
    const listed = await this.ownerGate(ownerId)
      .devices()
      .catch(() => undefined);
    if (!listed) return { refusal: "the devices list could not be read" };
    const device = listed.devices.find((entry) => entry.deviceId === deviceId);
    if (!device) return { refusal: "not connected", gone: true };
    const { deviceRefusal } = await import("@stella/agent/stella/execution");
    const refusal = deviceRefusal(device, device.label?.trim() || deviceId);
    if (!device.online) return { refusal: refusal ?? "offline", gone: true };
    const ready = !device.availability || device.availability.ready === true;
    const seenAt = Math.max(device.lastSeenAt ?? 0, Date.now());
    return {
      ...(refusal ? { refusal } : {}),
      ...(ready ? { seenAt } : {}),
    };
  }

  protected async claimPiBrain(args: {
    claimant: PiBrainHost;
    claimEpoch: number | null;
    holder?: {
      forEpoch: number;
      refusal?: string;
      seenAt?: number;
      gone?: true;
    };
    turnId?: string;
    claimFree?: boolean;
    home?: Extract<PiBrainHost, { host: "device" }>;
  }): Promise<{
    decision: PiBrainClaimDecision;
    record: PiBrainRecord | null;
    takenOver: boolean;
  }> {
    const now = Date.now();
    const stored =
      (await this.ctx.storage.get<PiBrainRecord>(PI_BRAIN_KEY)) ?? null;
    const holder =
      stored && args.holder?.forEpoch === stored.epoch
        ? args.holder
        : undefined;
    let record = stored;
    if (args.home) {
      const homed = await this.bringPiBrainHome(args.home, args.turnId);
      if (homed && homed.epoch !== stored?.epoch) {
        record = homed;
        if (samePiBrainHost(record, args.claimant)) {
          return { decision: { kind: "holder" }, record, takenOver: false };
        }
      }
    }
    if (record && holder?.seenAt !== undefined) {
      const renewed = renewPiBrainLease(record, holder.seenAt);
      if (renewed) {
        record = renewed;
        await this.storePiBrain(record);
      }
    }
    const decision = decidePiBrainClaim({
      record,
      claimant: args.claimant,
      claimEpoch: args.claimEpoch,
      ...(holder?.gone ? { holderGone: true } : {}),
      now,
    });
    if (
      decision.kind === "free" &&
      args.claimFree &&
      args.claimant.host === "device"
    ) {
      record = claimFreePiBrain(args.claimant, now);
      await this.storePiBrain(record);
      this.notePiBrainLease("claimed", record, {
        ...(args.turnId ? { turnId: args.turnId } : {}),
      });
      return { decision: { kind: "holder" }, record, takenOver: false };
    }
    if (decision.kind === "holder" && record) {
      const renewed = renewPiBrainLease(record, now);
      if (renewed) {
        record = renewed;
        await this.storePiBrain(record);
      }
      return { decision, record, takenOver: false };
    }
    if (decision.kind === "takeover" && record) {
      const prior = record;
      record = takeOverPiBrain(prior, args.claimant, now);
      await this.storePiBrain(record);
      this.notePiBrainLease("taken_over", record, {
        reason: decision.reason,
        ...(holder?.refusal ? { holderRefusal: holder.refusal } : {}),
        ...(args.turnId ? { turnId: args.turnId } : {}),
      });
      await this.settleTakenOverTurn(prior);
      return { decision, record, takenOver: true };
    }
    if (
      decision.kind === "elsewhere" &&
      record &&
      args.claimant.host === "device"
    ) {
      this.notePiBrainLease("refused", record, {
        reason: decision.reason,
        claimant: args.claimant.deviceId,
        claimEpoch: args.claimEpoch,
        ...(args.turnId ? { turnId: args.turnId } : {}),
      });
    }
    return { decision, record, takenOver: false };
  }

  protected async settleTakenOverTurn(prior: PiBrainRecord): Promise<void> {
    if (prior.host !== "device") return;
    const lease =
      await this.ctx.storage.get<LocalTurnLease>(LOCAL_TURN_LEASE_KEY);
    if (!lease || lease.deviceId !== prior.deviceId) return;
    log("info", "pi_brain_takeover_settles_turn", {
      conversationId: this.conversationId(),
      deviceId: lease.deviceId,
      turnId: lease.turnId,
      previousEpoch: prior.epoch,
    });
    try {
      if (lease.cancelRequested) await this.cancelLocalTurn(lease, true);
      else
        await this.expireLocalLease(
          lease,
          true,
          `Stella lost touch with ${piBrainHostName(prior)} before this was answered.`,
        );
    } catch (error) {
      log("error", "pi_brain_takeover_settle_failed", {
        conversationId: this.conversationId(),
        turnId: lease.turnId,
        message: errorMessage(error),
      });
    }
  }

  protected async piBrainHome(
    ownerId: string,
  ): Promise<Extract<PiBrainHost, { host: "device" }> | undefined> {
    const listed = await this.ownerGate(ownerId)
      .devices()
      .catch(() => undefined);
    const home = listed?.devices.find((entry) => entry.brainHome);
    if (!home?.online || home.availability?.ready !== true) return undefined;
    return {
      host: "device",
      deviceId: home.deviceId,
      ...(home.label?.trim() ? { label: home.label.trim() } : {}),
    };
  }

  protected async bringPiBrainHome(
    home: Extract<PiBrainHost, { host: "device" }>,
    turnId?: string,
  ): Promise<PiBrainRecord | null> {
    const record =
      (await this.ctx.storage.get<PiBrainRecord>(PI_BRAIN_KEY)) ?? null;
    if (record && samePiBrainHost(record, home)) return record;
    const busy =
      record?.host === "cloud"
        ? this.activeTurnId !== null
        : record?.host === "device" &&
          (await this.piBrainHolderBusy(record.deviceId));
    if (busy) return record;
    const homed = homePiBrain(record, home, Date.now());
    await this.storePiBrain(homed);
    this.notePiBrainLease("moved", homed, {
      reason: "home",
      ...(turnId ? { turnId } : {}),
    });
    return homed;
  }

  protected async piBrainHolderBusy(deviceId: string): Promise<boolean> {
    const lease =
      await this.ctx.storage.get<LocalTurnLease>(LOCAL_TURN_LEASE_KEY);
    return Boolean(
      lease &&
        lease.deviceId === deviceId &&
        !lease.cancelRequested &&
        lease.expiresAt > Date.now(),
    );
  }

  protected async renewPiBrainHolder(deviceId: string): Promise<void> {
    const record = await this.ctx.storage.get<PiBrainRecord>(PI_BRAIN_KEY);
    if (record?.host !== "device" || record.deviceId !== deviceId) return;
    const renewed = renewPiBrainLease(record, Date.now());
    if (renewed) await this.storePiBrain(renewed);
  }

  protected notePiBrainLease(
    kind: "claimed" | "moved" | "taken_over" | "refused",
    record: PiBrainRecord,
    detail: Record<string, unknown> = {},
  ): void {
    const conversationId = this.conversationId();
    const fields = {
      host: record.host === "cloud" ? "cloud" : record.deviceId,
      ...(record.previous
        ? {
            previousHost:
              record.previous.host === "cloud"
                ? "cloud"
                : record.previous.deviceId,
            previousEpoch: record.previous.epoch,
          }
        : {}),
      ...(record.leaseExpiresAt !== undefined
        ? { leaseExpiresAt: record.leaseExpiresAt }
        : {}),
      ...detail,
    };
    log("info", `pi_brain_lease_${kind}`, {
      conversationId,
      epoch: record.epoch,
      ...fields,
    });
    const ownerId = this.journal.ownerId();
    if (!ownerId) return;
    const key =
      kind === "refused"
        ? `brain_lease:${conversationId}:${record.epoch}:refused:${String(detail.claimant ?? "")}:${String(detail.turnId ?? detail.claimEpoch ?? "")}`
        : `brain_lease:${conversationId}:${record.epoch}:${kind}`;
    const append = async () => {
      const owner = await this.resolveOwnerForCaller({ ownerId });
      if (!owner) return;
      unwrapRpc(
        await this.ownerGate(ownerId).ownerInternal({
          name: "agentEvents.append",
          args: {
            key: key.slice(0, 512),
            kind: `brain_lease_${kind}`,
            source: `conversation:${conversationId}`.slice(0, 512),
            conversationId,
            brainEpoch: record.epoch,
            detail: fields,
          },
          ownerGeneration: owner.ownerGeneration,
        }),
      );
    };
    this.ctx.waitUntil(
      append().catch((error: unknown) => {
        log("error", "pi_brain_lease_event_failed", {
          conversationId,
          kind,
          message: errorMessage(error),
        });
      }),
    );
  }

  protected async placeOnPiBrain(args: {
    ownerId: string;
    ownerGeneration?: string;
    deviceId: string;
    clientMsgId: string;
    prompt: string;
    attachments?: string[];
    context?: CloudTurnContext;
    locale?: string;
    handoff?: true;
  }): Promise<string> {
    const conversationId = this.conversationId();
    const placed = await this.ownerGate(args.ownerId).submit({
      request: {
        protocol: PLACEMENT_PROTOCOL,
        idempotencyKey: `pi-brain:${args.clientMsgId}`.slice(0, 128),
        kind: "chat",
        ingress: "cloud",
        subject: "portable",
        targetMode: "device",
        targetDeviceId: args.deviceId,
        conversationId,
        requiredCapabilities: [
          "chat",
          ...(args.attachments?.length ? (["attachments"] as const) : []),
        ],
        payload: {
          schemaVersion: 1,
          prompt: args.prompt,
          conversationId,
          clientMsgId: args.clientMsgId,
          userMessageEventId: args.clientMsgId,
          ...(args.locale ? { locale: args.locale } : {}),
          ...(args.attachments?.length
            ? { attachments: args.attachments }
            : {}),
          ...(args.context ? { context: args.context } : {}),
          ...(args.handoff ? { handoff: true as const } : {}),
        },
      },
      ...(args.ownerGeneration
        ? { expectedGeneration: args.ownerGeneration }
        : {}),
    });
    if (!placed.ok) throw new Error(placed.error.message);
    return placed.response.dispatch.dispatchId;
  }

  protected reconcileRunningAgentsSoon(): void {
    const now = Date.now();
    if (now - this.agentsReconciledAt < AGENT_RECONCILE_INTERVAL_MS) return;
    this.agentsReconciledAt = now;
    if (this.agentsView) {
      this.refreshAgentsSoon();
      return;
    }
    this.ctx.waitUntil(
      this.reconcileRunningAgents().catch((error: unknown) => {
        log("error", "conversation_agent_reconcile_failed", {
          conversationId: this.conversationId(),
          message: errorMessage(error),
        });
      }),
    );
  }

  protected refreshAgentsSoon(): void {
    if (!this.agentsView || this.purged()) return;
    if (this.agentsRefresh) {
      this.agentsRefreshAgain = true;
      return;
    }
    const refresh = (async () => {
      do {
        this.agentsRefreshAgain = false;
        await this.refreshAgents();
      } while (this.agentsRefreshAgain);
    })()
      .catch((error: unknown) => {
        log("error", "conversation_agents_refresh_failed", {
          conversationId: this.conversationId(),
          message: errorMessage(error),
        });
      })
      .finally(() => {
        this.agentsRefresh = null;
      });
    this.agentsRefresh = refresh;
    this.ctx.waitUntil(refresh);
  }

  protected async refreshAgents(): Promise<void> {
    const pi =
      this.piRuntime || this.agentsView?.pi.length
        ? await (async () => {
            const runtime = await this.openPiRuntime(this.piGatewayOrigin());
            const { contextFor } = await import("../pi-runtime.js");
            return await runtime.runningAgents(contextFor());
          })()
        : [];
    const owner = await this.ownerRunningAgents().catch((error: unknown) => {
      log("error", "conversation_owner_agents_failed", {
        conversationId: this.conversationId(),
        message: errorMessage(error),
      });
      return this.agentsView?.owner ?? [];
    });
    if (this.purged()) return;
    const next: AgentsView = { pi, owner };
    const changed = JSON.stringify(next) !== JSON.stringify(this.agentsView);
    this.agentsView = next;
    if (changed || !this.agentsViewStored) {
      await this.ctx.storage.put(AGENTS_VIEW_KEY, next);
      this.agentsViewStored = true;
    }
    this.hub.agentsChanged();
  }

  protected async ownerRunningAgents(): Promise<AgentActivityEntry[]> {
    const ownerId = this.journal.ownerId();
    if (!ownerId) return [];
    const owner = await this.resolveOwnerForCaller({ ownerId });
    if (!owner) return [];
    const threads = unwrapRpc(
      await this.ownerGate(ownerId).ownerInternal({
        name: "agentThreads.runningIn",
        args: {
          ownerGeneration: owner.ownerGeneration,
          conversationId: this.conversationId(),
        },
        ownerGeneration: owner.ownerGeneration,
      }),
    ) as Array<{
      threadId: string;
      description: string;
      agentType: string;
      attemptGeneration: number;
      createdAt: number;
      updatedAt: number;
    }>;
    return threads.map((thread) => ({
      agentId: thread.threadId,
      title: thread.description,
      agentType: thread.agentType,
      status: "running" as const,
      createdAtMs: thread.createdAt,
      updatedAtMs: thread.updatedAt,
      attemptGeneration: thread.attemptGeneration,
    }));
  }

  /**
   * Settle what the journal of a conversation pi never ran in still shows
   * as running and has in fact ended: there its cards are what lists them.
   *
   * Whoever owns an agent's record writes the card that ends it: its report,
   * the owner's agent threads for a computer's agents. But the owner's post
   * is best effort, and an agent that ended before those cards existed has
   * none, so it read as running for good (the phantom "N agents running" a
   * phone showed). When a client connects, each agent the journal lists as
   * running is checked against the owner's agent threads (a computer's
   * agents, cloud agents, agents on a device). One that ended is settled
   * with how it ended; one still running there is left alone, and a computer
   * settles its own on its next start (`computer-agent-reconcile`).
   *
   * The first pass in a conversation also settles what no owner knows at all:
   * an agent its journal has carried since before any owner recorded agents.
   */
  protected async reconcileRunningAgents(): Promise<void> {
    if (this.purged()) return;
    const running = this.journal.runningAgents();
    const ownerId = this.journal.ownerId();
    if (running.length === 0 || !ownerId || (await this.turnRunning())) return;
    const owner = await this.resolveOwnerForCaller({ ownerId });
    if (!owner) return;
    const startedAt = Date.now();
    const threads = new Map(
      (
        unwrapRpc(
          await this.ownerGate(ownerId).ownerInternal({
            name: "agentThreads.statuses",
            args: {
              ownerGeneration: owner.ownerGeneration,
              threadIds: running.map((entry) => entry.agentId),
            },
            ownerGeneration: owner.ownerGeneration,
          }),
        ) as Array<{
          threadId: string;
          status: string;
          attemptGeneration: number;
          errorMessage?: string;
        }>
      ).map((thread) => [thread.threadId, thread]),
    );
    const unownedSettled = Boolean(
      await this.ctx.storage.get<number>(AGENTS_UNOWNED_SETTLED_KEY),
    );
    if (this.purged() || (await this.turnRunning())) return;
    for (const entry of running) {
      const thread = threads.get(entry.agentId);
      let ended: {
        kind: "completed" | "failed" | "canceled";
        attempt: number;
        body: string;
      } | null = null;
      if (thread) {
        if (
          (thread.status === "completed" ||
            thread.status === "failed" ||
            thread.status === "canceled") &&
          thread.attemptGeneration >= (entry.attemptGeneration ?? 0)
        ) {
          ended = {
            kind: thread.status,
            attempt: entry.attemptGeneration ?? thread.attemptGeneration,
            body: thread.errorMessage ?? "",
          };
        }
      } else if (
        !unownedSettled &&
        entry.createdAtMs < startedAt - AGENT_OWNER_RECORD_LAG_MS
      ) {
        ended = {
          kind: "canceled",
          attempt: entry.attemptGeneration ?? 1,
          body: "No longer running: Stella lost track of this agent when it stopped.",
        };
      }
      if (!ended) continue;
      const identity = {
        agentId: entry.agentId,
        attemptGeneration: ended.attempt,
      };
      this.publishAgentLifecycleCard(`settle:${entry.agentId}`, Date.now(), {
        type: "agent-lifecycle",
        eventId: `settle:${entry.agentId}:${ended.attempt}`,
        event:
          ended.kind === "completed"
            ? { type: "agent-completed", payload: { ...identity, result: "" } }
            : {
                type:
                  ended.kind === "failed" ? "agent-failed" : "agent-canceled",
                payload: {
                  ...identity,
                  ...(ended.body ? { error: ended.body } : {}),
                },
              },
      });
      log("info", "conversation_agent_settled", {
        conversationId: this.conversationId(),
        agentId: entry.agentId,
        status: ended.kind,
        by: thread ? "owner" : "unowned",
      });
    }
    if (!unownedSettled)
      await this.ctx.storage.put(AGENTS_UNOWNED_SETTLED_KEY, startedAt);
  }

  protected async createPiAgentTools(
    authority: {
      ownerId: string;
      ownerGeneration: string;
      conversationId: string;
    },
    browser: CloudBrowserClient | undefined,
    history?: import("../cloud-code-tool.js").CloudHistoryClient,
    delivery?: import("../pi-runtime.js").PiAgentFileDelivery,
  ): Promise<CloudCodeSourceAgentTool[]> {
    const ownerInternal = async (name: string, args: unknown) =>
      unwrapRpc(
        await this.ownerGate(authority.ownerId).ownerInternal({
          name,
          args,
          ownerGeneration: authority.ownerGeneration,
        }),
      );
    const web = createCloudWebTool({ ownerInternal });
    const connectors = new CloudConnectorDirectory({
      source: isSlackConversationId(authority.conversationId)
        ? SLACK_CONNECTOR_SOURCE
        : {
            catalog: () => listIntegrationCatalog(this.env),
            actions: (args) => listIntegrationActions(this.env, args),
            connections: async () =>
              (await ownerInternal("integrations.connections", {})) as {
                connections: Array<{ id: string; connected: boolean }>;
              },
            run: (args) => ownerInternal("integrations.run", args),
          },
      ...(isSlackConversationId(authority.conversationId)
        ? {}
        : { mcp: ownerMcpSource(ownerInternal) }),
    });
    const code = await createCloudCodeAgentTool({
      loader: this.env.LOADER,
      tools: [web],
      executionScope: `${authority.ownerGeneration}:${authority.conversationId}:pi-agents`,
      connect: createCloudConnectClient(connectors),
      ...(browser ? { browser } : {}),
      ...(history ? { history } : {}),
    });
    const media = {
      ownerGeneration: authority.ownerGeneration,
      conversationId: authority.conversationId,
      turnId: `pi-agent:${delivery?.threadId ?? "unbound"}`,
      ownerInternal,
      downloadLinks: true,
      publishFiles: async (
        _writerKey: string,
        files: import("../pi-runtime.js").PiDeliveredFile[],
      ) => {
        if (!delivery) throw new Error("Media generation is only available while this agent is running.");
        await delivery.deliver(files);
      },
    };
    return [code, web, createCloudImageGenTool(media), createCloudVideoGenTool(media)];
  }

  protected async awaitPiBrowserHandoff(
    handoff: import("../pi-runtime.js").PiBrowserHandoff,
    signal: AbortSignal | undefined,
  ): Promise<import("../pi-runtime.js").PiBrowserHandoffEnd> {
    const { authority, browser, suspension } = handoff;
    const ownerInternal = async (name: string, args: unknown) =>
      unwrapRpc(
        await this.ownerGate(authority.ownerId).ownerInternal({
          name,
          args,
          ownerGeneration: authority.ownerGeneration,
        }),
      );
    const interaction = { interactionId: suspension.interactionId };
    await ownerInternal("browser.handoffOpen", {
      conversationId: browser.conversationId,
      threadId: browser.threadId,
      turnId: browser.turnId,
      attemptGeneration: browser.attemptGeneration,
      toolCallId: handoff.toolCallId,
      suspension,
    });
    const deadline = suspension.expiresAt + BROWSER_HANDOFF_GRACE_MS;
    while (true) {
      if (signal?.aborted || Date.now() >= deadline) {
        await ownerInternal("browser.handoffCancel", interaction).catch(
          () => undefined,
        );
        if (signal?.aborted) throw new Error("Browser handoff withdrawn.");
        return { result: "expired", safeMessage: "Browser access expired." };
      }
      const state = (await ownerInternal(
        "browser.handoffState",
        interaction,
      ).catch(() => undefined)) as
        | { state: string; result?: string; safeMessage?: string }
        | undefined;
      if (
        state &&
        state.state !== "pending" &&
        state.state !== "human_control" &&
        state.result
      ) {
        return {
          result:
            state.result as import("../pi-runtime.js").PiBrowserHandoffEnd["result"],
          safeMessage: state.safeMessage ?? "Browser access ended.",
        };
      }
      await sleepWithAbort(
        BROWSER_HANDOFF_POLL_MS,
        signal,
        () => new Error("Browser handoff wait aborted."),
      ).catch(() => undefined);
    }
  }

  protected abstract handleTurnStart(
    request: Request,
    handoff?: {
      authority: AdmittedCloudChat;
      preparation: CloudChatPreparation;
    },
  ): Promise<Response>;
}
