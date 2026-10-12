import {
  NodeReplKernelRegistry,
  type NodeReplCellObservation,
  type NodeReplKernelManagerOptions,
} from "../../computer-use/kernel.js";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import type { ToolDefinition } from "../types.js";
import { CODE_TOOL_NAME } from "../code-tool.js";
import {
  CODE_TOOL_DESCRIPTION,
  CODE_TOOL_PARAMETERS,
  CODE_TOOL_PROMPT_SNIPPET,
  CODE_TOOL_REPLAY,
} from "./code-def.js";

export type CodeToolOptions = NodeReplKernelManagerOptions & {
  registry?: NodeReplKernelRegistry;
};

const FAILED_OUTPUT_MAX_CHARS = 1_900;

const cleanCodeError = (raw: string): string => {
  const lines = raw.split("\n");
  const position = raw.match(/stella-code:(\d+):(\d+)/);
  const kept = lines.filter((line) => !/^\s+at\s/.test(line));
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === "") kept.pop();
  const message = kept.join("\n").trim() || "Code cell failed.";
  return position && !message.includes(`stella-code:${position[1]}`)
    ? `${message} (line ${position[1]}:${position[2]})`
    : message;
};

export const createCodeTool = (options: CodeToolOptions): ToolDefinition => {
  const registry = options.registry ?? new NodeReplKernelRegistry(options);
  const observationDetails = (observation: NodeReplCellObservation) => {
    const media = observation.content?.filter((item) => item.type !== "text");
    return {
      ...(media && media.length > 0 ? { code: { content: media } } : {}),
      ...(observation.mapArtifacts?.length === 1
        ? { map: observation.mapArtifacts[0] }
        : {}),
      ...(observation.mapArtifacts && observation.mapArtifacts.length > 1
        ? { maps: [...observation.mapArtifacts] }
        : {}),
    };
  };
  const withDetails = <T extends Record<string, unknown>>(
    result: T,
    observation: NodeReplCellObservation,
  ) => {
    const details = observationDetails(observation);
    return Object.keys(details).length > 0 ? { ...result, details } : result;
  };
  const modelText = (observation: NodeReplCellObservation): string =>
    (observation.content ?? [])
      .flatMap((item) => {
        if (item.type === "text") return [item.text];
        if (item.type === "audio") {
          return [
            `[Audio output available at ${item.path}${item.mimeType ? ` (${item.mimeType})` : ""}.]`,
          ];
        }
        return [];
      })
      .join("\n");
  const seconds = (elapsedMs: number) =>
    `${(elapsedMs / 1000).toFixed(elapsedMs < 10_000 ? 1 : 0)}s`;
  const resetNote = (observation: NodeReplCellObservation) =>
    observation.reset && observation.reset.reason !== "explicit"
      ? "[runtime reset]"
      : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join("\n");
  const resultForObservation = (
    observation: NodeReplCellObservation,
    stopRequested: boolean,
  ) => {
    const text = modelText(observation);
    if (observation.status === "running") {
      return withDetails(
        {
          result: join(
            text,
            `[running · cell_id=${observation.cellId} · ${seconds(observation.elapsedMs)}]`,
          ),
        },
        observation,
      );
    }
    if (observation.status === "failed") {
      if (stopRequested && observation.reset?.reason === "terminated") {
        return withDetails(
          { result: join(text, "[stopped · runtime reset]") },
          observation,
        );
      }
      const failure = join(
        cleanCodeError(observation.error ?? "Code cell failed."),
        resetNote(observation),
      );
      const budget = FAILED_OUTPUT_MAX_CHARS - failure.length;
      const partial =
        text.length <= budget
          ? text
          : budget > 40
            ? `[earlier output omitted]\n${text.slice(text.length - budget + 26).replace(/^\n/, "")}`
            : "";
      return withDetails({ error: join(partial, failure) }, observation);
    }
    return withDetails({ result: text }, observation);
  };
  return {
    name: CODE_TOOL_NAME,
    replay: CODE_TOOL_REPLAY,
    agentTypes: [AGENT_IDS.ORCHESTRATOR, AGENT_IDS.GENERAL],
    description: CODE_TOOL_DESCRIPTION,
    promptSnippet: CODE_TOOL_PROMPT_SNIPPET,
    parameters: CODE_TOOL_PARAMETERS,
    execute: async (args, context, extras) => {
      const hasCode = typeof args.code === "string" && args.code.trim() !== "";
      const hasCellId =
        typeof args.cell_id === "string" && args.cell_id.trim() !== "";
      if (hasCode === hasCellId) {
        return { error: "Provide exactly one of code or cell_id." };
      }
      const timeoutMs =
        typeof args.timeout_ms === "number" &&
        Number.isFinite(args.timeout_ms) &&
        args.timeout_ms > 0
          ? Math.floor(args.timeout_ms)
          : undefined;
      const yieldTimeMs =
        typeof args.yield_time_ms === "number" &&
        Number.isFinite(args.yield_time_ms) &&
        args.yield_time_ms >= 0
          ? Math.floor(args.yield_time_ms)
          : undefined;
      const waitMs =
        typeof args.wait_ms === "number" &&
        Number.isFinite(args.wait_ms) &&
        args.wait_ms >= 0
          ? Math.floor(args.wait_ms)
          : undefined;
      const cursor =
        typeof args.cursor === "number" &&
        Number.isSafeInteger(args.cursor) &&
        args.cursor >= 0
          ? args.cursor
          : undefined;
      try {
        const observation = hasCode
          ? await registry.startCell(args.code as string, context, {
              ...(timeoutMs !== undefined ? { timeoutMs } : {}),
              ...(yieldTimeMs !== undefined ? { yieldTimeMs } : {}),
              ...(extras?.signal ? { signal: extras.signal } : {}),
              ...(extras?.onUpdate ? { onToolUpdate: extras.onUpdate } : {}),
            })
          : await registry.waitCell((args.cell_id as string).trim(), context, {
              ...(waitMs !== undefined ? { waitMs } : {}),
              ...(cursor !== undefined ? { afterCursor: cursor } : {}),
              ...(args.terminate === true ? { terminate: true } : {}),
              ...(extras?.signal ? { signal: extras.signal } : {}),
            });
        return resultForObservation(
          observation,
          hasCellId && args.terminate === true,
        );
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
};

