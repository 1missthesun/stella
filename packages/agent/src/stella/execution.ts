import type { Context } from "@earendil-works/chord/context";
import { bool, obj, opt, str } from "@earendil-works/pi-schema";
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

export const SWITCH_TO_TOOL_NAME = "switch_to";
/** The name older builds gave the self-move tool; stored transcripts still carry it. */
export const LEGACY_SWITCH_DESTINATION_TOOL_NAME = "switch_destination";

export type StellaExecutionHost = {
  moveBrain?(target: StellaPlacement, brief: string, context: Context): Promise<{ moved: StellaPlacement } | { error: string }>;
  /**
   * Puts this conversation on `model` (a spawn_agent model string), and the app's model picker follows; with `brief`,
   * Stella continues from it on that model once this turn ends. Throws when the model can't run here.
   */
  switchBrainModel?(model: string, brief: string | undefined, context: Context): Promise<{ label: string }>;
  standing?(deviceId: string, context: Context): Promise<DeviceStanding | undefined>;
  agentTarget?(
    deviceId: string,
    needs: { claudeCode: boolean; model?: string },
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
  /** The model to run on there, as for spawn_agent, when it switches model as it moves (`model` is then ignored). */
  pick?: string;
  /** It stays on the computer it runs on and only changes model (`pick`): its next run there starts from the brief. */
  inPlace?: true;
};

export const movedAgentBrief = (from: string, brief: string, held: readonly string[] = [], model?: string): string =>
  [
    `[You moved yourself here from ${from} with switch_to${model ? `, now on ${model}` : ""}, and you run here now: your conversation so far is above. Files in your old working folder stayed on ${from}. This is your brief, not a new message from anyone.]`,
    brief,
    ...held,
  ].join("\n\n");

export const switchedAgentBrief = (model: string, brief: string): string =>
  [
    `[You switched yourself to ${model} with switch_to, and you run on it now: your conversation so far is above. This is your brief, not a new message from anyone.]`,
    brief,
  ].join("\n\n");

/** What Stella reads to carry on after she put this conversation on another model. */
export const switchedBrainBrief = (model: string, brief: string): string =>
  [
    `[You switched this conversation to ${model} with switch_to, and you run on it now: the conversation so far is above. Do not switch again. This is your brief, not a new message from the user.]`,
    brief,
  ].join("\n\n");

/** What a task reads first after whoever started it put it on another model. */
export const switchedByStarterNote = (model: string): string =>
  `[Whoever started you switched you to ${model}; your conversation so far is above, and any run on your old model was interrupted. Carry on from the message below.]`;

export { relocatedAgentBrief } from "./relocated-brief.js";

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

export const whileDeviceOffline = async <T>(attempt: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  const deadline = performance.now() + DEVICE_OFFLINE_RETRY_MS;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (!isDeviceOfflineError(error)) throw error;
      if (performance.now() >= deadline) {
        throw Object.assign(new Error(`${(error as Error).message} ${RETRIED_NOTE}`), { reason: DEVICE_OFFLINE_REASON });
      }
      await pause(DEVICE_OFFLINE_POLL_MS, signal);
    }
  }
};

