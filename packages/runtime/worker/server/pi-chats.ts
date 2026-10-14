import { AGENT_REPORT_MAX_CHARS } from "@stella/contracts/backend/agent-reports";
import { AGENT_STOPPED_REASON, isAgentStopReason } from "@stella/contracts/agent-status";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiChatRequest, PiChatUsageRequest } from "@stella/contracts/pi-chat";
import {
  METHOD_NAMES,
  NOTIFICATION_NAMES,
  type RuntimeChatPayload,
} from "@stella/contracts/protocol";
import { CLIENT_MSG_ID_PATTERN, parseCloudTurnContext } from "@stella/contracts/turn-plane/turn-start";
import {
  getAgentRuntimeEngine,
  getModelOverride,
  getReasoningEffort,
  loadLocalPreferences,
} from "../../kernel/preferences/local-preferences.js";
import {
  getAccessibleLocalLlmApiKey,
  getAccessibleLocalLlmOAuthApiKey,
} from "../../kernel/storage/local-llm-credential-access.js";
import {
  getPlacementCancellation,
  persistPlacementCancellation,
  type PlacementLocalExecutionKind,
} from "../../kernel/runner/execution-placement-local-ownership.js";
import type { PiReportDelivery } from "../../kernel/runner/types.js";
import { prepareStoredLocalChatPayload } from "../../kernel/storage/local-chat-payload.js";
import { prepareChatInput } from "./chat-input.js";
import { piUserContent } from "./pi-chat-input.js";
import { brainFor } from "./pi-brain.js";
import { cloudJournalFor } from "./pi-journal.js";
import { piUserReminders } from "./pi-reminders.js";
import { piModelUsage } from "./pi-usage.js";
import {
  createRemoteDeviceSigner,
  HOST_DEVICE_SIGNING_METHOD,
} from "../../host/device-signing-method.js";
import type * as HostBus from "./host-bus.js";
import type { OpenSession } from "./sessions.js";

type DesktopChats = import("@stella/agent/host/desktop-chats").DesktopChats;

const PI_LOG_ROW = "pi:";
const PI_WRITER = "pi";
const AGENT_DIRECTORY_SESSIONS = 12;

