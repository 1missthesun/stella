import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
  ClaudeCodeEngine,
  ClaudeCodeSessionRecord,
  ClaudeCodeSessionRef,
  ClaudeCodeSessionStore,
  ClaudeCodeToolOutcome,
  ClaudeCodeTransport,
} from "@stella/agent/engine/claude-code";
import { resolveAgentWorkingDirectory } from "../../kernel/agent-runtime/shared.js";
import {
  antigravityCliProblem,
  antigravityHomeFor,
  createAntigravityCliRuntime,
  findAntigravityCli,
  type AntigravityCliConfig,
} from "../../kernel/integrations/antigravity-cli-acp.js";
import { stellaAgentShellEnvironment } from "../../kernel/tools/stella-agent-env.js";
import { TOOL_RESULT_AUTHORIZED_IMAGES, type AuthorizedToolImage, type ToolResult } from "../../kernel/tools/types.js";
import type { OpenSession } from "./sessions.js";

const IMAGE_TYPES = new Set<AuthorizedToolImage["mimeType"]>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

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
  const directory = path.join(dataDir, "agent", "antigravity-cli");
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
        const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
        const undelivered = strings(parsed.undelivered);
        return {
          ...(typeof parsed.cliSessionId === "string" ? { cliSessionId: parsed.cliSessionId } : {}),
          ...(parsed.open === true ? { open: true as const } : {}),
          seen: strings(parsed.seen),
          ...(undelivered.length > 0 ? { undelivered } : {}),
          ...(typeof parsed.context === "string" ? { context: parsed.context } : {}),
          ...(typeof parsed.boundary === "string" ? { boundary: parsed.boundary } : {}),
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

export const antigravityCliConfigFor = (session: OpenSession): AntigravityCliConfig => ({
  binary: findAntigravityCli,
  home: () => antigravityHomeFor(session.config.get().stellaDataDirPath),
});

const transportFor = (session: OpenSession, runtime: ReturnType<typeof createAntigravityCliRuntime>): ClaudeCodeTransport => {
  const dataDir = () => session.config.get().stellaDataDirPath;
  const appDir = session.key.stellaAppDir;
  const cwdOf = (ref: ClaudeCodeSessionRef) =>
    resolveAgentWorkingDirectory({
      agentType: ref.role === "orchestrator" ? "orchestrator" : "general",
      stellaAppDir: appDir,
      stellaDataDir: dataDir(),
      ...(ref.cwd ? { workingDirectory: ref.cwd } : {}),
    }) ?? process.cwd();
  const shellEnv = (ref: ClaudeCodeSessionRef, cwd: string): Record<string, string> =>
    session.runnerCell.get()?.piTools.shellEnvironment({
      conversationId: ref.conversationId,
      ...(ref.threadId ? { agentId: ref.threadId } : {}),
      cwd,
    }) ??
    stellaAgentShellEnvironment({
      stellaAppDir: appDir,
      stellaDataDir: dataDir(),
      ...(ref.threadId ? { agentId: ref.threadId } : {}),
    });
  return {
    resume: async (ref, { held }) => {
      const live = runtime.liveSessionId(ref.sessionKey);
      return live ? { sessionId: live } : held ? { sessionId: held } : {};
    },
    runTurn: async (spec) => {
      const ref = spec.session;
      const cwd = cwdOf(ref);
      await mkdir(cwd, { recursive: true }).catch(() => undefined);
      return await runtime.runTurn({
        ref: { sessionKey: ref.sessionKey, role: ref.role },
        cwd,
        env: { ...(process.env as Record<string, string>), ...shellEnv(ref, cwd) },
        ...(spec.resumeSessionId ? { resumeSessionId: spec.resumeSessionId } : {}),
        model: spec.model,
        thinkingLevel: spec.thinkingLevel,
        systemPrompt: spec.systemPrompt,
        prompt: spec.prompt,
        images: spec.images,
        resumeFallbackPrompt: spec.resumeFallbackPrompt,
        tools: spec.tools,
        nativeTools: spec.nativeTools,
        signal: spec.signal,
        executeTool: async (toolCallId, name, args, signal) => toToolResult(await spec.executeTool(toolCallId, name, args, signal)),
        onEvent: (event) => spec.onEvent(event),
        onNativeToolEnd: ({ toolCallId, result, isError }) => spec.onNativeToolEnd({ toolUseId: toolCallId, result, isError }),
        onSessionId: (sessionId) => spec.onSessionId(sessionId),
      });
    },
    close: (ref) => runtime.close(ref.sessionKey),
  };
};

const engines = new WeakMap<OpenSession, Promise<ClaudeCodeEngine>>();

export const antigravityCliEngineFor = (session: OpenSession): Promise<ClaudeCodeEngine> => {
  let engine = engines.get(session);
  if (!engine) {
    const runtime = createAntigravityCliRuntime(antigravityCliConfigFor(session));
    engine = import("@stella/agent/engine/claude-code").then(({ createClaudeCodeEngine, ANTIGRAVITY_CLI_FLAVOR }) =>
      createClaudeCodeEngine({
        flavor: ANTIGRAVITY_CLI_FLAVOR,
        transport: transportFor(session, runtime),
        sessions: sessionStore(session.config.get().stellaDataDirPath),
        report: (error) => console.error("[antigravity-cli-engine]", error),
      }),
    );
    engines.set(session, engine);
  }
  return engine;
};

export const antigravityCliProblemFor = (session: OpenSession): string | undefined => antigravityCliProblem(antigravityCliConfigFor(session));
