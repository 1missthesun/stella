import { sha256BytesHex } from "../hash.js";
import { serveAgentMoveRequest } from "./agent-move.js";
import { serveAgentCodeConnectRequest } from "./agent-connect.js";
import { serveAgentBrowserRequest } from "./agent-browser.js";
import {
  validNativeStateCheckpointMac,
} from "../native-state-checkpoint.js";
import { readThreadHistory, ThreadTranscriptError } from "../thread-transcript.js";
import { answerOwnHistory, withoutThinking, type OwnHistoryRow } from "@stella/contracts/history-search";

const THREAD_HISTORY_QUERY_ROWS = 100_000;
import type { ThreadMessageInput } from "../thread-transcript.js";
import {
  TurnBrokerBodyTooLargeError,
  claimTurnBrokerRequest,
  preflightTurnBrokerRequest,
  readTurnBrokerRequestBody,
  turnBrokerDenialResponse,
  turnBrokerStorageKey,
  turnBrokerTargetMatchesEngine,
} from "../turn-credential-broker.js";
import type {
  TurnBrokerLiveFence,
  TurnBrokerRecord,
  TurnBrokerTarget,
} from "../turn-credential-broker.js";
import { uploadTurnStateArchive } from "../turn-state-archive.js";
import {
  parseTurnStateCheckpointRequest,
  publicTurnStateCheckpointReceipt,
  replaceTurnStateArchiveSession,
} from "../turn-state-checkpoint.js";
import type {
  PreparedTurnStateOperation,
  ResolvedTurnState,
  TurnStateCandidate,
  TurnStateWorkspaceHead,
} from "../turn-state-registry.js";
import { worldName } from "../workspace.js";
import type { BuildSessionInternals } from "./host.js";
import {
  AgentTurnAuthorityLostError,
  AgentTurnError,
  OwnerPurgeFenceError,
  TurnStateOwnerCallError,
  TurnStateRegistryBookkeepingError,
  isTurnStateAuthorityError,
} from "./shared/errors.js";
import {
  callOrchestratorCliTurnRoute,
  errorMessage,
  exactTurnIdentityMatches,
  log,
  nativeStateIntegrityKeysFor,
  nativeStateThreadHash,
  sessionName,
  turnStateCheckpointOperationKey,
} from "./shared/keys.js";
import type {
  TurnRequest,
  TurnStateCheckpointOperation,
} from "./shared/types.js";
import {
  CLOUD_CLI_TURN_DO_PATHS,
  type CloudCliTurnEventsForward,
  type CloudCliTurnIdentity,
  type CloudCliTurnToolForward,
} from "@stella/contracts/cloud-orchestrator-cli";
import { TURN_BROKER_RESPONSE_HEADERS } from "@stella/contracts/turn-credential-broker";
import { rpcErrorStatus, type RpcResponse } from "@stella/contracts/backend/protocol";
import { TURN_BROKER_DRIVE_PATHS } from "../turn-credential-broker.js";
import type { DriveTurnFilesResult } from "../owner-store/domains/drive.js";
import type {
  TurnBrokerTurnStateCheckpointReceipt,
  TurnBrokerTurnStateCheckpointRequest,
} from "@stella/contracts/turn-credential-broker";
import { ownerGateStub } from "../rpc-release.js";
import { conversationWorldName, crewScopeForConversation } from "../slack/scope.js";

export type TurnBrokerHost = Pick<
  BuildSessionInternals,
  | "ctx"
  | "env"
  | "agentTurnExecutions"
  | "exactTurnCancellations"
  | "turnStateCheckpointRuns"
  | "appendThreadTranscript"
  | "assertAgentTurnIdentity"
  | "assertTurnWritable"
  | "callOwnerTurnState"
  | "currentSandbox"
  | "emitTurnEvent"
  | "executeTurnStateCheckpoint"
>;

const registryBookkeepingAfterCheckpoint = async <T>(
  historyCursor: string,
  manifestId: string | undefined,
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof AgentTurnAuthorityLostError ||
      error instanceof OwnerPurgeFenceError ||
      isTurnStateAuthorityError(error)
    ) {
      throw error;
    }
    throw new TurnStateRegistryBookkeepingError(
      historyCursor,
      manifestId,
      error,
    );
  }
};