const piLocalLog = (
  session: OpenSession,
  conversationId: string,
): import("@stella/agent/host/desktop-local-log").DesktopLocalLog => {
  const rowId = (key: string) => `${PI_LOG_ROW}${conversationId}:${key}`;
  const userRowId = (replyTo: string) => (/^\d+:\d+$/.test(replyTo) ? rowId(replyTo) : replyTo);
  return {
    read: async (afterSeq, limit) => {
      const page = session.storage.chatStore.chat.listMessagesAfterSeq(conversationId, afterSeq, limit);
      return {
        ...page,
        messages: page.messages.filter((message) => !message.id.startsWith(PI_LOG_ROW) && message.writer !== PI_WRITER),
      };
    },
    write: async (message) => {
      const written = (eventId: string) => {
        if (message.role !== "user") return { id: eventId };
        const seq = session.storage.chatStore.chat.getEventCursor(conversationId, eventId)?.sequence;
        return { id: eventId, ...(typeof seq === "number" ? { seq } : {}) };
      };
      const eventId =
        message.role === "user" && message.clientMsgId && CLIENT_MSG_ID_PATTERN.test(message.clientMsgId)
          ? message.clientMsgId
          : rowId(message.key);
      if (message.role === "reaction") {
        const reacted = session.storage.chatStore.chat.reactToUserMessage({
          conversationId,
          sequence: message.sequence,
          emoji: message.emoji,
          at: message.timestamp,
        });
        if (reacted) session.storage.notifyLocalChatUpdated(conversationId, reacted);
        return { id: reacted?._id ?? eventId };
      }
      if (session.storage.chatStore.chat.hasEvent(conversationId, eventId)) return written(eventId);
      const writer = { writer: PI_WRITER };
      if (message.role === "lifecycle") {
        session.storage.appendChatEventAndNotify({
          conversationId,
          eventId,
          type: message.type,
          requestId: message.agentId,
          timestamp: message.timestamp,
          payload: { ...message.payload, metadata: writer },
        });
        return written(eventId);
      }
      if (message.role === "tool_request" || message.role === "tool_result") {
        const details =
          message.role === "tool_result" && message.details && typeof message.details === "object"
            ? (message.details as Record<string, unknown>)
            : undefined;
        session.storage.appendChatEventAndNotify({
          conversationId,
          eventId,
          type: message.role,
          requestId: message.toolCallId,
          timestamp: message.timestamp,
          payload:
            message.role === "tool_request"
              ? { toolName: message.toolName, ...(message.args ? { args: message.args } : {}), metadata: writer }
              : {
                  ...(details ?? {}),
                  toolName: message.toolName,
                  agentType: "orchestrator",
                  result: details ?? message.text,
                  resultPreview: message.text,
                  ...(message.isError ? { error: message.text || "Tool failed." } : {}),
                  metadata: writer,
                },
        });
        return written(eventId);
      }
      const type = message.role === "user" ? "user_message" : "assistant_message";
      const userMessageId = message.role === "assistant" && message.replyTo ? userRowId(message.replyTo) : undefined;
      const attachments =
        message.role === "user"
          ? (message.display?.attachments ?? []).map((attachment) => ({
              ...(attachment.url ? { url: attachment.url } : {}),
              ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
              ...(attachment.name ? { name: attachment.name } : {}),
              ...(attachment.path ? { path: attachment.path } : {}),
              ...(typeof attachment.size === "number" ? { size: attachment.size } : {}),
              kind: attachment.kind,
            }))
          : [];
      session.storage.appendChatEventAndNotify({
        conversationId,
        eventId,
        type,
        timestamp: message.timestamp,
        ...(userMessageId ? { requestId: userMessageId } : {}),
        payload: prepareStoredLocalChatPayload({
          type,
          payload: {
            text: message.text,
            ...(userMessageId ? { userMessageId } : {}),
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(message.role === "assistant" && message.notice ? { source: "pi-turn-notice" } : {}),
            metadata:
              message.role === "user"
                ? {
                    ...writer,
                    ui: { visibility: "visible" },
                    ...(message.display?.context ? { context: message.display.context } : {}),
                  }
                : {
                    ...writer,
                    runtime: {
                      streamStartedAtMs: message.timestamp,
                      ...(message.followedByToolCall ? { followedByToolCall: true } : {}),
                    },
                  },
          },
          timestamp: message.timestamp,
        }),
      });
      return written(eventId);
    },
  };
};

const cloudAgentThreadsFor = (
  session: OpenSession,
  conversationId: string,
): import("@stella/agent/host/desktop-chats").DesktopEngineAgents | undefined => {
  if (conversationId.startsWith("local_")) return undefined;
  const threads = () => {
    const runner = session.runnerCell.get();
    if (!runner?.getStellaSiteAuth()) throw new Error("Sign in to Stella to run agents in the cloud.");
    return runner.piCloudAgentThreads;
  };
  const requestId = (key: string) => `pi:${conversationId}:${key}`.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128);
  return {
    start: async ({ key, description, prompt, model, parentThreadId, workspace }) =>
      await threads().start({
        conversationId,
        requestId: requestId(`start:${key}`),
        description,
        prompt,
        model,
        ...(parentThreadId ? { parentThreadId } : {}),
        ...(workspace ? { workspace } : {}),
      }),
    message: async ({ key, threadId, description, message, framed }) =>
      await threads().message({
        conversationId,
        threadId,
        requestId: requestId(`message:${key}`),
        description,
        message,
        ...(framed ? { framed } : {}),
      }),
    stop: async (threadId) => await threads().stop({ conversationId, threadId, requestId: requestId(`stop:${threadId}:${Date.now()}`) }),
  };
};

const deviceAgentThreadsFor = (
  session: OpenSession,
  conversationId: string,
): import("@stella/agent/host/desktop-chats").DesktopDeviceAgents | undefined => {
  if (conversationId.startsWith("local_")) return undefined;
  const threads = () => {
    const runner = session.runnerCell.get();
    if (!runner?.getStellaSiteAuth()) throw new Error("Sign in to Stella to run agents on your other computers.");
    return runner.piCloudAgentThreads;
  };
  const requestId = (key: string) => `pi:${conversationId}:${key}`.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128);
  return {
    start: async ({ key, deviceId, description, prompt, model, parentThreadId }) =>
      await threads().startOnDevice({
        conversationId,
        requestId: requestId(`device:${key}`),
        description,
        prompt,
        targetDeviceId: deviceId,
        ...(model ? { model } : {}),
        ...(parentThreadId ? { parentThreadId } : {}),
      }),
    message: async ({ key, threadId, description, message, framed }) =>
      await threads().message({
        conversationId,
        threadId,
        requestId: requestId(`message:${key}`),
        description,
        message,
        ...(framed ? { framed } : {}),
      }),
    stop: async (threadId) => await threads().stop({ conversationId, threadId, requestId: requestId(`stop:${threadId}:${Date.now()}`) }),
  };
};

