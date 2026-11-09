import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ConversationId, type ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  DEVICE_OFFLINE_POLL_MS,
  DEVICE_OFFLINE_REASON,
  DEVICE_OFFLINE_RETRY_MS,
  deviceOfflineText,
  isDeviceOfflineError,
} from "@stella/contracts/device-offline";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { StellaAgentDoc } from "./agent-doc.ts";
import { describePlacement, parseSpawnDestination, samePlacement, type StellaPlacement } from "./placement.ts";

export const SWITCH_DESTINATION_TOOL_NAME = "switch_destination";

export type StellaExecutionHost = {
  moveBrain?(target: StellaPlacement, brief: string, context: Context): Promise<{ moved: StellaPlacement } | { error: string }>;
  standing?(deviceId: string, context: Context): Promise<DeviceStanding | undefined>;
  agentTarget?(
    deviceId: string,
    needs: { claudeCode: boolean },
    context: Context,
  ): Promise<{ deviceId: string; name: string; here?: true } | { error: string }>;
  leftBehind?(cwd: string): Promise<string | undefined>;
  moveAgent?(move: AgentMove, context: Context): Promise<{ where: string } | { error: string }>;
};

export const AGENT_MOVE_CLOUD = "cloud";

export type AgentMove = {
  threadId: string;
  agentConversationId: ConversationId;
  deviceId: string;
  name: string;
  brief: string;
  key: string;
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
  cwd?: string;
};

export const movedAgentBrief = (from: string, brief: string, held: readonly string[] = []): string =>
  [
    `[You moved yourself here from ${from} with switch_destination, and you run here now: your conversation so far is above. Files in your old working folder stayed on ${from}. This is your brief, not a new message from anyone.]`,
    brief,
    ...held,
  ].join("\n\n");

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

const pause = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", stop, { once: true });
  });

const RETRIED_NOTE = `Checked again for ${DEVICE_OFFLINE_RETRY_MS / 1000} seconds.`;

/** Retries an attempt the backend refused because its computer is offline, for a few seconds, then throws that refusal. */
export const whileDeviceOffline = async <T>(attempt: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  const deadline = Date.now() + DEVICE_OFFLINE_RETRY_MS;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (!isDeviceOfflineError(error)) throw error;
      if (Date.now() >= deadline) {
        throw Object.assign(new Error(`${(error as Error).message} ${RETRIED_NOTE}`), { reason: DEVICE_OFFLINE_REASON });
      }
      await pause(DEVICE_OFFLINE_POLL_MS, signal);
    }
  }
};

/** Waits a few seconds for an offline computer to come back; the standing it ends on. */
export const untilOnline = async (
  standing: ((deviceId: string, context: Context) => Promise<DeviceStanding | undefined>) | undefined,
  deviceId: string,
  context: Context,
): Promise<DeviceStanding | undefined> => {
  if (!standing) return undefined;
  const deadline = Date.now() + DEVICE_OFFLINE_RETRY_MS;
  for (;;) {
    const current = await standing(deviceId, context).catch(() => undefined);
    if (!current || current.online || Date.now() >= deadline) return current;
    await pause(DEVICE_OFFLINE_POLL_MS, context.abortSignal);
  }
};

export const offlineMoveRefusal = (device: Pick<DeviceDestination, "deviceId" | "lastSeenAt">, name: string, stay: string): string =>
  deviceOfflineText(
    { name, deviceId: device.deviceId, ...(device.lastSeenAt !== undefined ? { lastSeenAt: device.lastSeenAt } : {}) },
    `You can't move there now, and nothing moved. ${stay}`,
  );

export const deviceRefusal = (device: DeviceDestination, name: string): string | undefined => {
  if (!device.online) {
    return offlineMoveRefusal(device, name, "You still run where you are.");
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

export type AgentSwitch = (
  args: { destination: string; prompt?: string; leave_files?: boolean },
  api: ToolExecutionApi,
  context: Context,
) => Promise<{ content: Array<{ type: "text"; text: string }>; details?: Record<string, string> }>;

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
      if (target.kind === "device") await untilOnline(host.standing, target.deviceId, context);
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
