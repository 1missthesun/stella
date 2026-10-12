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
import { defineTool } from "@earendil-works/pi-durable";
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
};

/** A computer's name, whether it is online, and when it was last seen. */
export type DeviceStanding = { name: string; online: boolean; lastSeenAt?: number };

export const deviceStanding = (device: DeviceDestination): DeviceStanding => ({
  name: device.label?.trim() || device.deviceId,
  online: device.online,
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

/** `switch_destination`, for Stella in a conversation whose brain can move. */
export const switchDestinationTool = (
  host: StellaExecutionHost & Required<Pick<StellaExecutionHost, "moveBrain">>,
  rootPlacement: StellaPlacement,
) =>
  defineTool({
    name: SWITCH_DESTINATION_TOOL_NAME,
    description:
      'Move yourself to another place: "cloud", or one of the user\'s computers by device_id. That host takes this conversation\'s turns from now on, the app\'s destination picker follows, and you carry on there with the whole conversation from your brief (prompt) once this turn ends. Use it when the user wants you yourself working there; for separate work there, start an agent with spawn_agent and that destination instead.',
    parameters: Type.Object({
      destination: Type.String({
        description: '"cloud", or a device_id from the connected devices list.',
      }),
      prompt: Type.String({
        description: "Your brief to yourself, which you read there to carry on: what the user asked and what to do there. Self-contained.",
      }),
    }),
    // Moving to one place twice is moving there once.
    replay: "safe",
    execute: async (args, api, context) => {
      const self = (await api.snapshot(StellaAgentDoc, api.conversationId, context)) ?? { agentType: "orchestrator" };
      if (self.agentType !== "orchestrator") {
        throw new Error("Only Stella moves. For work on another computer, ask Stella to start an agent there.");
      }
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
      const moved = await host.moveBrain(target, brief, context);
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
