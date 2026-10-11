/**
 * Where a Claude Code session's file and shell tools run, apart from where
 * its CLI runs (its brain). Each session (Stella's, or one agent's) has a
 * placement: this computer, another of the owner's computers, or a cloud
 * container. `switch_destination` (tools) and `spawn_agent` (an agent's
 * destination) set it; the engine reads it at every step.
 *
 * Here: the CLI's built-ins, in-process. Elsewhere: every built-in off,
 * Stella's Read/Write/Edit/Bash/Grep over MCP, and each of those calls sent
 * where the tools run through the execution environment pi shares
 * (`@stella/agent/host/remote-tools`). A change mid-turn restarts the CLI on
 * the new tool set with --resume (`ClaudeCodeTurnRequest.toolSetAfterStep`),
 * and the session reads pi's notice of the move.
 *
 * A placement is kept in a small file under the data dir, so an agent whose
 * tools were moved keeps them there across a restart of this computer.
 */
import fs from "node:fs";
import path from "node:path";
import {
  httpExecutionRemote,
  remoteToolEnvironment,
  type RemoteToolEnvironment,
} from "@stella/agent/host/remote-tools";
import {
  renderCloudDestination,
  renderDeviceDestination,
  toolsMovedNotice,
} from "@stella/agent/stella/execution";
import {
  describePlacement,
  placementOf,
  placementRecord,
  samePlacement,
  type StellaPlacement,
} from "@stella/agent/stella/placement";
import type { DeviceToolName, DeviceToolResult } from "@stella/contracts/turn-plane/device-tools";
import {
  TOOL_RESULT_AUTHORIZED_IMAGES,
  type AuthorizedToolImage,
  type ToolContext,
  type ToolResult,
  type ToolUpdateCallback,
} from "../tools/types.js";
import { isClaudeCodeEnvironmentToolName } from "./claude-code-native-tools.js";

const LOCAL: StellaPlacement = { kind: "local" };
const STATE_FILE = "claude-code-tool-placements.json";
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Whose tools: one session of a conversation, Stella's (no agent id) or an agent's. */
export type ClaudeCodeToolOwner = { conversationId: string; agentId?: string };

const ownerKey = (owner: ClaudeCodeToolOwner): string => `${owner.conversationId}::${owner.agentId ?? "stella"}`;

/** The cloud container's and the request's key for an owner: the scope's alphabet, kept short. */
const scopeKey = (owner: ClaudeCodeToolOwner): string =>
  `cc-${Buffer.from(ownerKey(owner)).toString("base64url").slice(0, 120)}`;

type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext,
  signal?: AbortSignal,
  onUpdate?: ToolUpdateCallback,
) => Promise<ToolResult>;

export type ClaudeCodeToolEnvironments = {
  /** Where an owner's file and shell tools run; this computer unless moved. */
  placement(owner: ClaudeCodeToolOwner): StellaPlacement;
  /** A Claude Code session runs for this owner here now, so its tools can move. */
  attach(owner: ClaudeCodeToolOwner): void;
  /** Whether a Claude Code session ever ran for this owner in this process. */
  attached(owner: ClaudeCodeToolOwner): boolean;
  /**
   * Whether `target` can take a conversation's tools now, and what an agent
   * is told about it; else why not, in words an agent can act on.
   */
  prepare(conversationId: string, target: StellaPlacement): Promise<{ placement: StellaPlacement } | { error: string }>;
  /** Where a new agent's tools start, as `prepare` answered it. */
  place(owner: ClaudeCodeToolOwner, placement: StellaPlacement): void;
  /**
   * Move an owner's tools to `target` once it can take them: the place they
   * left and the one they run on now (what an agent is told of it), or why
   * not, in words an agent can act on.
   */
  move(owner: ClaudeCodeToolOwner, target: StellaPlacement): Promise<{ from: StellaPlacement; to: StellaPlacement } | { error: string }>;
  /** Run Stella's file and shell tools where the owner's tools run; everything else as before. */
  route(executor: ToolExecutor, owner: ClaudeCodeToolOwner): ToolExecutor;
};

const resultOf = (outcome: DeviceToolResult, where: string): ToolResult => {
  const images: AuthorizedToolImage[] = (outcome.images ?? []).flatMap((image) =>
    IMAGE_TYPES.has(image.mimeType)
      ? [
          {
            data: new Uint8Array(Buffer.from(image.data, "base64")),
            mimeType: image.mimeType as AuthorizedToolImage["mimeType"],
            sourcePath: where,
          },
        ]
      : [],
  );
  const result: ToolResult = outcome.isError
    ? { error: outcome.text || "The call failed." }
    : { result: outcome.text || "(no output)" };
  if (outcome.details !== undefined) result.details = outcome.details;
  if (images.length > 0) result[TOOL_RESULT_AUTHORIZED_IMAGES] = images;
  return result;
};