const chatsBySession = new WeakMap<OpenSession, Promise<DesktopChats>>();
const loadedBySession = new WeakMap<OpenSession, DesktopChats>();

export const piChatsBusy = (session: OpenSession): boolean => loadedBySession.get(session)?.busy() ?? false;

export const closePiChats = async (session: OpenSession): Promise<void> => {
  const chats = chatsBySession.get(session);
  chatsBySession.delete(session);
  loadedBySession.delete(session);
  await (await chats?.catch(() => undefined))?.close();
};

export const terminatePiChatCommands = async (session: OpenSession): Promise<void> => {
  const chats = await chatsBySession.get(session)?.catch(() => undefined);
  await chats?.terminateCommands();
};

export const piChatsFor = (
  session: OpenSession,
  hostBus: HostBus.Interface,
): Promise<DesktopChats> => {
  let chats = chatsBySession.get(session);
  if (chats) return chats;
  let signer: ReturnType<typeof createRemoteDeviceSigner> | undefined;
  chats = Promise.all([
    import("@stella/agent/host/desktop-chats"),
    import("../../kernel/model-routing.js"),
    import("../../kernel/integrations/claude-code-agent-runtime.js"),
    import("./claude-code-engine.js").then(({ claudeCodeEngineFor }) => claudeCodeEngineFor(session)),
    import("@stella/agent/host/desktop-execution"),
  ]).then(([{ desktopChats }, { resolveDirectLlmRoute }, { getClaudeCodeAgentModelId }, claudeCodeEngine, { httpDevices }]) =>
    desktopChats({
      dataDir: session.config.get().stellaDataDirPath,
      deviceId: session.config.deviceId,
      workspace: os.homedir(),
      siteAuth: () => session.runnerCell.get()?.getStellaSiteAuth() ?? null,
      memoryEnabled: () => loadLocalPreferences(session.config.get().stellaDataDirPath).memoryEnabled,
      executionContext: async () => await session.runnerCell.get()?.loadExecutionContext(),
      stellaModel: () => {
        const dataDir = session.config.get().stellaDataDirPath;
        return getAgentRuntimeEngine(dataDir) === "claude_code_local"
          ? getClaudeCodeAgentModelId(dataDir, undefined, "orchestrator")
          : getModelOverride(dataDir, "orchestrator");
      },
      claudeCodeEngine,
      claudeCodeProblem: async () => {
        const { checkClaudeCodeAuth } = await import("../../kernel/integrations/claude-code-session-runtime.js");
        const auth = await checkClaudeCodeAuth();
        return auth.status === "ok" ? undefined : auth.message;
      },
      shellEnv: ({ conversationId, cwd }) =>
        session.runnerCell.get()?.piTools.shellEnvironment({ conversationId, cwd }),
      userReminders: ({ text, sentAt, previousUserAt, timezone }) =>
        piUserReminders(session.config.get().stellaDataDirPath, {
          text,
          sentAt,
          ...(previousUserAt !== undefined ? { previousUserAt } : {}),
          ...(timezone ? { timezone } : {}),
        }),
      credentials: {
        apiKey: (provider) => getAccessibleLocalLlmApiKey(session.config.get().stellaDataDirPath, provider),
        oauthToken: (provider) => getAccessibleLocalLlmOAuthApiKey(session.config.get().stellaDataDirPath, provider),
      },
      resolveDirectModel: (reference) =>
        resolveDirectLlmRoute({ stellaAppDir: session.config.get().stellaDataDirPath, modelName: reference }),
      thinkingLevel: () => getReasoningEffort(session.config.get().stellaDataDirPath, "orchestrator"),
      refreshAuthToken: async () => {
        const result = (await hostBus.request(
          METHOD_NAMES.HOST_RUNTIME_AUTH_REFRESH,
          { source: "stella_provider" },
          { retryOnDisconnect: true },
        )) as { authenticated?: boolean; token?: string } | null;
        return result?.authenticated ? (result.token ?? null) : null;
      },
      getDeviceSigner: () => {
        const pending =
          signer ??
          createRemoteDeviceSigner((input) =>
            hostBus.request(HOST_DEVICE_SIGNING_METHOD, { input }, { retryOnDisconnect: true }),
          );
        signer = pending;
        void pending.catch(() => {
          if (signer === pending) signer = undefined;
        });
        return pending;
      },
      tools: (conversationId) => ({
        specs: (role) => session.runnerCell.get()?.piTools.specs(role) ?? [],
        run: async (call, context) => {
          const runner = session.runnerCell.get();
          if (!runner) throw new Error("Stella's runtime is restarting; try again.");
          const result = await runner.piTools.run({
            agentType: call.role,
            name: call.name,
            callId: call.callId,
            args: call.args,
            conversationId,
            ...(call.threadId ? { agentId: call.threadId } : {}),
            ...(context.abortSignal ? { signal: context.abortSignal } : {}),
          });
          return {
            content: result.content,
            details: result.details,
            ...(result.isError ? { isError: true } : {}),
          };
        },
      }),
      localSessions: () =>
        session.storage.runtimeStore.chat
          .listConversationSummaries({ limit: AGENT_DIRECTORY_SESSIONS })
          .conversations.map(({ conversationId, title, updatedAt }) => ({ conversationId, title, updatedAt })),
      agentThreads: {
        directory: async (conversationId, threadIds) => {
          const runner = session.runnerCell.get();
          if (!runner?.getStellaSiteAuth()) throw new Error("Not signed in to Stella.");
          return await runner.agentThreads.directory(conversationId, threadIds);
        },
        message: async (args) => {
          const runner = session.runnerCell.get();
          if (!runner?.getStellaSiteAuth()) throw new Error("Sign in to Stella to message agents and sessions in the cloud.");
          return await runner.agentThreads.message(args);
        },
        stop: async (args) => {
          const runner = session.runnerCell.get();
          if (!runner?.getStellaSiteAuth()) throw new Error("Sign in to Stella to stop agents running in the cloud or on your other devices.");
          return await runner.agentThreads.stop(args);
        },
        note: async (args) => {
          const runner = session.runnerCell.get();
          if (!runner?.getStellaSiteAuth()) throw new Error("Sign in to Stella to send Stella a note from an agent.");
          await runner.agentThreads.note(args);
        },
      },
      agentLogs: {
        append: async (args) => {
          const runner = session.runnerCell.get();
          if (!runner?.getStellaSiteAuth()) throw new Error("Not signed in to Stella.");
          return await runner.agentLogs.append(args);
        },
        read: async (args) => {
          const runner = session.runnerCell.get();
          if (!runner?.getStellaSiteAuth()) throw new Error("Not signed in to Stella.");
          return await runner.agentLogs.read(args);
        },
      },
      agentHandoff: async (args) => {
        const runner = session.runnerCell.get();
        if (!runner?.getStellaSiteAuth()) throw new Error("Sign in to Stella to move agents to your other computers.");
        return await runner.agentThreads.handoff(args);
      },
      flushClaudeSessions: async () => {
        await session.runnerCell.get()?.flushClaudeSessionSync(15_000);
      },
      journal: (conversationId) => cloudJournalFor(session, conversationId),
      cloudThreads: (conversationId) => cloudAgentThreadsFor(session, conversationId),
      deviceAgents: (conversationId) => deviceAgentThreadsFor(session, conversationId),
      devices: (conversationId) =>
        httpDevices(
          conversationId,
          () => session.runnerCell.get()?.getStellaSiteAuth(),
          () => session.runnerCell.get()?.pushedDevices(),
        ),
      brain: (conversationId) => brainFor(session, hostBus, conversationId),
      agentRunEnded: ({ conversationId, threadId, interrupted }) => {
        const runner = session.runnerCell.get();
        if (!runner) return;
        void runner.piTools
          .endAgentBrowserTurn(threadId)
          .catch((error) => console.warn("[pi-chat] closing the agent's browser tabs failed", error));
        const owner = { conversationId, agentId: threadId };
        const runningSessionIds = runner.backgroundExits.runningSessions(owner);
        if (runningSessionIds.length === 0) return;
        runner.backgroundExits.arm({ ...owner, runningSessionIds, ...(interrupted ? { interrupted: true } : {}) });
      },
      agentStarted: (agent) => {
        session.runnerCell.get()?.backgroundExits.disarm({ conversationId: agent.conversationId, agentId: agent.threadId });
        if (agent.conversationId.startsWith("local_")) return;
        void (async () => {
          const runner = session.runnerCell.get();
          if (!runner) return;
          await runner.computerAgents.start({
            agentId: agent.threadId,
            conversationId: agent.conversationId,
            description: agent.description,
            agentType: "general",
            attemptGeneration: agent.attempt,
            ownerGeneration: await runner.cloudJournal.ownerGeneration(),
            ...(agent.parentThreadId ? { parentAgentId: agent.parentThreadId } : {}),
          });
        })().catch((error) => console.warn("[pi-chat] computer thread start failed", error));
      },
      subagentEnded: (agent) => {
        if (agent.conversationId.startsWith("local_")) return;
        void (async () => {
          const runner = session.runnerCell.get();
          if (!runner) return;
          await runner.computerAgents.complete({
            agentId: agent.threadId,
            attemptGeneration: agent.attempt,
            ownerGeneration: await runner.cloudJournal.ownerGeneration(),
            ...(agent.outcome === "completed"
              ? { status: "completed" as const, ...(agent.text ? { result: agent.text.slice(0, AGENT_REPORT_MAX_CHARS) } : {}) }
              : agent.outcome === "failed"
                ? { status: "error" as const, error: (agent.text || "The agent failed.").slice(0, 10_000) }
                : { status: "canceled" as const, error: (agent.text || AGENT_STOPPED_REASON).slice(0, 10_000) }),
          });
        })().catch((error) => console.warn("[pi-chat] computer thread completion failed", error));
      },
      agentReportRelayed: (agent) => {
        void hostBus
          .request(METHOD_NAMES.HOST_NOTIFICATION_SHOW, {
            title: agent.description.trim() || "Task complete",
            body: "",
            sound: "Glass",
          })
          .catch((error) => console.debug("[pi-chat] agent notification failed", error));
      },
      agentReported: (agent) => {
        if (agent.conversationId.startsWith("local_") || agent.running) return;
        const body = /\n(?:result|error): ([\s\S]*?)(?=\n(?:agent_state|routing|presentation): |$)/.exec(agent.report)?.[1]?.trim();
        void (async () => {
          const runner = session.runnerCell.get();
          if (!runner) return;
          const status = agent.status === "failed" ? "error" : agent.status;
          await runner.computerAgents.complete({
            agentId: agent.threadId,
            attemptGeneration: agent.attempt,
            status,
            ownerGeneration: await runner.cloudJournal.ownerGeneration(),
            ...(body ? (status === "completed" ? { result: body } : { error: body }) : {}),
            fallback: { conversationId: agent.conversationId, report: agent.report },
          });
        })().catch((error) => console.warn("[pi-chat] computer thread completion failed", error));
      },
      agentStopped: (agent) => {
        if (agent.conversationId.startsWith("local_")) return;
        void (async () => {
          const runner = session.runnerCell.get();
          if (!runner) return;
          await runner.computerAgents.complete({
            agentId: agent.threadId,
            attemptGeneration: agent.attempt,
            status: "canceled",
            error: AGENT_STOPPED_REASON,
            ownerGeneration: await runner.cloudJournal.ownerGeneration(),
          });
        })().catch((error) => console.warn("[pi-chat] computer thread stop failed", error));
      },
      localLog: (conversationId) =>
        conversationId.startsWith("local_") ? piLocalLog(session, conversationId) : undefined,
      emit: (payload) => hostBus.notify(NOTIFICATION_NAMES.PI_CHAT_EVENTS, payload),
      report: (error) => console.error("[pi-chat]", error),
    }),
  );
  void chats.then(
    (loaded) => {
      if (chatsBySession.get(session) === chats) loadedBySession.set(session, loaded);
    },
    () => chatsBySession.delete(session),
  );
  chatsBySession.set(session, chats);
  return chats;
};

