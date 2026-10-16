import {
  applyUsageLimitCard,
  dropStaleUsageLimitPauses,
  emptyUsageLimitPauses,
  summarizeUsageLimitPauses,
  USAGE_LIMIT_PAUSE_STALE_MS,
  USAGE_LIMIT_RESUMED_TITLE,
  type ClaudeUsageLimitCard,
  type UsageLimitPauses,
} from "@stella/contracts/claude-usage-limit";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message, ModelThinkingLevel, TextContent } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  ConversationBusy,
  type ContextEdit,
  defineDoc,
  LiveDoc,
  watchEvents,
  type AgentEventStream,
  type Conversation,
  type ConversationId,
  type Cursor,
  type EntryId,
  type EntryRecord,
  type Harness,
  type ModelRef,
  type Submission,
  type UserInput,
} from "@earendil-works/pi-durable";
import {
  formatAgentMessage,
  type AgentDirectoryAgentRow,
  type AgentDirectorySessionRow,
  type AgentMessageSender,
} from "@stella/contracts/agent-directory";
import type { AgentAttemptOutcome } from "@stella/contracts/agent-status";
import { PLACED_AGENT_STOPPED } from "../stella/agents.ts";
import type { AgentMessageDelivery, AgentStopResult } from "@stella/contracts/backend/agent-threads";
import { agentReportReceipt, parseAgentReportId } from "@stella/contracts/backend/agent-reports";
import type { ExecutionContextSnapshot, ExecutionDestination } from "@stella/contracts/execution-context";
import { extractLocalFileLinkPaths } from "@stella/contracts/local-file-links";
import { splitMessageReplyRefs } from "@stella/contracts/reply-refs";
import {
  isPiAgentInput,
  isPiAgentText,
  mergePiEntries,
  piEntriesForClients,
  piMessageText,
  piEventsForClients,
  piUserView,
  type PiChatEvent,
  type PiChatEventsPayload,
  type PiChatAgentsResult,
  type PiChatBrainResult,
  type PiChatMoveTarget,
  type PiChatOlderResult,
  type PiChatRequest,
  type PiChatWatchResult,
  type PiEntry,
  type PiPartMarks,
  type PiUserMessage,
} from "@stella/contracts/pi-chat";
import type { AgentReportEnvelope } from "@stella/contracts/agent-wake-prompt";
import type { DeviceSigner } from "@stella/runtime/kernel/home/device";
import {
  offersAgentTools,
  openStellaHarness,
  type OpenStellaHarness,
  orchestratorAgent,
  STELLA_DEFAULT_ALIAS,
  stellaModelRef,
} from "../harness.ts";
import { fitForHandover } from "../stella/handover.ts";
import { recordEngineCompaction } from "../stella/journal-sync.ts";
import {
  agentRunOutcome,
  isAnotherHostsAgent,
  noteRemoteReport,
  remoteAgentHome,
  StellaAgentsDoc,
  type AgentDirectoryHost,
  type AgentModelChoice,
  type RemoteAgentHost,
  type RunsOn,
} from "../stella/agents.ts";
import type { StellaToolHost } from "../stella/host-tools.ts";
import {
  parseStellaModelId,
  STELLA_PROVIDER_ID,
  stellaProvider,
  type StellaGatewayAccess,
  type StellaModelSpec,
} from "../provider/stella.ts";
import {
  byokModels,
  parseModelPick,
  stellaCredentialStore,
  storeOnlyAuthContext,
  type DirectModelResolver,
  type ModelPick,
  type StellaCredentialAccess,
} from "../provider/byok.ts";
import { CHATGPT_PROVIDER_ID } from "../provider/chatgpt.ts";
import {
  accountByokProvider,
  accountProviderModel,
  accountProviderOfRegistryId,
  accountRegistryId,
  isAccountProviderId,
} from "../provider/account-byok.ts";
import { openBunSqliteStorage } from "../storage/bun-sqlite.ts";
import type { StellaPlacement } from "../stella/placement.ts";
import { desktopAgentsHost, desktopEnvironments } from "./desktop-agents.ts";
import { desktopExecution, type DesktopBrain, type DesktopDevices, type DesktopExecution } from "./desktop-execution.ts";
import type { PiBrainRecord } from "@stella/contracts/turn-plane/pi-brain";
import { journalMirror, journalTurnGate, type DesktopJournal, type JournalMirror } from "./desktop-journal.ts";
import { localLogMirror, writtenReply, type DesktopLocalLog, type LocalLogMirror } from "./desktop-local-log.ts";
import { desktopGatewayAccess, resolveStellaModels } from "./desktop-gateway.ts";
import { desktopContextSources } from "./desktop-sources.ts";
import { afterStop, stopStella } from "../stella/stop.ts";
import { ownHistoryQuery } from "../stella/own-history.ts";
import { ownHistorySql } from "@stella/runtime/kernel/storage/own-history-sql";
import type { ClaudeCodeEngine, ClaudeCodeStatus } from "../engine/claude-code.ts";
import { CLAUDE_CODE_PROVIDER_ID, onClaudeCode } from "../engine/selection.ts";
import { agentLogDeviceHolder, type AgentLogCalls } from "@stella/contracts/backend/agent-logs";
import type { AgentThreadCalls } from "@stella/contracts/backend/agent-threads";
import { agentLogSync, importAgentLog, type AgentLogTransport } from "../stella/agent-log-sync.ts";
import { agentMoveModel } from "../stella/agent-move-model.ts";
import { movedAgentBrief, type AgentMove } from "../stella/execution.ts";
import { fetchWithDeadline, REQUEST_BUDGET_MS, withDeadline } from "@stella/contracts/request-deadline";

const HISTORY_PAGE = 200;
const CLIENT_PAGE_BYTES = 2 * 1024 * 1024;
const VOICE_HISTORY_ENTRIES = 200;
const LINKED_FILE_ENTRIES = 500;
/** How long a turn waits for other devices' turns to be imported before it starts. */
const JOURNAL_CATCH_UP_MS = 3_000;
const IDLE_CHECK_MS = 30_000;
const FOLLOW_MS = 2_000;
const BRAIN_TTL_MS = 5_000;
const BRAIN_WATCH_MS = 10_000;
const BRAIN_HANDOFF_WAIT_MS = 5 * 60_000;
const EXECUTION_CONTEXT_TTL_MS = 1_000;
const PROVIDER_RETRY_MS = 5_000;
const DIRECTORY_TIMEOUT_MS = 5_000;
const AGENT_MESSAGE_TIMEOUT_MS = 15_000;
const AGENT_REPORT_REQUEST_PREFIX = "agent-report:";
const PROMPT_SCAN_PAGE = 200;

export type DesktopChatsOptions = {
  dataDir: string;
  deviceId?: string;
  workspace: string;
  siteAuth(): { baseUrl: string; authToken: string } | null;
  refreshAuthToken?(): Promise<string | null | undefined>;
  getDeviceSigner(): Promise<DeviceSigner> | DeviceSigner;
  memoryEnabled?(): boolean;
  executionContext?(): Promise<ExecutionContextSnapshot | undefined>;
  stellaModel?(): string | undefined;
  credentials?: StellaCredentialAccess;
  resolveDirectModel?: DirectModelResolver;
  thinkingLevel?(): ModelThinkingLevel;
  shellEnv?(target: { conversationId: string; cwd: string }): Record<string, string> | undefined;
  tools?(conversationId: string): StellaToolHost;
  journal?(conversationId: string): DesktopJournal | undefined;
  claudeCodeEngine?: ClaudeCodeEngine;
  claudeCodeProblem?(): Promise<string | undefined>;
  userReminders?(input: {
    conversationId: string;
    text: string;
    sentAt: number;
    previousUserAt?: number;
    timezone?: string;
  }): Promise<string[]>;
  cloudThreads?(conversationId: string): DesktopEngineAgents | undefined;
  deviceAgents?(conversationId: string): DesktopDeviceAgents | undefined;
  devices?(conversationId: string): DesktopDevices | undefined;
  agentLogs?: {
    append(args: AgentLogCalls["agentLogs.append"]["args"]): Promise<AgentLogCalls["agentLogs.append"]["result"]>;
    read(args: AgentLogCalls["agentLogs.read"]["args"]): Promise<AgentLogCalls["agentLogs.read"]["result"]>;
  };
  agentHandoff?(
    args: Omit<AgentThreadCalls["agentThreads.handoff"]["args"], "ownerGeneration" | "fromDeviceId">,
  ): Promise<{ where: string }>;
  flushClaudeSessions?(): Promise<void>;
  brain?(conversationId: string): DesktopBrain | undefined;
  localSessions?(): Array<{ conversationId: string; title: string; updatedAt: number }>;
  agentThreads?: {
    directory(
      conversationId: string,
      threadIds?: string[],
    ): Promise<{ agents: AgentDirectoryAgentRow[]; sessions: AgentDirectorySessionRow[] }>;
    message(args: { messageId: string; to: string; text: string; from: AgentMessageSender }): Promise<AgentMessageDelivery>;
    stop(args: { conversationId: string; threadId: string; controlRequestId: string; requesterThreadId?: string }): Promise<AgentStopResult>;
    note(args: { noteId: string; conversationId: string; fromThreadId: string; text: string }): Promise<void>;
  };
  agentStarted?(agent: {
    conversationId: string;
    threadId: string;
    description: string;
    attempt: number;
    parentThreadId?: string;
  }): void;
  agentRunEnded?(agent: { conversationId: string; threadId: string; interrupted: boolean }): void;
  subagentEnded?(agent: {
    conversationId: string;
    threadId: string;
    parentThreadId: string;
    attempt: number;
    outcome: AgentAttemptOutcome;
    text?: string;
  }): void;
  agentReported?(agent: {
    conversationId: string;
    threadId: string;
    description: string;
    status: AgentAttemptOutcome;
    failed: boolean;
    report: string;
    attempt: number;
    running: boolean;
  }): void;
  agentReportRelayed?(agent: { conversationId: string; description: string }): void;
  agentStopped?(agent: { conversationId: string; threadId: string; description: string; attempt: number }): void;
  localLog?(conversationId: string): DesktopLocalLog | undefined;
  /** Records this computer's usage-limit pauses in the cloud and resumes a chat's paused work. */
  usageLimits?: {
    note(args: {
      conversationId: string;
      holdId: string;
      state: "held" | "resumed";
      threadId?: string;
      until?: number;
      monthly?: boolean;
    }): Promise<void>;
    resume(args: { conversationId: string; requestId: string }): Promise<{ cloud: number }>;
  };
  emit(payload: PiChatEventsPayload): void;
  report(error: unknown): void;
};

export type DesktopDeviceAgents = {
  start(args: { key: string; deviceId: string; description: string; prompt: string; model?: string; parentThreadId?: string }): Promise<{
    threadId: string;
    waitingForDevice: boolean;
  }>;
  message(args: { key: string; threadId: string; description: string; message: string; framed?: boolean }): Promise<"steered" | "resumed">;
  stop(threadId: string): Promise<AgentStopResult | void>;
};

