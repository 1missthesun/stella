import type { ToolMetadata, ToolResult } from "@stella/runtime/kernel/tools/types.js";
import { CLOUD_AGENT_MOVE_PATH, CLOUD_AGENT_MOVE_TOOL } from "./cloud-agent-move-protocol.js";

export { CLOUD_AGENT_MOVE_PATH, CLOUD_AGENT_MOVE_TOOL };

export const cloudAgentMoveTool: ToolMetadata = {
  name: CLOUD_AGENT_MOVE_TOOL,
  description:
    "Move yourself to one of the user's computers by device_id, and carry on there with this whole conversation from your brief (prompt). You move as a whole when this turn ends, and that computer's own Stella runs you from then on, with its files, apps, browser and sign-ins (and its Claude Code); your thread id, reports, messages and pauses follow you. Files in your cloud workspace do not move: push work in progress (a WIP branch is fine) before you move. End your turn right after calling it.",
  parameters: {
    type: "object",
    properties: {
      destination: { type: "string", description: "A device_id from the connected devices list." },
      prompt: {
        type: "string",
        description:
          "Your brief to yourself, which you read there to carry on: what you were asked and what to do there next. Self-contained.",
      },
      leave_files: {
        type: "boolean",
        description: "Move even though work in your cloud workspace is not pushed; it stays in the cloud.",
      },
    },
    required: ["destination", "prompt"],
    additionalProperties: false,
  },
};

export const runCloudAgentMove = async (
  post: (route: string, body: unknown) => Promise<Response>,
  turnId: string,
  params: Record<string, unknown>,
): Promise<ToolResult> => {
  const destination = typeof params.destination === "string" ? params.destination.trim() : "";
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  if (!destination) return { error: "destination is required: a device_id from the connected devices list." };
  if (!prompt) return { error: "Pass your brief as prompt: what you will do there next, as you will read it there." };
  const response = await post(CLOUD_AGENT_MOVE_PATH, { turnId, destination, prompt });
  const body = (await response.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null;
  if (!response.ok || !body?.ok || typeof body.text !== "string") {
    return { error: body?.error ?? `Your move could not be set up (${response.status}). Carry on here.` };
  }
  return { result: body.text };
};
