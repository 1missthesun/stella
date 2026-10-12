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
import { samePiBrainHost, type PiBrainHost, type PiBrainRecord } from "@stella/contracts/turn-plane/pi-brain";
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
  /** The account's home computer, where Stella stays while it is up; null clears it. */
  setHome?(deviceId: string | null): Promise<void>;
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

type PlacedRun = (
  placement: Exclude<StellaPlacement, { kind: "local" }>,
  call: RemoteToolCall,
  context: Context,
) => Promise<{ content: ToolResultContent; isError?: true }>;

/**
 * One device-shaped call where the conversation's tools run now, through
 * `run`; undefined while they run on this computer.
 */
export const runWherePlaced =
  (run: PlacedRun) =>
  async (
    call: { toolName: DeviceToolName; params: Record<string, unknown> },
    api: ToolExecutionApi<JsonValue>,
    context: Context,
  ): Promise<{ content: ToolResultContent; isError?: true } | undefined> => {
    const placement = placementOf(await api.snapshot(StellaPlacementDoc, api.conversationId, context));
    if (!placement || placement.kind === "local") return undefined;
    const role = await api.snapshot(StellaAgentDoc, api.conversationId, context);
    return await run(
      placement,
      {
        piConversationId: api.conversationId,
        ...(role?.threadId ? { threadId: role.threadId } : {}),
        callId: api.callId,
        toolName: call.toolName,
        params: call.params,
      },
      context,
    );
  };

/**
 * The agents' `stella-coding` on this computer: pi's own tools, which run
 * here through the ExecutionEnv, and wherever else the conversation's tools
 * were moved through `run`.
 */
export const desktopCoding = (run: PlacedRun): Extension => {
  const elsewhere = runWherePlaced(run);
  return defineExtension({
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
          const ran = await elsewhere(remoteCall(tool.name, (args ?? {}) as Record<string, unknown>), api, context);
          return ran ?? (await tool.execute(args as never, api as never, context));
        },
      }),
    ),
  });
};

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

  const isHere = (target: StellaPlacement): boolean =>
    target.kind === "local" || (target.kind === "device" && target.deviceId === options.deviceId);

  /** The brain record names `next` from now on: that host takes the conversation's turns. */
  const setBrain = async (brain: DesktopBrain, next: PiBrainHost): Promise<PiBrainRecord> => {
    const record = await brain.set(next);
    options.brainMoved?.(record);
    return record;
  };

  /** The cloud or another computer, which must be able to take work now, as for its tools. */
  const brainHostAt = async (
    target: StellaPlacement,
    context: Context,
  ): Promise<{ placement: StellaPlacement; next: PiBrainHost } | { error: string }> => {
    const prepared = await host.prepare(target, context);
    if ("error" in prepared) return prepared;
    const placement = prepared.placement;
    if (placement.kind === "local") return { error: "You already run on this computer." };
    return {
      placement,
      next:
        placement.kind === "device"
          ? { host: "device", deviceId: placement.deviceId, ...(placement.label ? { label: placement.label } : {}) }
          : { host: "cloud" },
    };
  };

  const host: StellaExecutionHost = {
    localOnly: options.localOnly,
    prepare: async (target) => await environment.prepare(target),
    standing: async (deviceId) => await environment.standing(deviceId),
    // Leaving the cloud saves the container's work into the world, then lets it go.
    moved: async (piConversationId, from) => await environment.moved(String(piConversationId), from),
    ...(options.brain && !options.localOnly
      ? {
          moveBrain: async (target, brief, context) => {
            if (isHere(target)) return { error: "You already run on this computer." };
            const at = await brainHostAt(target, context);
            if ("error" in at) return at;
            const brain = options.brain!;
            await setBrain(brain, at.next);
            void (async () => {
              await options.turnEnded?.();
              await brain.handOff(at.next, brief);
            })().catch((error: unknown) => options.report(error));
            return { moved: at.placement };
          },
        }
      : {}),
  };

  /**
   * The user moving Stella from the app's picker: the same move as her own,
   * with no brief to hand on, since the user's next message continues
   * there. This computer is a host like any other: picking it keeps her here
   * for every device's messages.
   */
  const pinBrain = async (target: StellaPlacement, context: Context): Promise<PiBrainRecord | { error: string }> => {
    const brain = options.brain;
    if (!brain || options.localOnly) return { error: "This chat is stored only on this computer, so it can only run here." };
    // The computer the user picks is the account's home computer from now
    // on: Stella comes back to it whenever it is up. Picking the cloud clears it.
    const home = async (record: PiBrainRecord): Promise<PiBrainRecord> => {
      await brain.setHome?.(record.host === "device" ? record.deviceId : null);
      return record;
    };
    // Already there: only the home computer changes, and the lease keeps its epoch.
    const settle = async (next: PiBrainHost): Promise<PiBrainRecord> => {
      const current = await brain.read().catch(() => null);
      return await home(current && samePiBrainHost(current, next) ? current : await setBrain(brain, next));
    };
    if (!isHere(target)) {
      const at = await brainHostAt(target, context);
      if ("error" in at) return at;
      return await settle(at.next);
    }
    if (!options.deviceId) return { error: "This computer has no device id yet. Try again in a moment." };
    const listed = await environment.remote?.devices().catch(() => undefined);
    const label = listed?.find((entry) => entry.deviceId === options.deviceId)?.label?.trim();
    return await settle({ host: "device", deviceId: options.deviceId, ...(label ? { label } : {}) });
  };

  return {
    host,
    run,
    pinBrain,
    /** Let every container this conversation holds go. */
    close: environment.close,
  };
}

export type DesktopExecution = ReturnType<typeof desktopExecution>;