export const resolveAgentTurnState = async (
  host: TurnBrokerHost,
  turn: TurnRequest,
  canonicalHistoryCursor: string,
): Promise<ResolvedTurnState> => {
  const resolved = await host.callOwnerTurnState<ResolvedTurnState>(
    turn,
    "resolve",
    {
      threadId: turn.threadId,
      canonicalHistoryCursor,
      requireNative: false,
    },
  );
  if (
    !resolved ||
    typeof resolved !== "object" ||
    typeof resolved.registryPresent !== "boolean" ||
    typeof resolved.threadRegistryPresent !== "boolean" ||
    typeof resolved.confirmationRequired !== "boolean" ||
    (!resolved.registryPresent &&
      (resolved.workspace !== undefined ||
        resolved.restore !== undefined ||
        resolved.threadRegistryPresent ||
        resolved.confirmationRequired)) ||
    (resolved.workspacePublication !== undefined &&
      (!resolved.registryPresent ||
        typeof resolved.workspacePublication !== "object" ||
        !/^[0-9a-f]{64}$/u.test(resolved.workspacePublication.operationId) ||
        typeof resolved.workspacePublication.publishable !== "boolean")) ||
    (resolved.confirmationRequired && !resolved.restore)
  ) {
    throw new Error("Turn state resolve receipt was invalid.");
  }
  const workspaceHead = resolved.workspace;
  if (
    workspaceHead &&
    (!/^[0-9a-f]{64}$/u.test(workspaceHead.manifestId) ||
      !/^(?:v1:empty|v1:[0-9a-f]{64})$/u.test(workspaceHead.historyCursor))
  ) {
    throw new Error("Canonical workspace head was invalid.");
  }
  const candidate = resolved.restore;
  if (candidate) {
    if (
      candidate.schemaVersion !== 1 ||
      !/^[0-9a-f]{64}$/u.test(candidate.operationId) ||
      !/^[0-9a-f]{64}$/u.test(candidate.requestFingerprint) ||
      !/^[0-9a-f]{64}$/u.test(candidate.receipt) ||
      candidate.historyCursor !== canonicalHistoryCursor ||
      !Number.isSafeInteger(candidate.createdAt) ||
      candidate.createdAt < 0
    ) {
      throw new Error("Canonical turn state candidate was invalid.");
    }
    if (turn.execution?.engine === "anthropic") {
      if (Boolean(candidate.native) !== Boolean(candidate.nativeCheckpoint)) {
        throw new AgentTurnError(
          "Stella couldn't validate this agent's saved native session. Try again.",
        );
      }
      if (!candidate.nativeCheckpoint) return resolved;
      const integrityKey = await nativeStateIntegrityKeysFor(host.env, turn);
      if (
        candidate.nativeCheckpoint.cursor !== canonicalHistoryCursor ||
        !(await validNativeStateCheckpointMac({
          checkpoint: candidate.nativeCheckpoint,
          threadId: turn.threadId!,
          integrityKey,
        }))
      ) {
        throw new AgentTurnError(
          "Stella couldn't validate this agent's saved native session. Try again.",
        );
      }
    }
  }
  return resolved;
};

export const publishAgentTurnWorkspace = async (
  host: TurnBrokerHost,
  turn: TurnRequest,
  canonicalHistoryCursor: string,
  operationId: string,
): Promise<TurnStateWorkspaceHead | undefined> => {
  const published = await host.callOwnerTurnState<{
    workspaceHead?: TurnStateWorkspaceHead;
    publicationReceipt?: unknown;
    replayed?: unknown;
  }>(turn, "publish-workspace", {
    threadId: turn.threadId,
    canonicalHistoryCursor,
    operationId,
  });
  const head = published?.workspaceHead;
  if (
    !published ||
    (turn.agentRole === "orchestrator"
      ? head !== undefined
      : !head ||
        head.historyCursor !== canonicalHistoryCursor ||
        !/^[0-9a-f]{64}$/u.test(head.manifestId)) ||
    typeof published.publicationReceipt !== "string" ||
    !/^[0-9a-f]{64}$/u.test(published.publicationReceipt) ||
    typeof published.replayed !== "boolean"
  ) {
    throw new Error("Turn state workspace publication was invalid.");
  }
  return head;
};

export const confirmAgentTurnStateRestore = async (
  host: TurnBrokerHost,
  turn: TurnRequest,
  canonicalHistoryCursor: string,
  threadCandidate: TurnStateCandidate | undefined,
  threadConfirmationRequired: boolean,
): Promise<void> => {
  if (threadConfirmationRequired) {
    const confirmed = await host.callOwnerTurnState<{
      thread?: {
        restore?: TurnStateCandidate;
        promoted?: unknown;
        replayed?: unknown;
      };
      confirmationReceipt?: unknown;
    }>(turn, "confirm-restore", {
      threadId: turn.threadId,
      canonicalHistoryCursor,
      ...(threadConfirmationRequired && threadCandidate
        ? { threadOperationId: threadCandidate.operationId }
        : {}),
    });
    if (
      (threadConfirmationRequired &&
        (!threadCandidate ||
          confirmed?.thread?.restore?.operationId !==
            threadCandidate.operationId ||
          confirmed.thread.restore.historyCursor !== canonicalHistoryCursor ||
          confirmed.thread.restore.receipt !== threadCandidate.receipt ||
          typeof confirmed.thread.promoted !== "boolean" ||
          typeof confirmed.thread.replayed !== "boolean")) ||
      typeof confirmed?.confirmationReceipt !== "string" ||
      !/^[0-9a-f]{64}$/u.test(confirmed.confirmationReceipt)
    ) {
      throw new Error("Turn state restore confirmation was invalid.");
    }
  }
  host.ctx.waitUntil(
    host
      .callOwnerTurnState(turn, "drain", { limit: 32 })
      .then(() => undefined, () => undefined),
  );
};

export const exactTurnStateCheckpointOperations = async (
  host: TurnBrokerHost,
  turn: TurnRequest,
): Promise<TurnStateCheckpointOperation[]> => {
  const listed = await host.ctx.storage.list<TurnStateCheckpointOperation>({
    prefix: "turnStateCheckpointOperation:",
    limit: 128,
  });
  const exact = [...listed.values()].filter(
    (operation) =>
      operation.turnId === turn.turnId &&
      operation.attemptGeneration === turn.attemptGeneration,
  );
  if (exact.length > 8) {
    throw new Error("Agent checkpoint recovery exceeded its operation bound.");
  }
  return exact;
};

