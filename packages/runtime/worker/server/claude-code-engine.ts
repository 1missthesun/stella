import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageContent, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentModelReasoningEffort } from "@stella/contracts/agent-engine";
import type {
  ClaudeCodeSessionRecord,
  ClaudeCodeSessionRef,
  ClaudeCodeSessionStore,
  ClaudeCodeToolOutcome,
  ClaudeCodeTransport,
} from "@stella/agent/engine/claude-code";
import { resolveAgentWorkingDirectory } from "../../kernel/agent-runtime/shared.js";
import { getClaudeCodeRuntimeEffortLevel } from "../../kernel/integrations/claude-code-agent-runtime.js";
import { readClaudeCodeContextWindows, readClaudeCodeResolvedModels } from "../../kernel/integrations/claude-code-resolved-models.js";
import {
  checkClaudeCodeAuth,
  claudeCodeResumableSessionId,
  closeClaudeCodeSessionWhenIdle,
  CLAUDE_CODE_AGENT_AUTO_COMPACT_WINDOW,
  runClaudeCodeTurn,
} from "../../kernel/integrations/claude-code-session-runtime.js";
import {
  claudeCliCanResume,
  claudeCliVersion,
  claudeSessionProjectDir,
  hashClaudeReplyText,
  resolveClaudeWorkingFolder,
  writeFileAtomically,
} from "../../kernel/integrations/claude-code-session-files.js";
import { createClaudeCodeCompactionDetector } from "../../kernel/integrations/claude-code-compaction.js";
import { claudeSessionSyncSink } from "../../kernel/integrations/claude-code-session-sync-sink.js";
import { getClaudeCodeConfig } from "../../kernel/storage/local-llm-credential-access.js";
import { stellaAgentShellEnvironment } from "../../kernel/tools/stella-agent-env.js";
import {
  TOOL_RESULT_AUTHORIZED_IMAGES,
  type AuthorizedToolImage,
  type ToolResult,
} from "../../kernel/tools/types.js";
import { latestPromptSeq } from "./pi-journal.js";
import type { OpenSession } from "./sessions.js";