export type DesktopEngineAgents = {
  start(args: {
    key: string;
    description: string;
    prompt: string;
    model: string;
    parentThreadId?: string;
    workspace?: import("@stella/contracts/turn-plane/turn-start").AgentWorkspaceSize;
  }): Promise<{ threadId: string }>;
  message(args: { key: string; threadId: string; description: string; message: string; framed?: boolean }): Promise<"steered" | "resumed">;
  stop(threadId: string): Promise<AgentStopResult | void>;
};

type DeliveredReport = { requestId: string; text: string; agentReport?: AgentReportEnvelope };

type Chat = {
  harness: Harness;
  root: Conversation;
  refreshTools(): void;
  startAgent: OpenStellaHarness["startAgent"];
  agentRecords: OpenStellaHarness["agentRecords"];
  messageAgent: OpenStellaHarness["messageAgent"];
  stopAgent: OpenStellaHarness["stopAgent"];
  agentStanding: OpenStellaHarness["agentStanding"];
  runPlacedAgent: OpenStellaHarness["runPlacedAgent"];
  steerPlacedAgent: OpenStellaHarness["steerPlacedAgent"];
  mirror?: JournalMirror;
  journalAdvanced?(): void;
  localLog?: LocalLogMirror;
  execution: DesktopExecution;
  stream?: AgentEventStream;
  watchers: number;
  idleCheck: ReturnType<typeof setInterval>;
  followCheck: ReturnType<typeof setInterval>;
  reminderContext?: ReminderContext;
};

type ReminderContext = {
  tail: EntryId;
  previousUserAt?: number;
  shown: Set<string>;
};

const context = BACKGROUND_CONTEXT;

const CLOUD_THREAD_ENGINE = "cloud-thread";

const LocaleDoc = defineDoc<{ locale?: string }>({
  kind: "stella.locale",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({}),
});

const fileName = (conversationId: string): string => {
  const safe = conversationId.replace(/[^A-Za-z0-9_.-]/g, "_");
  if (!safe || safe.startsWith(".")) throw new Error(`Invalid conversation id: ${conversationId}`);
  return `${safe}.sqlite`;
};

const git = (cwd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 10_000, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });

const workLeftBehind = async (cwd: string): Promise<string | undefined> => {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => "");
  if (inside.trim() !== "true") return undefined;
  const changed = (await git(cwd, ["status", "--porcelain"]).catch(() => "")).split("\n").filter((line) => line.trim()).length;
  const branch = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim();
  const upstream = await git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => "");
  const ahead = upstream.trim()
    ? Number((await git(cwd, ["rev-list", "--count", "@{u}..HEAD"]).catch(() => "0")).trim()) || 0
    : 0;
  const remotes = upstream.trim() ? "" : (await git(cwd, ["remote"]).catch(() => "")).trim();
  const unpushed =
    remotes && !(await git(cwd, ["branch", "-r", "--contains", "HEAD"]).catch(() => "")).trim();
  const parts = [
    ...(changed > 0 ? [`${changed} uncommitted change${changed === 1 ? "" : "s"}`] : []),
    ...(ahead > 0 ? [`${ahead} commit${ahead === 1 ? "" : "s"} on ${branch} not pushed`] : []),
    ...(unpushed ? [`commits on ${branch || "HEAD"} that no remote has`] : []),
  ];
  return parts.length > 0 ? `${cwd} has ${parts.join(" and ")}.` : undefined;
};