export const abortUnpublishedTurnStateOperation = async (
  host: TurnBrokerHost,
  turn: TurnRequest,
  operation: TurnStateCheckpointOperation,
  canonicalHistoryCursor: string,
): Promise<void> => {
  if (!operation.payload) {
    await host.ctx.storage.delete(
      turnStateCheckpointOperationKey(operation.requestId),
    );
    return;
  }
  let operationId = operation.operationId;
  if (operation.state === "failed" && !operationId) {
    await host.ctx.storage.delete(
      turnStateCheckpointOperationKey(operation.requestId),
    );
    return;
  }
  if (!operationId) {
    const prepared = await host.callOwnerTurnState<PreparedTurnStateOperation>(
      turn,
      "prepare",
      {
        threadId: turn.threadId,
        attemptGeneration: turn.attemptGeneration,
        requestFingerprint: operation.requestFingerprint,
        historyCursor: operation.payload.historyCursor,
        ...(turn.agentRole === "orchestrator"
          ? { nativeOnly: true as const }
          : {}),
        createdAt: operation.createdAt,
        ...(operation.payload.nativeCheckpoint
          ? { nativeCheckpoint: operation.payload.nativeCheckpoint }
          : {}),
      },
    );
    if (!prepared || !/^[0-9a-f]{64}$/u.test(prepared.operationId)) {
      throw new Error("Turn state abort preparation receipt was invalid.");
    }
    operationId = prepared.operationId;
    const operationKey = turnStateCheckpointOperationKey(operation.requestId);
    await host.ctx.storage.transaction(async (transaction) => {
      const current =
        await transaction.get<TurnStateCheckpointOperation>(operationKey);
      if (
        !current ||
        current.state !== "pending" ||
        current.turnId !== operation.turnId ||
        current.attemptGeneration !== operation.attemptGeneration ||
        current.requestFingerprint !== operation.requestFingerprint ||
        (current.operationId !== undefined &&
          current.operationId !== prepared.operationId)
      ) {
        throw new Error("Turn state abort operation changed.");
      }
      await transaction.put(operationKey, {
        ...current,
        operationId: prepared.operationId,
      } satisfies TurnStateCheckpointOperation);
    });
  }
  const aborted = await host.callOwnerTurnState<{
    operationId?: unknown;
    abortReceipt?: unknown;
    replayed?: unknown;
  }>(turn, "abort-unpublished", {
    threadId: turn.threadId,
    operationId,
    candidateHistoryCursor: operation.payload.historyCursor,
    canonicalHistoryCursor,
  });
  if (
    aborted?.operationId !== operationId ||
    typeof aborted.replayed !== "boolean" ||
    typeof aborted.abortReceipt !== "string" ||
    !/^[0-9a-f]{64}$/u.test(aborted.abortReceipt)
  ) {
    throw new Error("Unpublished turn-state abort receipt was invalid.");
  }
};

const brokerFailure = (status: number): Response => {
  return Response.json(
    { error: "Turn broker authority is unavailable." },
    {
      status,
      headers: {
        "cache-control": "no-store",
        [TURN_BROKER_RESPONSE_HEADERS.denial]: "1",
      },
    },
  );
};

const brokerCheckpointPending = (): Response => {
  return Response.json(
    { error: "Turn state checkpoint is still resolving." },
    {
      status: 425,
      headers: {
        "cache-control": "no-store",
        [TURN_BROKER_RESPONSE_HEADERS.replayPending]: "1",
      },
    },
  );
};