export const piBackgroundExitTarget = (
  session: OpenSession,
  hostBus: HostBus.Interface,
): import("../../kernel/runner/types.js").BackgroundExitTarget => ({
  status: async (agentId) => (await (await piChatsFor(session, hostBus)).agentStatus(agentId))?.status ?? "canceled",
  deliver: async ({ agentId, eventId, text }) =>
    (await (await piChatsFor(session, hostBus)).deliverAgentMessage(agentId, text, eventId)) !== "not_found",
});

export const resumePiChats = async (
  session: OpenSession,
  hostBus: HostBus.Interface,
): Promise<void> => {
  const file = path.join(session.config.get().stellaDataDirPath, "agent", "active.json");
  if (!existsSync(file)) return;
  try {
    const ids = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(ids) || ids.length === 0) return;
  } catch {
    return;
  }
  await (await piChatsFor(session, hostBus)).resumeActive();
};

const piAgentStanding = async (
  session: OpenSession,
  hostBus: HostBus.Interface,
  threadId: string,
): Promise<import("../../kernel/runner/computer-agent-reconcile.js").ComputerAgentStanding | undefined> => {
  const file = path.join(session.config.get().stellaDataDirPath, "agent", "threads.json");
  if (!existsSync(file)) return undefined;
  try {
    const index = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (typeof index[threadId] !== "string") return undefined;
  } catch {
    return undefined;
  }
  const status = await (await piChatsFor(session, hostBus)).agentStatus(threadId);
  return (
    status && {
      status: status.status,
      attempt: status.attempt,
      ...(status.status === "canceled" ? { error: AGENT_STOPPED_REASON } : {}),
      ...(status.lastText ? { lastText: status.lastText } : {}),
    }
  );
};

