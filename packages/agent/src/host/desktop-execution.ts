/**
 * Where a desktop conversation's tools run, apart from the conversation: the
 * brain (Stella's or an agent's conversation, its state and history) stays
 * in this computer's harness, and its file and shell tools run on this
 * computer, on another of the owner's computers, or in a cloud container.
 *
 *   another computer: this computer --HTTP--> owner gate --presence socket--> computer
 *   cloud:            this computer --HTTP--> conversation object --> its container
 *
 * Both ends serve the same file and shell tools a cloud agent's container
 * does (`@stella/contracts/turn-plane/device-tools`), so a call leaves here
 * in their shape: pi's own tools translate their arguments, and Stella's
 * Read goes as it is. Only a conversation stored in the cloud can move its
 * tools; one kept on this computer refuses every switch.
 *
 * In a conversation stored in the cloud Stella can move her brain as well
 * (`switch_destination` with `move: "brain"`): the conversation's object
 * records the new host (`@stella/contracts/turn-plane/pi-brain`), and once
 * her turn here ends her brief continues there as a placed chat.
 */
import type { Context, JsonValue } from "@earendil-works/chord";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { defineExtension, type Extension, type ToolExecutionApi, type ToolRegistration } from "@earendil-works/pi-durable";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import type { PiBrainHost, PiBrainRecord } from "@stella/contracts/turn-plane/pi-brain";
import type { DeviceToolName, DeviceToolResult } from "@stella/contracts/turn-plane/device-tools";
import { StellaAgentDoc } from "../stella/agent-doc.ts";
import { STELLA_CODING_EXTENSION } from "../stella/coding.ts";
import type { StellaExecutionHost } from "../stella/execution.ts";
import { placementOf, StellaPlacementDoc, type StellaPlacement } from "../stella/placement.ts";
import { remoteToolEnvironment, type DesktopExecutionRemote, type RemoteToolCall as EnvironmentToolCall } from "./remote-tools.ts";

export type { DesktopExecutionRemote } from "./remote-tools.ts";

/** One file or shell call for a pi conversation's tools elsewhere. */
export type RemoteToolCall = Omit<EnvironmentToolCall, "owner"> & {
  /** The pi conversation whose tools these are, in this computer's harness. */
  piConversationId: number;
};

/** The longest a shell command waits for its end on the other side before handing back a session. */
const SHELL_WAIT_MS = 600_000;

/** Where a conversation stored in the cloud has its brain, as its object records it. */
export type DesktopBrain = {
  read(): Promise<PiBrainRecord | null>;
  set(host: PiBrainHost): Promise<PiBrainRecord>;
  /** Carry on at `host` with Stella's brief, as a chat placed there. */
  handOff(host: PiBrainHost, brief: string): Promise<void>;
  /**
   * What Stella reads hidden (an agent's report or note), placed at `host`,
   * where she runs; once per `id`. False when that host can't take it now
   * (out of reach, not ready), for this computer to take instead.
   */
  note(host: PiBrainHost, note: { id: string; text: string }): Promise<boolean>;
};

export type ToolResultContent = (TextContent | ImageContent)[];

const result = (outcome: DeviceToolResult): { content: ToolResultContent; isError?: true } => ({
  content: [
    { type: "text", text: outcome.text || "(no output)" },
    ...(outcome.images ?? []).map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
  ],
  ...(outcome.isError ? { isError: true as const } : {}),
});

/**
 * pi's file and shell tools, as the other side's tools take them: the
 * same work under the container's argument names. A shell command waits as
 * long as the other side lets one wait.
 */
const remoteCall = (toolName: string, args: Record<string, unknown>): { toolName: DeviceToolName; params: Record<string, unknown> } => {
  switch (toolName) {
    case "Bash": {
      const seconds = typeof args.timeout === "number" && args.timeout > 0 ? args.timeout : undefined;
      return {
        toolName: "Bash",
        params: { cmd: args.command, timeout_ms: Math.min(SHELL_WAIT_MS, seconds ? seconds * 1000 : SHELL_WAIT_MS) },
      };
    }
    case "Read":
      return {
        toolName: "Read",
        params: {
          file_path: args.path,
          ...(typeof args.offset === "number" ? { offset: args.offset } : {}),
          ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
        },
      };
    case "Write":
      return { toolName: "Write", params: { file_path: args.path, content: args.content } };
    case "Edit": {
      const edits = Array.isArray(args.edits) ? (args.edits as Array<{ oldText?: unknown; newText?: unknown }>) : [];
      return {
        toolName: "Edit",
        params: { file_path: args.path, edits: edits.map((edit) => ({ old_string: edit.oldText, new_string: edit.newText })) },
      };
    }
    default:
      throw new Error(`${toolName} does not run away from this computer.`);
  }
};