export const executeTurnStateCheckpoint = async (
  host: TurnBrokerHost,
  args: {
    turn: TurnRequest;
    operationKey: string;
    operation: Extract<TurnStateCheckpointOperation, { state: "pending" }> & {
      payload: TurnBrokerTurnStateCheckpointRequest;
    };
  },
): Promise<TurnBrokerTurnStateCheckpointReceipt> => {
  const { turn, operationKey, operation } = args;
  await host.assertTurnWritable(turn);
  host.assertAgentTurnIdentity(turn);
  const nativeOnly = turn.agentRole === "orchestrator";
  const manifestId = nativeOnly
    ? undefined
    : (
        await host.env.WORLDS.getByName(
          await conversationWorldName(
            host.env,
            turn.ownerId,
            turn.conversationId ?? turn.originConversationId,
            worldName,
          ),
        ).checkpoint({ historyCursor: operation.payload.historyCursor })
      ).manifestId;

  const prepared = await registryBookkeepingAfterCheckpoint(
    operation.payload.historyCursor,
    manifestId,
    async () =>
      await host.callOwnerTurnState<PreparedTurnStateOperation>(
        turn,
        "prepare",
        {
          threadId: turn.threadId,
          attemptGeneration: turn.attemptGeneration,
          requestFingerprint: operation.requestFingerprint,
          historyCursor: operation.payload.historyCursor,
          ...(nativeOnly ? { nativeOnly: true } : { manifestId }),
          createdAt: operation.createdAt,
          ...(operation.payload.nativeCheckpoint
            ? { nativeCheckpoint: operation.payload.nativeCheckpoint }
            : {}),
        },
      ),
  );
  if (
    !prepared ||
    !/^[0-9a-f]{64}$/u.test(prepared.operationId) ||
    prepared.manifestId !== manifestId ||
    (operation.payload.nativeCheckpoint
      ? typeof prepared.objectKeys.native !== "string"
      : prepared.objectKeys.native !== undefined)
  ) {
    throw new TurnStateRegistryBookkeepingError(
      operation.payload.historyCursor,
      manifestId,
      new Error("Turn state preparation receipt was invalid."),
    );
  }
  await host.ctx.storage.transaction(async (transaction) => {
    const current =
      await transaction.get<TurnStateCheckpointOperation>(operationKey);
    if (
      !current ||
      current.state !== "pending" ||
      current.turnId !== operation.turnId ||
      current.attemptGeneration !== operation.attemptGeneration ||
      current.requestId !== operation.requestId ||
      current.requestFingerprint !== operation.requestFingerprint ||
      current.createdAt !== operation.createdAt ||
      (current.operationId !== undefined &&
        current.operationId !== prepared.operationId)
    ) {
      throw new Error("Turn state preparation operation changed.");
    }
    if (current.operationId === undefined) {
      await transaction.put(operationKey, {
        ...current,
        operationId: prepared.operationId,
      } satisfies TurnStateCheckpointOperation);
    }
  });

  await host.assertTurnWritable(turn);
  host.assertAgentTurnIdentity(turn);
  const sandbox = await host.currentSandbox();
  if (!sandbox) throw new AgentTurnAuthorityLostError();
  const archiveSessionId = sessionName(
    `turn-state-${turn.turnId}-${operation.requestId}`,
  );
  const session = await replaceTurnStateArchiveSession({
    sandbox,
    sessionId: archiveSessionId,
    commandTimeoutMs: Number(host.env.TURN_TIMEOUT_MS),
  });
  try {
    let nativeUpload:
      | Awaited<ReturnType<typeof uploadTurnStateArchive>>
      | undefined;
    if (prepared.objectKeys.native) {
      nativeUpload = await uploadTurnStateArchive({
        session,
        bucket: host.env.BACKUP_BUCKET,
        key: prepared.objectKeys.native,
        target: {
          kind: "native",
          threadHash: await nativeStateThreadHash(turn),
        },
      });
      await host.assertTurnWritable(turn);
      host.assertAgentTurnIdentity(turn);
      const archive = nativeUpload.archive;
      await registryBookkeepingAfterCheckpoint(
        operation.payload.historyCursor,
        manifestId,
        async () =>
          await host.callOwnerTurnState(turn, "mark-uploaded", {
            operationId: prepared.operationId,
            archive,
          }),
      );
    }

    await host.assertTurnWritable(turn);
    host.assertAgentTurnIdentity(turn);
    const committed = await registryBookkeepingAfterCheckpoint(
      operation.payload.historyCursor,
      manifestId,
      async () =>
        await host.callOwnerTurnState<{
          candidate: TurnStateCandidate;
          workspaceHead?: TurnStateWorkspaceHead;
          replayed: boolean;
        }>(turn, "commit", { operationId: prepared.operationId }),
    );
    const candidate = committed?.candidate;
    const workspaceHead = committed?.workspaceHead;
    if (
      !candidate ||
      candidate.schemaVersion !== 1 ||
      candidate.operationId !== prepared.operationId ||
      candidate.requestFingerprint !== operation.requestFingerprint ||
      candidate.historyCursor !== operation.payload.historyCursor ||
      candidate.createdAt !== operation.createdAt ||
      !/^[0-9a-f]{64}$/u.test(candidate.receipt) ||
      (manifestId === undefined
        ? candidate.workspace !== undefined || workspaceHead !== undefined
        : candidate.workspace?.historyCursor !==
            operation.payload.historyCursor ||
          candidate.workspace.manifestId !== manifestId ||
          workspaceHead?.historyCursor !== operation.payload.historyCursor ||
          workspaceHead.manifestId !== manifestId) ||
      JSON.stringify(candidate.native) !==
        JSON.stringify(nativeUpload?.archive) ||
      JSON.stringify(candidate.nativeCheckpoint) !==
        JSON.stringify(operation.payload.nativeCheckpoint)
    ) {
      throw new TurnStateRegistryBookkeepingError(
        operation.payload.historyCursor,
        manifestId,
        new Error("Turn state commit receipt was invalid."),
      );
    }

    const receipt = publicTurnStateCheckpointReceipt(candidate, false);
    await host.ctx.storage.transaction(async (transaction) => {
      const current =
        await transaction.get<TurnStateCheckpointOperation>(operationKey);
      if (
        !current ||
        current.state !== "pending" ||
        current.turnId !== operation.turnId ||
        current.attemptGeneration !== operation.attemptGeneration ||
        current.requestId !== operation.requestId ||
        current.requestFingerprint !== operation.requestFingerprint ||
        current.createdAt !== operation.createdAt ||
        current.operationId !== prepared.operationId ||
        JSON.stringify(current.payload) !== JSON.stringify(operation.payload)
      ) {
        throw new Error("Turn state checkpoint operation changed.");
      }
      await transaction.put(operationKey, {
        ...operation,
        state: "succeeded",
        operationId: prepared.operationId,
        receipt,
      } satisfies TurnStateCheckpointOperation);
    });
    return receipt;
  } finally {
    await sandbox.deleteSession(session.id).catch(() => undefined);
  }
};