const reconciling = new WeakMap<OpenSession, Promise<void>>();

export const reconcileComputerAgents = (
  session: OpenSession,
  hostBus: HostBus.Interface,
): Promise<void> => {
  const pending = reconciling.get(session);
  if (pending) return pending;
  const run = (async () => {
    const runner = session.runnerCell.get();
    if (!runner) return;
    const { settled } = await runner.computerAgents.reconcile((threadId) =>
      piAgentStanding(session, hostBus, threadId),
    );
    if (settled.length > 0) {
      console.info("[runtime-worker] settled agents no longer running here:", settled.join(", "));
    }
  })().finally(() => reconciling.delete(session));
  reconciling.set(session, run);
  return run;
};

export const piPlacedChat = async (
  session: OpenSession,
  hostBus: HostBus.Interface,
  run: {
    conversationId: string;
    userPrompt: string;
    placementRunId: string;
    userMessageEventId?: string;
    attachments?: RuntimeChatPayload["attachments"];
    context?: unknown;
    scheduled?: boolean;
    handoff?: boolean;
  },
) => {
  const chats = await piChatsFor(session, hostBus);
  const requestId = run.userMessageEventId || `placement:${run.placementRunId}`;
  const payload: RuntimeChatPayload = {
    conversationId: run.conversationId,
    userPrompt: run.userPrompt,
    userMessageEventId: requestId,
    platform: process.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(run.attachments?.length ? { attachments: run.attachments } : {}),
  };
  const prepared = await prepareChatInput(payload, {
    stellaDataDirPath: session.config.get().stellaDataDirPath,
    resolveImageTarget: async () => (await session.runnerCell.get()?.resolveImageTarget(undefined)) ?? undefined,
  });
  const content = piUserContent(payload, prepared);
  const context = run.context === undefined ? null : parseCloudTurnContext(run.context);
  if (context?.text) {
    const [first] = content;
    const placeholderOnly =
      content.length === 1 && first?.type === "text" && first.stella?.hidden && first.text === "(empty message)";
    const part = { type: "text" as const, text: context.text, stella: { hidden: true as const } };
    if (placeholderOnly) content[0] = { ...part, stella: { ...first.stella, ...part.stella } };
    else content.push(part);
  }
  if (context?.display) {
    const first = content[0]!;
    const display = first.stella?.display;
    content[0] = {
      ...first,
      stella: { ...first.stella, display: { ...display, context: { ...display?.context, ...context.display } } },
    } as typeof first;
  }
  content[0] = { ...content[0]!, stella: { ...content[0]!.stella, clientMsgId: requestId } } as typeof content[number];
  if (run.scheduled || run.handoff) {
    for (const [index, part] of content.entries()) {
      if (part.type !== "text") continue;
      content[index] = {
        ...part,
        stella: { ...part.stella, hidden: true, ...(run.scheduled ? { source: "schedule" } : {}) },
      } as typeof part;
    }
  }
  const canceled = piPlacementCanceled(session, "chat", run.placementRunId);
  if (canceled) return { status: "error" as const, finalText: "" as const, error: canceled };
  return await chats.automation(run.conversationId, {
    requestId,
    prompt: run.userPrompt,
    content,
    visible: true,
    placementRunId: run.placementRunId,
  });
};

