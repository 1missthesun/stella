/**
 * Where Stella herself runs. Everything a conversation does runs on the host
 * that holds it: its tools, its files, its agents' processes. An agent meant
 * for another computer, or for the cloud, starts there as a whole
 * (`spawn_agent` with a destination), so nothing here runs one host's tools
 * for a conversation on another.
 *
 * In a conversation stored in the cloud, Stella can move herself
 * (`switch_destination`): another host (the conversation's object in the
 * cloud, or one of the owner's computers) takes the conversation's turns
 * from then on and carries on from the shared journal with her brief
 * (`@stella/contracts/turn-plane/pi-brain`).
 */
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ConversationId, type ToolExecutionApi } from "@earendil-works/pi-durable";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { StellaAgentDoc } from "./agent-doc.ts";
import { describePlacement, parseSpawnDestination, samePlacement, type StellaPlacement } from "./placement.ts";

export const SWITCH_DESTINATION_TOOL_NAME = "switch_destination";

export type StellaExecutionHost = {
  /**
   * Stella's brain moves to `target`: from now on that host takes the
   * conversation's turns, and `brief` continues there once this turn ends.
   * Answers where it went, named for her; absent, she stays on this host.
   */
  moveBrain?(target: StellaPlacement, brief: string, context: Context): Promise<{ moved: StellaPlacement } | { error: string }>;
  /** One of the owner's computers as the device list has it now; undefined when the list can't be read. */
  standing?(deviceId: string, context: Context): Promise<DeviceStanding | undefined>;
  /**
   * Whether one of this host's agents can move to `deviceId` now
   * (`switch_destination`), `AGENT_MOVE_CLOUD` for the cloud: that place by
   * its id and name, `here` when it is this one, or why not (offline, not
   * ready, not taking work, not signed in to Claude Code for an agent on it).
   */
  agentTarget?(
    deviceId: string,
    needs: { claudeCode: boolean },
    context: Context,
  ): Promise<{ deviceId: string; name: string; here?: true } | { error: string }>;
  /** What an agent moving away leaves in `cwd` (uncommitted or unpushed work), in one line; undefined when nothing. */
  leftBehind?(cwd: string): Promise<string | undefined>;
  /**
   * Move one of this host's agents, once its run here ended: its log has
   * everything, and the computer it moves to holds it and continues it from
   * `brief`. Answers where it runs now, or why it could not move.
   */
  moveAgent?(move: AgentMove, context: Context): Promise<{ where: string } | { error: string }>;
};

/** An agent moving itself, as `StellaExecutionHost.moveAgent` takes it. */
/** The `deviceId` of a move to the cloud. */
export const AGENT_MOVE_CLOUD = "cloud";

export type AgentMove = {
  threadId: string;
  agentConversationId: ConversationId;
  deviceId: string;
  name: string;
  brief: string;
  /** Once per move: the `switch_destination` call that asked for it. */
  key: string;
  /** What it runs on here, which it runs on there. */
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
  cwd?: string;
};

/** The framed brief an agent continues from after a move. */
export const movedAgentBrief = (from: string, brief: string, held: readonly string[] = []): string =>
  [
    `[You moved yourself here from ${from} with switch_destination, and you run here now: your conversation so far is above. Files in your old working folder stayed on ${from}. This is your brief, not a new message from anyone.]`,
    brief,
    ...held,
  ].join("\n\n");

/** A computer's name, whether it is online, and when it was last seen. */
export type DeviceStanding = {
  name: string;
  online: boolean;
  lastSeenAt?: number;
  remoteExecution?: DeviceDestination["remoteExecution"];
};

export const deviceStanding = (device: DeviceDestination): DeviceStanding => ({
  name: device.label?.trim() || device.deviceId,
  online: device.online,
  ...(device.remoteExecution ? { remoteExecution: device.remoteExecution } : {}),
  ...(device.lastSeenAt !== undefined ? { lastSeenAt: device.lastSeenAt } : {}),
});