const driveJson = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export const serveTurnDriveRequest = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES" | "DB">,
  turn: Pick<TurnRequest, "ownerId" | "ownerGeneration" | "turnId" | "kind"> &
    Partial<Pick<TurnRequest, "conversationId" | "originConversationId">>,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> => {
  const call =
    path === TURN_BROKER_DRIVE_PATHS.files
      ? {
          name: "drive.turnFiles",
          args: {
            turnId: turn.turnId,
            hydratesDrive: turn.kind === "agent",
            source: body.source,
            batchKey: body.batchKey,
            files: body.files,
          },
        }
      : path === TURN_BROKER_DRIVE_PATHS.stage
        ? { name: "drive.turnStage", args: { turnId: turn.turnId, files: body.files } }
        : path === TURN_BROKER_DRIVE_PATHS.delete
          ? { name: "drive.turnDelete", args: { turnId: turn.turnId, files: body.files } }
          : path === TURN_BROKER_DRIVE_PATHS.sync
            ? {
                name: "drive.turnSync",
                args: {
                  turnId: turn.turnId,
                  include: body.include,
                  since: body.since,
                  have: body.have,
                },
              }
            : null;
  if (!call) return brokerFailure(403);
  // A Stella Crew turn's drive is its Slack workspace's own space.
  const crew = await crewScopeForConversation(env, turn.conversationId ?? turn.originConversationId);
  const response = (await ownerGateStub(env.OWNER_GATES, turn.ownerId).ownerInternal({
    ...call,
    ownerGeneration: turn.ownerGeneration,
    ...(crew ? { crew } : {}),
  })) as RpcResponse;
  if (!response.ok) {
    return driveJson(
      { error: response.error.message },
      rpcErrorStatus(response.error.code),
    );
  }
  if (call.name === "drive.turnFiles") {
    const result = response.value as DriveTurnFilesResult;
    if (result.files.length === 0 && result.skipped.length > 0) {
      return driveJson(
        {
          error: result.skipped[0]!.reason,
          skipped: result.skipped,
          renamed: result.renamed,
          files: [],
        },
        413,
      );
    }
  }
  return driveJson({ ok: true, ...(response.value as Record<string, unknown>) });
};

export const serveTurnSearchRequest = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES">,
  turn: Pick<TurnRequest, "ownerId" | "ownerGeneration">,
  body: Record<string, unknown>,
): Promise<Response> => {
  const response = (await ownerGateStub(env.OWNER_GATES, turn.ownerId).ownerInternal({
    name: "search.web",
    args: {
      query: body.query,
      ...(body.category !== undefined && body.category !== null
        ? { category: body.category }
        : {}),
    },
    ownerGeneration: turn.ownerGeneration,
  })) as RpcResponse;
  if (!response.ok) {
    return driveJson({ error: response.error.message }, rpcErrorStatus(response.error.code));
  }
  return driveJson(response.value);
};