export const piDeliverAgentMessage = async (
  session: OpenSession,
  hostBus: HostBus.Interface,
  message: { threadId: string; text: string; messageId: string },
) => (await piChatsFor(session, hostBus)).deliverAgentMessage(message.threadId, message.text, message.messageId);

export const piStopAgent = async (session: OpenSession, hostBus: HostBus.Interface, threadId: string) =>
  await (await piChatsFor(session, hostBus)).stopAgent(threadId);

export const piAgentHistory = async (
  session: OpenSession,
  hostBus: HostBus.Interface,
  request: { conversationId: string; threadId: string; args: Record<string, unknown> },
): Promise<unknown> =>
  await (await piChatsFor(session, hostBus)).agentHistory(request.conversationId, request.threadId, request.args);

export const piDeliverReport = async (
  session: OpenSession,
  hostBus: HostBus.Interface,
  report: Parameters<PiReportDelivery>[0],
): Promise<void> =>
  await (await piChatsFor(session, hostBus)).deliverReport(report.conversationId, {
    requestId: report.requestId,
    text: report.text,
    ...(report.agentReport ? { agentReport: report.agentReport } : {}),
  });

export const piPlacementCanceled = (
  session: OpenSession,
  kind: PlacementLocalExecutionKind,
  executionId: string,
): string | null => getPlacementCancellation({ store: session.storage.runtimeStore.chat, kind, executionId });