/** Why a listed computer cannot take Stella now; undefined when it can. */
export const deviceRefusal = (device: DeviceDestination, name: string): string | undefined => {
  if (!device.online) {
    return `${name} is offline, so you can't move there now. Tell the user, or start an agent there with spawn_agent if the work can wait for it to come back.`;
  }
  switch (device.remoteExecution) {
    case "enabled":
      break;
    case "asking":
      return `${name} is still waiting for the user to allow work from other devices on its screen. Ask the user to approve it there, then try again.`;
    case "declined":
      return `${name} has declined work from other devices. To change that, on ${name} the user opens Account › "Stella on your phone" and presses Enable next to that computer.`;
    default:
      return `${name} hasn't been enabled to accept work from other devices yet. To enable it, on ${name} the user opens Account › "Stella on your phone" and presses Enable next to that computer.`;
  }
  if (device.availability && device.availability.ready !== true) {
    return `${name} is online but not ready to take work yet. Try again in a moment.`;
  }
  return undefined;
};

/** What an agent's own `switch_destination` does (`stellaAgents`), from the call's arguments. */
export type AgentSwitch = (
  args: { destination: string; prompt?: string; leave_files?: boolean },
  api: ToolExecutionApi,
  context: Context,
) => Promise<{ content: Array<{ type: "text"; text: string }>; details?: Record<string, string> }>;

/**
 * `switch_destination`: Stella moves her brain (`moveBrain`), an agent moves
 * itself as a whole (`agentSwitch`), each in a conversation stored in the
 * cloud.
 */
export const switchDestinationTool = (
  host: StellaExecutionHost,
  rootPlacement: StellaPlacement,
  agentSwitch?: AgentSwitch,
) =>
  defineTool({
    name: SWITCH_DESTINATION_TOOL_NAME,
    description:
      'Move yourself, with this whole conversation, to "cloud" or one of the user\'s computers; you continue there from your brief once this turn ends, so end the turn with at most one short line. As Stella, the conversation\'s turns run there from then on and the app\'s destination picker follows. As an agent, that place\'s Stella runs you with its files, apps, browser and sign-ins; your thread id, reports and messages follow you, but your working folder\'s files stay behind: commit and push first (a WIP branch is fine).',
    parameters: Type.Object({
      destination: Type.String({
        description: '"cloud" or a device_id.',
      }),
      prompt: Type.String({
        description: "Your self-contained brief to read there: what you were asked and what to do next.",
      }),
      leave_files: Type.Optional(
        Type.Boolean({
          description:
            "Agents: move even with uncommitted or unpushed changes, which stay behind.",
        }),
      ),
    }),
    // Moving to one place twice is moving there once.
    replay: "safe",
    execute: async (args, api, context) => {
      const self = (await api.snapshot(StellaAgentDoc, api.conversationId, context)) ?? { agentType: "orchestrator" };
      if (self.agentType !== "orchestrator") {
        if (!agentSwitch) throw new Error("You can't move from here. For work on another computer, ask Stella with send_message to \"stella\".");
        return await agentSwitch(args, api, context);
      }
      const moveBrain = host.moveBrain;
      if (!moveBrain) throw new Error("This chat is stored only on this computer, so you can only run here.");
      const local = /^(local|here|this computer)$/iu.test(args.destination.trim());
      const destination = parseSpawnDestination(args.destination);
      if (destination.kind === "here") throw new Error('destination is required: "cloud" or a device_id.');
      const target: StellaPlacement = local
        ? rootPlacement
        : destination.kind === "cloud"
          ? { kind: "cloud" }
          : { kind: "device", deviceId: destination.deviceId };
      if (samePlacement(target, rootPlacement)) {
        return { content: [{ type: "text", text: `You already run on ${describePlacement(rootPlacement)}. Carry on here.` }] };
      }
      const brief = args.prompt?.trim();
      if (!brief) throw new Error("Pass your brief as prompt: what you will do there, as you will read it there.");
      const moved = await moveBrain(target, brief, context);
      if ("error" in moved) throw new Error(moved.error);
      return {
        content: [
          {
            type: "text",
            text: `You are moving to ${describePlacement(moved.moved)}: from now on it takes this conversation's turns, and you carry on there with your brief once this turn ends, with the whole conversation. End this turn now with at most one short line to the user; start no more work here.`,
          },
        ],
        details: {
          move: "brain",
          destination: moved.moved.kind === "device" ? moved.moved.deviceId : moved.moved.kind,
          brief,
        } satisfies Record<string, string> as Record<string, string>,
      };
    },
  });
