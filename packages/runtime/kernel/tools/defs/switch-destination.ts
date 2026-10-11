import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import {
  DEVICES_PATH,
  type DeviceDestination,
} from "@stella/contracts/turn-plane/placement";
import { samePlacement, type StellaPlacement } from "@stella/agent/stella/placement";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";
import {
  claudeCodeToolEnvironments,
  claudeCodeToolsMovedAnswer,
} from "../../integrations/claude-code-tool-environment.js";
import { parseSpawnDestination } from "./agent-orchestration-def.js";

export const SWITCH_DESTINATION_TOOL_NAME = "switch_destination";

export type ExecutionDestinationSwitchTarget =
  | { mode: "automatic" }
  | { mode: "cloud" }
  | { mode: "device"; deviceId: string };

export type ExecutionDestinationSwitchRequest = {
  conversationId: string;
  runId?: string;
  target: ExecutionDestinationSwitchTarget;
  prompt?: string;
};

export type ExecutionDestinationSwitcher = (
  request: ExecutionDestinationSwitchRequest,
) => Promise<{ ok: true } | { ok: false; error: string }>;

export const SWITCH_DESTINATION_TOOL_DESCRIPTOR = {
  name: SWITCH_DESTINATION_TOOL_NAME,
  description:
    'Move where you or your tools run. For Stella, by default this moves yourself to another execution destination: the same switch the user flips in the app, so the chat\'s destination picker changes too, and your own tools (code, Read, and the rest) then run there. Use it when the user wants you, not a background agent, working on another computer or in the cloud. That move takes effect when this turn ends: you continue there with `prompt` as your brief, so end this turn right after calling it. With move: "tools" (always, for an agent) only your file and shell tools move: "cloud", a device_id, or "local" for this computer. You stay here with your conversation and carry on in this same turn; the new place is a fresh environment, and files and shells from where you were do not come along. Use it when the work needs that computer\'s files, programs or hardware, or to bring your tools back.',
  parameters: {
    type: "object",
    properties: {
      destination: {
        type: "string",
        description:
          'Where to move: "cloud", or a device_id from the connected devices list. This device\'s own id (or "local", for your tools) means this computer.',
      },
      prompt: {
        type: "string",
        description:
          'Your brief to yourself for the turn that continues at the destination: what the user asked and what to do there. Self-contained; it is the first thing you read after the move. Required for Stella\'s own move unless the destination is where you already are; optional with move: "tools".',
      },
      move: {
        type: "string",
        enum: ["tools", "brain"],
        description:
          'Stella only: "brain" (the default for Stella) moves the whole chat as described; "tools" moves only your tools. An agent always moves only its tools.',
      },
    },
    required: ["destination"],
  },
} as const;

const DEVICE_LIST_TIMEOUT_MS = 5_000;

