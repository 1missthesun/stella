import { builderServiceSecret } from "./secret-rotation.js";
import type { SerializedAgentToolResult } from "@stella/executor-cloud/attached-tool-protocol";
import {
  ATTACHED_TOOL_PROTOCOL_VERSION,
  attachedToolFingerprint,
  attachedToolPathsForDirectory,
  isAttachedToolName,
} from "@stella/executor-cloud/attached-tool-protocol";
import {
  acquireAgentContainerSlot,
  agentContainerHandle,
  agentContainerSize,
  materializeAgentWorld,
  openAgentSession,
  piAgentContainerSizeKeys,
  probeAgentContainerPressure,
  releaseAgentContainer,
  releaseAgentContainerSlot,
  type AgentContainerPressure,
} from "./agent-container.js";
import { executorSessionEnvironment } from "./executor-session-env.js";
import { normalizeToolWorkspaceRoot, turnBrokerCredentialsPath } from "./build-session/shared/keys.js";
import type { ExecutionSession, SandboxHandle } from "./sandbox-client.js";
import {
  issueTurnBrokerCredential,
  revokeTurnBrokerCredential,
  TURN_BROKER_MAX_TTL_MS,
  turnBrokerStorageKey,
  type TurnBrokerRecord,
} from "./turn-credential-broker.js";
import { prepareSlackPreviews } from "./slack/previews.js";
import { prepareSlackRepo } from "./slack/repo-clone.js";
import { egressForConversation, prepareSlackEnvironment, slackEnvironmentsEnabled } from "./slack/environment.js";
import { isSlackConversationId } from "./slack/conversation-id.js";
import { conversationWorldName } from "./slack/scope.js";
import { startTurnExecution } from "./turn-cancellation.js";
import type { InstanceSize } from "./instance-size.js";
import { issueWorldCapability } from "./world-capability.js";
import { agentSandboxId, WORLD_ROOT, worldName } from "./workspace.js";

export type PiComputeEnv = Pick<
  Cloudflare.Env,
  "OWNER_GATES" | "WORLDS" | "BUILDER_SERVICE_SECRET"
> &
  Partial<Pick<Cloudflare.Env, "Sandbox" | "SANDBOX_IDLE_TIMEOUT_MS" | "CLOUD_BUILDER_PUBLIC_URL" | "DB" | "BETTER_AUTH_SECRET">>;

export type PiComputeOwner = { ownerId: string; ownerGeneration: string; conversationId: string };

export type PiComputeHost = {
  env: PiComputeEnv;
  storage: DurableObjectStorage;
  log(event: string, fields: Record<string, unknown>): void;
};

export type PiComputeRecord = {
  version: 1;
  owner: PiComputeOwner;
  turnId: string;
  attemptGeneration: number;
  sandboxId: string;
  sessionId: string;
  daemonDirectory: string;
  size?: InstanceSize;
  threadId?: string;
};

export type PiWorkspaceCall = { toolCallId: string; toolName: string; params: Record<string, unknown> };

export type PiComputeLease = {
  readonly record: PiComputeRecord;
  readonly ready: Promise<void>;
  call(call: PiWorkspaceCall): Promise<SerializedAgentToolResult>;
  quiesce(linkedPaths: readonly string[]): Promise<{ deliveredFiles: readonly string[] }>;
  probePressure(): Promise<AgentContainerPressure | undefined>;
  release(options?: { warm?: boolean }): Promise<void>;
  readonly expiresAt: number;
  abort(reason?: unknown): void;
};

export const piBrokerSessionId = (conversationId: string): string => `pi:${conversationId}`;

const generationKey = (agentConversationId: number) => `piComputeGen:${agentConversationId}`;

export const piComputeKey = (agentConversationId: number) => `piCompute:${agentConversationId}`;

const CREDENTIAL_TTL_MS = Math.min(TURN_BROKER_MAX_TTL_MS, 30 * 60_000);
const COMMAND_TIMEOUT_MS = 15 * 60_000;