export function desktopChats(options: DesktopChatsOptions) {
  const chats = new Map<string, Promise<Chat>>();
  let executionContextRead: { snapshot?: ExecutionContextSnapshot; at: number; pending?: Promise<void> } = { at: 0 };
  const sharedExecutionContext = async (): Promise<ExecutionContextSnapshot | undefined> => {
    const loadOnce = () =>
      (executionContextRead.pending ??= (async () => {
        const read = options.executionContext;
        const snapshot = read
          ? await withDeadline(
              { label: "Reading your devices", timeoutMs: REQUEST_BUDGET_MS.lookup },
              async () => await read(),
            ).catch(() => undefined)
          : undefined;
        executionContextRead = {
          snapshot: snapshot?.devicesKnown || !executionContextRead.snapshot ? snapshot : executionContextRead.snapshot,
          at: Date.now(),
        };
      })());
    if (executionContextRead.at === 0 || Date.now() - executionContextRead.at >= EXECUTION_CONTEXT_TTL_MS) await loadOnce();
    return executionContextRead.snapshot;
  };
  const placedIn = new Map<string, string>();
  const placedRuns = new Map<string, { runKey: string; cancel: AbortController }>();
  const directory = path.join(options.dataDir, "agent");

  const activeFile = path.join(directory, "active.json");
  let active: Promise<Set<string>> | undefined;
  let activeNow: ReadonlySet<string> = new Set();
  let saving = Promise.resolve();
  const activeSet = () =>
    (active ??= readFile(activeFile, "utf8")
      .then(
        (text) => new Set((JSON.parse(text) as unknown[]).filter((id): id is string => typeof id === "string")),
        () => new Set<string>(),
      )
      .then((ids) => (activeNow = ids)));
  const markActive = async (conversationId: string, busy: boolean) => {
    const ids = await activeSet();
    if (ids.has(conversationId) === busy) return;
    if (busy) ids.add(conversationId);
    else ids.delete(conversationId);
    const text = JSON.stringify([...ids]);
    saving = saving.then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(`${activeFile}.tmp`, text);
      await rename(`${activeFile}.tmp`, activeFile);
    }).catch((error: unknown) => options.report(error));
    await saving;
  };
  const threadsFile = path.join(directory, "threads.json");
  let threads: Promise<Record<string, string>> | undefined;
  const threadIndex = () =>
    (threads ??= readFile(threadsFile, "utf8").then(
      (text) => JSON.parse(text) as Record<string, string>,
      (): Record<string, string> => ({}),
    ));
  const noteAgentThread = async (threadId: string, conversationId: string) => {
    const index = await threadIndex();
    if (index[threadId] === conversationId) return;
    index[threadId] = conversationId;
    const text = JSON.stringify(index);
    saving = saving.then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(`${threadsFile}.tmp`, text);
      await rename(`${threadsFile}.tmp`, threadsFile);
    }).catch((error: unknown) => options.report(error));
    await saving;
  };
  const environments = desktopEnvironments(options.workspace, options.shellEnv);
  const brains = new Map<
    string,
    { record: PiBrainRecord | null; host: PiBrainRecord | null; at: number; failed?: true }
  >();
  const otherHost = (record: PiBrainRecord | null) =>
    record && !(record.host === "device" && record.deviceId === options.deviceId) ? record : null;
  const placementOfHost = (host: PiBrainRecord | null): PiChatBrainResult =>
    !host
      ? { here: true }
      : host.host === "cloud"
        ? { here: false, target: { mode: "cloud" } }
        : { here: false, target: { mode: "device", deviceId: host.deviceId }, ...(host.label ? { label: host.label } : {}) };
  const rememberBrain = (
    conversationId: string,
    entry: { record: PiBrainRecord | null; host: PiBrainRecord | null; failed?: true },
    readAt = Date.now(),
  ) => {
    const before = brains.get(conversationId);
    brains.set(conversationId, { ...entry, at: readAt });
    const brain = placementOfHost(entry.host);
    if (before && JSON.stringify(placementOfHost(before.host)) === JSON.stringify(brain)) return;
    options.emit({ conversationId, events: [{ type: "brain", brain }] });
  };
  const brainHost = async (conversationId: string): Promise<PiBrainRecord | null> => {
    const known = brains.get(conversationId);
    if (known && Date.now() - known.at < BRAIN_TTL_MS) return known.host;
    const brain = options.brain?.(conversationId);
    if (!brain) return null;
    let record: PiBrainRecord | null;
    try {
      record = await brain.read();
    } catch {
      rememberBrain(conversationId, { record: known?.record ?? null, host: null, failed: true });
      return null;
    }
    const host = await hostOfRecord(conversationId, record);
    rememberBrain(conversationId, { record, host });
    return host;
  };
  const hostOfRecord = async (conversationId: string, record: PiBrainRecord | null): Promise<PiBrainRecord | null> => {
    let host = otherHost(record);
    const listed =
      host?.host === "device" || options.deviceId
        ? await options.devices?.(conversationId)?.devices().catch(() => undefined)
        : undefined;
    const home = listed?.find((entry) => entry.brainHome && entry.online && entry.availability?.ready === true);
    if (home && home.deviceId === options.deviceId) {
      host = null;
    } else if (home && !(host?.host === "device" && host.deviceId === home.deviceId)) {
      host = {
        host: "device",
        deviceId: home.deviceId,
        ...(home.label ? { label: home.label } : {}),
        epoch: record?.epoch ?? 0,
        updatedAt: record?.updatedAt ?? 0,
      };
    } else if (host?.host === "device") {
      const { deviceId } = host;
      const device = listed?.find((entry) => entry.deviceId === deviceId);
      if (listed && !device?.online) host = null;
      else if (!host.label && device?.label) host = { ...host, label: device.label };
    }
    return host;
  };
  const expireBrain = (conversationId: string) => {
    const known = brains.get(conversationId);
    if (known) brains.set(conversationId, { ...known, at: 0 });
  };
  const recheckBrainHost = async (conversationId: string): Promise<PiBrainRecord | null> => {
    const known = brains.get(conversationId);
    if (!known || known.failed) {
      expireBrain(conversationId);
      return await brainHost(conversationId);
    }
    const host = await hostOfRecord(conversationId, known.record);
    rememberBrain(conversationId, { record: known.record, host }, known.at);
    return host;
  };
  const brainPlacement = async (conversationId: string): Promise<PiChatBrainResult> =>
    placementOfHost(await brainHost(conversationId));
  const noteOnBrain = async (
    conversationId: string,
    requestId: string,
    text: string,
    fromThreadId: string = conversationId,
  ): Promise<boolean> => {
    const host = await brainHost(conversationId);
    if (!host) return false;
    const id = createHash("sha256").update(`${options.deviceId ?? ""}\0${conversationId}\0${requestId}`).digest("hex").slice(0, 48);
    if (host.host === "device" && options.agentThreads) {
      await options.agentThreads.note({ noteId: `note:${id}`, conversationId, fromThreadId, text });
    } else {
      const brain = options.brain?.(conversationId);
      if (!brain) return false;
      if (!(await brain.note(host, { id: `pi-note:${id}`, text }))) return false;
    }
    return true;
  };
  const moveBrain = async (conversationId: string, target: PiChatMoveTarget): Promise<PiChatBrainResult> => {
    const chat = await open(conversationId);
    const placement: StellaPlacement =
      target.mode === "cloud"
        ? { kind: "cloud" }
        : target.mode === "device"
          ? { kind: "device", deviceId: target.deviceId }
          : { kind: "local" };
    const moved = await chat.execution.pinBrain(placement, context);
    if ("error" in moved) throw new Error(moved.error);
    return await brainPlacement(conversationId);
  };
  const elsewhere = (placement: Extract<PiChatBrainResult, { here: false }>) =>
    `Stella for this chat runs ${placement.target.mode === "cloud" ? "in the cloud" : `on ${placement.label ?? placement.target.deviceId}`} now, so this computer does not answer it.`;
  const models = createModels(
    options.credentials
      ? { credentials: stellaCredentialStore(options.credentials), authContext: storeOnlyAuthContext }
      : {},
  );
  const byok = byokModels(models, options.resolveDirectModel);
  // What a usage limit has paused in each chat: this computer's own held
  // Claude Code steps plus the pauses the chat's journal records elsewhere
  // (the cloud, other computers). One card per chat shows them; Resume
  // continues all of them.
  const usageLimitPauses = new Map<string, UsageLimitPauses>();
  const pausesOf = (conversationId: string) => {
    let pauses = usageLimitPauses.get(conversationId);
    if (!pauses) usageLimitPauses.set(conversationId, (pauses = emptyUsageLimitPauses()));
    return pauses;
  };
  const usageLimitEvent = (conversationId: string): PiChatEvent | undefined => {
    const pauses = usageLimitPauses.get(conversationId);
    if (!pauses) return undefined;
    dropStaleUsageLimitPauses(pauses);
    const paused = summarizeUsageLimitPauses(pauses);
    if (!paused) return undefined;
    return {
      type: "engine_status",
      state: "usage-limit",
      text: "Paused by the Claude usage limit.",
      ...(paused.until !== undefined ? { until: paused.until } : {}),
      paused,
    };
  };
  const emitUsageLimit = (conversationId: string, ended?: { text: string; resumed: boolean }) => {
    const event: PiChatEvent | undefined =
      usageLimitEvent(conversationId) ??
      (ended ? { type: "engine_status", state: "usage-limit-end", text: ended.text, resumed: ended.resumed } : undefined);
    if (event) options.emit({ conversationId, events: [event] });
  };
  const holdSerial = new Map<string, number>();
  const startedAt = Date.now();
  const ownResumes = new Set<string>();
  const recordUsageLimit = (
    conversationId: string,
    note: { key: string; state: "held" | "resumed"; until?: number; monthly?: true },
  ) => {
    if (conversationId.startsWith("local_") || !options.usageLimits) return;
    const serialKey = `${conversationId}\0${note.key}`;
    const serial = note.state === "held" ? (holdSerial.get(serialKey) ?? 0) + 1 : (holdSerial.get(serialKey) ?? 0);
    holdSerial.set(serialKey, serial);
    const holdId = createHash("sha256")
      .update(`${conversationId}\0${note.key}\0${serial}\0${process.pid}\0${startedAt}`)
      .digest("hex")
      .slice(0, 40);
    void options.usageLimits
      .note({
        conversationId,
        holdId,
        state: note.state,
        ...(note.key ? { threadId: note.key } : {}),
        ...(note.until !== undefined ? { until: note.until } : {}),
        ...(note.monthly ? { monthly: true } : {}),
      })
      .catch((error: unknown) => options.report(error));
  };
  // Subagents pause and resume with the rest, but the card counts only the
  // reply and Stella's own tasks.
  const subagentThreads = new Set<string>();
  const heldThreads = new Set<string>();
  const noteUsageLimit = (
    conversationId: string,
    threadId: string | undefined,
    status: Extract<ClaudeCodeStatus, { state: "usage-limit" | "usage-limit-end" }>,
  ) => {
    if (threadId) {
      if (status.state === "usage-limit") heldThreads.add(threadId);
      else heldThreads.delete(threadId);
      if (subagentThreads.has(threadId)) return;
    }
    const pauses = pausesOf(conversationId);
    const key = threadId ?? "";
    if (status.state === "usage-limit") {
      applyUsageLimitCard(
        pauses,
        {
          type: "usage-limit",
          state: "held",
          ...(threadId ? { threadId } : {}),
          ...(status.until !== undefined ? { until: status.until } : {}),
          ...(status.monthly ? { monthly: true as const } : {}),
          ...(options.deviceId ? { deviceId: options.deviceId } : {}),
        },
        Date.now(),
      );
      recordUsageLimit(conversationId, {
        key,
        state: "held",
        ...(status.until !== undefined ? { until: status.until } : {}),
        ...(status.monthly ? { monthly: true as const } : {}),
      });
      emitUsageLimit(conversationId);
      return;
    }
    if (!pauses.held.has(key)) return;
    applyUsageLimitCard(pauses, { type: "usage-limit", state: "resumed", ...(threadId ? { threadId } : {}) }, Date.now());
    recordUsageLimit(conversationId, { key, state: "resumed" });
    if (pauses.held.size > 0) {
      emitUsageLimit(conversationId);
      return;
    }
    emitUsageLimit(conversationId, { text: status.text, resumed: status.resumed });
  };
  const noteCloudUsageLimit = (conversationId: string, card: ClaudeUsageLimitCard, at: number) => {
    // This computer's own pauses come back through the journal too; its
    // engine is the truth for them.
    if (!card.resume && card.deviceId && card.deviceId === options.deviceId) return;
    const pauses = pausesOf(conversationId);
    const before = pauses.held.size;
    if (card.resume) {
      // Resume pressed on another device: wake what this computer holds.
      if (card.requestId && ownResumes.has(card.requestId)) return;
      if (Date.now() - at < USAGE_LIMIT_PAUSE_STALE_MS) claudeCodeEngine?.wakeUsageLimitHolds(conversationId);
    }
    applyUsageLimitCard(pauses, card, at);
    if (pauses.held.size > 0 || before > 0 || card.resume) {
      emitUsageLimit(conversationId, { text: USAGE_LIMIT_RESUMED_TITLE, resumed: Date.now() - at < USAGE_LIMIT_PAUSE_STALE_MS });
    }
  };
  /** Resume pressed here: continue everything the limit paused in this chat, wherever it runs. */
  const resumeUsageLimit = async (conversationId: string): Promise<{ woken: number; cloud: number }> => {
    const woken = claudeCodeEngine?.wakeUsageLimitHolds(conversationId) ?? 0;
    const pauses = pausesOf(conversationId);
    const now = Date.now();
    applyUsageLimitCard(pauses, { type: "usage-limit", state: "resumed", resume: true }, now);
    emitUsageLimit(conversationId, { text: USAGE_LIMIT_RESUMED_TITLE, resumed: true });
    let cloud = 0;
    if (!conversationId.startsWith("local_") && options.usageLimits) {
      const requestId = randomUUID();
      ownResumes.add(requestId);
      cloud = (await options.usageLimits.resume({ conversationId, requestId })).cloud;
    }
    return { woken, cloud };
  };
  const usageLimitPaused = (conversationId: string, threadId: string): boolean =>
    heldThreads.has(threadId) || (usageLimitPauses.get(conversationId)?.held.has(threadId) ?? false);
  const claudeCodeEngine = options.claudeCodeEngine;
  if (claudeCodeEngine) {
    models.setProvider(claudeCodeEngine.provider());
    claudeCodeEngine.onProviderChange((provider) => models.setProvider(provider));
    claudeCodeEngine.onStatus((session, status) => {
      if (status.state === "usage-limit" || status.state === "usage-limit-end") {
        noteUsageLimit(session.conversationId, session.threadId, status);
        return;
      }
      if (session.threadId) return;
      void chats
        .get(session.conversationId)
        ?.then((chat) => {
          if (chat.watchers === 0) return;
          options.emit({
            conversationId: session.conversationId,
            events: [{ type: "engine_status", state: status.state, text: status.text }],
          });
        })
        .catch(() => undefined);
    });
    claudeCodeEngine.onCompaction((session, compaction, conversationId) => {
      void (async () => {
        const chat = await ready(session.conversationId);
        const conversation = session.threadId ? await chat.harness.conversation(conversationId, context) : chat.root;
        if (!conversation) return;
        await recordEngineCompaction(chat.harness, conversation, { ...compaction, engine: "claude-code" }, context);
      })().catch((error: unknown) => options.report(error));
    });
    claudeCodeEngine.onBackgroundWake((session, wake) => {
      const threadId = session.threadId;
      if (!threadId) return;
      void (async () => {
        const chat = await ready(session.conversationId);
        const record = await chat.agentStanding(threadId, context);
        if (!record || record.agentStatus === "canceled") return;
        await chat.messageAgent({ key: `claude-code-wake:${wake.key}`, threadId, message: wake.text, fromOrchestrator: true }, context);
      })().catch((error: unknown) => options.report(error));
    });
  }
  let gateway: Promise<{ access: StellaGatewayAccess; gatewayOrigin: string }> | undefined;
  const specsByAlias = new Map<string, Promise<StellaModelSpec[]>>();

  const ensureGateway = () =>
    (gateway ??= (async () => {
      const site = options.siteAuth();
      if (!site) throw new Error("Sign in to Stella to chat.");
      const baseUrl = site.baseUrl.replace(/\/+$/, "");
      const catalog = (await (
        await fetchWithDeadline(fetch, `${baseUrl}/api/stella/models`, {}, {
          label: "Loading Stella's model catalog",
          timeoutMs: REQUEST_BUDGET_MS.lookup,
        })
      ).json()) as { gateway?: { origin?: string } };
      const gatewayOrigin = catalog.gateway?.origin;
      if (!gatewayOrigin) throw new Error("Stella's model catalog names no gateway.");
      const access = desktopGatewayAccess({
        gatewayOrigin,
        getAuthToken: () => options.siteAuth()?.authToken,
        ...(options.refreshAuthToken
          ? { refreshAuthToken: async () => (await options.refreshAuthToken?.()) ?? undefined }
          : {}),
        getDeviceSigner: options.getDeviceSigner,
      });
      return { access, gatewayOrigin };
    })().catch((error: unknown) => {
      gateway = undefined;
      throw error;
    }));

  const ensureProvider = async (alias: string = STELLA_DEFAULT_ALIAS): Promise<void> => {
    const { access, gatewayOrigin } = await ensureGateway();
    const known = specsByAlias.get(alias);
    if (known) {
      await known;
      return;
    }
    const pending = resolveStellaModels(access, gatewayOrigin, alias, ["orchestrator", "general"]);
    specsByAlias.set(alias, pending);
    try {
      await pending;
    } catch (error) {
      specsByAlias.delete(alias);
      throw error;
    }
    const all = await Promise.all([...specsByAlias.values()].map((specs) => specs.catch(() => [])));
    models.setProvider(stellaProvider({ access, models: all.flat() }));
  };

  const hasOwnKey = async (provider: string, modelId: string): Promise<boolean> => {
    const stored =
      (await options.credentials?.apiKey(provider))?.trim() || (await options.credentials?.oauthToken(provider))?.trim();
    if (stored) return true;
    const route = options.resolveDirectModel?.(`${provider}/${modelId}`);
    if (!route || "error" in route) return false;
    return route.credentialless === true || Boolean((await route.getApiKey())?.trim());
  };

  const accountModels = new Map<string, NonNullable<ReturnType<typeof accountProviderModel>>[]>();
  const ensureAccountModel = async (provider: string, modelId: string): Promise<ModelRef> => {
    const { access, gatewayOrigin } = await ensureGateway();
    const model = accountProviderModel(provider, modelId);
    if (!model) throw new Error(`${provider}/${modelId} isn't a model Stella can run on your account's key.`);
    const entries = accountModels.get(provider) ?? [];
    if (!entries.some((entry) => entry.id === model.id)) {
      entries.push(model);
      accountModels.set(provider, entries);
      models.setProvider(
        accountByokProvider({
          providerId: provider,
          registryId: accountRegistryId(provider),
          models: entries,
          transport: { gatewayOrigin, fetch: (request) => access.fetch(request) },
        }),
      );
    }
    return { provider: accountRegistryId(provider), modelId: model.id };
  };

  const modelOfPick = async (pick: ModelPick | undefined, agentType: "orchestrator" | "general"): Promise<ModelRef> => {
    if (!pick || pick.kind === "stella") {
      const alias = pick?.alias ?? STELLA_DEFAULT_ALIAS;
      await ensureProvider(alias);
      return stellaModelRef(agentType, alias);
    }
    if (pick.kind === "engine") {
      if (pick.engine !== CLAUDE_CODE_PROVIDER_ID || !claudeCodeEngine) {
        throw new Error(`${pick.engine} doesn't run on this computer.`);
      }
      return claudeCodeEngine.ensureModel(pick.modelId);
    }
    if (pick.kind === "direct" && isAccountProviderId(pick.provider) && !(await hasOwnKey(pick.provider, pick.modelId))) {
      return await ensureAccountModel(pick.provider, pick.modelId);
    }
    const ref = byok.ensure(pick);
    if ("error" in ref) throw new Error(ref.error);
    return ref;
  };

  const pickedModel = (): Promise<ModelRef> => modelOfPick(parseModelPick(options.stellaModel?.()), "orchestrator");

  const agentModel = async (
    conversationId: string,
    requested: string,
    placement?: StellaPlacement,
  ): Promise<AgentModelChoice> => {
    if (placement) return { there: true };
    const effort = /^(.+):(low|medium|high|xhigh|max)$/.exec(requested.trim());
    const reference = (effort?.[1] ?? requested).trim();
    const stellaDefault = reference.toLowerCase() === "stella";
    const pick = stellaDefault ? undefined : parseModelPick(reference);
    if (!pick && !stellaDefault) {
      throw new Error(
        `"${requested}" isn't a model agents run on here. Name a Stella model ("stella/<model>"), a model on your own key or plan ("<provider>/<model>", such as "codex/<model>"), or Claude Code ("claude-code" or "claude-code/<model>").`,
      );
    }
    if (pick?.kind === "direct" && pick.provider === CHATGPT_PROVIDER_ID && !(await hasOwnKey(pick.provider, pick.modelId))) {
      throw new Error(
        `"${reference}" runs on your ChatGPT plan, and this computer isn't signed in to ChatGPT. Sign in with ChatGPT in Stella's settings on this computer, or pick another model.`,
      );
    }
    const model = await modelOfPick(pick, "general");
    const thinkingLevel = (effort?.[2] as ModelThinkingLevel | undefined) ?? options.thinkingLevel?.();
    return { runsOn: { model, ...(thinkingLevel ? { thinkingLevel } : {}) } };
  };

  const engineHost = (
    engine: DesktopEngineAgents | undefined,
    defaultModel: string,
    chat: () => Chat | undefined,
  ): RemoteAgentHost | undefined => {
    if (!engine) return undefined;
    const settle = async (threadId: string, requestId: string, status?: "canceled") => {
      const opened = chat();
      if (!opened) return;
      const home = (await remoteAgentHome(opened.harness, opened.root.id, threadId, context)) ?? opened.root.id;
      await opened.harness.commit(
        (tx) => noteRemoteReport(tx, home, { threadId, requestId, ...(status ? { status } : {}) }),
        context,
      );
    };
    const descriptionOf = async (threadId: string) => {
      const opened = chat();
      const agents = opened ? (await opened.harness.snapshot(StellaAgentsDoc, opened.root.id, context))?.agents : undefined;
      return agents?.[threadId]?.description ?? threadId;
    };
    return {
      start: async ({ key, description, prompt, model, parentThreadId, workspace }) =>
        await engine.start({
          key,
          description,
          prompt,
          model: model ?? defaultModel,
          ...(parentThreadId ? { parentThreadId } : {}),
          ...(workspace ? { workspace } : {}),
        }),
      message: async ({ key, threadId, message, framed }) => {
        const description = await descriptionOf(threadId);
        if ((await engine.message({ key, threadId, description, message, ...(framed ? { framed } : {}) })) === "steered") {
          await settle(threadId, `steered:${key}`);
        }
      },
      stop: async (threadId) => {
        const result = await engine.stop(threadId);
        await settle(threadId, `stopped:${threadId}:${Date.now()}`, "canceled");
        return result;
      },
    };
  };

  const deviceHost = (
    conversationId: string,
    deviceId: string,
    chat: () => Chat | undefined,
  ): RemoteAgentHost | undefined => {
    const agents = options.deviceAgents?.(conversationId);
    if (!agents) return undefined;
    const device = async () =>
      (await options.devices?.(conversationId)?.devices().catch(() => undefined))?.find((entry) => entry.deviceId === deviceId);
    const settle = async (threadId: string, requestId: string, status?: "canceled") => {
      const opened = chat();
      if (!opened) return;
      const home = (await remoteAgentHome(opened.harness, opened.root.id, threadId, context)) ?? opened.root.id;
      await opened.harness.commit(
        (tx) => noteRemoteReport(tx, home, { threadId, requestId, ...(status ? { status } : {}) }),
        context,
      );
    };
    const descriptionOf = async (threadId: string) => {
      const opened = chat();
      const known = opened ? (await opened.harness.snapshot(StellaAgentsDoc, opened.root.id, context))?.agents : undefined;
      return known?.[threadId]?.description ?? threadId;
    };
    return {
      start: async ({ key, description, prompt, model, parentThreadId }) => {
        if (model && /^claude-code(?:[/:]|$)/u.test(model)) {
          const there = await device();
          const name = there?.label?.trim() || deviceId;
          if (there?.online && there.availability && !there.availability.capabilities.includes("claude-code")) {
            throw new Error(
              `${name} isn't signed in to Claude Code, so a Claude Code agent can't run there. Ask the user to sign in to Claude on ${name} (Settings › Account there) and try again, or start the agent in the cloud with destination "cloud".`,
            );
          }
        }
        const started = await agents.start({
          key,
          deviceId,
          description,
          prompt,
          ...(model ? { model } : {}),
          ...(parentThreadId ? { parentThreadId } : {}),
        });
        return { threadId: started.threadId, ...(started.waitingForDevice ? { waiting: true } : {}) };
      },
      message: async ({ key, threadId, message, framed }) => {
        const description = await descriptionOf(threadId);
        if ((await agents.message({ key, threadId, description, message, ...(framed ? { framed } : {}) })) === "steered") {
          await settle(threadId, `steered:${key}`);
        }
      },
      stop: async (threadId) => {
        const result = await agents.stop(threadId);
        await settle(threadId, `stopped:${threadId}:${Date.now()}`, "canceled");
        return result;
      },
    };
  };

  const noteEngineReport = async (conversationId: string, report: DeliveredReport) => {
    const threadId = report.agentReport?.threadId;
    if (!threadId) return;
    const chat = await ready(conversationId);
    const agent = (await chat.harness.snapshot(StellaAgentsDoc, chat.root.id, context))?.agents[threadId];
    if (!agent?.remote) return;
    await chat.harness.commit(
      (tx) => noteRemoteReport(tx, chat.root.id, { threadId, requestId: report.requestId, text: report.text }),
      context,
    );
  };

  const ensureModel = async (ref: ModelRef | undefined): Promise<void> => {
    const accountProvider = ref ? accountProviderOfRegistryId(ref.provider) : undefined;
    if (ref && accountProvider) await ensureAccountModel(accountProvider, ref.modelId);
    else if (!ref || ref.provider === STELLA_PROVIDER_ID) await ensureProvider(aliasOf(ref));
    else restoreOwnModel(ref);
  };

  const restoreOwnModel = (ref: ModelRef): void => {
    if (onClaudeCode(ref)) {
      claudeCodeEngine?.ensureModel(ref.modelId);
      return;
    }
    byok.restore(ref);
  };

  const aliasOf = (model: { modelId: string } | undefined): string =>
    (model && parseStellaModelId(model.modelId)?.alias) || STELLA_DEFAULT_ALIAS;

  const waitForProvider = async (alias?: string): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await ensureProvider(alias);
      } catch (error) {
        if (attempt === 0) options.report(error);
        await new Promise((resolve) => setTimeout(resolve, PROVIDER_RETRY_MS));
      }
    }
  };

  const within = <T,>(work: Promise<T>, ms: number, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  };

  const directoryFor = (conversationId: string): AgentDirectoryHost => {
    const cloud = conversationId.startsWith("local_") ? undefined : options.agentThreads;
    const localSessions = (): AgentDirectorySessionRow[] =>
      (options.localSessions?.() ?? []).map((row) => ({
        ...row,
        active: activeNow.has(row.conversationId),
        where: row.conversationId.startsWith("local_") ? "this computer" : "cloud",
      }));
    return {
      conversationId: async () => conversationId,
      usageLimitPaused: (threadId) => usageLimitPaused(conversationId, threadId),
      list: async (_context, listOptions) => {
        const local = localSessions();
        if (!cloud) return { agents: [], sessions: local };
        try {
          const threadIds = listOptions?.threadIds?.length ? listOptions.threadIds : undefined;
          const remote = await within(
            cloud.directory(conversationId, threadIds),
            DIRECTORY_TIMEOUT_MS,
            "Stella's cloud did not answer.",
          );
          const sessions = new Map(remote.sessions.map((row) => [row.conversationId, row]));
          for (const row of local) {
            const there = sessions.get(row.conversationId);
            sessions.set(
              row.conversationId,
              there
                ? {
                    ...there,
                    title: row.title.trim() ? row.title : there.title,
                    active: row.active || there.active,
                    updatedAt: Math.max(row.updatedAt, there.updatedAt),
                  }
                : row,
            );
          }
          return {
            agents: remote.agents,
            sessions: [...sessions.values()],
          };
        } catch (error) {
          return {
            agents: [],
            sessions: local,
            unavailable: `Stella's cloud did not answer (${error instanceof Error ? error.message : String(error)}), so agents running in the cloud or on other devices are not listed right now.`,
          };
        }
      },
      message: async ({ key, to, text, from, remoteStella }) => {
        const id = createHash("sha256").update(`${options.deviceId ?? ""}\0${conversationId}\0${key}`).digest("hex").slice(0, 48);
        const framed = formatAgentMessage(from, text);
        if (!remoteStella && to !== conversationId) {
          if (chats.has(to) || localSessions().some((row) => row.conversationId === to)) {
            if (await noteOnBrain(to, `agent-note:${id}`, framed)) return { outcome: "queued", threadId: to };
            const chat = await ready(to);
            const note: TextContent & { stella: { hidden: true } } = { type: "text", text: framed, stella: { hidden: true } };
            await chat.root.submit({ type: "input", content: [note], whenBusy: "followUp", requestId: `agent-note:${id}` }, context);
            return { outcome: "queued", threadId: to };
          }
          const home = (await threadIndex())[to];
          if (home && home !== conversationId) {
            const chat = await ready(home);
            const record = await chat.agentStanding(to, context);
            if (record) {
              await chat.messageAgent({ key: `note:${id}`, threadId: to, message: framed, fromOrchestrator: true }, context);
              return { outcome: record.status === "running" ? "steered" : "resumed", threadId: to };
            }
          }
        }
        if (!cloud) return undefined;
        return await within(
          cloud.message({ messageId: `pi-msg:${id}`, to, text, from }),
          AGENT_MESSAGE_TIMEOUT_MS,
          "Stella's cloud did not answer, so the message may not have been delivered.",
        );
      },
      stop: async ({ key, threadId, requesterThreadId }) => {
        if (!requesterThreadId) {
          const here = await stopLocalAgent(threadId);
          if (here !== "not_found") {
            return { threadId, outcome: "stopped", where: "on this computer", ...(here.elsewhere.length ? { descendants: here.elsewhere } : {}) };
          }
        }
        if (!cloud) {
          throw new Error(
            requesterThreadId
              ? `${threadId} is not an agent you started. You can stop only agents you started, at any depth.`
              : `No agent ${threadId} on this computer. This chat is stored only on this computer, so it can stop only agents here.`,
          );
        }
        const id = createHash("sha256").update(`${options.deviceId ?? ""}\0${conversationId}\0${key}`).digest("hex").slice(0, 48);
        return await within(
          cloud.stop({ conversationId, threadId, controlRequestId: `pi-stop:${id}`, ...(requesterThreadId ? { requesterThreadId } : {}) }),
          AGENT_MESSAGE_TIMEOUT_MS,
          "Stella's cloud did not answer, so the stop may not have reached the agent. Check agent_status.",
        );
      },
    };
  };

  const stopLocalAgent = async (threadId: string): Promise<{ elsewhere: AgentStopResult[] } | "not_found"> => {
    const conversationId = (await threadIndex())[threadId];
    if (!conversationId) return "not_found";
    const chat = await ready(conversationId);
    const stopped = await chat.stopAgent(threadId, context);
    if (!stopped) return "not_found";
    for (const local of stopped.local) claudeCodeEngine?.abort(conversationId, { threadId: local });
    return { elsewhere: stopped.elsewhere };
  };

  const open = (conversationId: string): Promise<Chat> => {
    let chat = chats.get(conversationId);
    if (!chat) {
      let opened: Chat | undefined;
      chat = (async () => {
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, fileName(conversationId));
        const storage = await openBunSqliteStorage(file);
        const devices = options.devices?.(conversationId);
        const brain = options.brain?.(conversationId);
        let harnessRef: Harness | undefined;
        const agentLogs = options.agentLogs;
        const agentLogTransport: AgentLogTransport | undefined =
          !conversationId.startsWith("local_") && agentLogs && options.deviceId
            ? (() => {
                const holder = agentLogDeviceHolder(options.deviceId);
                return {
                  holder,
                  conversationId,
                  append: ({ threadId, records }) => agentLogs.append({ threadId, conversationId, holder, records }),
                  read: (args) => agentLogs.read(args),
                };
              })()
            : undefined;
        const agentLog = agentLogTransport
          ? agentLogSync({
              harness: () => harnessRef,
              transport: () => agentLogTransport,
              report: options.report,
              onAppend: (stat) => console.info(`[agent-log] append ${JSON.stringify(stat)}`),
              context,
            })
          : undefined;
        const handoff = options.agentHandoff;
        const moveAgent =
          agentLog && handoff
            ? async (move: AgentMove): Promise<{ where: string } | { error: string }> => {
                try {
                  await agentLog.flush(move.agentConversationId);
                } catch (error) {
                  return {
                    error: `your conversation couldn't be saved to Stella's cloud (${error instanceof Error ? error.message : String(error)}).`,
                  };
                }
                await options.flushClaudeSessions?.().catch((error: unknown) => options.report(error));
                const listed = await devices?.devices().catch(() => undefined);
                const from = listed?.find((entry) => entry.deviceId === options.deviceId)?.label?.trim() || "the computer you ran on";
                const brief = move.brief.length > 6_000 ? `${move.brief.slice(0, 6_000)}\n[brief cut]` : move.brief;
                const model = agentMoveModel(move.model, move.thinkingLevel);
                const moved = await handoff({
                  handoffId: `move:${createHash("sha256").update(`${conversationId}\0${move.threadId}\0${move.key}`).digest("hex").slice(0, 40)}`,
                  threadId: move.threadId,
                  conversationId,
                  targetDeviceId: move.deviceId,
                  prompt: movedAgentBrief(from, brief),
                  ...(model ? { model } : {}),
                  ...(move.cwd ? { cwd: move.cwd } : {}),
                });
                return { where: moved.where };
              }
            : undefined;
        const execution = desktopExecution({
          ...(moveAgent ? { moveAgent, leftBehind: workLeftBehind } : {}),
          ...(options.deviceId ? { deviceId: options.deviceId } : {}),
          localOnly: conversationId.startsWith("local_"),
          ...(devices ? { devices } : {}),
          ...(brain ? { brain } : {}),
          turnEnded: async () => {
            const deadline = Date.now() + BRAIN_HANDOFF_WAIT_MS;
            while (Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 1_000));
              if (opened && (await opened.harness.snapshot(LiveDoc, opened.root.id, context))?.run === undefined) return;
            }
          },
          brainMoved: (record) => rememberBrain(conversationId, { record, host: otherHost(record) }),
          report: options.report,
        });
        const destination: ExecutionDestination = {
          kind: "device",
          deviceId: options.deviceId ?? "this-computer",
          label: "This computer",
        };
        let settleStanding!: (held: boolean) => void;
        const standing = new Promise<boolean>((resolve) => {
          settleStanding = resolve;
        });
        const {
          harness,
          refreshTools,
          startAgent,
          agentRecords,
          messageAgent,
          stopAgent,
          agentStanding,
          runPlacedAgent,
          steerPlacedAgent,
        } =
          await openStellaHarness(
          {
            storage,
            models,
            sources: desktopContextSources({
              stellaHome: options.dataDir,
              backendUrl: options.siteAuth()?.baseUrl,
              ...(options.memoryEnabled ? { memoryEnabled: options.memoryEnabled } : {}),
              destination,
              ...(options.executionContext ? { executionContext: sharedExecutionContext } : {}),
              locale: async () =>
                opened && (await opened.harness.snapshot(LocaleDoc, opened.root.id, context))?.locale,
              cloudStored: !conversationId.startsWith("local_"),
            }),
            agents: (() => {
              const { agentStarted, agentReported, agentStopped, subagentEnded, agentRunEnded } = options;
              const attempts = async (threadId: string) => {
                if (!opened) return 1;
                const state = await opened.harness.snapshot(StellaAgentsDoc, opened.root.id, context);
                return Math.max(1, Object.values(state?.calls ?? {}).filter((call) => call.threadId === threadId).length);
              };
              const cloud = engineHost(options.cloudThreads?.(conversationId), "default", () => opened);
              return desktopAgentsHost({
                ...(options.deviceId ? { deviceId: options.deviceId } : {}),
                ...(cloud ? { cloud } : {}),
                ...(options.deviceAgents?.(conversationId)
                  ? { devices: (deviceId: string) => deviceHost(conversationId, deviceId, () => opened) }
                  : {}),
                agentModel: (requested, _caller, placement) => agentModel(conversationId, requested, placement),
                engine: (id) => (id === CLOUD_THREAD_ENGINE ? cloud : undefined),
                directory: directoryFor(conversationId),
                dataDir: options.dataDir,
                execution: execution.host,
                ...(agentLog && agentLogTransport
                  ? {
                      agentLog: {
                        kick: agentLog.kick,
                        importInto: async (agentConversationId, threadId, runContext) => {
                          const into = harnessRef;
                          const conversation = into ? await into.conversation(agentConversationId, runContext) : undefined;
                          if (!into || !conversation) throw new Error("this chat isn't open here.");
                          return await importAgentLog(into, conversation, agentLogTransport, threadId, runContext);
                        },
                      },
                    }
                  : {}),
                ensureModel: (model) => ensureModel(model),
                beginAgentRun: async (run) => {
                  if (!opened) return;
                  if (run.parentThreadId) subagentThreads.add(run.threadId);
                  if (run.parentConversationId !== opened.root.id) {
                    if (!run.parentThreadId) return;
                    await noteAgentThread(run.threadId, conversationId);
                    agentStarted?.({
                      conversationId,
                      threadId: run.threadId,
                      description: run.description,
                      attempt: run.attempt,
                      parentThreadId: run.parentThreadId,
                    });
                    return;
                  }
                  await noteAgentThread(run.threadId, conversationId);
                  const state = await opened.harness.snapshot(StellaAgentsDoc, opened.root.id, context);
                  if (isAnotherHostsAgent(state, run.threadId)) return;
                  const agent = state?.agents[run.threadId];
                  agentStarted?.({
                    conversationId,
                    threadId: run.threadId,
                    description: agent?.description ?? run.threadId,
                    attempt: await attempts(run.threadId),
                  });
                },
                ...(subagentEnded || agentRunEnded
                  ? {
                      endAgentRun: async (run, _context, end) => {
                        const outcome = agentRunOutcome(end);
                        agentRunEnded?.({ conversationId, threadId: run.threadId, interrupted: outcome === undefined });
                        if (!run.parentThreadId || !outcome || end?.waiting || !subagentEnded) return;
                        subagentEnded({
                          conversationId,
                          threadId: run.threadId,
                          parentThreadId: run.parentThreadId,
                          attempt: run.attempt,
                          ...outcome,
                        });
                      },
                    }
                  : {}),
                reportsFromLedger: () => !conversationId.startsWith("local_"),
                deliverReport: async (report, context) => {
                  if (report.settled || report.ledger) return;
                  if (await noteOnBrain(conversationId, report.requestId, report.text, report.threadId)) return;
                  const root = await harness.conversation(report.rootConversationId, context);
                  if (!root) return;
                  const submission = await root.submit(
                    { type: "input", content: report.text, whenBusy: "followUp", requestId: report.requestId },
                    context,
                  );
                  relayedReport(conversationId, root, submission, report.text);
                },
                deliverNote: async (note, context) => {
                  if (!conversationId.startsWith("local_") && options.agentThreads) {
                    await options.agentThreads.note({
                      noteId: `note:${createHash("sha256").update(`${options.deviceId ?? ""}\0${conversationId}\0${note.requestId}`).digest("hex").slice(0, 48)}`,
                      conversationId,
                      fromThreadId: note.threadId,
                      text: note.text,
                    });
                    return;
                  }
                  const root = await harness.conversation(note.rootConversationId, context);
                  if (!root) throw new Error("Stella is not reachable from here.");
                  const hidden: TextContent & { stella: { hidden: true } } = { type: "text", text: note.text, stella: { hidden: true } };
                  await root.submit({ type: "input", content: [hidden], whenBusy: "followUp", requestId: note.requestId }, context);
                },
                ...(agentReported
                  ? {
                      agentReported: (agent) => {
                        void (async () => {
                          const attempt = await attempts(agent.threadId);
                          const record = opened
                            ? (await opened.harness.snapshot(StellaAgentsDoc, opened.root.id, context))?.agents[agent.threadId]
                            : undefined;
                          const live =
                            opened && record && !record.remote
                              ? await opened.harness.snapshot(LiveDoc, record.conversationId as ConversationId, context)
                              : undefined;
                          agentReported({ conversationId, ...agent, attempt, running: live?.run !== undefined });
                        })().catch((error: unknown) => options.report(error));
                      },
                    }
                  : {}),
                ...(agentStopped
                  ? {
                      agentStopped: async (agent) => {
                        if (opened && isAnotherHostsAgent(await opened.harness.snapshot(StellaAgentsDoc, opened.root.id, context), agent.threadId)) {
                          return;
                        }
                        agentStopped({ conversationId, ...agent, attempt: await attempts(agent.threadId) });
                      },
                    }
                  : {}),
              });
            })(),
            ...(options.tools ? { tools: options.tools(conversationId) } : {}),
            extensions: [
              journalTurnGate(standing),
              ...(agentLog ? [agentLog.extension()] : []),
              ...(claudeCodeEngine ? [claudeCodeEngine.extension(conversationId)] : []),
            ],
            env: environments.env,
            onReport: options.report,
          },
          context,
        );
        harnessRef = harness;
        const orchestrator = orchestratorAgent(stellaModelRef("orchestrator"));
        const root = await harness.root(context, { agent: orchestrator });
        if (offersAgentTools(await root.agent(context))) await root.configure(orchestrator, context);
        const resumed = (await harness.snapshot(LiveDoc, root.id, context))?.run !== undefined;
        const log = options.localLog?.(conversationId);
        const localLog = log ? await localLogMirror({ harness, root, log, report: options.report, context }) : undefined;
        const rootModel = (await root.agent(context)).model;
        const aliases = new Set<string>();
        const accountRefs: ModelRef[] = [];
        for (const agent of Object.values((await harness.snapshot(StellaAgentsDoc, root.id, context))?.agents ?? {})) {
          if (agent.remote) continue;
          const model = (await (await harness.conversation(agent.conversationId as ConversationId, context))?.agent(context))?.model;
          if (model && accountProviderOfRegistryId(model.provider)) accountRefs.push(model);
          else if (model && model.provider !== STELLA_PROVIDER_ID) restoreOwnModel(model);
          else if (model && (await harness.snapshot(LiveDoc, agent.conversationId as ConversationId, context))?.run) {
            aliases.add(aliasOf(model));
          }
        }
        if (rootModel && accountProviderOfRegistryId(rootModel.provider)) accountRefs.push(rootModel);
        else if (rootModel && rootModel.provider !== STELLA_PROVIDER_ID) restoreOwnModel(rootModel);
        else aliases.add(aliasOf(rootModel));
        if (aliases.size === 0 && accountRefs.length === 0) void harness.resume();
        else
          void Promise.all([
            ...[...aliases].map((alias) => waitForProvider(alias)),
            ...accountRefs.map((ref) => ensureModel(ref).catch((error: unknown) => options.report(error))),
          ]).then(() => harness.resume());
        const journal = options.journal?.(conversationId);
        const mirror = journal
          ? await journalMirror({
              harness,
              root,
              journal,
              report: options.report,
              onRemoteTurns: (turns) => {
                if (opened?.watchers) options.emit({ conversationId, events: [{ type: "remote_turns", turns }] });
                if (turns.length > 0) {
                  brains.delete(conversationId);
                  void brainHost(conversationId).catch((error: unknown) => options.report(error));
                }
              },
              onUsageLimit: (card, at) => noteCloudUsageLimit(conversationId, card, at),
              ...(brain ? { readBrain: () => brain.read() } : {}),
              resumed,
              context,
            })
          : undefined;
        void (mirror ? mirror.standing : Promise.resolve(true)).then(settleStanding);
        void mirror?.importNow().catch((error: unknown) => options.report(error));
        let pulling = false;
        let pullAgain = false;
        const journalAdvanced = mirror
          ? () => {
              if (pulling) {
                pullAgain = true;
                return;
              }
              pulling = true;
              void (async () => {
                do {
                  pullAgain = false;
                  await mirror.importNow();
                } while (pullAgain);
              })()
                .catch((error: unknown) => options.report(error))
                .finally(() => {
                  pulling = false;
                });
            }
          : undefined;
        const idleCheck = setInterval(() => {
          void (async () => {
            const inspection = await harness.inspect(context);
            const awaitingCloud = mirror
              ? (await agentRecords(context)).some((agent) => agent.placement.kind === "cloud" && agent.status === "running")
              : false;
            await markActive(
              conversationId,
              inspection.tasks.length > 0 || inspection.submissions.length > 0 || awaitingCloud,
            );
            const watched = Boolean(opened?.watchers);
            if ((!watched && awaitingCloud) || (watched && (mirror?.remoteTurns().length ?? 0) > 0)) {
              await mirror?.importNow();
            }
          })().catch((error: unknown) => options.report(error));
        }, IDLE_CHECK_MS);
        idleCheck.unref?.();
        let following = false;
        let brainReadAt = 0;
        const followCheck = setInterval(() => {
          if (opened?.watchers && mirror && Date.now() - brainReadAt >= BRAIN_WATCH_MS) {
            brainReadAt = Date.now();
            void recheckBrainHost(conversationId).catch((error: unknown) => options.report(error));
          }
          if (!mirror || following || !opened) return;
          if (opened.watchers > 0 || !mirror.turnOpen()) return;
          following = true;
          void mirror
            .importNow()
            .catch((error: unknown) => options.report(error))
            .finally(() => {
              following = false;
            });
        }, FOLLOW_MS);
        followCheck.unref?.();
        opened = {
          harness,
          root,
          refreshTools,
          startAgent,
          agentRecords,
          messageAgent,
          stopAgent,
          agentStanding,
          runPlacedAgent,
          steerPlacedAgent,
          ...(mirror ? { mirror } : {}),
          ...(journalAdvanced ? { journalAdvanced } : {}),
          ...(localLog ? { localLog } : {}),
          execution,
          watchers: 0,
          idleCheck,
          followCheck,
        };
        return opened;
      })().catch((error: unknown) => {
        chats.delete(conversationId);
        throw error;
      });
      chats.set(conversationId, chat);
    }
    return chat;
  };

  const history = async (chat: Chat, beforeEntryId?: number): Promise<{ entries: PiEntry[]; hasOlder: boolean }> => {
    const page = await chat.root.entries(
      beforeEntryId === undefined ? {} : { maxEntryId: (beforeEntryId - 1) as EntryId },
      HISTORY_PAGE,
      undefined,
      context,
    );
    const { entries, trimmed } = piEntriesForClients([...page.items].reverse() as unknown as PiEntry[], CLIENT_PAGE_BYTES);
    return { entries, hasOlder: page.next !== undefined || trimmed };
  };

  const eventsForClients = (events: readonly PiChatEvent[]): PiChatEvent[] =>
    piEventsForClients(
      events.map((event) =>
        event.type === "snapshot" ? { ...event, entries: piEntriesForClients(event.entries, CLIENT_PAGE_BYTES).entries } : event,
      ),
    );

  const attach = async (conversationId: string, chat: Chat): Promise<AgentEventStream> => {
    const previous = chat.stream;
    const stream = await watchEvents(chat.harness, chat.root.id, context);
    chat.stream = stream;
    if (options.userReminders) chat.reminderContext = reminderContextFrom(stream.snapshot.entries);
    stream.start(async (events) => {
      if (chat.stream !== stream) return;
      options.emit({ conversationId, events: eventsForClients(events as unknown as PiChatEvent[]) });
    });
    if (previous) {
      options.emit({ conversationId, events: eventsForClients([stream.snapshot as unknown as PiChatEvent]) });
      await previous.stop().catch(() => undefined);
    }
    return stream;
  };

  const watch = async (conversationId: string): Promise<PiChatWatchResult> => {
    const chat = await open(conversationId);
    await chat.localLog?.importNow().catch((error: unknown) => options.report(error));
    chat.watchers += 1;
    const stream = await attach(conversationId, chat);
    const { entries, hasOlder } = await history(chat);
    const [snapshot] = eventsForClients([stream.snapshot as unknown as PiChatEvent]) as [PiChatWatchResult["snapshot"]];
    const held = usageLimitEvent(conversationId);
    if (held) options.emit({ conversationId, events: [held] });
    return {
      snapshot: { ...snapshot, entries: mergePiEntries(entries, snapshot.entries) },
      hasOlder,
      remote: chat.mirror?.remoteTurns() ?? [],
    };
  };

  const welcome = async (conversationId: string, message: string): Promise<void> => {
    const text = message.trim();
    if (!text) return;
    const chat = await open(conversationId);
    const reply = writtenReply(text, Date.now(), "welcome");
    await chat.root.submit(
      {
        type: "write",
        requestId: `welcome:${randomUUID()}`,
        entry: { kind: "pi.assistant", model: [reply], data: { localOnly: true } },
      },
      context,
    );
  };

  const linkedFiles = async (conversationId: string): Promise<{ paths: string[] }> => {
    const chat = await open(conversationId);
    const page = await chat.root.entries({}, LINKED_FILE_ENTRIES, undefined, context);
    const texts: string[] = [];
    for (const entry of page.items as unknown as PiEntry[]) {
      const message = entry.model?.[0];
      if (entry.kind === "pi.assistant" && message?.role === "assistant") texts.push(piMessageText(message));
    }
    for (const agent of await chat.agentRecords(context)) texts.push(...agent.assistantMessages);
    return { paths: [...new Set(texts.flatMap((text) => extractLocalFileLinkPaths(text)))] };
  };

  const follow = async (conversationId: string): Promise<void> => {
    await open(conversationId);
  };

  const unwatch = async (conversationId: string): Promise<void> => {
    const chat = await chats.get(conversationId);
    if (!chat || chat.watchers === 0) return;
    chat.watchers -= 1;
    if (chat.watchers > 0) return;
    const stream = chat.stream;
    chat.stream = undefined;
    await stream?.stop().catch(() => undefined);
  };

  /**
   * A conversation answers with what was said elsewhere too: one stored in
   * the cloud with other devices' turns, imported first, waiting at most a
   * moment for the journal; one kept on this computer with another engine's.
   */
  const transcriptHasPrompt = (chat: Chat, clientMsgId: string): Promise<boolean> =>
    chat.harness.commit(async (tx) => {
      let cursor: Parameters<typeof tx.scanEntries>[2];
      do {
        const page = await tx.scanEntries({ conversationId: chat.root.id, order: "descending" }, PROMPT_SCAN_PAGE, cursor);
        const found = page.items.some((entry) => {
          if (entry.kind !== "pi.user") return false;
          const content = (entry.model?.[0] as { content?: unknown } | undefined)?.content;
          return (
            Array.isArray(content) &&
            content.some((part) => (part as { stella?: { clientMsgId?: unknown } } | null)?.stella?.clientMsgId === clientMsgId)
          );
        });
        if (found) return true;
        cursor = page.next;
      } while (cursor !== undefined);
      return false;
    }, context);
  const caughtUp = async (chat: Chat): Promise<void> => {
    await chat.localLog?.importNow().catch((error: unknown) => options.report(error));
    if (!chat.mirror) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      chat.mirror.importNow().catch((error: unknown) => options.report(error)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, JOURNAL_CATCH_UP_MS);
      }),
    ]);
    clearTimeout(timer);
  };

  const submit = async (
    conversationId: string,
    requestId: string,
    content: UserInput,
    sent: { locale?: string; followSender?: boolean; timezone?: string } = {},
  ) => {
    if (!sent.followSender) {
      const placement = await brainPlacement(conversationId);
      if (!placement.here) throw new Error(elsewhere(placement));
    }
    const chat = await open(conversationId);
    await followPickedModel(chat);
    chat.refreshTools();
    const locale = sent.locale;
    if (locale && (await chat.harness.snapshot(LocaleDoc, chat.root.id, context))?.locale !== locale) {
      await chat.harness.commit(async (tx) => {
        (await tx.doc(LocaleDoc, chat.root.id)).locale = locale;
        return undefined;
      }, context);
    }
    await markActive(conversationId, true);
    await caughtUp(chat);
    if (sent.followSender && (await transcriptHasPrompt(chat, requestId))) {
      return { submissionId: null, alreadyAnswered: true };
    }
    await afterStop(chat.harness, chat.root, context);
    const input = await withReminders(conversationId, chat, content, sent);
    const submission = await chat.root.submit(
      { type: "input", content: input, requestId, whenBusy: "steer" },
      context,
    );
    return { submissionId: submission.id };
  };

  const noteUserMessages = (messages: readonly Message[], into: ReminderContext): void => {
    for (const message of messages) {
      if (message.role !== "user") continue;
      const user = message as unknown as PiUserMessage;
      if (typeof user.content !== "string") {
        for (const part of user.content) if (part.type === "text" && part.stella?.hidden) into.shown.add(part.text);
      }
      if (piUserView(user).text.trim() && !isPiAgentInput(user)) into.previousUserAt = user.timestamp;
    }
  };

  const reminderContextFrom = (entries: readonly EntryRecord[]): ReminderContext | undefined => {
    const first = entries[0];
    if (!first) return undefined;
    const edits = new Map<EntryId, ContextEdit>();
    for (const entry of entries) for (const edit of entry.edits ?? []) edits.set(edit.target, edit);
    const into: ReminderContext = { tail: first.id, shown: new Set() };
    for (const entry of entries) {
      const edit = edits.get(entry.id);
      noteUserMessages(edit?.action === "omit" ? [] : edit?.action === "replace" ? edit.messages : (entry.model ?? []), into);
      if (entry.id > into.tail) into.tail = entry.id;
    }
    return into;
  };

  const reminderContextOf = async (chat: Chat): Promise<Pick<ReminderContext, "previousUserAt" | "shown">> => {
    const latest = (await chat.root.entries({}, 1, undefined, context)).items[0];
    if (!latest) return { shown: new Set() };
    const known = chat.reminderContext;
    if (known && known.tail <= latest.id) {
      const added: EntryRecord[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await chat.root.entries(
          { minEntryId: (known.tail + 1) as EntryId, maxEntryId: latest.id, order: "ascending" },
          HISTORY_PAGE,
          cursor,
          context,
        );
        added.push(...page.items);
        cursor = page.next;
      } while (cursor !== undefined);
      if (added.every((entry) => entry.head === undefined && entry.edits === undefined)) {
        for (const entry of added) noteUserMessages(entry.model ?? [], known);
        known.tail = latest.id;
        return known;
      }
    }
    const view = await chat.root.context(context, { at: latest.id });
    const fresh: ReminderContext = { tail: latest.id, shown: new Set() };
    noteUserMessages(view.messages, fresh);
    chat.reminderContext = fresh;
    return fresh;
  };

  const withReminders = async (
    conversationId: string,
    chat: Chat,
    content: UserInput,
    sent: { timezone?: string } = {},
  ): Promise<UserInput> => {
    if (!options.userReminders) return content;
    const text = typeof content === "string" ? content : piUserView({ role: "user", content, timestamp: 0 } as PiUserMessage).text;
    if (!text.trim()) return content;
    const { previousUserAt, shown } = await reminderContextOf(chat);
    const reminders = (
      await options
        .userReminders({
          conversationId,
          text,
          sentAt: Date.now(),
          ...(previousUserAt !== undefined ? { previousUserAt } : {}),
          ...(sent.timezone ? { timezone: sent.timezone } : {}),
        })
        .catch((error: unknown) => {
          options.report(error);
          return [];
        })
    ).filter((reminder) => !shown.has(reminder));
    if (reminders.length === 0) return content;
    const parts = typeof content === "string" ? [{ type: "text" as const, text: content }] : [...content];
    const hidden = reminders.map((reminder): TextContent & { stella: { hidden: true } } => ({
      type: "text",
      text: reminder,
      stella: { hidden: true },
    }));
    return [...parts, ...hidden];
  };

  const followPickedModel = async (chat: Chat): Promise<void> => {
    const model = await pickedModel();
    const agent = await chat.root.agent(context);
    const thinkingLevel = options.thinkingLevel?.() ?? "off";
    const moved = agent.model?.provider !== model.provider || agent.model?.modelId !== model.modelId;
    if (moved) {
      const window = onClaudeCode(model)
        ? (options.claudeCodeEngine?.contextWindow(model.modelId) ?? 0)
        : (models.getModel(model.provider, model.modelId)?.contextWindow ?? 0);
      const fit = await fitForHandover({ harness: chat.harness, conversation: chat.root, window, context, report: options.report }).catch(
        (error: unknown) => options.report(error),
      );
      if (fit) console.info("[stella-handover]", { from: agent.model, to: model, ...fit });
    }
    if (moved || agent.thinkingLevel !== thinkingLevel) {
      await chat.root.configure(
        { model, thinkingLevel, ...(moved ? { extensions: orchestratorAgent(model).extensions } : {}) },
        context,
      );
    }
  };

  const ready = async (conversationId: string): Promise<Chat> => {
    const chat = await open(conversationId);
    await chat.localLog?.importNow().catch((error: unknown) => options.report(error));
    await ensureModel((await chat.root.agent(context)).model);
    chat.refreshTools();
    await markActive(conversationId, true);
    return chat;
  };

  const placements = new Map<string, Placement>();
  type Placement = { chat?: Chat; submission?: Submission; canceled?: true };

  const stopPlacement = async ({ chat, submission }: Placement) => {
    if (!chat || !submission) return;
    const withdrawn = await chat.harness.abortSubmission(submission.id, context, chat.root.id);
    if (withdrawn === "already_placed") await stopStella(chat.harness, chat.root, context);
  };

  const automation = async (
    conversationId: string,
    turn: {
      requestId: string;
      prompt: string;
      content?: UserInput;
      visible: boolean;
      rejectIfBusy?: boolean;
      placementRunId?: string;
      observe?: (events: PiChatEvent[]) => void;
    },
  ): Promise<{ status: "ok"; finalText: string } | { status: "busy" | "error"; finalText: ""; error: string }> => {
    const { observe, placementRunId } = turn;
    if (!placementRunId) {
      const where = await brainPlacement(conversationId);
      if (!where.here) return { status: "error", finalText: "", error: elsewhere(where) };
    }
    const placement: Placement = {};
    if (placementRunId) placements.set(placementRunId, placement);
    try {
      const chat = await ready(conversationId);
      placement.chat = chat;
      const observer = observe ? await watchEvents(chat.harness, chat.root.id, context) : undefined;
      observer?.start(async (events) => observe?.(events as unknown as PiChatEvent[]));
      try {
        return await automationTurn(conversationId, chat, turn);
      } finally {
        await observer?.stop().catch(() => undefined);
      }
    } finally {
      if (placementRunId && placements.get(placementRunId) === placement) placements.delete(placementRunId);
    }
  };

  const automationTurn = async (
    conversationId: string,
    chat: Chat,
    turn: {
      requestId: string;
      prompt: string;
      content?: UserInput;
      visible: boolean;
      rejectIfBusy?: boolean;
      placementRunId?: string;
    },
  ): Promise<{ status: "ok"; finalText: string } | { status: "busy" | "error"; finalText: ""; error: string }> => {
    await caughtUp(chat);
    await followPickedModel(chat);
    const placement = turn.placementRunId ? placements.get(turn.placementRunId) : undefined;
    if (placement?.canceled) return { status: "error", finalText: "", error: "Canceled." };
    let submission;
    const content: UserInput =
      turn.content ??
      (turn.visible ? turn.prompt : [{ type: "text", text: turn.prompt, stella: { hidden: true } } as TextContent]);
    try {
      submission = await chat.root.submit(
        {
          type: "input",
          content: turn.visible ? await withReminders(conversationId, chat, content) : content,
          requestId: turn.requestId,
          whenBusy: turn.rejectIfBusy ? "reject" : "followUp",
        },
        context,
      );
    } catch (error) {
      if (error instanceof ConversationBusy) {
        return { status: "busy", finalText: "", error: "Stella is already handling another turn." };
      }
      throw error;
    }
    if (placement) {
      placement.submission = submission;
      if (placement.canceled) await stopPlacement(placement);
    }
    const settled = await submission.wait(context);
    if (settled.status === "unanswered") {
      return { status: "error", finalText: "", error: settled.reason ?? "The turn did not finish." };
    }
    const answer = settled.type === "input" ? settled.answer : undefined;
    if (answer === undefined) return { status: "ok", finalText: "" };
    const page = await chat.root.entries({ minEntryId: answer, maxEntryId: answer }, 1, undefined, context);
    const message = (page.items[0] as unknown as PiEntry | undefined)?.model?.[0];
    return { status: "ok", finalText: splitMessageReplyRefs(message).text.trim() };
  };

  const voiceTranscript = async (
    conversationId: string,
    said: {
      eventId?: string;
      role: "user" | "assistant";
      text: string;
      timestamp?: number;
      hidden?: boolean;
      voiceSession?: { durationMs: number };
    },
  ): Promise<void> => {
    const chat = await open(conversationId);
    const timestamp = said.timestamp ?? Date.now();
    const marks = { source: "voice" as const, ...(said.voiceSession ? { voiceSession: said.voiceSession } : {}) };
    const message =
      said.role === "user"
        ? {
            role: "user" as const,
            content: [{ type: "text" as const, text: said.text, ...(said.hidden ? { stella: { hidden: true } } : {}) }],
            timestamp,
            ...marks,
          }
        : ({
            role: "assistant",
            content: [{ type: "text", text: said.text }],
            api: "stella-voice",
            provider: "stella",
            model: "realtime-voice",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp,
            ...marks,
            ...(said.hidden ? { stella: { hidden: true } } : {}),
          } as AssistantMessage);
    await chat.root.submit(
      {
        type: "write",
        ...(said.eventId ? { requestId: `voice-said:${said.eventId}` } : {}),
        entry: { kind: said.role === "user" ? "pi.user" : "pi.assistant", model: [message as Message] },
      },
      context,
    );
  };

  const voiceHistory = async (
    conversationId: string,
  ): Promise<Array<{ role: "user" | "assistant"; content: string; timestamp: number }>> => {
    const chat = await open(conversationId);
    const page = await chat.root.entries({}, VOICE_HISTORY_ENTRIES, undefined, context);
    const items: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
    for (const entry of [...page.items].reverse() as unknown as PiEntry[]) {
      const message = entry.model?.[0];
      if (entry.kind === "pi.user" && message?.role === "user") {
        const text = piUserView(message).text || ((message as PiUserMessage).source === "voice" ? piMessageText(message) : "");
        if (text.trim() && !isPiAgentText(text)) {
          items.push({ role: "user", content: text, timestamp: message.timestamp });
        }
      } else if (entry.kind === "pi.assistant" && message?.role === "assistant") {
        const text = splitMessageReplyRefs(message).text.trim();
        if (text.trim()) items.push({ role: "assistant", content: text, timestamp: message.timestamp });
      }
    }
    return items;
  };

  const relayedReport = (conversationId: string, root: Conversation, submission: Submission, text: string) => {
    const relayed = options.agentReportRelayed;
    if (!relayed) return;
    void (async () => {
      const settled = await submission.wait(context);
      if (settled.status === "unanswered" || settled.type !== "input" || settled.answer === undefined) return;
      const page = await root.entries({ minEntryId: settled.answer, maxEntryId: settled.answer }, 1, undefined, context);
      const message = (page.items[0] as unknown as PiEntry | undefined)?.model?.[0];
      if (message?.role !== "assistant" || !piMessageText(message).trim()) return;
      relayed({ conversationId, description: /^description: (.*)$/m.exec(text)?.[1]?.trim() ?? "" });
    })().catch((error: unknown) => options.report(error));
  };

  const startAgent = async (
    conversationId: string,
    agent: { key: string; description: string; prompt: string },
  ): Promise<{ threadId: string }> => {
    const chat = await ready(conversationId);
    const { threadId } = await chat.startAgent(agent, context);
    return { threadId };
  };

  const agents = async (conversationId: string): Promise<PiChatAgentsResult> => {
    if (!chats.has(conversationId) && !(await stat(path.join(directory, fileName(conversationId))).catch(() => undefined))) {
      return { agents: [] };
    }
    const chat = await open(conversationId);
    const records = await chat.agentRecords(context);
    return {
      agents: records.map(({ placement: _placement, stopped: _stopped, ...agent }) => agent),
    };
  };

  const messageAgent = async (
    conversationId: string,
    message: { key: string; threadId: string; message: string },
  ): Promise<void> => {
    const chat = await ready(conversationId);
    await chat.messageAgent(message, context);
  };

  const runPlacedAgent = async (
    conversationId: string,
    run: Omit<Parameters<OpenStellaHarness["runPlacedAgent"]>[0], "runsOn"> & {
      model?: string;
    },
  ): ReturnType<OpenStellaHarness["runPlacedAgent"]> => {
    placedIn.set(run.agentKey, conversationId);
    const placed = { runKey: run.runKey, cancel: new AbortController() };
    placedRuns.set(run.agentKey, placed);
    const { model, signal, ...placedRun } = run;
    const stop = () => placed.cancel.abort(signal?.reason);
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    try {
      let runsOn: RunsOn | undefined;
      if (model) {
        const choice = await agentModel(conversationId, model);
        if (!("runsOn" in choice)) throw new Error(`"${model}" runs on Claude Code, not on Stella's own agents.`);
        runsOn = choice.runsOn;
      }
      const chat = await ready(conversationId);
      const engineModel = runsOn?.model ?? (await chat.root.agent(context)).model;
      if (onClaudeCode(engineModel)) {
        const problem = await options.claudeCodeProblem?.().catch(() => undefined);
        if (problem) {
          return {
            threadId: run.threadId ?? run.agentKey,
            status: "error",
            error: `${problem} This agent was started from another device to run on Claude Code here; once Claude is signed in on this computer, message it to try again, or start it in the cloud.`,
          };
        }
      }
      return await chat.runPlacedAgent({ ...placedRun, ...(runsOn ? { runsOn } : {}), signal: placed.cancel.signal }, context);
    } finally {
      signal?.removeEventListener("abort", stop);
      if (placedRuns.get(run.agentKey) === placed) placedRuns.delete(run.agentKey);
    }
  };

  const agentHistory = async (conversationId: string, threadId: string, args: Record<string, unknown>): Promise<unknown> => {
    const chat = await ready(conversationId);
    return await ownHistoryQuery(chat.harness, chat.root.id, threadId, args, context, ownHistorySql);
  };

  const steerPlacedAgent = async (message: { key: string; agentKey: string; message: string }): Promise<boolean> => {
    const conversationId = placedIn.get(message.agentKey);
    if (!conversationId) return false;
    return await (await open(conversationId)).steerPlacedAgent(message, context);
  };

  const cancelPlacedAgent = (agentKey: string, runKey: string, stopped?: boolean): boolean => {
    const placed = placedRuns.get(agentKey);
    if (placed?.runKey !== runKey) return false;
    placed.cancel.abort(stopped ? PLACED_AGENT_STOPPED : undefined);
    return true;
  };

  const older = async (conversationId: string, beforeEntryId: number): Promise<PiChatOlderResult> =>
    history(await open(conversationId), beforeEntryId);

  return {
    submit,
    automation,
    resumeUsageLimit,
    startAgent,
    messageAgent,
    runPlacedAgent,
    steerPlacedAgent,
    agentHistory,
    cancelPlacedAgent,
    voiceTranscript,
    voiceHistory,
    async cancelPlacement(placementRunId: string): Promise<{ canceled: boolean }> {
      const placement = placements.get(placementRunId);
      if (!placement) return { canceled: false };
      placement.canceled = true;
      await stopPlacement(placement);
      return { canceled: true };
    },
    async deliverAgentMessage(
      threadId: string,
      text: string,
      messageId: string,
    ): Promise<"steered" | "resumed" | "queued" | "not_found"> {
      const conversationId = (await threadIndex())[threadId];
      if (!conversationId || !text.trim()) return "not_found";
      const chat = await ready(conversationId);
      const record = await chat.agentStanding(threadId, context);
      if (!record) return "not_found";
      const report = parseAgentReportId(messageId);
      await chat.messageAgent(
        {
          key: `device:${messageId.trim() || crypto.randomUUID()}`,
          threadId,
          message: text,
          fromOrchestrator: true,
          ...(report ? { report: true as const, reportFrom: report.threadId } : {}),
        },
        context,
      );
      return record.status === "running" ? "steered" : "resumed";
    },
    stopAgent: stopLocalAgent,
    async deliverReport(conversationId: string, report: DeliveredReport): Promise<void> {
      await noteEngineReport(conversationId, report);
      if (await noteOnBrain(conversationId, report.requestId, report.text)) return;
      const chat = await ready(conversationId);
      await caughtUp(chat);
      // A ledger report carries its receipt, the client id the cloud and
      // every computer give its prompt; one already in the transcript (taken
      // on another computer, or by an earlier build) is not taken again.
      const reportId = report.requestId.startsWith(AGENT_REPORT_REQUEST_PREFIX)
        ? report.requestId.slice(AGENT_REPORT_REQUEST_PREFIX.length)
        : undefined;
      const receipt = reportId && parseAgentReportId(reportId) ? agentReportReceipt(reportId) : undefined;
      if (receipt && (await transcriptHasPrompt(chat, receipt))) return;
      const hidden: TextContent & { stella: PiPartMarks & { hidden: true } } = {
        type: "text",
        text: report.text,
        stella: {
          hidden: true,
          ...(receipt ? { clientMsgId: receipt } : {}),
          ...(report.agentReport ? { agentReport: report.agentReport } : {}),
        },
      };
      const submission = await chat.root.submit(
        { type: "input", content: [hidden], whenBusy: "followUp", requestId: report.requestId },
        context,
      );
      relayedReport(conversationId, chat.root, submission, report.text);
    },
    async agentStatus(
      threadId: string,
    ): Promise<
      { conversationId: string; status: "running" | "completed" | "error" | "canceled"; attempt: number; lastText?: string } | undefined
    > {
      const conversationId = (await threadIndex())[threadId];
      if (!conversationId) return undefined;
      const chat = await open(conversationId);
      const record = await chat.agentStanding(threadId, context);
      if (!record) return undefined;
      return {
        conversationId,
        status:
          record.agentStatus === "failed"
            ? "error"
            : record.agentStatus === "canceled"
              ? record.agentStatus
              : record.status,
        attempt: record.attempt,
        ...(record.lastText ? { lastText: record.lastText } : {}),
      };
    },
    busy(): boolean {
      return activeNow.size > 0;
    },
    async resumeActive(): Promise<void> {
      for (const conversationId of await activeSet()) {
        await open(conversationId).catch((error: unknown) => options.report(error));
      }
    },
    async request(request: PiChatRequest): Promise<unknown> {
      switch (request.op) {
        case "submit":
          return submit(request.conversationId, request.requestId, request.text);
        case "abort": {
          const chat = await open(request.conversationId);
          claudeCodeEngine?.abort(request.conversationId);
          await stopStella(chat.harness, chat.root, context);
          return { ok: true };
        }
        case "watch":
          return watch(request.conversationId);
        case "unwatch":
          await unwatch(request.conversationId);
          return { ok: true };
        case "older":
          return older(request.conversationId, request.beforeEntryId);
        case "agents":
          return agents(request.conversationId);
        case "follow":
          await follow(request.conversationId);
          return { ok: true };
        case "sendMoved":
          options.emit({
            conversationId: request.conversationId,
            events: [{ type: "send_moved", requestId: request.requestId, userMessageId: request.userMessageId }],
          });
          return { ok: true };
        case "resumeUsageLimit":
          return await resumeUsageLimit(request.conversationId);
        case "journaled": {
          const chat = await open(request.conversationId);
          await caughtUp(chat);
          return { journaled: await transcriptHasPrompt(chat, request.requestId) };
        }
        case "sendFailed":
          options.emit({
            conversationId: request.conversationId,
            events: [{ type: "send_failed", requestId: request.requestId, message: request.message }],
          });
          return { ok: true };
        case "welcome":
          await welcome(request.conversationId, request.message);
          return { ok: true };
        case "files":
          return linkedFiles(request.conversationId);
        case "journal": {
          const opened = await chats.get(request.conversationId)?.catch(() => undefined);
          opened?.journalAdvanced?.();
          return { ok: true };
        }
        case "brain":
          if (request.fresh) expireBrain(request.conversationId);
          return brainPlacement(request.conversationId);
        case "move":
          return moveBrain(request.conversationId, request.target);
      }
    },
    async terminateCommands(): Promise<void> {
      await environments.terminateCommands(context);
    },
    async close(): Promise<void> {
      for (const conversationId of chats.keys()) claudeCodeEngine?.close(conversationId);
      const opened = await Promise.all([...chats.values()].map((chat) => chat.catch(() => undefined)));
      chats.clear();
      for (const chat of opened) {
        if (!chat) continue;
        clearInterval(chat.idleCheck);
        clearInterval(chat.followCheck);
        await chat.mirror?.stop();
        await chat.localLog?.stop();
        await chat.stream?.stop().catch(() => undefined);
        await chat.harness.close(context).catch(() => undefined);
      }
      await environments.cleanup(context);
    },
  };
}

export type DesktopChats = ReturnType<typeof desktopChats>;