export const createClaudeCodeToolEnvironments = (options: {
  deviceId: string;
  stellaDataDir?: string;
  auth: () => { baseUrl: string; authToken: string } | null | undefined;
  report: (error: unknown) => void;
}): ClaudeCodeToolEnvironments & { close(): Promise<void> } => {
  const statePath = options.stellaDataDir ? path.join(options.stellaDataDir, "state", STATE_FILE) : undefined;
  const placements = new Map<string, StellaPlacement>();
  const attached = new Set<string>();
  const environments = new Map<string, RemoteToolEnvironment>();
  if (statePath) {
    try {
      const saved = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
      for (const [key, value] of Object.entries(saved ?? {})) {
        const placement = placementOf(value as Parameters<typeof placementOf>[0]);
        if (placement && placement.kind !== "local") placements.set(key, placement);
      }
    } catch {
      // Nothing kept yet, or unreadable: every session's tools start here.
    }
  }
  const save = () => {
    if (!statePath) return;
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      const temporary = `${statePath}.${process.pid}.tmp`;
      fs.writeFileSync(
        temporary,
        JSON.stringify(Object.fromEntries([...placements].map(([key, placement]) => [key, placementRecord(placement)]))),
        { mode: 0o600 },
      );
      fs.renameSync(temporary, statePath);
    } catch (error) {
      options.report(error);
    }
  };
  const environmentFor = (conversationId: string): RemoteToolEnvironment => {
    let environment = environments.get(conversationId);
    if (!environment) {
      const remote = httpExecutionRemote(conversationId, options.auth);
      environment = remoteToolEnvironment({
        conversationId,
        deviceId: options.deviceId,
        ...(remote ? { remote } : {}),
        report: options.report,
      });
      environments.set(conversationId, environment);
    }
    return environment;
  };
  const placement = (owner: ClaudeCodeToolOwner) => placements.get(ownerKey(owner)) ?? LOCAL;
  const record = (owner: ClaudeCodeToolOwner, to: StellaPlacement) => {
    const key = ownerKey(owner);
    if (to.kind === "local") placements.delete(key);
    else placements.set(key, to);
    save();
  };
  const prepare = async (conversationId: string, target: StellaPlacement) =>
    conversationId.startsWith("local_") && target.kind !== "local"
      ? { error: "This chat is stored only on this computer, so its tools can only run here." }
      : await environmentFor(conversationId).prepare(target);
  return {
    placement,
    prepare,
    place: record,
    attach: (owner) => {
      attached.add(ownerKey(owner));
    },
    attached: (owner) => attached.has(ownerKey(owner)),
    move: async (owner, target) => {
      const prepared = await prepare(owner.conversationId, target);
      if ("error" in prepared) return prepared;
      const from = placement(owner);
      const to = prepared.placement;
      if (samePlacement(from, to)) return { from, to };
      record(owner, to);
      await environmentFor(owner.conversationId).moved(scopeKey(owner), from);
      return { from, to };
    },
    route: (executor, owner) => async (toolName, args, context, signal, onUpdate) => {
      const where = placement(owner);
      if (where.kind === "local" || !isClaudeCodeEnvironmentToolName(toolName)) {
        return await executor(toolName, args, context, signal, onUpdate);
      }
      const outcome = await environmentFor(owner.conversationId).run(
        where,
        {
          owner: scopeKey(owner),
          ...(owner.agentId ? { threadId: owner.agentId } : {}),
          callId: context.requestId,
          toolName: toolName as DeviceToolName,
          params: args,
        },
        signal,
      );
      return resultOf(outcome, describePlacement(where));
    },
    close: async () => {
      await Promise.all([...environments.values()].map((environment) => environment.close()));
      environments.clear();
    },
  };
};

/**
 * The prompt's line on where a session's tools run, when that is not where
 * its CLI runs; pi's words for the same placement.
 */
export const claudeCodeToolDestinationPrompt = (placement: StellaPlacement, orchestrator: boolean): string | undefined =>
  placement.kind === "device"
    ? renderDeviceDestination(placement, orchestrator)
    : placement.kind === "cloud"
      ? renderCloudDestination(orchestrator)
      : undefined;

/** What the switch answers in a Claude Code session: pi's notice, and when the new tools take over. */
export const claudeCodeToolsMovedAnswer = (from: StellaPlacement, to: StellaPlacement, orchestrator: boolean): string =>
  [
    toolsMovedNotice(from, to, orchestrator, LOCAL),
    "Your tools change over as this step ends: end it now with one short line and no more tool calls, and you carry on at once with your tools there.",
  ].join("\n");

/** What the session reads as it carries on with its new tool set. */
export const claudeCodeToolsMovedContinuation = (to: StellaPlacement): string =>
  to.kind === "local"
    ? "[Your tools run on this computer again, with your built-in file and shell tools.] Carry on with your work."
    : `[Your tools now run on ${describePlacement(to)}: your file and shell tools are Stella's Read, Write, Edit, Bash and Grep, and they run there.] Carry on with your work.`;

let active: ClaudeCodeToolEnvironments | null = null;

export const setClaudeCodeToolEnvironments = (environments: ClaudeCodeToolEnvironments | null): void => {
  active = environments;
};

export const claudeCodeToolEnvironments = (): ClaudeCodeToolEnvironments | null => active;