export const serveTurnUserAskRequest = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES">,
  turn: Pick<
    TurnRequest,
    | "ownerId"
    | "ownerGeneration"
    | "conversationId"
    | "originConversationId"
    | "threadId"
    | "description"
  >,
  body: Record<string, unknown>,
): Promise<Response> => {
  const operation = body.op;
  if (operation !== "register" && operation !== "answer" && operation !== "cancel") {
    return brokerFailure(400);
  }
  const conversationId =
    turn.conversationId ??
    turn.originConversationId ??
    (typeof body.conversationId === "string" && body.conversationId
      ? body.conversationId.slice(0, 128)
      : undefined);
  if (operation === "register" && !conversationId) {
    return brokerFailure(403);
  }
  const name =
    operation === "register"
      ? "userAsks.turnRegister"
      : operation === "answer"
        ? "userAsks.turnAnswer"
        : "userAsks.turnCancel";
  const args =
    operation === "register"
      ? {
          askId: body.askId,
          kind: body.kind,
          conversationId,
          threadId: turn.threadId,
          toolCallId: body.toolCallId,
          ...(turn.description
            ? { agentLabel: turn.description.slice(0, 96) }
            : {}),
          urgency: body.urgency,
          blocking: body.blocking,
          ...(body.timeoutMs === undefined || body.timeoutMs === null
            ? {}
            : { timeoutMs: body.timeoutMs }),
          detail: body.detail,
        }
      : { askId: body.askId };
  const response = (await ownerGateStub(env.OWNER_GATES, turn.ownerId).ownerInternal({
    name,
    args,
    ownerGeneration: turn.ownerGeneration,
  })) as RpcResponse;
  if (!response.ok) {
    return driveJson(
      { error: response.error.message, code: response.error.code },
      rpcErrorStatus(response.error.code),
    );
  }
  return driveJson(response.value);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const orchestratorEventBatchSeqKey = (turn: TurnRequest): string =>
  `orchestratorEventBatchSeq:${turn.turnId}:${turn.attemptGeneration}`;

const orchestratorUnavailable = (): Response =>
  Response.json(
    { error: "The conversation is unavailable. Try again." },
    { status: 503, headers: { "cache-control": "no-store" } },
  );

const forwardOrchestratorBrokerRequest = async (
  host: TurnBrokerHost,
  turn: TurnRequest,
  target: TurnBrokerTarget,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> => {
  if (!turn.conversationId || !turn.threadId) return brokerFailure(410);
  const identity: CloudCliTurnIdentity = {
    conversationId: turn.conversationId,
    threadId: turn.threadId,
    turnId: turn.turnId,
    attemptGeneration: turn.attemptGeneration!,
  };
  let path: string;
  let forwarded: CloudCliTurnToolForward | CloudCliTurnEventsForward;
  let batchSeq: number | undefined;
  if (target.kind === "orchestrator-tool") {
    const { toolCallId, name, args } = body;
    if (
      typeof toolCallId !== "string" ||
      !toolCallId ||
      toolCallId.length > 256 ||
      typeof name !== "string" ||
      !name ||
      name.length > 128 ||
      !isRecord(args)
    ) {
      return brokerFailure(400);
    }
    path = CLOUD_CLI_TURN_DO_PATHS.tool;
    forwarded = { ...identity, toolCallId, name, args };
  } else {
    const seq = body.batchSeq;
    if (
      typeof seq !== "number" ||
      !Number.isSafeInteger(seq) ||
      seq < 1 ||
      !Array.isArray(body.events)
    ) {
      return brokerFailure(400);
    }
    const acknowledged =
      (await host.ctx.storage.get<number>(orchestratorEventBatchSeqKey(turn))) ??
      0;
    if (seq > acknowledged + 1) return brokerFailure(409);
    batchSeq = seq;
    path = CLOUD_CLI_TURN_DO_PATHS.events;
    forwarded = {
      ...identity,
      batchSeq: seq,
      events: body.events as CloudCliTurnEventsForward["events"],
    };
  }
  let response: Response;
  try {
    response = await callOrchestratorCliTurnRoute(
      host.env,
      turn,
      path,
      forwarded,
      signal,
    );
  } catch (error) {
    if (signal.aborted) return brokerFailure(410);
    log("error", "orchestrator_cli_forward_failed", {
      turnId: turn.turnId,
      targetKind: target.kind,
      message: errorMessage(error),
    });
    return orchestratorUnavailable();
  }
  const text = await response.text().catch(() => "");
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    decoded = undefined;
  }
  if (!response.ok) {
    if (response.status >= 500 || response.status === 429) {
      return orchestratorUnavailable();
    }
    log("info", "orchestrator_cli_forward_refused", {
      turnId: turn.turnId,
      targetKind: target.kind,
      status: response.status,
    });
    return brokerFailure(410);
  }
  if (target.kind === "orchestrator-tool") {
    if (!isRecord(decoded) || typeof decoded.ok !== "boolean") {
      return orchestratorUnavailable();
    }
    return Response.json(decoded, {
      headers: { "cache-control": "no-store" },
    });
  }
  if (batchSeq !== undefined) {
    const key = orchestratorEventBatchSeqKey(turn);
    await host.ctx.storage.transaction(async (txn) => {
      if ((((await txn.get<number>(key)) ?? 0) as number) < batchSeq!) {
        await txn.put(key, batchSeq!);
      }
    });
  }
  return Response.json(isRecord(decoded) ? decoded : { ok: true }, {
    headers: { "cache-control": "no-store" },
  });
};

const serveThreadHistoryRequest = (sql: SqlStorage, body: Record<string, unknown>): Response => {
  const headers = { "cache-control": "no-store" };
  const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Record<string, unknown>) : {};
  try {
    const rows: OwnHistoryRow[] = readThreadHistory(sql, { limit: THREAD_HISTORY_QUERY_ROWS }).flatMap((row) => {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payloadJson);
      } catch {
        return [];
      }
      if (!payload || typeof payload !== "object") return [];
      const timestamp = (payload as { timestamp?: unknown }).timestamp;
      return [
        {
          seq: row.seq,
          kind: "message" as const,
          turnId: row.turnId,
          createdAtMs: typeof timestamp === "number" ? timestamp : 0,
          role: row.role,
          payload: withoutThinking(payload),
        },
      ];
    });
    return Response.json({ ok: true, result: answerOwnHistory(rows, args) }, { headers });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { headers });
  }
};