const SESSION_ENGINE = "claude_code_local" as const;
const IMAGE_TYPES = new Set<AuthorizedToolImage["mimeType"]>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const EFFORT_BY_THINKING: Record<ModelThinkingLevel, AgentModelReasoningEffort | undefined> = {
  off: undefined,
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

const sameFolder = (left: string, right: string | undefined): boolean => {
  if (!right) return false;
  const resolve = (value: string) => {
    try {
      return realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  };
  return resolve(left) === resolve(right);
};

const toToolResult = (outcome: ClaudeCodeToolOutcome): ToolResult => {
  const text = outcome.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
  const images: AuthorizedToolImage[] = outcome.content
    .filter((part): part is ImageContent => part.type === "image")
    .filter((image) => IMAGE_TYPES.has(image.mimeType as AuthorizedToolImage["mimeType"]))
    .map((image) => ({
      data: Buffer.from(image.data, "base64"),
      mimeType: image.mimeType as AuthorizedToolImage["mimeType"],
      sourcePath: "stella-tool-result",
    }));
  return {
    ...(outcome.isError ? { error: text || "The tool failed." } : { result: text }),
    ...(images.length > 0 ? { [TOOL_RESULT_AUTHORIZED_IMAGES]: images } : {}),
  };
};

const sessionStore = (dataDir: string): ClaudeCodeSessionStore => {
  const directory = path.join(dataDir, "agent", "claude-code");
  const file = (piSessionId: string) => path.join(directory, `${piSessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  const writes = new Map<string, Promise<void>>();
  const save = async (target: string, contents: string) => {
    await mkdir(directory, { recursive: true });
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, contents);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  };
  return {
    read: async (piSessionId) => {
      try {
        const parsed = JSON.parse(await readFile(file(piSessionId), "utf8")) as Partial<ClaudeCodeSessionRecord>;
        const undelivered = Array.isArray(parsed.undelivered)
          ? parsed.undelivered.filter((entry): entry is string => typeof entry === "string")
          : [];
        return {
          ...(typeof parsed.cliSessionId === "string" ? { cliSessionId: parsed.cliSessionId } : {}),
          seen: Array.isArray(parsed.seen) ? parsed.seen.filter((entry): entry is string => typeof entry === "string") : [],
          ...(undelivered.length > 0 ? { undelivered } : {}),
          ...(typeof parsed.context === "string" ? { context: parsed.context } : {}),
        };
      } catch {
        return undefined;
      }
    },
    write: (piSessionId, record) => {
      const target = file(piSessionId);
      const contents = JSON.stringify(record);
      const next = (writes.get(target) ?? Promise.resolve()).catch(() => undefined).then(() => save(target, contents));
      writes.set(target, next);
      void next
        .catch(() => undefined)
        .finally(() => {
          if (writes.get(target) === next) writes.delete(target);
        });
      return next;
    },
  };
};

const desktopTransport = (session: OpenSession): ClaudeCodeTransport => {
  const dataDir = () => session.config.get().stellaDataDirPath;
  const appDir = session.key.stellaAppDir;
  const runner = () => session.runnerCell.get();
  const adopted = new Map<string, string>();
  const cwdOf = (ref: ClaudeCodeSessionRef) =>
    resolveAgentWorkingDirectory({
      agentType: ref.role === "orchestrator" ? "orchestrator" : "general",
      stellaAppDir: appDir,
      ...(ref.cwd ? { workingDirectory: ref.cwd } : {}),
    });
  const syncs = (ref: ClaudeCodeSessionRef) => !ref.ephemeral && !ref.conversationId.startsWith("local_");
  const shellEnv = (ref: ClaudeCodeSessionRef, cwd: string): Record<string, string> =>
    runner()?.piTools.shellEnvironment({
      conversationId: ref.conversationId,
      ...(ref.threadId ? { agentId: ref.threadId } : {}),
      cwd,
    }) ??
    stellaAgentShellEnvironment({
      stellaAppDir: appDir,
      stellaDataDir: dataDir(),
      ...(ref.threadId ? { agentId: ref.threadId } : {}),
    });
  // Stella's session is fenced by her brain lease; an agent's has its own holder (its log's).
  const leaseEpoch = (ref: ClaudeCodeSessionRef): number | null =>
    ref.role === "orchestrator" ? (runner()?.brainLeases.claim(ref.conversationId).epoch ?? null) : null;

  const adopt = async (ref: ClaudeCodeSessionRef, cwd: string | undefined, lastReply: string | undefined) => {
    const sink = claudeSessionSyncSink();
    const restored = sink?.takeRestored({ threadId: ref.sessionKey, engine: SESSION_ENGINE });
    if (!sink || !restored) return undefined;
    const reject = (reason: string) => {
      console.warn("[claude-code-engine] restored session not resumed", { sessionKey: ref.sessionKey, reason });
      sink.consumeRestored({ threadId: ref.sessionKey, sessionId: restored.sessionId });
      return undefined;
    };
    if (!sameFolder(restored.cwd, cwd)) return reject("working_folder_changed");
    if (!claudeCliCanResume(await claudeCliVersion(), restored.cliVersion)) return reject("cli_older_than_origin");
    if (lastReply !== undefined && !restored.replyHashes.has(hashClaudeReplyText(lastReply))) return reject("sync_behind_log");
    adopted.set(ref.sessionKey, restored.sessionId);
    return restored.sessionId;
  };

  /** Where the signed-in Claude account keeps `sessionId`'s transcript for a CLI working in `cwd`. */
  const transcriptPath = async (cwd: string, sessionId: string) => {
    const configDir = (await getClaudeCodeConfig()).configDir ?? null;
    return path.join(claudeSessionProjectDir(configDir, await resolveClaudeWorkingFolder(cwd)), `${sessionId}.jsonl`);
  };

  /** A session the CLI can resume here: the signed-in account has its transcript (another account's can't). */
  const resumable = async (cwd: string | undefined, sessionId: string): Promise<boolean> =>
    await access(await transcriptPath(cwd ?? process.cwd(), sessionId)).then(
      () => true,
      () => false,
    );

  const prepareRestore = async (ref: ClaudeCodeSessionRef, cwd: string | undefined): Promise<"native" | "rebuild" | "none"> => {
    const sink = claudeSessionSyncSink();
    if (!sink || !cwd) return "none";
    if (sink.takeRestored({ threadId: ref.sessionKey, engine: SESSION_ENGINE })) return "native";
    const configDir = (await getClaudeCodeConfig()).configDir ?? null;
    // An agent resumes the newest session it synced, wherever it ran it:
    // files here that already cover the cloud's are kept, others come down.
    if (ref.role !== "orchestrator") {
      if ((await sink.restoreForResume({ threadId: ref.sessionKey, configDir, cwd })) === "native") return "native";
      const prepared = await sink.prepareLocalResume({ threadId: ref.sessionKey, engine: SESSION_ENGINE, configDir, cwd });
      return prepared ? "native" : "none";
    }
    const promptSeq = latestPromptSeq(ref.conversationId);
    const atJournalSeq =
      promptSeq === undefined
        ? undefined
        : await runner()?.cloudJournal.priorTurnPromptSeq(ref.conversationId, promptSeq - 1).catch(() => undefined);
    if (atJournalSeq === undefined) return "none";
    return await sink.restoreForResume({ threadId: ref.sessionKey, configDir, cwd, atJournalSeq });
  };

  return {
    preflight: async () => {
      const auth = await checkClaudeCodeAuth();
      if (auth.status !== "reauth_required") return;
      const failure = new Error(auth.message) as Error & { code?: string; status?: number };
      failure.code = "CLAUDE_CODE_AUTH_REAUTH_REQUIRED";
      failure.status = 401;
      throw failure;
    },
    resume: async (ref, { held, lastReply }) => {
      const cwd = cwdOf(ref);
      const live = claudeCodeResumableSessionId(ref.sessionKey, cwd);
      if (syncs(ref) && ref.role === "orchestrator") {
        const epoch = leaseEpoch(ref);
        const moved = runner()?.brainLeases.beganUnder(ref.conversationId, epoch) ?? false;
        if (moved && (live || held) && (await prepareRestore(ref, cwd)) === "native") {
          closeClaudeCodeSessionWhenIdle(ref.sessionKey);
          const sessionId = await adopt(ref, cwd, lastReply);
          if (sessionId) return { sessionId, restored: true };
        }
      }
      if (live) return { sessionId: live };
      if (held && (await resumable(cwd, held))) return { sessionId: held };
      if (!syncs(ref)) return {};
      await prepareRestore(ref, cwd);
      const sessionId = await adopt(ref, cwd, lastReply);
      return sessionId ? { sessionId, restored: true } : {};
    },
    runTurn: async (spec) => {
      const ref = spec.session;
      const cwd = cwdOf(ref);
      const effort = EFFORT_BY_THINKING[spec.thinkingLevel];
      const effortLevel = getClaudeCodeRuntimeEffortLevel(dataDir(), effort);
      const cliBridgeSocketPath = runner()?.piTools.cliBridgeSocketPath;
      const compaction = createClaudeCodeCompactionDetector();
      const result = await runClaudeCodeTurn({
        sessionKey: ref.sessionKey,
        ...(spec.resumeSessionId ? { persistedSessionId: spec.resumeSessionId } : {}),
        modelId: `claude-code/${spec.model}`,
        stellaAppDir: dataDir(),
        shellEnv: shellEnv(ref, cwd ?? process.cwd()),
        ...(cliBridgeSocketPath ? { cliBridgeSocketPath } : {}),
        ...(effortLevel ? { effortLevel } : {}),
        prompt: spec.prompt,
        resumeFallbackPrompt: spec.resumeFallbackPrompt,
        systemPrompt: spec.systemPrompt,
        ...(cwd ? { cwd } : {}),
        ...(spec.images.length > 0
          ? { attachments: spec.images.map((image) => ({ url: `data:${image.mimeType};base64,${image.data}`, mimeType: image.mimeType })) }
          : {}),
        tools: spec.tools,
        nativeTools: spec.nativeTools,
        nativeToolCallIds: true,
        boundToolInactivity: false,
        allowEmptyFinal: true,
        ...(spec.quiet ? { quietFinal: true } : {}),
        ...(spec.compact ? { vanilla: true } : {}),
        ...(ref.role === "worker" ? { autoCompactWindowTokens: CLAUDE_CODE_AGENT_AUTO_COMPACT_WINDOW } : {}),
        abortSignal: spec.signal,
        holdOnUsageLimit: true,
        executeTool: async (toolCallId, toolName, toolArgs, signal) =>
          toToolResult(await spec.executeTool(toolCallId, toolName, toolArgs, signal)),
        onNativeToolEnd: ({ toolCallId, result, isError }) => spec.onNativeToolEnd({ toolUseId: toolCallId, result, isError }),
        onStreamEvent: (event) => {
          const compacted = compaction(event as Record<string, unknown>);
          if (compacted) spec.onCompaction(compacted);
          spec.onEvent(event);
        },
        onStatusChange: (status) => spec.onStatus(status),
        onSessionId: (sessionId) => spec.onSessionId(sessionId),
        onTurnControl: ({ inject, endStep }) => {
          spec.control({
            inject: (input) =>
              inject({
                text: input.text,
                images: input.images,
                ...(input.onConsumed ? { onConsumed: input.onConsumed } : {}),
                ...(input.onDropped ? { onDropped: input.onDropped } : {}),
              }),
            endStep,
          });
          return undefined;
        },
        toolSetAfterStep: () => spec.toolSetAfterStep(),
        onBackgroundWake: (wake) => spec.onBackgroundWake(wake),
        ...(spec.backgroundWake ? { backgroundWake: true } : {}),
        ...(syncs(ref)
          ? {
              onSessionCheckpoint: (checkpoint: { sessionId: string; configDir: string | null; cwd: string; final: boolean }) => {
                const journalSeq = latestPromptSeq(ref.conversationId);
                const epoch = leaseEpoch(ref);
                claudeSessionSyncSink()?.noteCheckpoint({
                  threadId: ref.sessionKey,
                  conversationId: ref.conversationId,
                  sessionId: checkpoint.sessionId,
                  engine: SESSION_ENGINE,
                  configDir: checkpoint.configDir,
                  cwd: checkpoint.cwd,
                  final: checkpoint.final,
                  ...(journalSeq !== undefined ? { journalSeq } : {}),
                  ...(epoch !== null ? { leaseEpoch: epoch } : {}),
                });
              },
            }
          : {}),
      });
      const restored = adopted.get(ref.sessionKey);
      if (restored) {
        adopted.delete(ref.sessionKey);
        claudeSessionSyncSink()?.consumeRestored({ threadId: ref.sessionKey, sessionId: restored });
      }
      return { text: result.text, sessionId: result.sessionId };
    },
    hydrate: async (ref, transcript) => {
      const cwd = cwdOf(ref) ?? process.cwd();
      await mkdir(cwd, { recursive: true });
      const sessionId = randomUUID();
      const text = transcript({ sessionId, cwd: await resolveClaudeWorkingFolder(cwd), version: await claudeCliVersion() });
      await writeFileAtomically(await transcriptPath(cwd, sessionId), text);
      closeClaudeCodeSessionWhenIdle(ref.sessionKey);
      console.info("[claude-code-engine] hydrated a session from the conversation", {
        sessionKey: ref.sessionKey,
        sessionId,
        bytes: text.length,
      });
      return sessionId;
    },
    close: (ref) => closeClaudeCodeSessionWhenIdle(ref.sessionKey),
  };
};

const engines = new WeakMap<OpenSession, Promise<import("@stella/agent/engine/claude-code").ClaudeCodeEngine>>();

export const claudeCodeEngineFor = (session: OpenSession) => {
  let engine = engines.get(session);
  if (!engine) {
    engine = import("@stella/agent/engine/claude-code").then(({ createClaudeCodeEngine }) =>
      createClaudeCodeEngine({
        transport: desktopTransport(session),
        sessions: sessionStore(session.config.get().stellaDataDirPath),
        resolveModel: (alias) => readClaudeCodeResolvedModels(session.config.get().stellaDataDirPath)[alias],
        reportedContextWindow: (model) => readClaudeCodeContextWindows(session.config.get().stellaDataDirPath)[model],
        report: (error) => console.error("[claude-code-engine]", error),
      }),
    );
    engines.set(session, engine);
  }
  return engine;
};