/**
 * The agents' `stella-coding` on this computer: pi's own tools, which run
 * here through the ExecutionEnv, and wherever else the conversation's tools
 * were moved through `run`.
 */
export const desktopCoding = (
  run: (placement: Exclude<StellaPlacement, { kind: "local" }>, call: RemoteToolCall, context: Context) => Promise<{ content: ToolResultContent; isError?: true }>,
): Extension =>
  defineExtension({
    name: STELLA_CODING_EXTENSION,
    tools: [
      { ...createBashTool(), name: "Bash" },
      { ...createReadTool(), name: "Read" },
      { ...createWriteTool(), name: "Write" },
      { ...createEditTool(), name: "Edit" },
    ].map(
      (tool): ToolRegistration => ({
        ...tool,
        async execute(args: unknown, api: ToolExecutionApi<JsonValue>, context: Context) {
          const placement = placementOf(await api.snapshot(StellaPlacementDoc, api.conversationId, context));
          if (!placement || placement.kind === "local") return await tool.execute(args as never, api as never, context);
          const role = await api.snapshot(StellaAgentDoc, api.conversationId, context);
          const { toolName, params } = remoteCall(tool.name, (args ?? {}) as Record<string, unknown>);
          return await run(
            placement,
            {
              piConversationId: api.conversationId,
              ...(role?.threadId ? { threadId: role.threadId } : {}),
              callId: api.callId,
              toolName,
              params,
            },
            context,
          );
        },
      }),
    ),
  });

/**
 * One conversation's execution host on this computer: where its tools can
 * move (`switch_destination`, `spawn_agent` with a device), and how a call
 * reaches them there.
 */
export function desktopExecution(options: {
  /** The Stella conversation. */
  conversationId: string;
  /** This computer: naming it moves tools back here. */
  deviceId?: string;
  /** Kept on this computer only: every switch is refused. */
  localOnly: boolean;
  remote?: DesktopExecutionRemote;
  /** Where the conversation's brain runs, for a conversation stored in the cloud. */
  brain?: DesktopBrain;
  /** Settles once Stella's turn here has ended, so her brief continues after it. */
  turnEnded?(): Promise<void>;
  /** The record the conversation's object took for a move. */
  brainMoved?(record: PiBrainRecord): void;
  report(error: unknown): void;
}) {
  const environment = remoteToolEnvironment({
    conversationId: options.conversationId,
    ...(options.deviceId ? { deviceId: options.deviceId } : {}),
    ...(options.remote ? { remote: options.remote } : {}),
    report: options.report,
  });

  /** One call where the conversation's tools run now. */
  const run = async (
    placement: Exclude<StellaPlacement, { kind: "local" }>,
    call: RemoteToolCall,
    context: Context,
  ): Promise<{ content: ToolResultContent; isError?: true }> => {
    const { piConversationId, ...rest } = call;
    return result(await environment.run(placement, { ...rest, owner: String(piConversationId) }, context.abortSignal));
  };

  const host: StellaExecutionHost = {
    localOnly: options.localOnly,
    prepare: async (target) => await environment.prepare(target),
    // Leaving the cloud saves the container's work into the world, then lets it go.
    moved: async (piConversationId, from) => await environment.moved(String(piConversationId), from),
    ...(options.brain && !options.localOnly
      ? {
          moveBrain: async (target, brief, context) => {
            const brain = options.brain!;
            if (target.kind === "local" || (target.kind === "device" && target.deviceId === options.deviceId)) {
              return { error: "You already run on this computer." };
            }
            // A computer must be able to take work now, as for its tools.
            const prepared = await host.prepare(target, context);
            if ("error" in prepared) return prepared;
            const placement = prepared.placement;
            const next: PiBrainHost =
              placement.kind === "device"
                ? { host: "device", deviceId: placement.deviceId, ...(placement.label ? { label: placement.label } : {}) }
                : { host: "cloud" };
            const record = await brain.set(next);
            options.brainMoved?.(record);
            void (async () => {
              await options.turnEnded?.();
              await brain.handOff(next, brief);
            })().catch((error: unknown) => options.report(error));
            return { moved: placement };
          },
        }
      : {}),
  };

  return {
    host,
    run,
    /** Let every container this conversation holds go. */
    close: environment.close,
  };
}

export type DesktopExecution = ReturnType<typeof desktopExecution>;
