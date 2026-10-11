/**
 * A LocalAgentManager agent whose model is not Claude Code runs on pi, the
 * desktop's own agent engine (`PiAgentEngine`): the manager keeps its
 * lifecycle, ledger row, report, steering and cancel, and pi runs each of its
 * runs in the conversation's harness, on the model it was started with.
 */
import crypto from "crypto";
import type { AgentModelConfigSnapshot } from "@stella/contracts/agent-engine";
import type { RuntimeAttachmentRef } from "@stella/contracts/protocol";
import type { AgentSteering } from "../agent-runtime/agent-steering.js";
import type { SubagentRunResult } from "../agent-runtime/types.js";
import type { RuntimeStore } from "../storage/runtime-store.js";
import type { PiAgentEngine } from "./types.js";
import { claudeCodeToolEnvironments } from "../integrations/claude-code-tool-environment.js";

const PI_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);

/** The pick pi runs an agent on, from the model it was started with; undefined is Stella's default. */
export const piModelPick = (agentContext: {
  agentEngine?: string;
  modelConfigSnapshot?: AgentModelConfigSnapshot;
  spawnEngine?: { engine: string; model?: string };
  model?: string;
  reasoningEffort?: string;
}): string | undefined => {
  const snapshot = agentContext.modelConfigSnapshot;
  const base =
    agentContext.agentEngine === "codex_cli"
      ? `codex/${snapshot?.engineModel ?? agentContext.spawnEngine?.model ?? ""}`
      : snapshot?.routeModel?.trim() || agentContext.model?.trim();
  if (!base) return undefined;
  const effort = snapshot?.reasoningEffort ?? agentContext.reasoningEffort;
  return effort && PI_EFFORTS.has(effort) ? `${base}:${effort}` : base;
};

const withAttachedFiles = (prompt: string, attachments: readonly RuntimeAttachmentRef[] | undefined): string => {
  const paths = (attachments ?? []).flatMap((attachment) =>
    attachment.sourcePath ? [JSON.stringify(attachment.sourcePath)] : [],
  );
  return paths.length === 0
    ? prompt
    : `${prompt}\n\nThe user attached these files; they are on this computer at: ${paths.join(", ")}.`;
};

export const runSubagentOnPi = async (
  engine: PiAgentEngine | undefined,
  args: {
    conversationId: string;
    agentId: string;
    runId: string;
    description: string;
    prompt: string;
    attachments?: readonly RuntimeAttachmentRef[];
    agentContext: Parameters<typeof piModelPick>[0] & { attemptGeneration?: number };
    abortSignal: AbortSignal;
    steering?: AgentSteering;
    store: RuntimeStore;
  },
): Promise<SubagentRunResult> => {
  if (!engine) {
    return {
      runId: args.runId,
      result: "",
      error: "Stella's own agent engine isn't ready on this computer yet, so this agent couldn't start. Try again in a moment.",
    };
  }
  const agentKey = `kernel:${args.agentId}`;
  const model = piModelPick(args.agentContext);
  // Tools its spawn placed elsewhere start there, in pi's own environment.
  const placement = claudeCodeToolEnvironments()?.placement({
    conversationId: args.conversationId,
    agentId: args.agentId,
  });
  let running = true;
  const detach = args.steering?.attach(
    {
      state: {
        get isStreaming() {
          return running;
        },
      },
      steer: (message) => {
        const content = message.role === "user" ? message.content : [];
        const text = (typeof content === "string" ? content : content.map((part) => (part.type === "text" ? part.text : "")).join(""))
          .trim();
        if (!text) return;
        void engine
          .steer({ key: `${args.runId}:${crypto.randomUUID()}`, agentKey, message: text })
          .catch((error) => console.warn("[pi-agent-run] steer failed", error instanceof Error ? error.message : error));
      },
    },
    {
      store: args.store,
      runId: args.runId,
      ...(typeof args.agentContext.attemptGeneration === "number"
        ? { attemptGeneration: args.agentContext.attemptGeneration }
        : {}),
    },
  );
  try {
    const result = await engine.run({
      conversationId: args.conversationId,
      agentKey,
      runKey: args.runId,
      threadId: args.agentId,
      description: args.description,
      prompt: withAttachedFiles(args.prompt, args.attachments),
      ...(model ? { model } : {}),
      ...(placement && placement.kind !== "local" ? { placement } : {}),
      signal: args.abortSignal,
    });
    if (result.status === "ok") return { runId: args.runId, result: result.finalText };
    if (result.status === "error") return { runId: args.runId, result: "", error: result.error };
    return { runId: args.runId, result: "", interrupted: true, error: result.error };
  } catch (error) {
    return { runId: args.runId, result: "", error: error instanceof Error ? error.message : String(error) };
  } finally {
    running = false;
    detach?.();
  }
};
