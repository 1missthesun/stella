import { AGENT_PAUSED_REASON } from "@stella/contracts/backend/agent-threads";
import {
  agentAttemptOutcomeOf,
  isLiveAgentStatus,
  reportStatusOf,
  type AgentAttemptOutcome,
} from "@stella/contracts/agent-status";
import { normalizeAgentDirectoryStatus } from "@stella/contracts/agent-directory";
import type {
  AdmittedCloudChat,
  CloudChatPreparation,
} from "../cloud-chat-admission.js";
import { PLACEMENT_PROTOCOL } from "@stella/contracts/turn-plane/placement";
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
  pauseAgentThread,
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
  readDeviceAgent,
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
  type PiThreadPause,
  type PiThreadPauseResult,
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
import { isSlackConversationId } from "@stella/contracts/turn-plane/turn-start";
import { standaloneOwnerInternal } from "../slack/standalone.js";
import { unwrapRpc } from "../owner-store/errors.js";
import { sha256Hex } from "../hash.js";
import {
  CloudConnectorDirectory,
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
import { OrchestratorCloudAgents } from "./cloud-agents.js";
import { resolveCloudSpawnExecution } from "../cloud-spawn-model.js";

/**
 * pi-durable: the conversation's pi runtime, pi agents and threads, the
 * brain's placement, the journal checkpoint, and the running-agents view.
 */
export abstract class OrchestratorPi extends OrchestratorCloudAgents {
  /** The transport pi's Claude Code engine runs this conversation's CLI turns on. */
  protected abstract claudeCodeTransport(): import("./claude-code-transport.js").CloudClaudeCodeTransport;

  /** A model grant from the owner, unless a freeze landed while it was issued. */
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

  /**
   * A pi agent's run held to the owner's purge fence as a chat turn is: an
   * owner-fence lease for the run (the same lease when a resumed run asks
   * again), and a model grant under the owner's current memory policy on
   * each request. A purge or a privacy change freezes the grant and aborts
   * the request in flight.
   */
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

  /** Attaching for one more socket re-sends the snapshot to every pi socket. */
  protected async attachPiClients(): Promise<{
    snapshot: unknown;
    hasOlder: boolean;
  }> {
    // This attach is the one the opening would otherwise start.
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

  /** This conversation's pi-durable harness, opened once per isolate. */
  protected async openPiRuntime(
    gatewayOrigin: string,
  ): Promise<import("../pi-runtime.js").PiConversationRuntime> {
    const standalone = isSlackConversationId(this.conversationId());
    this.piRuntime ??= import("../pi-runtime.js").then(
      ({ PiConversationRuntime }) =>
        new PiConversationRuntime({
          storage: this.ctx.storage,
          env: this.env,
          gatewayOrigin,
          journalStart: () => this.journalStart(),
          waitUntil: (work) => this.ctx.waitUntil(work),
          report: (error) =>
            log("error", "pi_runtime_report", { message: errorMessage(error) }),
          log: (event, fields) => log("info", event, fields),
          deliverNote: (note, authority) =>
            this.deliverPiAgentNote(note, authority),
          // A computer's cloud agent reports to that computer: its journal
          // import takes the card and gives it to its orchestrator.
          deliverOriginReport: async (report, turnId, agent) => {
            // The computer reads the report from its card; the journal's
            // count of what runs learns it ended now, whether or not the
            // computer is awake to read it.
            if (!report.settled && !agent.running) {
              this.publishPiAgentTerminal(
                report.threadId,
                agent,
                piReportOutcome(report),
              );
            }
            const appended = this.journal.appendCard({
              turnId,
              createdAt: Date.now(),
              card: {
                type: "agent-report",
                reportFor: report.origin.deviceId,
                threadId: report.threadId,
                requestId: report.requestId,
                text: report.text,
                ...(report.status ? { status: report.status } : {}),
                ...(report.settled ? { settled: true as const } : {}),
              },
              writer: "orchestrator",
              writerKey: `pi-report:${report.requestId}`,
            });
            if (appended.inserted) this.publish(appended.record);
            // What the agent saved to the drive and linked, as the conversation's files card.
            if (agent.files?.length) {
              this.publishTurnFilesCard(
                turnId,
                `pi-files:${report.requestId}`,
                agent.files,
              );
            }
            log("info", "pi_origin_report_journaled", {
              threadId: report.threadId,
              settled: report.settled === true,
              reportFor: report.origin.deviceId,
              seq: appended.seq,
            });
          },
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
          // Every client draws the agents' rows from these cards, as it does
          // the loop's; which of them run is pi's to say (`runningAgents`).
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
          // A pause reports nothing to the orchestrator, which is not woken
          // for it; the agent's cards still end, or its row would read as
          // running for good.
          agentPaused: (event) =>
            this.publishPiAgentTerminal(
              event.threadId,
              event,
              { kind: "paused", body: "Paused." },
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
          agentTools: (authority, browser, history) =>
            this.createPiAgentTools(authority, browser, history),
          ...(standalone
            ? {}
            : {
                browserHandoff: (
                  handoff: import("../pi-runtime.js").PiBrowserHandoff,
                  signal: AbortSignal | undefined,
                ) => this.awaitPiBrowserHandoff(handoff, signal),
                deviceAgents: this.piDeviceAgents(),
                threadAgents: this.piThreadAgents(),
              }),
          agentGuard: (authority, turnId) =>
            this.piAgentGuard(authority, turnId),
          claudeCode: this.claudeCodeTransport(),
          // Her brief continues there once this turn ends (`runPiTurn`).
          ...(standalone
            ? {}
            : {
                moveBrain: async (
                  authority: import("../pi-runtime.js").PiAuthority,
                  host: Extract<
                    import("@stella/contracts/turn-plane/pi-brain").PiBrainHost,
                    { host: "device" }
                  >,
                  brief: string,
                ) => {
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
            // No turn of this object's runs her: nothing to wait for.
            await this.setPiBrain(host);
            await this.placeOnPiBrain({ ...handoff, handoff: true });
          },
              }),
          // What the agents reach beyond this conversation's harness: the
          // owner's agent threads and other sessions, as the loop's do.
          agentDirectory: {
            list: async (authority) =>
              await readAgentDirectory(
                this.piOwnerCaller(authority),
                authority.conversationId,
              ),
            message: async (authority, args) =>
              await sendAgentMessage(this.piOwnerCaller(authority), {
                ...args,
                conversationId: authority.conversationId,
              }),
            pause: async (authority, args) =>
              await pauseAgentThread(this.piOwnerCaller(authority), {
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
    // From now on pi says which of its agents run here.
    if (!this.agentsView) {
      this.agentsView = { pi: [], owner: [] };
      this.refreshAgentsSoon();
    }
    // Sockets that watched the pi view through an eviction get a new stream
    // and a fresh snapshot.
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

  /**
   * An agent's report reaches the orchestrator as a hidden wake turn, through
   * the same admission as any turn. Its request id is the turn's
   * `clientMsgId`, so a report sent again after an eviction is a replay.
   */
  /** The owner's object, as the pi agents' directory reads and messages it. */
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

  /**
   * Agents a cloud pi conversation places on the owner's devices: started,
   * messaged and paused through the owner's agent threads, the loop's device
   * agents' plane. The device runs one as a whole; its report comes back as
   * the same wake turn. Control receipts are kept per thread.
   */
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
    // The owner's agent threads replay by request id across conversations.
    const requestId = (authority: Authority, key: string) =>
      `pi:${authority.conversationId}:${key}`.slice(0, 128);
    return {
      start: async (args, authority, parentTurnId) => {
        const started = await spawnDeviceAgent(
          caller(authority, parentTurnId),
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
      status: async (threadId, authority, parentTurnId) => {
        const current = await readDeviceAgent(
          caller(authority, parentTurnId),
          await receipt(threadId),
        );
        await this.ctx.storage.put(receiptKey(threadId), current);
        const deviceId = current.executorDeviceId;
        const device = deviceId
          ? (
              await this.ownerGate(authority.ownerId)
                .devices()
                .catch(() => undefined)
            )?.devices.find((entry) => entry.deviceId === deviceId)
          : undefined;
        const name = device?.label?.trim() || deviceId || "its computer";
        const status = normalizeAgentDirectoryStatus(current.status);
        const offline =
          device && !device.online && isLiveAgentStatus(status)
            ? `, but ${name} is offline${
                device.lastSeenAt ? ` (last seen ${new Date(device.lastSeenAt).toISOString()})` : ""
              }, so this may be out of date; it reports when ${name} reconnects`
            : "";
        return `${status} on ${name}${offline}`;
      },
      pause: async (args, authority, parentTurnId) => {
        const next = await cancelDeviceAgent(
          caller(authority, parentTurnId),
          await receipt(args.threadId),
          requestId(authority, args.key),
        );
        await this.ctx.storage.put(receiptKey(args.threadId), next);
      },
    };
  }

  /**
   * Agents a cloud pi conversation starts on a model of their own: each is
   * one of the owner's agent threads on that execution (Claude Code or Codex
   * in a container, a model on a key saved to the account, a Stella model),
   * dispatched, messaged and paused as the loop's own cloud agents are; its
   * report comes back as a wake turn. Control receipts are kept per thread.
   */
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
          // A pi agent here, or else an agent in its own container.
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
      status: async (threadId) => {
        const control = await this.requireCloudAgentControlReceipt(threadId, "any");
        return `${control.status} in Stella's cloud`;
      },
      pause: async (args, authority, parentTurnId) => {
        const control = await this.requireCloudAgentControlReceipt(args.threadId, "any");
        if (!isCloudAgentControlActive(control.status) || !control.turnId) return;
        const paused = await this.pausePiThread({
          ownerId: authority.ownerId,
          ownerGeneration: authority.ownerGeneration,
          threadId: control.threadId,
          turnId: control.turnId,
          attemptGeneration: control.attemptGeneration,
        });
        if (paused !== "unknown") return;
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
              reason: AGENT_PAUSED_REASON,
            }),
          },
        );
        await teardown.body?.cancel().catch(() => undefined);
        if (!teardown.ok && teardown.status !== 409) {
          throw new Error(`Could not pause ${control.threadId}. Try again.`);
        }
      },
    };
  }

  /** A note one of this conversation's pi agents sent Stella, through the owner's report outbox. */
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

  /**
   * One run of a pi agent here, in the owner's agent threads: its row, under
   * the agent that started it, and how the run ended. The row is marked as
   * the harness's, which keeps its attempts and reports. An end carries its
   * start again, so a row whose start was lost still gets made first.
   */
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
        agentDepth: event.parentThreadId ? 2 : 1,
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
        completedAt: now,
      });
    }
    await this.deferOwnerEvents(events);
  }

  /** The card that ends one of pi's agents' attempts, under `turnId` (its own, by default). */
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
    // A pause's card has always been the attempt's canceled card; its id stays.
    const cardKind = outcome.kind === "paused" ? "canceled" : outcome.kind;
    return {
      type: "agent-lifecycle",
      eventId: `pi-agent:${threadId}:${agent.attempt}:${cardKind}`,
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

  /**
   * Start one attempt of an agent thread as a pi agent here, right away: pi
   * runs it in the background whatever turn this conversation is running,
   * on the authority its dispatcher admitted. The attempt is recorded before
   * pi has it, so a pause that arrives first stops it, and a retried
   * dispatch hands it over once. The owner's agent threads learn it started
   * once pi has it.
   */
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
    // Paused before it started: it never starts.
    if (open.pausing) {
      await this.settlePiThreadAttempts(record, attempt.attemptGeneration, {
        status: "canceled",
        errorMessage: AGENT_PAUSED_REASON,
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
        authority: {
          ownerId: input.ownerId,
          ownerGeneration: input.ownerGeneration,
          conversationId: input.conversationId,
          audience: input.audience,
          budgetMicroCents: input.budgetMicroCents,
          execution: input.execution,
        },
        // A ChatGPT plan agent runs on the plan's model, which the gateway does not resolve.
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
    // Paused while pi took it: it stops now, and settles as canceled.
    if (
      handed?.attempts.find(
        (entry) => entry.attemptGeneration === attempt.attemptGeneration,
      )?.pausing
    ) {
      await runtime.pauseThreadAgent(attempt.threadId, contextFor());
    }
    // Agents keep this object waking while they run.
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

  /**
   * A report of an agent thread's agent. It answers one attempt (the one
   * whose message its run took; older open attempts are answered with it).
   * A report without text settles an attempt only when it was paused.
   */
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
      if (!attempt.pausing) return;
      outcome = { status: "canceled", errorMessage: AGENT_PAUSED_REASON };
    } else {
      const parsed = piReportOutcome(report);
      outcome =
        parsed.kind === "completed"
          ? {
              status: "completed",
              resultJson: JSON.stringify({ finalText: parsed.body }),
            }
          : parsed.kind === "paused"
            ? { status: "canceled", errorMessage: AGENT_PAUSED_REASON }
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

  /**
   * Settle an agent thread's attempts through `attemptGeneration` with one
   * outcome, as a BuildSession settles its agent's: each attempt's terminal
   * event and the thread's completion go to the owner's agent threads, and
   * the conversation that started the thread is woken with the report
   * (a computer's dispatch is delivered to it by the agent threads). The
   * decision is kept before anything is sent, so a redelivered report
   * repeats the same terminal and the same wake.
   */
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
      status: agentAttemptOutcomeOf({
        status: terminal.status,
        reason: terminal.errorMessage,
      }),
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

  /**
   * New input for the running attempt of an agent thread whose agent runs
   * here; it reads it before its next step. `unknown` when none does.
   */
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

  /**
   * Pause one exact attempt of an agent thread whose agent runs here. Its
   * attempt settles as canceled once its run stops, or as it is handed over
   * if pi does not have it yet.
   */
  async pausePiThread(input: PiThreadPause): Promise<PiThreadPauseResult> {
    const decided = await this.ctx.blockConcurrencyWhile(
      async (): Promise<PiThreadPauseResult | "pause"> => {
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
        return attempt?.handedOff ? "pause" : "paused";
      },
    );
    if (decided !== "pause") return decided;
    const runtime = await this.openPiRuntime(this.piGatewayOrigin());
    const { contextFor } = await import("../pi-runtime.js");
    await runtime.pauseThreadAgent(input.threadId, contextFor());
    return "paused";
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

  /**
   * While pi has work in flight here (agents running, their reports on the
   * way), wake this object every {@link PI_HEARTBEAT_MS}. A wake after an
   * eviction reopens the harness, which resumes that work.
   */
  protected async piHeartbeat(): Promise<void> {
    // Any conversation may hold pi work: its own, or a computer's cloud agent.
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

  /**
   * Abort what pi is running for this conversation when no live turn here
   * holds the run: a watchdog firing in an isolate that never resumed it.
   */
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

  /**
   * Stella moved to one of the owner's computers during this turn, pi's or
   * Claude Code's (`switch_destination`): now that the turn has ended, her
   * brief continues there, as a computer's hand-off does. A turn the user
   * stopped leaves her there with nothing to carry on.
   */
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

  /**
   * The latest checkpoint of this journal epoch, if a host published one.
   * Rollover keeps every message after it resident; only storage pressure or
   * the byte backstop archives past it, and then it is stale and a new
   * transcript starts from the journal's window instead.
   */
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

  /** Where a new transcript of this conversation starts (`journalImportAfter`). */
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

  /**
   * Keep a compaction as the conversation's checkpoint: its summary covers
   * the journal up to the message before the first one it kept. Only a newer
   * checkpoint replaces the one kept. Returns where it covers through, or
   * undefined when the kept message is not in the journal.
   */
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

  protected async setPiBrain(host: PiBrainHost): Promise<PiBrainRecord> {
    const prior = await this.ctx.storage.get<PiBrainRecord>(PI_BRAIN_KEY);
    const record = movePiBrain(prior, host, Date.now());
    await this.ctx.storage.put(PI_BRAIN_KEY, record);
    this.notePiBrainLease("moved", record);
    return record;
  }

  /**
   * The computer holding this conversation's brain as the owner gate sees
   * it: whether it takes work from other devices now, as pi's
   * `switch_destination` would refuse a move there (`refusal` undefined when
   * it does), when its presence heartbeat was last heard while it was ready,
   * which renews its lease, and whether it is gone: offline, or not among
   * the owner's computers at all. Only a gone holder loses the brain to a
   * takeover; one that is up and takes no work from elsewhere keeps it.
   */
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

  /**
   * A host's claim on this conversation's brain for a turn it would answer:
   * the record's holder renews its lease, a computer answering its own
   * user's message (`claimFree`) while no host holds one claims it, a host
   * that finds the holder gone or lapsed takes the lease over under the
   * next epoch, and
   * any other claim is refused (`decidePiBrainClaim`). `holder` is the
   * holding computer's state, read before this so no request interleaves
   * between the record read and its write; a record that moved meanwhile
   * is weighed without it.
   */
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
    /** A device's turn on a message its user typed there: with no lease held, it claims one. */
    claimFree?: boolean;
    /** The account's home computer, when it is up and ready (`piBrainHome`). */
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
        await this.ctx.storage.put(PI_BRAIN_KEY, record);
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
      await this.ctx.storage.put(PI_BRAIN_KEY, record);
      this.notePiBrainLease("claimed", record, {
        ...(args.turnId ? { turnId: args.turnId } : {}),
      });
      return { decision: { kind: "holder" }, record, takenOver: false };
    }
    if (decision.kind === "holder" && record) {
      const renewed = renewPiBrainLease(record, now);
      if (renewed) {
        record = renewed;
        await this.ctx.storage.put(PI_BRAIN_KEY, record);
      }
      return { decision, record, takenOver: false };
    }
    if (decision.kind === "takeover" && record) {
      const prior = record;
      record = takeOverPiBrain(prior, args.claimant, now);
      await this.ctx.storage.put(PI_BRAIN_KEY, record);
      this.notePiBrainLease("taken_over", record, {
        reason: decision.reason,
        ...(holder?.refusal ? { holderRefusal: holder.refusal } : {}),
        ...(args.turnId ? { turnId: args.turnId } : {}),
      });
      await this.settleTakenOverTurn(prior);
      return { decision, record, takenOver: true };
    }
    // The object's own claim on a live holder is routine: it places there.
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

  /** The account's home computer while it is up and ready: the lease belongs there. */
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

  /**
   * The lease back on the account's home computer, which is up: unless the
   * holder is in the middle of a turn. It only ever moves the lease home; it
   * never weighs whether the holder lapsed. The record as it stands after.
   */
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
    await this.ctx.storage.put(PI_BRAIN_KEY, homed);
    this.notePiBrainLease("moved", homed, {
      reason: "home",
      ...(turnId ? { turnId } : {}),
    });
    return homed;
  }

  /** Whether a computer is in the middle of one of this conversation's turns. */
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

  /** The holding computer journaled or renewed a turn: it is up, so its lease runs on. */
  protected async renewPiBrainHolder(deviceId: string): Promise<void> {
    const record = await this.ctx.storage.get<PiBrainRecord>(PI_BRAIN_KEY);
    if (record?.host !== "device" || record.deviceId !== deviceId) return;
    const renewed = renewPiBrainLease(record, Date.now());
    if (renewed) await this.ctx.storage.put(PI_BRAIN_KEY, renewed);
  }

  /**
   * What happened to this conversation's brain lease (a move, a takeover,
   * a refused claim), logged and appended to the owner's agent event log
   * under the lease's epoch, once per event.
   */
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

  /**
   * A chat for this conversation placed on the computer its Stella runs on,
   * which answers it from the shared journal: a message the user sent from
   * elsewhere, or Stella's own brief when she moved there.
   */
  protected async placeOnPiBrain(args: {
    ownerId: string;
    ownerGeneration?: string;
    deviceId: string;
    clientMsgId: string;
    prompt: string;
    attachments?: string[];
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

  /** Read the running agents again: one read at a time, and one more for what changed during it. */
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

  /**
   * The running agents of a conversation pi has run in, from the records of
   * whoever runs them: Stella's own from pi's state here, everything else (a
   * computer's agents, agents on a device, agent threads) from the owner's
   * agent threads. Neither is folded from cards, so a card that was never
   * written leaves nothing running; an agent that started before pi listed
   * them and never ended is simply not listed. Clients hear the new list.
   */
  protected async refreshAgents(): Promise<void> {
    // pi's agents start and stop only while pi is open here: one it has not
    // opened for, with none listed, has none running.
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

  /** The owner's agent threads this conversation lists as running. */
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
    // Cards are rows: none lands inside a turn that started meanwhile.
    if (this.purged() || (await this.turnRunning())) return;
    for (const entry of running) {
      const thread = threads.get(entry.agentId);
      let ended: {
        kind: "completed" | "failed" | "canceled";
        attempt: number;
        body: string;
      } | null = null;
      if (thread) {
        // An owner record behind the journal's newest start is not about that start.
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

  /**
   * A pi-durable cloud agent's own tools: web, and code with the owner's
   * connectors and the run's cloud browser (its files and shell are its
   * container's). Built on the authority the agents keep, since they run
   * between turns.
   */
  protected async createPiAgentTools(
    authority: {
      ownerId: string;
      ownerGeneration: string;
      conversationId: string;
    },
    browser: CloudBrowserClient | undefined,
    history?: import("../cloud-code-tool.js").CloudHistoryClient,
  ): Promise<CloudCodeSourceAgentTool[]> {
    const ownerInternal = async (name: string, args: unknown) =>
      unwrapRpc(
        await this.ownerGate(authority.ownerId).ownerInternal({
          name,
          args,
          ownerGeneration: authority.ownerGeneration,
        }),
      );
    if (isSlackConversationId(authority.conversationId)) {
      const web = createCloudWebTool({
        ownerInternal: standaloneOwnerInternal(ownerInternal),
      });
      const code = await createCloudCodeAgentTool({
        loader: this.env.LOADER,
        tools: [web],
        executionScope: `${authority.ownerGeneration}:${authority.conversationId}:pi-agents`,
        ...(browser ? { browser } : {}),
        ...(history ? { history } : {}),
      });
      return [code, web];
    }
    const web = createCloudWebTool({ ownerInternal });
    const connectors = new CloudConnectorDirectory({
      source: {
        catalog: () => listIntegrationCatalog(this.env),
        actions: (args) => listIntegrationActions(this.env, args),
        connections: async () =>
          (await ownerInternal("integrations.connections", {})) as {
            connections: Array<{ id: string; connected: boolean }>;
          },
        run: (args) => ownerInternal("integrations.run", args),
      },
    });
    const code = await createCloudCodeAgentTool({
      loader: this.env.LOADER,
      tools: [web],
      executionScope: `${authority.ownerGeneration}:${authority.conversationId}:pi-agents`,
      connect: createCloudConnectClient(connectors),
      ...(browser ? { browser } : {}),
      ...(history ? { history } : {}),
    });
    return [code, web];
  }

  /**
   * A pi agent's login handoff, shown to the user as the owner's browser
   * interaction (every signed-in client lists `browser.pending`) and waited
   * on until it ends. Polling is the wait, as for the connect card: the
   * owner object closes the interaction when the user finishes or cancels
   * it, or at its deadline. A stopped agent withdraws it.
   */
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
    // The owner's expiry job closes it at its deadline; this one is a backstop.
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
      // An abort just ends the wait; the loop's next check withdraws it.
      await sleepWithAbort(
        BROWSER_HANDOFF_POLL_MS,
        signal,
        () => new Error("Browser handoff wait aborted."),
      ).catch(() => undefined);
    }
  }

  // Implemented further up the chain.
  protected abstract handleTurnStart(
    request: Request,
    handoff?: {
      authority: AdmittedCloudChat;
      preparation: CloudChatPreparation;
    },
  ): Promise<Response>;
}