const loadDevices = async (
  auth: { baseUrl: string; authToken: string },
): Promise<DeviceDestination[] | null> => {
  try {
    const response = await fetch(
      `${auth.baseUrl.replace(/\/+$/, "")}${DEVICES_PATH}`,
      {
        headers: { Authorization: `Bearer ${auth.authToken}` },
        signal: AbortSignal.timeout(DEVICE_LIST_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { devices?: unknown };
    return Array.isArray(body.devices)
      ? (body.devices as DeviceDestination[])
      : null;
  } catch {
    return null;
  }
};

const deviceRefusal = (device: DeviceDestination, name: string): string | null => {
  if (!device.online) {
    return `${name} is offline, so you can't move there now. Tell the user, or use spawn_agent with that destination if the work can wait for it to come back.`;
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
  return null;
};

/**
 * Only the calling session's file and shell tools move: Claude Code's
 * sessions turn their built-ins off while their tools run elsewhere
 * (`integrations/claude-code-tool-environment`). pi's agents and Stella have
 * their own `switch_destination` in their harness.
 */
const moveTools = async (
  destination: ReturnType<typeof parseSpawnDestination> | { kind: "local" },
  context: ToolContext,
): Promise<ToolResult> => {
  if (destination.kind === "here") {
    return { error: 'destination is required: "cloud", a device_id, or "local".' };
  }
  if (context.conversationId.startsWith("local_") || context.storageMode === "local") {
    return { error: "This chat is stored only on this computer, so your tools can only run here." };
  }
  const environments = claudeCodeToolEnvironments();
  const owner = {
    conversationId: context.conversationId,
    ...(context.agentId ? { agentId: context.agentId } : {}),
  };
  if (!environments?.attached(owner)) {
    return { error: "Your tools can't move from this runtime. Use spawn_agent with a destination instead." };
  }
  const target: StellaPlacement =
    destination.kind === "local" || (destination.kind === "device" && destination.deviceId === context.deviceId)
      ? { kind: "local" }
      : destination.kind === "cloud"
        ? { kind: "cloud" }
        : { kind: "device", deviceId: destination.deviceId };
  const moved = await environments.move(owner, target);
  if ("error" in moved) return { error: moved.error };
  if (samePlacement(moved.from, moved.to)) {
    return { result: "Your tools already run there. Carry on." };
  }
  return {
    result: claudeCodeToolsMovedAnswer(moved.from, moved.to, context.agentType === AGENT_IDS.ORCHESTRATOR),
    details: {
      move: "tools",
      destination: moved.to.kind === "device" ? moved.to.deviceId : moved.to.kind,
    },
  };
};

export const createSwitchDestinationTool = (options: {
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
  switchExecutionDestination?: ExecutionDestinationSwitcher;
}): ToolDefinition => ({
  ...SWITCH_DESTINATION_TOOL_DESCRIPTOR,
  label: "Switch destination",
  workingText: "Switching destination",
  replay: "unsafe",
  agentTypes: [AGENT_IDS.ORCHESTRATOR, AGENT_IDS.GENERAL],
  execute: async (args, context) => {
    const destination = parseSpawnDestination(args.destination);
    if (context.agentType !== AGENT_IDS.ORCHESTRATOR || args.move === "tools") {
      const local =
        typeof args.destination === "string" &&
        /^(local|here|this computer)$/iu.test(args.destination.trim());
      return await moveTools(local ? { kind: "local" } : destination, context);
    }
    if (args.move !== undefined && args.move !== "brain") {
      return { error: 'move is "tools" or "brain".' };
    }
    if (destination.kind === "here") {
      return { error: 'destination is required: "cloud" or a device_id.' };
    }
    if (context.conversationId.startsWith("local_") || context.storageMode === "local") {
      return {
        error: "This chat is stored only on this computer, so it can only run here.",
      };
    }
    const switcher = options.switchExecutionDestination;
    if (!switcher) {
      return {
        error: "This runtime can't change the chat's destination. Use spawn_agent with a destination instead.",
      };
    }
    if (destination.kind === "device" && destination.deviceId === context.deviceId) {
      const result = await switcher({
        conversationId: context.conversationId,
        ...(context.runId ? { runId: context.runId } : {}),
        target: { mode: "automatic" },
      });
      if (!result.ok) return { error: result.error };
      return {
        result:
          "You are already running on this computer. The chat's destination is now set to this computer, so later turns run here too. Carry on.",
      };
    }
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) {
      return {
        error: "prompt is required: write the brief you will continue from at the destination.",
      };
    }
    const auth = options.getCloudBackendAuth?.() ?? null;
    if (!auth) {
      return {
        error: "Moving to the cloud or another computer needs this computer to be signed in to Stella.",
      };
    }
    let name = "Stella's cloud";
    if (destination.kind === "device") {
      const devices = await loadDevices(auth);
      if (!devices) {
        return {
          error: "Couldn't read the connected devices list right now. Try again in a moment.",
        };
      }
      const device = devices.find((entry) => entry.deviceId === destination.deviceId);
      if (!device) {
        return {
          error: `No connected device has device_id ${destination.deviceId}. Use a device_id from the connected devices list, or "cloud".`,
        };
      }
      name = device.label?.trim() || destination.deviceId;
      const refusal = deviceRefusal(device, name);
      if (refusal) return { error: refusal };
    }
    const result = await switcher({
      conversationId: context.conversationId,
      ...(context.runId ? { runId: context.runId } : {}),
      target:
        destination.kind === "cloud"
          ? { mode: "cloud" }
          : { mode: "device", deviceId: destination.deviceId },
      prompt,
    });
    if (!result.ok) return { error: result.error };
    return {
      result: `Switched this chat to ${name}; the app's destination picker shows it now. You continue there from your brief as soon as this turn ends, and later turns run there too. End this turn now with one short line telling the user you're moving to ${name}. Do no more work here.`,
    };
  },
});