const handleBrokerLocalRequest = async (
  host: TurnBrokerHost,
  turn: TurnRequest,
  target: TurnBrokerTarget,
  decoded: unknown,
  signal: AbortSignal,
): Promise<Response> => {
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return brokerFailure(400);
  }
  const body = decoded as Record<string, unknown>;
  try {
    if (target.kind === "search") {
      return await serveTurnSearchRequest(host.env, turn, body);
    }
    if (
      target.kind === "orchestrator-tool" ||
      target.kind === "orchestrator-events"
    ) {
      return await forwardOrchestratorBrokerRequest(
        host,
        turn,
        target,
        body,
        signal,
      );
    }
    if (typeof body.turnId !== "string" || body.turnId !== turn.turnId) {
      return brokerFailure(403);
    }
    if (target.kind === "user-ask") {
      return await serveTurnUserAskRequest(host.env, turn, body);
    }
    if (target.kind === "agent-move") {
      return await serveAgentMoveRequest(host.ctx.storage, host.env, turn, body);
    }
    if (target.kind === "code-connect") {
      return await serveAgentCodeConnectRequest(host.env, turn, body);
    }
    if (target.kind === "cloud-browser") {
      return await serveAgentBrowserRequest(
        host.env,
        host.ctx.storage,
        turn,
        body,
        signal,
      );
    }
    if (target.kind === "thread-history") {
      return serveThreadHistoryRequest(host.ctx.storage.sql, body);
    }
    if (target.kind === "drive") {
      return await serveTurnDriveRequest(host.env, turn, target.path, body);
    }
    if (target.kind === "turn-event") {
      if (
        body.attemptGeneration !== undefined &&
        body.attemptGeneration !== turn.attemptGeneration
      ) {
        return brokerFailure(403);
      }
      if (typeof body.kind !== "string" || !body.kind.trim()) {
        return brokerFailure(400);
      }
      const seq = body.seq;
      if (
        seq !== "auto" &&
        (!Number.isSafeInteger(seq) || (seq as number) < 1)
      ) {
        return brokerFailure(400);
      }
      if (body.terminal === true) return brokerFailure(403);
      await host.emitTurnEvent(turn, body.kind, body.payload, {
        ...(seq === "auto" ? {} : { eventSeq: seq as number }),
        signal,
      });
      return Response.json(
        { ok: true },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (
      typeof body.conversationId !== "string" ||
      body.conversationId !== turn.threadId ||
      !Array.isArray(body.messages)
    ) {
      return brokerFailure(400);
    }
    await host.assertTurnWritable(turn);
    signal.throwIfAborted();
    await host.appendThreadTranscript(
      turn,
      body.messages as ThreadMessageInput[],
    );
    return Response.json(
      { ok: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ThreadTranscriptError) {
      return brokerFailure(400);
    }
    if (
      error instanceof OwnerPurgeFenceError ||
      error instanceof AgentTurnAuthorityLostError
    ) {
      return brokerFailure(410);
    }
    log("error", "turn_broker_local_failed", {
      turnId: turn.turnId,
      targetKind: target.kind,
      message: errorMessage(error),
    });
    return brokerFailure(signal.aborted ? 410 : 502);
  }
};

export const handleTurnBroker = async (
  host: TurnBrokerHost,
  request: Request,
): Promise<Response> => {
  const turn = await host.ctx.storage.get<TurnRequest>("turn");
  if (
    !turn ||
    turn.kind !== "agent" ||
    !turn.threadId ||
    !turn.turnBrokerRoute ||
    !Number.isSafeInteger(turn.attemptGeneration)
  ) {
    return brokerFailure(401);
  }
  const recordKey = turnBrokerStorageKey({
    turnId: turn.turnId,
    attemptGeneration: turn.attemptGeneration!,
  });
  const initialRecord = await host.ctx.storage.get<TurnBrokerRecord>(recordKey);
  if (!initialRecord) return brokerFailure(401);

  const preflight = await preflightTurnBrokerRequest({
    record: initialRecord,
    headers: request.headers,
    now: Date.now(),
  });
  if (!preflight.ok) return turnBrokerDenialResponse(preflight);
  if (request.method !== preflight.target.method) {
    return brokerFailure(403);
  }
  const brokerEngine = turn.execution?.engine;
  if (
    (brokerEngine !== "stella" &&
      brokerEngine !== "anthropic" &&
      brokerEngine !== "chatgpt") ||
    !turnBrokerTargetMatchesEngine(preflight.target, brokerEngine)
  ) {
    return brokerFailure(403);
  }
  if (
    (preflight.target.kind === "orchestrator-tool" ||
      preflight.target.kind === "orchestrator-events") &&
    turn.agentRole !== "orchestrator"
  ) {
    return brokerFailure(403);
  }

  let body: Uint8Array;
  try {
    body = await readTurnBrokerRequestBody(
      request,
      preflight.target.maxBodyBytes,
    );
  } catch (error) {
    if (error instanceof TurnBrokerBodyTooLargeError) {
      return brokerFailure(413);
    }
    return brokerFailure(400);
  }
  const requestFingerprint = await sha256BytesHex(body);

  try {
    await host.assertTurnWritable(turn);
    host.assertAgentTurnIdentity(turn);
  } catch {
    return brokerFailure(410);
  }

  const operationKey = turnStateCheckpointOperationKey(preflight.requestId);
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body),
    ) as unknown;
  } catch {
    decoded = undefined;
  }
  const payload = parseTurnStateCheckpointRequest(decoded);

  const admission = await host.ctx.blockConcurrencyWhile(async () => {
    const [current, storedRecord, terminal, cancellation, sandboxId] =
      await Promise.all([
        host.ctx.storage.get<TurnRequest>("turn"),
        host.ctx.storage.get<TurnBrokerRecord>(recordKey),
        host.ctx.storage.get<boolean>("terminal"),
        host.exactTurnCancellations.matching({
          turnId: turn.turnId,
          ownerId: turn.ownerId,
          ownerGeneration: turn.ownerGeneration,
          attemptGeneration: turn.attemptGeneration,
        }),
        host.ctx.storage.get<string>("sandboxId"),
      ]);
    if (!storedRecord) return { kind: "missing" as const };
    const running = host.agentTurnExecutions.get(turn.turnId);
    const live: TurnBrokerLiveFence = {
      sessionId: turn.turnBrokerRoute!.sessionId,
      ownerId: turn.ownerId,
      ownerGeneration: turn.ownerGeneration,
      turnId: turn.turnId,
      attemptGeneration: turn.attemptGeneration!,
      active:
        exactTurnIdentityMatches(current, turn) &&
        Boolean(sandboxId) &&
        running?.cancellation.aborted === false,
      canceled: Boolean(cancellation),
      terminal: terminal === true,
    };
    const claimed = await claimTurnBrokerRequest({
      record: storedRecord,
      live,
      headers: request.headers,
      now: Date.now(),
      bodyBytes: body.byteLength,
      bodySha256: requestFingerprint,
    });
    if (!claimed.ok) return { kind: "denied" as const, claimed };
    if (claimed.disposition === "replay") {
      return {
        kind: "replay" as const,
        operation:
          await host.ctx.storage.get<TurnStateCheckpointOperation>(
            operationKey,
          ),
      };
    }
    if (
      claimed.target.kind === "turn-event" ||
      claimed.target.kind === "thread-messages" ||
      claimed.target.kind === "thread-history" ||
      claimed.target.kind === "drive" ||
      claimed.target.kind === "search" ||
      claimed.target.kind === "user-ask" ||
      claimed.target.kind === "agent-move" ||
      claimed.target.kind === "code-connect" ||
      claimed.target.kind === "cloud-browser" ||
      claimed.target.kind === "orchestrator-tool" ||
      claimed.target.kind === "orchestrator-events"
    ) {
      await host.ctx.storage.put(recordKey, claimed.record);
      return {
        kind: "local" as const,
        target: claimed.target,
        signal: running!.signal,
      };
    }
    if (claimed.target.kind !== "builder-callback") {
      await host.ctx.storage.put(recordKey, claimed.record);
      return { kind: "unsupported" as const };
    }
    const operation: Extract<
      TurnStateCheckpointOperation,
      { state: "pending" }
    > = {
      state: "pending",
      turnId: turn.turnId,
      attemptGeneration: turn.attemptGeneration!,
      requestId: preflight.requestId,
      requestFingerprint,
      createdAt: Date.now(),
      ...(payload ? { payload } : {}),
    };
    await host.ctx.storage.put({
      [recordKey]: claimed.record,
      [operationKey]: operation,
    });
    return { kind: "checkpoint" as const, operation };
  });

  if (admission.kind === "missing") return brokerFailure(401);
  if (admission.kind === "denied") {
    return turnBrokerDenialResponse(admission.claimed);
  }
  if (admission.kind === "local") {
    return await handleBrokerLocalRequest(
      host,
      turn,
      admission.target,
      decoded,
      admission.signal,
    );
  }
  if (admission.kind === "unsupported") return brokerFailure(403);
  let pendingOperation: Extract<
    TurnStateCheckpointOperation,
    { state: "pending" }
  >;
  if (admission.kind === "replay") {
    const operation = admission.operation;
    if (operation?.state === "succeeded") {
      return Response.json(operation.receipt, {
        headers: { "cache-control": "no-store" },
      });
    }
    if (operation?.state === "failed") {
      return brokerFailure(operation.status);
    }
    if (!operation || operation.state !== "pending") {
      return brokerFailure(409);
    }
    pendingOperation = operation;
  } else {
    pendingOperation = admission.operation;
  }
  const failOperation = async (status: number): Promise<Response> => {
    await host.ctx.storage.transaction(async (transaction) => {
      const current =
        await transaction.get<TurnStateCheckpointOperation>(operationKey);
      if (
        current?.state === "pending" &&
        current.turnId === pendingOperation.turnId &&
        current.attemptGeneration === pendingOperation.attemptGeneration &&
        current.requestId === pendingOperation.requestId &&
        current.requestFingerprint === pendingOperation.requestFingerprint &&
        current.createdAt === pendingOperation.createdAt
      ) {
        await transaction.put(operationKey, {
          ...current,
          state: "failed",
          status,
        } satisfies TurnStateCheckpointOperation);
      }
    });
    return brokerFailure(status);
  };

  if (!payload) return await failOperation(400);
  if (
    (turn.execution?.engine === "anthropic") !==
    Boolean(payload.nativeCheckpoint)
  ) {
    return await failOperation(403);
  }
  if (payload.nativeCheckpoint) {
    const integrityKey = await nativeStateIntegrityKeysFor(host.env, turn);
    if (
      !(await validNativeStateCheckpointMac({
        checkpoint: payload.nativeCheckpoint,
        threadId: turn.threadId,
        integrityKey,
      }))
    ) {
      return await failOperation(403);
    }
  }

  const exactOperation = {
    ...pendingOperation,
    payload,
  } satisfies Extract<TurnStateCheckpointOperation, { state: "pending" }> & {
    payload: TurnBrokerTurnStateCheckpointRequest;
  };
  if (!pendingOperation.payload) {
    await host.ctx.storage.put(operationKey, exactOperation);
  } else if (
    JSON.stringify(pendingOperation.payload) !== JSON.stringify(payload)
  ) {
    return await failOperation(409);
  }

  let run = host.turnStateCheckpointRuns.get(operationKey);
  if (!run) {
    run = host.executeTurnStateCheckpoint({
      turn,
      operationKey,
      operation: exactOperation,
    });
    host.turnStateCheckpointRuns.set(operationKey, run);
    void run
      .finally(() => {
        if (host.turnStateCheckpointRuns.get(operationKey) === run) {
          host.turnStateCheckpointRuns.delete(operationKey);
        }
      })
      .catch(() => undefined);
  }
  try {
    const receipt = await run;
    return Response.json(receipt, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof TurnStateOwnerCallError && error.status < 500
        ? error.status
        : error instanceof AgentTurnAuthorityLostError ||
            error instanceof OwnerPurgeFenceError
          ? 410
          : undefined;
    if (status) return await failOperation(status);
    log("error", "turn_state_checkpoint_deferred", {
      turnId: turn.turnId,
      requestId: preflight.requestId,
      message: errorMessage(error),
    });
    return brokerCheckpointPending();
  }
};