const hex = async (value: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sandboxFor = (
  host: PiComputeHost,
  target: { sandboxId: string; size: InstanceSize; world: string; owner: string },
): SandboxHandle => {
  const idle = Number(host.env.SANDBOX_IDLE_TIMEOUT_MS);
  return agentContainerHandle(host.env.Sandbox, {
    ...target,
    ...(Number.isSafeInteger(idle) && idle > 0 ? { idleTimeoutMs: idle } : {}),
  });
};

const piLog =
  (host: PiComputeHost) =>
  (_level: "info" | "error", event: string, fields: Record<string, unknown>) =>
    host.log(event, fields);

const publicOrigin = (host: PiComputeHost): string => {
  const origin = host.env.CLOUD_BUILDER_PUBLIC_URL?.replace(/\/+$/u, "");
  if (!origin) throw new Error("Cloud containers are not configured.");
  return origin;
};

const piWorldName = async (host: PiComputeHost, owner: PiComputeOwner): Promise<string> =>
  await conversationWorldName(host.env, owner.ownerId, owner.conversationId, worldName);

export const releasePiCompute = async (
  host: PiComputeHost,
  record: PiComputeRecord,
  options: { warm?: boolean } = {},
) => {
  await releaseAgentContainer({
    env: host.env,
    ownerId: record.owner.ownerId,
    sandbox: sandboxFor(host, {
      sandboxId: record.sandboxId,
      size: record.size ?? "small",
      world: await piWorldName(host, record.owner),
      owner: record.owner.ownerId,
    }),
    sandboxId: record.sandboxId,
    sessionId: record.sessionId,
    daemonDirectory: record.daemonDirectory,
    release: { warm: options.warm === true },
    log: piLog(host),
  });
  const brokerKey = turnBrokerStorageKey(record);
  const broker = await host.storage.get<TurnBrokerRecord>(brokerKey);
  if (broker) await host.storage.put(brokerKey, revokeTurnBrokerCredential(broker, Date.now())).catch(() => undefined);
};

export const openPiComputeLease = async (
  host: PiComputeHost,
  args: { owner: PiComputeOwner; agentConversationId: number; threadId: string; turnId: string },
): Promise<PiComputeLease> => {
  const { owner, agentConversationId, threadId, turnId } = args;
  const attemptGeneration = ((await host.storage.get<number>(generationKey(agentConversationId))) ?? 0) + 1;
  await host.storage.put(generationKey(agentConversationId), attemptGeneration);
  const identity = { turnId, attemptGeneration };
  const hash = (await hex(`${turnId}:${attemptGeneration}`)).slice(0, 32);
  const sizeKeys = piAgentContainerSizeKeys(threadId);
  const size = await agentContainerSize(host.storage, sizeKeys, "small");
  const record: PiComputeRecord = {
    version: 1,
    owner,
    turnId,
    attemptGeneration,
    size,
    threadId,
    sandboxId: await agentSandboxId(
      owner.ownerId,
      `${isSlackConversationId(owner.conversationId) ? "crew-world:" : ""}pi:${owner.conversationId}:${threadId}`,
    ),
    sessionId: `pi-agent-${hash}`,
    daemonDirectory: attachedToolPathsForDirectory(`/workspace/attached/pi-${hash}-${attemptGeneration}`).directory,
  };
  await host.storage.put(piComputeKey(agentConversationId), record);
  const world = await piWorldName(host, owner);
  let released!: () => void;
  const held = new Promise<void>((resolve) => {
    released = resolve;
  });
  const execution = startTurnExecution({ work: async () => await held });
  const context = {
    cancellation: execution.cancellation,
    signal: execution.signal,
    assertActive: () => {
      execution.signal.throwIfAborted();
      if (execution.cancellation.aborted) throw new Error("This agent's workspace was released.");
    },
  };
  const expiresAt = Date.now() + CREDENTIAL_TTL_MS;
  let sandbox: SandboxHandle | undefined;
  let releaseWarm = false;
  let workspaceEnv: Record<string, string> = {};
  let environmentNotice: string | undefined;

  const attachWorld = async (target: { sandboxId: string; sessionId: string }) => {
    const started = Date.now();
    await acquireAgentContainerSlot(host.env, owner.ownerId, target.sandboxId);
    sandbox = sandboxFor(host, { sandboxId: target.sandboxId, size, world, owner: owner.ownerId });
    if (isSlackConversationId(owner.conversationId) && slackEnvironmentsEnabled(host.env)) {
      const egress = await egressForConversation(host.env as Cloudflare.Env, owner.conversationId);
      const { restarted } = await sandbox.setEgress(egress);
      if (restarted) host.log("slack_container_restarted_for_network", { threadId, network: egress?.internet ? "full" : "restricted" });
    }
    const options = {
      id: target.sessionId,
      cwd: "/opt/stella",
      commandTimeoutMs: COMMAND_TIMEOUT_MS,
      env: executorSessionEnvironment(),
    };
    const session: ExecutionSession = await openAgentSession(sandbox, options);
    context.assertActive();
    const coldContainerStartMs = Date.now() - started;
    const restoring = Date.now();
    await normalizeToolWorkspaceRoot(session, WORLD_ROOT);
    const materialized = await materializeAgentWorld(session, {
      secret: builderServiceSecret(host.env),
      origin: publicOrigin(host),
      worldRoot: WORLD_ROOT,
      worldName: world,
      turnId,
      attemptGeneration,
      ttlMs: CREDENTIAL_TTL_MS,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (!materialized.ok) {
      host.log("pi_agent_world_materialize_failed", {
        threadId,
        turnId,
        exitCode: materialized.result.exitCode,
        stderr: materialized.result.stderr.trim().slice(-1500),
        stdout: materialized.result.stdout.trim().slice(-500),
      });
      throw new Error(materialized.message);
    }
    const repoDir = await prepareSlackRepo(host.env, session, owner.conversationId, publicOrigin(host), host.log, expiresAt);
    await prepareSlackPreviews(host.env, session, owner.conversationId, publicOrigin(host), host.log);
    if (isSlackConversationId(owner.conversationId) && slackEnvironmentsEnabled(host.env)) {
      const prepared = await prepareSlackEnvironment(
        host.env as Cloudflare.Env,
        session,
        owner.conversationId,
        repoDir ?? WORLD_ROOT,
        host.log,
      );
      workspaceEnv = prepared?.env ?? {};
      environmentNotice = prepared?.notice;
    }
    context.assertActive();
    host.log("pi_agent_world_attached", {
      threadId,
      turnId,
      attemptGeneration,
      instanceSize: size,
      ms: Date.now() - started,
    });
    return { session, coldContainerStartMs, restoreMs: Date.now() - restoring };
  };

  const prepareBrokerHandoff = async ({ session }: { session: ExecutionSession }) => {
    const brokerIdentity = {
      sessionId: piBrokerSessionId(owner.conversationId),
      ownerId: owner.ownerId,
      ownerGeneration: owner.ownerGeneration,
      turnId,
      attemptGeneration,
    };
    const origin = publicOrigin(host);
    const issued = await issueTurnBrokerCredential({
      identity: brokerIdentity,
      endpoint: `${origin}/sessions/${encodeURIComponent(brokerIdentity.sessionId)}/turn-broker`,
      now: Date.now(),
      ttlMs: Math.max(1, expiresAt - Date.now()),
    });
    await host.storage.put(turnBrokerStorageKey(brokerIdentity), issued.record);
    const credentialsPath = turnBrokerCredentialsPath("/workspace");
    await session.writeFile(credentialsPath, JSON.stringify(issued.handoff));
    const protectedHandoff = await session.exec(`chmod 600 ${credentialsPath}`);
    if (!protectedHandoff.success) throw new Error("Turn broker handoff could not be protected.");
    return {
      turnId,
      attemptGeneration,
      threadId,
      prompt: "",
      workspaceRestored: true,
      turnBroker: { credentialsPath },
      world: {
        origin,
        name: world,
        capability: await issueWorldCapability({
          secret: builderServiceSecret(host.env),
          worldName: world,
          turnId,
          attemptGeneration,
          now: Date.now(),
          ttlMs: Math.max(1, expiresAt - Date.now()),
        }),
      },
    };
  };

  const { createAgentSandboxAttachment } = await import("./agent-sandbox-attachment.js");
  const attachment = createAgentSandboxAttachment({
    context,
    attachWorld,
    prepareBrokerHandoff,
    startDaemon: async (command, options) => {
      if (!sandbox) throw new Error("The agent's container has not been attached.");
      return await sandbox.startProcess(command, {
        cwd: options.cwd,
        env: { ...workspaceEnv, ...executorSessionEnvironment() },
        processId: options.processId,
      });
    },
    release: async () => await releasePiCompute(host, record, { warm: releaseWarm }),
    destroy: async (target) => {
      await releaseAgentContainerSlot(host.env, owner.ownerId, target.sandboxId);
      await sandboxFor(host, { sandboxId: target.sandboxId, size, world, owner: owner.ownerId })
        .destroy()
        .catch(() => undefined);
    },
    emitEvent: (kind, payload) => host.log("pi_agent_compute_event", { threadId, kind, payload }),
  });
  const target = {
    sandboxId: record.sandboxId,
    instanceSize: size,
    sessionId: record.sessionId,
    daemonDirectory: record.daemonDirectory,
  } as const;

  let bootNotice: string | undefined;
  const ready = (async () => {
    await attachment.boot(target);
    const report = await attachment.control({ sandboxId: record.sandboxId, control: "boot_report", ...identity });
    const notices = [
      ...(environmentNotice ? [environmentNotice] : []),
      ...(report.status === "boot_report" ? report.notices : []),
    ];
    if (notices.length > 0) bootNotice = notices.join(" ");
  })();
  ready.catch(() => undefined);
  let quiesced: Promise<{ deliveredFiles: readonly string[] }> | undefined;
  let releasing: Promise<void> | undefined;

  const failure = (message: string): SerializedAgentToolResult => ({
    outcome: { kind: "error", message },
    details: null,
    authorizedImages: [],
  });

  return {
    record,
    ready,
    expiresAt,
    async call({ toolCallId, toolName, params }) {
      if (!isAttachedToolName(toolName)) return failure(`${toolName} is not a tool the workspace can run.`);
      await ready;
      context.assertActive();
      const response = await attachment.callTool({
        sandboxId: record.sandboxId,
        request: {
          version: ATTACHED_TOOL_PROTOCOL_VERSION,
          ...identity,
          toolCallId,
          fingerprint: await attachedToolFingerprint({ toolName, params }),
          toolName,
          params,
        },
      });
      if (response.status === "pending") {
        return failure("That command is still running in the workspace. Wait for it before trying again.");
      }
      if (response.status !== "completed") return failure(response.error);
      const result = response.result;
      if (!bootNotice || result.outcome.kind !== "ok") return result;
      const notice = bootNotice;
      bootNotice = undefined;
      return { ...result, outcome: { kind: "ok", text: `${result.outcome.text}\n\n${notice}` } };
    },
    quiesce: (linkedPaths) =>
      (quiesced ??= (async () => {
        const response = await attachment.control({
          sandboxId: record.sandboxId,
          control: "quiesce",
          linkedPaths: [...linkedPaths],
          ...identity,
        });
        return { deliveredFiles: response.status === "quiesced" ? response.deliveredFiles : [] };
      })()),
    probePressure: async () => {
      if (!sandbox) return undefined;
      return await probeAgentContainerPressure({
        sandbox,
        size,
        storage: host.storage,
        keys: sizeKeys,
        log: piLog(host),
        fields: { threadId, turnId, attemptGeneration },
      }).catch(() => undefined);
    },
    release: (options) => {
      if (releasing === undefined) releaseWarm = options?.warm === true;
      return (releasing ??= attachment.release(target));
    },
    abort: (reason) => {
      void execution.interrupt(reason).catch(() => undefined);
      released();
    },
  };
};

export const forgetPiCompute = async (host: PiComputeHost, recordKey: string, record: PiComputeRecord) => {
  await host.storage.delete([recordKey, turnBrokerStorageKey(record)]);
};
