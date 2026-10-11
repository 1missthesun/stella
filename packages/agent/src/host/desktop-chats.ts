/**
 * The desktop's chats on pi-durable: one harness per Stella conversation, on
 * its own SQLite file under `<data dir>/agent/`, opened on first use and kept
 * open so its agents keep running between turns. The runtime worker serves
 * `PiChatRequest`s with it and forwards a watched conversation's events to
 * the app (`@stella/contracts/pi-chat`).
 */
import { CLAUDE_USAGE_LIMIT_RESUMED_TEXT, type ClaudeUsageLimitCard } from "@stella/contracts/claude-usage-limit";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message, ModelThinkingLevel, TextContent } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  ConversationBusy,
  defineDoc,
  LiveDoc,
  watchEvents,
  type AgentEventStream,
  type Conversation,
  type ConversationId,
  type EntryId,
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
import { PLACED_AGENT_PAUSED } from "../stella/agents.ts";
import type { AgentMessageDelivery, AgentPauseResult } from "@stella/contracts/backend/agent-threads";
import type { ExecutionContextSnapshot, ExecutionDestination } from "@stella/contracts/execution-context";
import { extractLocalFileLinkPaths } from "@stella/contracts/local-file-links";
import { splitReplyRefs } from "@stella/contracts/reply-refs";
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
  type PiUserMessage,
} from "@stella/contracts/pi-chat";
import type { DeviceSigner } from "@stella/runtime/kernel/home/device";
import {
  offersAgentTools,
  openStellaHarness,
  type OpenStellaHarness,
  orchestratorAgent,
  STELLA_DEFAULT_ALIAS,
  stellaModelRef,
} from "../harness.ts";
import {
  agentRunOutcome,
  noteRemoteReport,
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
import {
  accountByokProvider,
  accountProviderModel,
  accountProviderOfRegistryId,
  accountRegistryId,
  isAccountProviderId,
} from "../provider/account-byok.ts";
import { openBunSqliteStorage } from "../storage/bun-sqlite.ts";
import { isDeviceToolName } from "@stella/contracts/turn-plane/device-tools";
import { deviceRefusal } from "../stella/execution.ts";
import { placementOf, StellaPlacementDoc, type StellaPlacement } from "../stella/placement.ts";
import { desktopAgentsHost, desktopEnvironments } from "./desktop-agents.ts";
import {
  desktopCoding,
  desktopExecution,
  type DesktopBrain,
  type DesktopExecution,
  type DesktopExecutionRemote,
} from "./desktop-execution.ts";
import type { PiBrainRecord } from "@stella/contracts/turn-plane/pi-brain";
import { journalMirror, type DesktopJournal, type JournalMirror } from "./desktop-journal.ts";
import { localLogMirror, writtenReply, type DesktopLocalLog, type LocalLogMirror } from "./desktop-local-log.ts";
import { desktopGatewayAccess, resolveStellaModels } from "./desktop-gateway.ts";
import { desktopContextSources } from "./desktop-sources.ts";
import { stopStella } from "../stella/stop.ts";
import type { ClaudeCodeEngine, ClaudeCodeStatus } from "../engine/claude-code.ts";
import { CLAUDE_CODE_PROVIDER_ID, onClaudeCode } from "../engine/selection.ts";

/** The newest entries a client gets when it attaches, and per older page. */
const HISTORY_PAGE = 200;
/** A page of entries over IPC stays small enough to parse off the frame budget. */
const CLIENT_PAGE_BYTES = 2 * 1024 * 1024;
/** How far back a voice call's history reaches, in entries. */
const VOICE_HISTORY_ENTRIES = 200;
/** How far back the files a conversation linked are looked for, in entries. */
const LINKED_FILE_ENTRIES = 500;
/** How long a turn waits for other devices' turns to be imported before it starts. */
const JOURNAL_CATCH_UP_MS = 3_000;
/** How often an open conversation is checked for being idle again. */
const IDLE_CHECK_MS = 30_000;
/** How often the journal is read while a turn runs elsewhere, or while one here can be stopped from elsewhere. */
const FOLLOW_MS = 2_000;
/** How long after a turn is placed elsewhere the journal is read that often, until the turn shows. */
const FOLLOW_WINDOW_MS = 60_000;
/** How long where a conversation's brain runs is trusted before it is read again. */
const BRAIN_TTL_MS = 5_000;
/** How long a moved brain's brief waits for Stella's turn here to end. */
const BRAIN_HANDOFF_WAIT_MS = 5 * 60_000;
/** How long the owner's device list and media access are trusted before they are read again. */
const EXECUTION_CONTEXT_TTL_MS = 30_000;
/** Until signed in, recovered work retries the provider this often. */
const PROVIDER_RETRY_MS = 5_000;
/** How long the agents' directory waits for the cloud; a message waits out the cloud's own device wait. */
const DIRECTORY_TIMEOUT_MS = 5_000;
const AGENT_MESSAGE_TIMEOUT_MS = 15_000;

export type DesktopChatsOptions = {
  /** The Stella data directory (`~/.stella`). */
  dataDir: string;
  deviceId?: string;
  /** Where this computer's agents work by default. */
  workspace: string;
  siteAuth(): { baseUrl: string; authToken: string } | null;
  refreshAuthToken?(): Promise<string | null | undefined>;
  getDeviceSigner(): Promise<DeviceSigner> | DeviceSigner;
  memoryEnabled?(): boolean;
  /** The owner's devices and media access, as the app reads them; the destination is this computer's own. */
  executionContext?(): Promise<ExecutionContextSnapshot | undefined>;
  /** The model the user picked for the orchestrator (`stella/<alias>`, or another provider's). */
  stellaModel?(): string | undefined;
  /** The keys the user brought for other providers' models (BYOK), as the app keeps them. */
  credentials?: StellaCredentialAccess;
  /**
   * A pick on the user's own key resolved through the app's model registry,
   * the one the model picker lists (models.json and extension providers,
   * builtin overrides). Absent, such picks run on pi-ai's builtin providers only.
   */
  resolveDirectModel?: DirectModelResolver;
  /** The orchestrator's thinking level, from the user's reasoning effort. */
  thinkingLevel?(): ModelThinkingLevel;
  /** Stella's own tools (web, html, image_gen, ask_user, …) for one conversation. */
  tools?(conversationId: string): StellaToolHost;
  /** The cloud journal of a conversation stored in the cloud, which its turns are mirrored into. */
  journal?(conversationId: string): DesktopJournal | undefined;
  /** For a conversation stored in the cloud: its cloud agents, run in its object. */
  cloudAgents?(conversationId: string): RemoteAgentHost | undefined;
  claudeCodeEngine?: ClaudeCodeEngine;
  userReminders?(input: {
    conversationId: string;
    text: string;
    sentAt: number;
    previousUserAt?: number;
    timezone?: string;
  }): Promise<string[]>;
  /**
   * For a conversation stored in the cloud: cloud agents started with a
   * model, run as the owner's agent threads on that model (a Stella model,
   * Codex, Claude Code, a model on a key saved to the account); their
   * reports come back as `deliverReport`s.
   */
  cloudThreads?(conversationId: string): DesktopEngineAgents | undefined;
  /**
   * For a conversation stored in the cloud: how its tools reach the owner's
   * other computers and a cloud container, once they are moved there.
   */
  execution?(conversationId: string): DesktopExecutionRemote | undefined;
  /**
   * For a conversation stored in the cloud: where its brain runs, as its
   * object records it. Once that names another host, this computer takes
   * none of its turns while that host can take them.
   */
  brain?(conversationId: string): DesktopBrain | undefined;
  /** The chats on this computer, newest first, which agents list and message as sessions. */
  localSessions?(): Array<{ conversationId: string; title: string; updatedAt: number }>;
  /**
   * The owner's agent threads in the cloud, once signed in: a conversation's
   * agents elsewhere and the user's cloud sessions, and a note for one of
   * them. A chat kept on this computer never reaches them.
   */
  agentThreads?: {
    directory(conversationId: string): Promise<{ agents: AgentDirectoryAgentRow[]; sessions: AgentDirectorySessionRow[] }>;
    message(args: { messageId: string; to: string; text: string; from: AgentMessageSender }): Promise<AgentMessageDelivery>;
    pause(args: { conversationId: string; threadId: string; controlRequestId: string }): Promise<AgentPauseResult>;
    note(args: { noteId: string; conversationId: string; fromThreadId: string; text: string }): Promise<void>;
  };
  /**
   * One of Stella's agents, or one of theirs, started work (a spawn or a
   * follow-up: `attempt` counts them). `parentThreadId` names the agent that
   * started it; absent for Stella's own.
   */
  agentStarted?(agent: {
    conversationId: string;
    threadId: string;
    description: string;
    attempt: number;
    parentThreadId?: string;
  }): void;
  /**
   * An agent another agent started finished a run: it answered, failed, or
   * was paused before it answered. Its report goes to the agent that started
   * it; this is for the owner's records. Stella's own end in `agentReported`
   * and `agentPaused`.
   */
  agentRunEnded?(agent: { conversationId: string; threadId: string; interrupted: boolean }): void;
  subagentEnded?(agent: {
    conversationId: string;
    threadId: string;
    parentThreadId: string;
    attempt: number;
    outcome: "completed" | "failed" | "paused";
    text?: string;
  }): void;
  /**
   * An agent finished and reported to Stella (the app shows a notification).
   * `running`: a message since has it working again, so `attempt` is that
   * newer run's and still open.
   */
  agentReported?(agent: {
    conversationId: string;
    threadId: string;
    description: string;
    /** How the run it reports ended. */
    status: AgentAttemptOutcome;
    failed: boolean;
    report: string;
    attempt: number;
    running: boolean;
  }): void;
  /** One of Stella's agents was paused before it answered; Stella is not told (`StellaAgentsHost.agentPaused`). */
  agentPaused?(agent: { conversationId: string; threadId: string; description: string; attempt: number }): void;
  /**
   * For a conversation kept on this computer: the agent loops' chat log,
   * which the Claude Code engine answers from. Its turns are mirrored both
   * ways, so the conversation stays one across engines.
   */
  localLog?(conversationId: string): DesktopLocalLog | undefined;
  /** A watched conversation's events, for every attached client. */
  emit(payload: PiChatEventsPayload): void;
  report(error: unknown): void;
};

/** Agents another runtime runs as a whole (`DesktopChatsOptions.cloudThreads`). */
export type DesktopEngineAgents = {
  /** Start one, once per `key`, on `model`. */
  start(args: { key: string; description: string; prompt: string; model: string }): Promise<{ threadId: string }>;
  /** Another message for it: steers it while it runs, or starts its next run. */
  message(args: { key: string; threadId: string; description: string; message: string }): Promise<"steered" | "resumed">;
  status(threadId: string): Promise<string>;
  pause(threadId: string): Promise<void>;
};

type Chat = {
  harness: Harness;
  root: Conversation;
  refreshTools(): void;
  startAgent: OpenStellaHarness["startAgent"];
  agentRecords: OpenStellaHarness["agentRecords"];
  messageAgent: OpenStellaHarness["messageAgent"];
  pauseAgent: OpenStellaHarness["pauseAgent"];
  agentStanding: OpenStellaHarness["agentStanding"];
  runPlacedAgent: OpenStellaHarness["runPlacedAgent"];
  steerPlacedAgent: OpenStellaHarness["steerPlacedAgent"];
  /** For a conversation stored in the cloud: its journal mirror. */
  mirror?: JournalMirror;
  /** For a conversation kept on this computer: its chat log mirror. */
  localLog?: LocalLogMirror;
  /** Where its tools run when they are not on this computer. */
  execution: DesktopExecution;
  stream?: AgentEventStream;
  watchers: number;
  idleCheck: ReturnType<typeof setInterval>;
  /** Reads the journal closely while a turn runs elsewhere (`follow`). */
  followCheck: ReturnType<typeof setInterval>;
  followUntil: number;
};

const context = BACKGROUND_CONTEXT;

/** The engine id of cloud agents started with a model (`cloudThreads`). */
const CLOUD_THREAD_ENGINE = "cloud-thread";

/** The response language a conversation's latest message asked for, so it holds across restarts. */
const LocaleDoc = defineDoc<{ locale?: string }>({
  kind: "stella.locale",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({}),
});

/**
 * Stella's own tools for one conversation: her Read reads where her tools
 * run, this computer or wherever `switch_destination` moved them.
 */
const placedTools = (tools: StellaToolHost, execution: DesktopExecution, chat: () => Chat | undefined): StellaToolHost => ({
  specs: (role) => tools.specs(role),
  run: async (call, context) => {
    const opened = chat();
    if (call.role === "orchestrator" && isDeviceToolName(call.name) && opened) {
      const placement = placementOf(await opened.harness.snapshot(StellaPlacementDoc, opened.root.id, context));
      if (placement && placement.kind !== "local") {
        return await execution.run(
          placement,
          { piConversationId: opened.root.id, callId: call.callId, toolName: call.name, params: call.args },
          context,
        );
      }
    }
    return await tools.run(call, context);
  },
});

/** A conversation id as a file name. */
const fileName = (conversationId: string): string => {
  const safe = conversationId.replace(/[^A-Za-z0-9_.-]/g, "_");
  if (!safe || safe.startsWith(".")) throw new Error(`Invalid conversation id: ${conversationId}`);
  return `${safe}.sqlite`;
};

export function desktopChats(options: DesktopChatsOptions) {
  const chats = new Map<string, Promise<Chat>>();
  /**
   * The owner's devices and media access for every conversation's prompt,
   * read once per `EXECUTION_CONTEXT_TTL_MS`: the first request waits for it,
   * later ones get the last answer while a newer one loads, and a failed
   * read keeps the last answer, so a moment offline does not rewrite the prompt.
   */
  let executionContextRead: { snapshot?: ExecutionContextSnapshot; at: number; pending?: Promise<void> } = { at: 0 };
  const sharedExecutionContext = async (): Promise<ExecutionContextSnapshot | undefined> => {
    const loadOnce = () =>
      (executionContextRead.pending ??= (async () => {
        const snapshot = await options.executionContext?.().catch(() => undefined);
        executionContextRead = {
          snapshot: snapshot?.devicesKnown || !executionContextRead.snapshot ? snapshot : executionContextRead.snapshot,
          at: Date.now(),
        };
      })());
    if (executionContextRead.at === 0) await loadOnce();
    else if (Date.now() - executionContextRead.at >= EXECUTION_CONTEXT_TTL_MS) void loadOnce();
    return executionContextRead.snapshot;
  };
  /** The conversation each agent placed here runs in, by its key at the placing host. */
  const placedIn = new Map<string, string>();
  /** Runs of agents placed here, until they settle, so the host that placed one can stop it. */
  const placedRuns = new Map<string, { runKey: string; cancel: AbortController }>();
  const directory = path.join(options.dataDir, "agent");

  // Conversations with work in flight, so a new runtime process resumes
  // them without waiting for a window to open them.
  const activeFile = path.join(directory, "active.json");
  let active: Promise<Set<string>> | undefined;
  /** The same set once read, for `busy()`. */
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
  // Stella's agents by thread id, to their conversation: a message from
  // another device (a paired phone) names only the thread.
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
  const environments = desktopEnvironments(options.workspace);
  /**
   * Where each conversation stored in the cloud has its brain, as last read,
   * and the host that takes this computer's turns for it now (null: here).
   */
  const brains = new Map<string, { record: PiBrainRecord | null; host: PiBrainRecord | null; at: number }>();
  /** The record's host, unless that is this computer. */
  const otherHost = (record: PiBrainRecord | null) =>
    record && !(record.host === "device" && record.deviceId === options.deviceId) ? record : null;
  /**
   * The host this computer's turns for the conversation go to: the one its
   * record names, while that host can take them. With no record, or one
   * naming a host that can't now (a computer offline or not ready, the cloud
   * out of reach), null: the sender's host answers, as with no record, and
   * the record stays for once that host is back.
   */
  const brainHost = async (conversationId: string): Promise<PiBrainRecord | null> => {
    const known = brains.get(conversationId);
    if (known && Date.now() - known.at < BRAIN_TTL_MS) return known.host;
    const brain = options.brain?.(conversationId);
    if (!brain) return null;
    let record: PiBrainRecord | null;
    try {
      record = await brain.read();
    } catch {
      // The cloud is out of reach (offline, signed out), and so is every host it would pass a turn to.
      brains.set(conversationId, { record: known?.record ?? null, host: null, at: Date.now() });
      return null;
    }
    let host = otherHost(record);
    if (host?.host === "device") {
      const { deviceId, label } = host;
      const listed = await options.execution?.(conversationId)?.devices().catch(() => undefined);
      const device = listed?.find((entry) => entry.deviceId === deviceId);
      if (!device || deviceRefusal(device, label ?? deviceId)) host = null;
    }
    brains.set(conversationId, { record, host, at: Date.now() });
    return host;
  };
  /** Whether this computer takes the conversation's turns, or where a send goes instead. */
  const brainPlacement = async (conversationId: string): Promise<PiChatBrainResult> => {
    const host = await brainHost(conversationId);
    if (!host) return { here: true };
    return host.host === "cloud"
      ? { here: false, target: { mode: "cloud" } }
      : { here: false, target: { mode: "device", deviceId: host.deviceId }, ...(host.label ? { label: host.label } : {}) };
  };
  /**
   * What Stella reads hidden and the user did not write (an agent's report
   * or note) for a conversation whose brain runs elsewhere: placed there as
   * this computer's sends are, once per `requestId`. False when she runs
   * here, or where she runs can't take it now, for the conversation here to take.
   */
  const noteOnBrain = async (conversationId: string, requestId: string, text: string): Promise<boolean> => {
    const host = await brainHost(conversationId);
    if (!host) return false;
    const brain = options.brain?.(conversationId);
    if (!brain) return false;
    // Another computer's harness counts its own request ids.
    const id = createHash("sha256").update(`${options.deviceId ?? ""}\0${conversationId}\0${requestId}`).digest("hex").slice(0, 48);
    if (!(await brain.note(host, { id: `pi-note:${id}`, text }))) return false;
    // Her answer comes back through the journal.
    const chat = await chats.get(conversationId)?.catch(() => undefined);
    if (chat) chat.followUntil = Date.now() + FOLLOW_WINDOW_MS;
    return true;
  };
  /** The user moving Stella from the app's picker. */
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
  // A model on another provider runs with the key the user stored for it,
  // never one found in this process's environment.
  const models = createModels(
    options.credentials
      ? { credentials: stellaCredentialStore(options.credentials), authContext: storeOnlyAuthContext }
      : {},
  );
  const byok = byokModels(models, options.resolveDirectModel);
  /**
   * Claude Code turns held until the Claude usage limit resets, by
   * conversation and session (Stella's turn or one of its agents): the chat
   * shows one waiting card while any is held, and one line when the last
   * resumes. A restart drops this and it fills back up: this computer's
   * held turns re-run, meet the limit and hold again, and the cloud's holds
   * are read back from its journal when the conversation opens.
   */
  const usageLimitHolds = new Map<string, Map<string, number | undefined>>();
  const usageLimitEvent = (conversationId: string): PiChatEvent | undefined => {
    const holds = usageLimitHolds.get(conversationId);
    if (!holds || holds.size === 0) return undefined;
    const known = [...holds.values()].filter((until): until is number => until !== undefined);
    const until = known.length > 0 ? Math.max(...known) : undefined;
    return {
      type: "engine_status",
      state: "usage-limit",
      text: "Claude usage limit reached. Held work continues when it resets.",
      ...(until !== undefined ? { until } : {}),
    };
  };
  const noteUsageLimit = (
    conversationId: string,
    sessionKey: string,
    status: Extract<ClaudeCodeStatus, { state: "usage-limit" | "usage-limit-end" }>,
  ) => {
    const holds = usageLimitHolds.get(conversationId) ?? new Map<string, number | undefined>();
    let event: PiChatEvent | undefined;
    if (status.state === "usage-limit") {
      holds.set(sessionKey, status.until);
      usageLimitHolds.set(conversationId, holds);
      event = usageLimitEvent(conversationId);
    } else {
      if (!holds.delete(sessionKey)) return;
      if (holds.size > 0) return;
      usageLimitHolds.delete(conversationId);
      event = { type: "engine_status", state: "usage-limit-end", text: status.text, resumed: status.resumed };
    }
    if (event) options.emit({ conversationId, events: [event] });
  };
  /**
   * A hold the cloud journaled: Stella's cloud turn or a cloud agent waiting
   * on the Claude usage limit. A hold whose reset passed long ago, or a
   * resume from long ago, is history an import replays, not news.
   */
  const CLOUD_USAGE_LIMIT_STALE_MS = 15 * 60_000;
  const noteCloudUsageLimit = (conversationId: string, card: ClaudeUsageLimitCard, at: number) => {
    const key = `cloud:${card.threadId ?? "stella"}`;
    const now = Date.now();
    if (card.state === "held") {
      if (card.until !== undefined && card.until < now - CLOUD_USAGE_LIMIT_STALE_MS) return;
      noteUsageLimit(conversationId, key, {
        state: "usage-limit",
        text: "",
        ...(card.until !== undefined ? { until: card.until } : {}),
      });
      return;
    }
    noteUsageLimit(conversationId, key, {
      state: "usage-limit-end",
      text: CLAUDE_USAGE_LIMIT_RESUMED_TEXT,
      resumed: now - at < CLOUD_USAGE_LIMIT_STALE_MS,
    });
  };
  const claudeCodeEngine = options.claudeCodeEngine;
  if (claudeCodeEngine) {
    models.setProvider(claudeCodeEngine.provider());
    claudeCodeEngine.onProviderChange((provider) => models.setProvider(provider));
    claudeCodeEngine.onStatus((session, status) => {
      if (status.state === "usage-limit" || status.state === "usage-limit-end") {
        noteUsageLimit(session.conversationId, session.sessionKey, status);
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
    // An agent's Claude Code CLI took up a background command that finished:
    // the agent is woken for it, as for one of Stella's own shells, unless
    // the user paused or stopped it.
    claudeCodeEngine.onBackgroundWake((session, wake) => {
      const threadId = session.threadId;
      if (!threadId) return;
      void (async () => {
        const chat = await ready(session.conversationId);
        const record = await chat.agentStanding(threadId, context);
        if (!record || record.agentStatus === "paused" || record.agentStatus === "canceled") return;
        await chat.messageAgent({ key: `claude-code-wake:${wake.key}`, threadId, message: wake.text, fromOrchestrator: true }, context);
      })().catch((error: unknown) => options.report(error));
    });
  }
  let gateway: Promise<{ access: StellaGatewayAccess; gatewayOrigin: string }> | undefined;
  /** Each Stella model alias in use, resolved for the orchestrator and agents. */
  const specsByAlias = new Map<string, Promise<StellaModelSpec[]>>();

  /** The model gateway, once the user is signed in. */
  const ensureGateway = () =>
    (gateway ??= (async () => {
      const site = options.siteAuth();
      if (!site) throw new Error("Sign in to Stella to chat.");
      const baseUrl = site.baseUrl.replace(/\/+$/, "");
      const catalog = (await (await fetch(`${baseUrl}/api/stella/models`)).json()) as { gateway?: { origin?: string } };
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

  /** The `stella` provider with an alias's models among the ones it offers. */
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

  /** Whether this computer holds its own key (or sign-in) for a provider. */
  const hasOwnKey = async (provider: string, modelId: string): Promise<boolean> => {
    const stored =
      (await options.credentials?.apiKey(provider))?.trim() || (await options.credentials?.oauthToken(provider))?.trim();
    if (stored) return true;
    const route = options.resolveDirectModel?.(`${provider}/${modelId}`);
    if (!route || "error" in route) return false;
    return route.credentialless === true || Boolean((await route.getApiKey())?.trim());
  };

  /** Models on the account's keys this computer runs, by provider. */
  const accountModels = new Map<string, NonNullable<ReturnType<typeof accountProviderModel>>[]>();
  /**
   * A model on a provider key saved to the account, for a provider this
   * computer has no key of its own for: its requests go through the model
   * gateway's BYOK lane on this computer's session, and the key stays on
   * the server.
   */
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

  /** The model a pick runs on, for the orchestrator or an agent: a Stella alias, or a model on the user's own key (or the account's). */
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

  /** The orchestrator's model for the user's pick. */
  const pickedModel = (): Promise<ModelRef> => modelOfPick(parseModelPick(options.stellaModel?.()), "orchestrator");

  /**
   * What an agent its caller named `requested` for runs on here: Claude Code
   * as a whole, or a model pi runs (a Stella alias, a model on the user's own
   * key or plan), with an optional `:<effort>`. Anything else fails; it never
   * runs on another model.
   */
  const agentModel = async (
    conversationId: string,
    requested: string,
    placement?: StellaPlacement,
  ): Promise<AgentModelChoice> => {
    if (placement?.kind === "cloud") {
      if (!options.cloudThreads?.(conversationId)) throw new Error("This conversation can't start cloud agents on a chosen model.");
      return { engine: CLOUD_THREAD_ENGINE };
    }
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
    const model = await modelOfPick(pick, "general");
    const thinkingLevel = (effort?.[2] as ModelThinkingLevel | undefined) ?? options.thinkingLevel?.();
    return { runsOn: { model, ...(thinkingLevel ? { thinkingLevel } : {}) } };
  };

  /**
   * A conversation's agents on another engine as its Stella reaches them: a
   * message one takes mid-run, and a pause, settle what Stella waits for, as
   * its reports do (`noteEngineReport`).
   */
  const engineHost = (
    engine: DesktopEngineAgents | undefined,
    defaultModel: string,
    chat: () => Chat | undefined,
  ): RemoteAgentHost | undefined => {
    if (!engine) return undefined;
    const settle = async (threadId: string, requestId: string, status?: "paused") => {
      const opened = chat();
      if (!opened) return;
      await opened.harness.commit(
        (tx) => noteRemoteReport(tx, opened.root.id, { threadId, requestId, ...(status ? { status } : {}) }),
        context,
      );
    };
    const descriptionOf = async (threadId: string) => {
      const opened = chat();
      const agents = opened ? (await opened.harness.snapshot(StellaAgentsDoc, opened.root.id, context))?.agents : undefined;
      return agents?.[threadId]?.description ?? threadId;
    };
    return {
      start: async ({ key, description, prompt, model }) =>
        await engine.start({ key, description, prompt, model: model ?? defaultModel }),
      message: async ({ key, threadId, message }) => {
        const description = await descriptionOf(threadId);
        if ((await engine.message({ key, threadId, description, message })) === "steered") {
          await settle(threadId, `steered:${key}`);
        }
      },
      status: async (threadId) => await engine.status(threadId),
      pause: async (threadId) => {
        await engine.pause(threadId);
        await settle(threadId, `paused:${threadId}:${Date.now()}`, "paused");
      },
    };
  };

  /** A report for one of the conversation's Claude Code agents counts as that agent's answer. */
  const noteEngineReport = async (conversationId: string, report: { requestId: string; text: string }) => {
    const threadId = /\nthread_id: (\S+)/.exec(report.text)?.[1];
    if (!threadId) return;
    const chat = await ready(conversationId);
    const agent = (await chat.harness.snapshot(StellaAgentsDoc, chat.root.id, context))?.agents[threadId];
    if (!agent?.engine) return;
    await chat.harness.commit(
      (tx) => noteRemoteReport(tx, chat.root.id, { threadId, requestId: report.requestId, text: report.text }),
      context,
    );
  };

  /** A model a conversation or one of its agents is on, ready to run (after a restart too). */
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

  /** The alias a conversation's agent runs on. */
  const aliasOf = (model: { modelId: string } | undefined): string =>
    (model && parseStellaModelId(model.modelId)?.alias) || STELLA_DEFAULT_ALIAS;

  /** The provider, retried until the user is signed in. */
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

  /** Settles as `work` does, or fails once `ms` pass. */
  const within = <T,>(work: Promise<T>, ms: number, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  };

  /**
   * Who a conversation's agents reach beyond its own harness: the other
   * chats on this computer and their Stellas' agents, and, for a
   * conversation stored in the cloud, the owner's agent threads (its agents
   * elsewhere, the user's cloud sessions).
   */
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
      list: async () => {
        const local = localSessions();
        if (!cloud) return { agents: [], sessions: local };
        try {
          const remote = await within(cloud.directory(conversationId), DIRECTORY_TIMEOUT_MS, "Stella's cloud did not answer.");
          // A chat here keeps the title this computer has and the cloud's place.
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
          return { agents: remote.agents, sessions: [...sessions.values()] };
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
          // Another chat here: its Stella reads the note as its next turn, and the user does not see it.
          if (chats.has(to) || localSessions().some((row) => row.conversationId === to)) {
            if (await noteOnBrain(to, `agent-note:${id}`, framed)) return { delivered: "queued", threadId: to };
            const chat = await ready(to);
            const note: TextContent & { stella: { hidden: true } } = { type: "text", text: framed, stella: { hidden: true } };
            await chat.root.submit({ type: "input", content: [note], whenBusy: "followUp", requestId: `agent-note:${id}` }, context);
            return { delivered: "queued", threadId: to };
          }
          // One of another chat's agents here: it reaches the agent as that chat's Stella's messages do.
          const home = (await threadIndex())[to];
          if (home && home !== conversationId) {
            const chat = await ready(home);
            const record = await chat.agentStanding(to, context);
            if (record) {
              await chat.messageAgent({ key: `note:${id}`, threadId: to, message: framed, fromOrchestrator: true }, context);
              return { delivered: record.status === "running" ? "steered" : "resumed", threadId: to };
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
      pause: async ({ key, threadId }) => {
        // Another chat's agent here stops here; any other agent stops where it runs.
        if ((await pauseLocalAgent(threadId)) === "paused") {
          return { threadId, outcome: "paused", status: "paused", attemptGeneration: 0, where: "on this computer" };
        }
        if (!cloud) {
          throw new Error(`No agent ${threadId} on this computer. This chat is stored only on this computer, so it can pause only agents here.`);
        }
        const id = createHash("sha256").update(`${options.deviceId ?? ""}\0${conversationId}\0${key}`).digest("hex").slice(0, 48);
        return await within(
          cloud.pause({ conversationId, threadId, controlRequestId: `pi-pause:${id}` }),
          AGENT_MESSAGE_TIMEOUT_MS,
          "Stella's cloud did not answer, so the pause may not have reached the agent. Check agent_status.",
        );
      },
    };
  };

  /** Pause one of Stella's agents on this computer, whichever chat started it. */
  const pauseLocalAgent = async (threadId: string): Promise<"paused" | "not_running" | "not_found"> => {
    const conversationId = (await threadIndex())[threadId];
    if (!conversationId) return "not_found";
    const chat = await ready(conversationId);
    const record = await chat.agentStanding(threadId, context);
    if (!record) return "not_found";
    if (record.status !== "running") return "not_running";
    claudeCodeEngine?.abort(conversationId, { threadId });
    await chat.pauseAgent(threadId, context);
    return "paused";
  };

  const open = (conversationId: string): Promise<Chat> => {
    let chat = chats.get(conversationId);
    if (!chat) {
      let opened: Chat | undefined;
      chat = (async () => {
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, fileName(conversationId));
        const storage = await openBunSqliteStorage(file);
        const remote = options.execution?.(conversationId);
        const brain = options.brain?.(conversationId);
        const execution = desktopExecution({
          conversationId,
          ...(options.deviceId ? { deviceId: options.deviceId } : {}),
          localOnly: conversationId.startsWith("local_"),
          ...(remote ? { remote } : {}),
          ...(brain ? { brain } : {}),
          // Stella's brief continues elsewhere once her turn here has ended.
          turnEnded: async () => {
            const deadline = Date.now() + BRAIN_HANDOFF_WAIT_MS;
            while (Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 1_000));
              if (opened && (await opened.harness.snapshot(LiveDoc, opened.root.id, context))?.run === undefined) return;
            }
          },
          brainMoved: (record) => brains.set(conversationId, { record, host: otherHost(record), at: Date.now() }),
          report: options.report,
        });
        const destination: ExecutionDestination = {
          kind: "device",
          deviceId: options.deviceId ?? "this-computer",
          label: "This computer",
        };
        const {
          harness,
          refreshTools,
          startAgent,
          agentRecords,
          messageAgent,
          pauseAgent,
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
              const cloud = options.cloudAgents?.(conversationId);
              const { agentStarted, agentReported, agentPaused, subagentEnded, agentRunEnded } = options;
              /** How many runs Stella has given one of its agents: the attempt a run is. */
              const attempts = async (threadId: string) => {
                if (!opened) return 1;
                const state = await opened.harness.snapshot(StellaAgentsDoc, opened.root.id, context);
                return Math.max(1, Object.values(state?.calls ?? {}).filter((call) => call.threadId === threadId).length);
              };
              const engines = new Map<string, RemoteAgentHost>();
              const cloudThreads = engineHost(options.cloudThreads?.(conversationId), "default", () => opened);
              if (cloudThreads) engines.set(CLOUD_THREAD_ENGINE, cloudThreads);
              return desktopAgentsHost({
                ...(options.deviceId ? { deviceId: options.deviceId } : {}),
                ...(cloud ? { cloud } : {}),
                agentModel: (requested, _caller, placement) => agentModel(conversationId, requested, placement),
                engine: (id) => engines.get(id),
                directory: directoryFor(conversationId),
                dataDir: options.dataDir,
                execution: execution.host,
                ensureModel: (model) => ensureModel(model),
                beginAgentRun: async (run) => {
                  if (!opened) return;
                  // An agent's own agent: listed under the agent that started it.
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
                  const agent = (await opened.harness.snapshot(StellaAgentsDoc, opened.root.id, context))?.agents[run.threadId];
                  agentStarted?.({
                    conversationId,
                    threadId: run.threadId,
                    description: agent?.description ?? run.threadId,
                    attempt: await attempts(run.threadId),
                  });
                },
                // Stella's own end when their reports reach her (`agentReported`, `agentPaused`).
                ...(subagentEnded || agentRunEnded
                  ? {
                      endAgentRun: async (run, _context, end) => {
                        const outcome = agentRunOutcome(end);
                        agentRunEnded?.({ conversationId, threadId: run.threadId, interrupted: outcome === undefined });
                        if (!run.parentThreadId || !outcome || !subagentEnded) return;
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
                  if (await noteOnBrain(conversationId, report.requestId, report.text)) return;
                  // The harness is open by then: reports run once it resumes.
                  const root = await harness.conversation(report.rootConversationId, context);
                  await root?.submit(
                    { type: "input", content: report.text, whenBusy: "followUp", requestId: report.requestId },
                    context,
                  );
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
                  // Read by the model, never shown: the user did not write it.
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
                ...(agentPaused
                  ? {
                      agentPaused: async (agent) => {
                        agentPaused({ conversationId, ...agent, attempt: await attempts(agent.threadId) });
                      },
                    }
                  : {}),
              });
            })(),
            ...(options.tools ? { tools: placedTools(options.tools(conversationId), execution, () => opened) } : {}),
            // An agent's file and shell tools run here, or wherever its tools were moved.
            extensions: [
              desktopCoding(execution.run),
              ...(claudeCodeEngine ? [claudeCodeEngine.extension(conversationId)] : []),
            ],
            env: environments.env,
            onReport: options.report,
          },
          context,
        );
        const orchestrator = orchestratorAgent(stellaModelRef("orchestrator"));
        const root = await harness.root(context, { agent: orchestrator });
        // A conversation from an older build keeps up with what the orchestrator is offered.
        if (offersAgentTools(await root.agent(context))) await root.configure(orchestrator, context);
        // A conversation kept on this computer starts with what the agent
        // loops' chat log holds (imported as the mirror starts), and keeps up with it.
        const log = options.localLog?.(conversationId);
        const localLog = log ? await localLogMirror({ harness, root, log, report: options.report, context }) : undefined;
        // Recovered work needs its models: a Stella alias waits for sign-in; a
        // model on the user's own key is ready at once.
        const rootModel = (await root.agent(context)).model;
        /** The Stella aliases the orchestrator and its unfinished agents run on. */
        const aliases = new Set<string>();
        /** Models on the account's keys, which need the gateway as Stella's aliases do. */
        const accountRefs: ModelRef[] = [];
        for (const agent of Object.values((await harness.snapshot(StellaAgentsDoc, root.id, context))?.agents ?? {})) {
          if (agent.remote) continue;
          const model = (await (await harness.conversation(agent.conversationId as ConversationId, context))?.agent(context))?.model;
          if (model && accountProviderOfRegistryId(model.provider)) accountRefs.push(model);
          else if (model && model.provider !== STELLA_PROVIDER_ID) restoreOwnModel(model);
          // A finished agent's alias is registered when it is next messaged.
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
              // A turn running elsewhere shows as running to whoever watches.
              onRemoteTurns: (turns) => {
                if (opened?.watchers) options.emit({ conversationId, events: [{ type: "remote_turns", turns }] });
              },
              // The cloud's holds show as this computer's own do.
              onUsageLimit: (card, at) => noteCloudUsageLimit(conversationId, card, at),
              context,
            })
          : undefined;
        void mirror?.importNow().catch((error: unknown) => options.report(error));
        const idleCheck = setInterval(() => {
          void (async () => {
            const inspection = await harness.inspect(context);
            // A cloud agent still working is work here too: its report comes
            // back through the journal, for this computer to answer.
            const awaitingCloud = mirror
              ? (await agentRecords(context)).some((agent) => agent.placement.kind === "cloud" && agent.status === "running")
              : false;
            await markActive(
              conversationId,
              inspection.tasks.length > 0 || inspection.submissions.length > 0 || awaitingCloud,
            );
            // While someone looks at it, or a report is due, what the journal
            // gained shows up here.
            if (opened?.watchers || awaitingCloud) await mirror?.importNow();
          })().catch((error: unknown) => options.report(error));
        }, IDLE_CHECK_MS);
        idleCheck.unref?.();
        let following = false;
        const followCheck = setInterval(() => {
          if (!mirror || following || !opened) return;
          const watched =
            opened.watchers > 0 && (mirror.remoteTurns().length > 0 || Date.now() < opened.followUntil);
          // While a turn of this computer's is open, a Stop from another device ends it here.
          if (!watched && !mirror.turnOpen()) return;
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
          pauseAgent,
          agentStanding,
          runPlacedAgent,
          steerPlacedAgent,
          ...(mirror ? { mirror } : {}),
          ...(localLog ? { localLog } : {}),
          execution,
          watchers: 0,
          idleCheck,
          followCheck,
          followUntil: 0,
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

  /** The newest page of the whole history, ascending; compaction never hides it. */
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

  /**
   * Events as clients receive them, a snapshot's entries cut to its newest
   * page: older context (all of a long conversation's imported history,
   * until pi first compacts it) is paged in like the rest of the history.
   */
  const eventsForClients = (events: readonly PiChatEvent[]): PiChatEvent[] =>
    piEventsForClients(
      events.map((event) =>
        event.type === "snapshot" ? { ...event, entries: piEntriesForClients(event.entries, CLIENT_PAGE_BYTES).entries } : event,
      ),
    );

  /**
   * (Re)attach the conversation's event stream. Every attached client gets
   * the new snapshot as an event, so none misses what happened between the
   * old stream and the new one.
   */
  const attach = async (conversationId: string, chat: Chat): Promise<AgentEventStream> => {
    const previous = chat.stream;
    const stream = await watchEvents(chat.harness, chat.root.id, context);
    chat.stream = stream;
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
    // What another engine said here since shows too.
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

  /**
   * Stella's greeting after onboarding, as a reply in the conversation: the
   * model reads it like its own words, and it stays on this computer, as the
   * agent loops kept it (`localOnly`: the journal mirror skips it).
   */
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

  /**
   * The local files Stella linked in a conversation: in its replies and in
   * its agents' words. Only what Stella wrote grants a paired phone a file,
   * never what a user or a tool said.
   */
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

  /** A turn of this conversation was placed elsewhere: read the journal closely until it shows. */
  const follow = async (conversationId: string): Promise<void> => {
    const chat = await open(conversationId);
    chat.followUntil = Date.now() + FOLLOW_WINDOW_MS;
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
    // Stella answers where her brain is; the app places a send there instead,
    // and sends it here when that host could not take it.
    if (!sent.followSender) {
      const placement = await brainPlacement(conversationId);
      if (!placement.here) throw new Error(elsewhere(placement));
    }
    const chat = await open(conversationId);
    await followPickedModel(chat);
    // The tool catalog follows the runtime's (extension tools come and go).
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
    const input = await withReminders(conversationId, chat, content, sent);
    const submission = await chat.root.submit(
      // A message sent while Stella works joins the run at its next step.
      { type: "input", content: input, requestId, whenBusy: "steer" },
      context,
    );
    return { submissionId: submission.id };
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
    const view = await chat.root.context(context);
    let previousUserAt: number | undefined;
    const shown = new Set<string>();
    for (const message of view.messages) {
      if (message.role !== "user") continue;
      const user = message as unknown as PiUserMessage;
      if (typeof user.content !== "string") {
        for (const part of user.content) if (part.type === "text" && part.stella?.hidden) shown.add(part.text);
      }
      if (piUserView(user).text.trim() && !isPiAgentInput(user)) previousUserAt = user.timestamp;
    }
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
    // The model the user picked: one of Stella's, or one on their own key.
    const model = await pickedModel();
    const agent = await chat.root.agent(context);
    const thinkingLevel = options.thinkingLevel?.() ?? "off";
    const moved = agent.model?.provider !== model.provider || agent.model?.modelId !== model.modelId;
    if (moved || agent.thinkingLevel !== thinkingLevel) {
      await chat.root.configure(
        { model, thinkingLevel, ...(moved ? { extensions: orchestratorAgent(model).extensions } : {}) },
        context,
      );
    }
  };

  /** The conversation open and its model ready, for work the host starts in it. */
  const ready = async (conversationId: string): Promise<Chat> => {
    const chat = await open(conversationId);
    await chat.localLog?.importNow().catch((error: unknown) => options.report(error));
    await ensureModel((await chat.root.agent(context)).model);
    chat.refreshTools();
    await markActive(conversationId, true);
    return chat;
  };

  /** Chats another device placed here, by placement run id, until they settle (`cancelPlacement`). */
  const placements = new Map<string, Placement>();
  type Placement = { chat?: Chat; submission?: Submission; canceled?: true };

  /** Withdraw a placed chat's input while it waits, or stop the run answering it. */
  const stopPlacement = async ({ chat, submission }: Placement) => {
    if (!chat || !submission) return;
    const withdrawn = await chat.harness.abortSubmission(submission.id, context, chat.root.id);
    if (withdrawn === "already_placed") await stopStella(chat.harness, chat.root, context);
  };

  /**
   * A turn the host starts (a schedule fire, a watch escalation, a chat
   * another device placed here): its prompt shown as the user's only when
   * the user wrote it, answered after whatever the conversation is doing.
   * Settles with the answer's text.
   */
  const automation = async (
    conversationId: string,
    turn: {
      requestId: string;
      prompt: string;
      /** The input as prepared (attached images and files); else `prompt`. */
      content?: UserInput;
      visible: boolean;
      rejectIfBusy?: boolean;
      /** A chat another device placed here, cancellable by this id. */
      placementRunId?: string;
      /** The conversation's events while the turn is open (a voice call narrates its tools). */
      observe?: (events: PiChatEvent[]) => void;
    },
  ): Promise<{ status: "ok"; finalText: string } | { status: "busy" | "error"; finalText: ""; error: string }> => {
    const { observe, placementRunId } = turn;
    // A chat placed here is for this computer; anything else waits for where
    // Stella is, unless that host can't take turns now (then it runs here).
    if (!placementRunId) {
      const where = await brainPlacement(conversationId);
      if (!where.here) return { status: "error", finalText: "", error: elsewhere(where) };
    }
    // Before anything awaits, so a cancel that lands while the conversation opens still holds.
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
          // A prompt the user did not write is read by the model, not shown.
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
    // What gets delivered or spoken is the prose, without the reply's citations.
    return { status: "ok", finalText: splitReplyRefs(piMessageText(message)).text.trim() };
  };

  /**
   * What a voice call said, written into the transcript without a run: the
   * user's and the voice model's words as model history the timeline leaves
   * out, and the call's summary, which it shows. Once per `eventId`.
   */
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

  /** The conversation so far as a voice call starts with it: what was said, oldest first. */
  const voiceHistory = async (
    conversationId: string,
  ): Promise<Array<{ role: "user" | "assistant"; content: string; timestamp: number }>> => {
    const chat = await open(conversationId);
    const page = await chat.root.entries({}, VOICE_HISTORY_ENTRIES, undefined, context);
    const items: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
    for (const entry of [...page.items].reverse() as unknown as PiEntry[]) {
      const message = entry.model?.[0];
      if (entry.kind === "pi.user" && message?.role === "user") {
        // What the user typed or said; not the context and notices sent along,
        // an agent's report or note, or a prompt the app wrote.
        const text = piUserView(message).text || ((message as PiUserMessage).source === "voice" ? piMessageText(message) : "");
        if (text.trim() && !isPiAgentText(text)) {
          items.push({ role: "user", content: text, timestamp: message.timestamp });
        }
      } else if (entry.kind === "pi.assistant" && message?.role === "assistant") {
        const text = splitReplyRefs(piMessageText(message)).text.trim();
        if (text.trim()) items.push({ role: "assistant", content: text, timestamp: message.timestamp });
      }
    }
    return items;
  };

  /** An agent the host starts in a conversation (an app-source merge, memory sync). */
  const startAgent = async (
    conversationId: string,
    agent: { key: string; description: string; prompt: string },
  ): Promise<{ threadId: string }> => {
    const chat = await ready(conversationId);
    const { threadId } = await chat.startAgent(agent, context);
    return { threadId };
  };

  /** The conversation's agents, as the app lists them. */
  const agents = async (conversationId: string): Promise<PiChatAgentsResult> => {
    // A conversation pi never ran has no agents of pi's; asking must not open one.
    if (!chats.has(conversationId) && !(await stat(path.join(directory, fileName(conversationId))).catch(() => undefined))) {
      return { agents: [] };
    }
    const chat = await open(conversationId);
    const records = await chat.agentRecords(context);
    return {
      agents: records.map(({ placement: _placement, paused: _paused, ...agent }) => agent),
    };
  };

  /** What the user typed into one agent's thread, delivered once per `key`. */
  const messageAgent = async (
    conversationId: string,
    message: { key: string; threadId: string; message: string },
  ): Promise<void> => {
    const chat = await ready(conversationId);
    await chat.messageAgent(message, context);
  };

  /**
   * An agent another host placed on this computer (a cloud conversation's
   * agent on a device), run in the conversation here to its answer, which
   * goes back to that host.
   */
  const runPlacedAgent = async (
    conversationId: string,
    run: Omit<Parameters<OpenStellaHarness["runPlacedAgent"]>[0], "runsOn"> & {
      /** The model it runs on (`agentModel`), when its host named one. */
      model?: string;
    },
  ): ReturnType<OpenStellaHarness["runPlacedAgent"]> => {
    placedIn.set(run.agentKey, conversationId);
    // Before anything awaits, so a cancel that lands while the conversation opens still holds.
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
      return await chat.runPlacedAgent({ ...placedRun, ...(runsOn ? { runsOn } : {}), signal: placed.cancel.signal }, context);
    } finally {
      signal?.removeEventListener("abort", stop);
      if (placedRuns.get(run.agentKey) === placed) placedRuns.delete(run.agentKey);
    }
  };

  /** A message for an agent placed here, from the host that placed it; false when it is not running here. */
  const steerPlacedAgent = async (message: { key: string; agentKey: string; message: string }): Promise<boolean> => {
    const conversationId = placedIn.get(message.agentKey);
    if (!conversationId) return false;
    return await (await open(conversationId)).steerPlacedAgent(message, context);
  };

  /** Stop a run of an agent placed here, for the host that placed it; false when that run is not going here. */
  /** Stop an agent another host placed here; `paused` when that host paused it. */
  const cancelPlacedAgent = (agentKey: string, runKey: string, paused?: boolean): boolean => {
    const placed = placedRuns.get(agentKey);
    if (placed?.runKey !== runKey) return false;
    placed.cancel.abort(paused ? PLACED_AGENT_PAUSED : undefined);
    return true;
  };

  const older = async (conversationId: string, beforeEntryId: number): Promise<PiChatOlderResult> =>
    history(await open(conversationId), beforeEntryId);

  return {
    /** Submit a prepared message (text and marked parts). */
    submit,
    automation,
    startAgent,
    messageAgent,
    runPlacedAgent,
    steerPlacedAgent,
    cancelPlacedAgent,
    voiceTranscript,
    voiceHistory,
    /**
     * Stop a chat another device placed here: withdraw it while it waits,
     * or stop the run answering it.
     */
    async cancelPlacement(placementRunId: string): Promise<{ canceled: boolean }> {
      const placement = placements.get(placementRunId);
      if (!placement) return { canceled: false };
      placement.canceled = true;
      await stopPlacement(placement);
      return { canceled: true };
    },
    /**
     * A message for one of Stella's agents from another device (a paired
     * phone, the cloud's Stella): it steers the agent while it works or
     * starts its next run, and the report goes to Stella here.
     */
    async deliverAgentMessage(
      threadId: string,
      text: string,
      messageId: string,
    ): Promise<"steered" | "resumed" | "not_found"> {
      const conversationId = (await threadIndex())[threadId];
      if (!conversationId || !text.trim()) return "not_found";
      const chat = await ready(conversationId);
      const record = await chat.agentStanding(threadId, context);
      if (!record) return "not_found";
      await chat.messageAgent(
        { key: `device:${messageId.trim() || crypto.randomUUID()}`, threadId, message: text, fromOrchestrator: true },
        context,
      );
      return record.status === "running" ? "steered" : "resumed";
    },
    /** A pause for one of Stella's agents here from another host (the cloud, another computer). */
    pauseAgent: pauseLocalAgent,
    async deliverReport(conversationId: string, report: { requestId: string; text: string }): Promise<void> {
      await noteEngineReport(conversationId, report);
      if (await noteOnBrain(conversationId, report.requestId, report.text)) return;
      const chat = await ready(conversationId);
      await caughtUp(chat);
      const hidden: TextContent & { stella: { hidden: true } } = { type: "text", text: report.text, stella: { hidden: true } };
      await chat.root.submit({ type: "input", content: [hidden], whenBusy: "followUp", requestId: report.requestId }, context);
    },
    /**
     * Where one of Stella's agents on this computer stands, for settling the
     * cloud's record of it: undefined when no conversation here started it.
     * A run a previous process left unfinished reads as running: it resumes.
     */
    async agentStatus(
      threadId: string,
    ): Promise<
      { conversationId: string; status: "running" | "completed" | "error" | "canceled" | "paused"; attempt: number } | undefined
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
            : record.agentStatus === "paused" || record.agentStatus === "canceled"
              ? record.agentStatus
              : record.status,
        attempt: record.attempt,
      };
    },
    /** Whether any conversation has work in flight here, so the process must stay up. */
    busy(): boolean {
      return activeNow.size > 0;
    },
    /** Reopen the conversations a previous process left with work in flight. */
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
        case "welcome":
          await welcome(request.conversationId, request.message);
          return { ok: true };
        case "files":
          return linkedFiles(request.conversationId);
        case "brain":
          return brainPlacement(request.conversationId);
        case "move":
          return moveBrain(request.conversationId, request.target);
      }
    },
    /** End every shell command the chats' agents have running on this computer. */
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
        await chat.execution.close();
        await chat.stream?.stop().catch(() => undefined);
        await chat.harness.close(context).catch(() => undefined);
      }
      await environments.cleanup(context);
    },
  };
}

export type DesktopChats = ReturnType<typeof desktopChats>;