const persistPiCancel = (
  session: OpenSession,
  kind: PlacementLocalExecutionKind,
  executionId: string,
  reason?: string,
) => persistPlacementCancellation({ store: session.storage.runtimeStore.chat, kind, executionId, ...(reason ? { reason } : {}) });

export const cancelPiPlacement = async (session: OpenSession, placementRunId: string, reason?: string): Promise<boolean> => {
  persistPiCancel(session, "chat", placementRunId, reason);
  const chats = await chatsBySession.get(session)?.catch(() => undefined);
  await chats?.cancelPlacement(placementRunId);
  return true;
};

export const cancelPiPlacedAgent = async (
  session: OpenSession,
  cancel: { agentKey: string; runKey: string; reason?: string },
): Promise<boolean> => {
  persistPiCancel(session, "agent", cancel.runKey, cancel.reason);
  const chats = await chatsBySession.get(session)?.catch(() => undefined);
  chats?.cancelPlacedAgent(cancel.agentKey, cancel.runKey, isAgentStopReason(cancel.reason));
  return true;
};

export const piChatRequest = async (
  session: OpenSession,
  hostBus: HostBus.Interface,
  request: PiChatRequest | PiChatUsageRequest,
): Promise<unknown> => {
  if (request.op === "usage") return await piModelUsage(session.config.get().stellaDataDirPath, request);
  const chats = await piChatsFor(session, hostBus);
  if (request.op !== "submit" || !request.send) return await chats.request(request);
  const payload: RuntimeChatPayload = {
    ...(request.send as Omit<RuntimeChatPayload, "conversationId" | "userPrompt">),
    conversationId: request.conversationId,
    userPrompt: request.text,
    userMessageEventId: request.requestId,
  };
  const prepared = await prepareChatInput(payload, {
    stellaDataDirPath: session.config.get().stellaDataDirPath,
    resolveImageTarget: async () =>
      (await session.runnerCell.get()?.resolveImageTarget(payload.agentType)) ?? undefined,
  });
  const content = piUserContent(payload, prepared);
  if (CLIENT_MSG_ID_PATTERN.test(request.requestId)) {
    const [first] = content;
    content[0] = { ...first!, stella: { ...first!.stella, clientMsgId: request.requestId } };
  }
  return await chats.submit(request.conversationId, request.requestId, content, {
    ...(payload.locale ? { locale: payload.locale } : {}),
    ...(payload.timezone ? { timezone: payload.timezone } : {}),
    ...(request.send.followSender ? { followSender: true } : {}),
  });
};