export const untilOnline = async (
  standing: ((deviceId: string, context: Context) => Promise<DeviceStanding | undefined>) | undefined,
  deviceId: string,
  context: Context,
): Promise<DeviceStanding | undefined> => {
  if (!standing) return undefined;
  const deadline = performance.now() + DEVICE_OFFLINE_RETRY_MS;
  for (;;) {
    const current = await standing(deviceId, context).catch(() => undefined);
    if (!current || current.online || performance.now() >= deadline) return current;
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
  args: { destination?: string; model?: string; prompt?: string; leave_files?: boolean },
  api: ToolExecutionApi,
  context: Context,
) => Promise<{ output: Array<{ type: "text"; text: string }>; details?: Record<string, string> }>;

export const switchToTool = (host: StellaExecutionHost, rootPlacement: StellaPlacement, agentSwitch?: AgentSwitch) =>
  defineTool({
    name: SWITCH_TO_TOOL_NAME,
    description:
      'Move yourself, with this whole conversation, to "cloud" or one of the user\'s computers, onto another model or engine, or both; you continue from your brief once this turn ends, so end the turn with at most one short line. As Stella, the conversation\'s turns run there and on that model from then on, and the app\'s destination and model pickers follow. As an agent, your thread id, reports and messages stay with you; a move puts you under that place\'s Stella, with its files, apps, browser and sign-ins, but your working folder\'s files stay behind: commit and push first (a WIP branch is fine).',
    parameters: obj({
      destination: opt(str({ description: '"cloud" or a device_id.' })),
      model: opt(
        str({
          description:
            'The model to run on, as for spawn_agent: "<provider>/<model>", "claude-code" or "claude-code/<model>", "antigravity/<model>", "stella/<model>"; ":low" to ":max" sets reasoning.',
        }),
      ),
      prompt: str({
        description: "Your self-contained brief to read when you continue: what you were asked and what to do next.",
      }),
      leave_files: opt(bool({ description: "Agents: move even with uncommitted or unpushed changes, which stay behind." })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      if (!args.destination?.trim() && !args.model?.trim()) throw new Error("Pass destination, model, or both.");
      const self = (await api.snapshot(StellaAgentDoc, api.conversationId, context)) ?? { agentType: "orchestrator" };
      if (self.agentType !== "orchestrator") {
        if (!agentSwitch) throw new Error("You can't switch from here. To run somewhere else or on another model, ask Stella with send_message to \"stella\".");
        return await agentSwitch(args, api, context);
      }
      const brief = args.prompt?.trim();
      if (!brief) throw new Error("Pass your brief as prompt: what you will do next, as you will read it then.");
      const model = args.model?.trim();
      const target = args.destination?.trim() ? brainTarget(args.destination, rootPlacement) : undefined;
      const moves = target !== undefined && !samePlacement(target, rootPlacement);
      if (!moves && !model) {
        return { output: [{ type: "text", text: `You already run on ${describePlacement(rootPlacement)}. Carry on here.` }] };
      }
      if (moves && !host.moveBrain) throw new Error("This chat is stored only on this computer, so you can only run here.");
      if (model && !host.switchBrainModel) throw new Error("This conversation can't change its own model from here; the user picks it in the app.");
      const switched = model ? await host.switchBrainModel!(model, moves ? undefined : brief, context) : undefined;
      if (!moves) {
        return {
          output: [
            {
              type: "text",
              text: `You switch to ${switched!.label} once this turn ends: this conversation carries on on it from your brief, with everything so far, and the app's model picker shows it. End this turn now with at most one short line to the user; start no more work on this model.`,
            },
          ],
          details: { move: "model", model: model!, brief },
        };
      }
      if (target!.kind === "device") await untilOnline(host.standing, target!.deviceId, context);
      const moved = await host.moveBrain!(target!, brief, context);
      if ("error" in moved) throw new Error(moved.error);
      return {
        output: [
          {
            type: "text",
            text: `You are moving to ${describePlacement(moved.moved)}${switched ? ` and onto ${switched.label}` : ""}: from now on it takes this conversation's turns, and you carry on there with your brief once this turn ends, with the whole conversation. End this turn now with at most one short line to the user; start no more work here.`,
          },
        ],
        details: {
          move: "brain",
          destination: moved.moved.kind === "device" ? moved.moved.deviceId : moved.moved.kind,
          brief,
          ...(model ? { model } : {}),
        } satisfies Record<string, string> as Record<string, string>,
      };
    },
  });

const brainTarget = (raw: string, rootPlacement: StellaPlacement): StellaPlacement => {
  if (/^(local|here|this computer)$/iu.test(raw.trim())) return rootPlacement;
  const destination = parseSpawnDestination(raw);
  if (destination.kind === "here") return rootPlacement;
  return destination.kind === "cloud" ? { kind: "cloud" } : { kind: "device", deviceId: destination.deviceId };
};
