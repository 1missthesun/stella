/**
 * An agent this BuildSession runs on Claude Code moving itself to one of the
 * owner's computers (`switch_destination`, `@stella/executor-cloud/cloud-agent-move`).
 *
 * The tool call is checked here while the agent still listens: the computer
 * exists, is online, takes work, and is signed in to Claude Code. The request
 * is kept for the turn, and once the turn's transcript is saved (and so in
 * the agent's log), `takeAgentMove` hands the thread to that computer through
 * the owner's agent threads, which continues it there with its brief.
 */
import type { RpcResponse } from "@stella/contracts/backend/protocol";
import type { AgentThreadCalls } from "@stella/contracts/backend/agent-threads";
import { findDeviceDestination } from "@stella/contracts/turn-plane/placement";
import { deviceRefusal, movedAgentBrief } from "@stella/agent/stella/execution";
import { sha256Hex } from "../hash.js";
import { ownerGateStub } from "../rpc-release.js";
import { log } from "./shared/keys.js";
import type { TurnRequest } from "./shared/types.js";

type MoveRequest = { deviceId: string; name: string; brief: string };

const moveKey = (turn: Pick<TurnRequest, "turnId" | "attemptGeneration">) =>
  `agent-move:${turn.turnId}:${turn.attemptGeneration ?? 1}`;

const BRIEF_MAX_CHARS = 6_000;

const reply = (body: { ok: true; text: string } | { ok: false; error: string }) =>
  Response.json(body, { headers: { "cache-control": "no-store" } });

/** The owner's computers as a cloud agent reads them, for its prompt. */
export const agentDevicesSection = async (env: Pick<Cloudflare.Env, "OWNER_GATES">, turn: TurnRequest): Promise<string | undefined> => {
  const listed = await ownerGateStub(env.OWNER_GATES, turn.ownerId)
    .devices()
    .catch(() => undefined);
  if (!listed || listed.devices.length === 0) return undefined;
  return [
    "# Connected devices",
    ...listed.devices.map(
      (device) => `- ${device.label?.trim() || device.deviceId} [device_id: ${device.deviceId}]: ${device.online ? "online" : "offline"}`,
    ),
    "To move yourself to one of these computers, pass its device_id to switch_destination.",
  ].join("\n");
};

export const serveAgentMoveRequest = async (
  storage: DurableObjectStorage,
  env: Pick<Cloudflare.Env, "OWNER_GATES">,
  turn: TurnRequest,
  body: Record<string, unknown>,
): Promise<Response> => {
  if (turn.agentRole === "orchestrator" || !turn.threadId) return reply({ ok: false, error: "Only an agent can move itself." });
  const destination = typeof body.destination === "string" ? body.destination.trim() : "";
  const brief = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!destination || !brief) return reply({ ok: false, error: "Pass destination (a device_id) and your brief as prompt." });
  if (destination.toLowerCase() === "cloud") return reply({ ok: false, error: "You already run in the cloud. Carry on here." });
  const listed = await ownerGateStub(env.OWNER_GATES, turn.ownerId)
    .devices()
    .catch(() => undefined);
  if (!listed) return reply({ ok: false, error: "Couldn't read the connected devices list right now. Try again in a moment." });
  const device = findDeviceDestination(listed.devices, destination);
  if (!device) {
    return reply({ ok: false, error: `No connected device has the device_id or name ${destination}. Use a device_id from the connected devices list.` });
  }
  const name = device.label?.trim() || device.deviceId;
  if (!device.online) return reply({ ok: false, error: `${name} is offline, so you can't move there now. Carry on here.` });
  const refusal = deviceRefusal(device, name);
  if (refusal) return reply({ ok: false, error: refusal });
  if (device.availability && !device.availability.capabilities.includes("claude-code")) {
    return reply({
      ok: false,
      error: `${name} isn't signed in to Claude Code, so you, on Claude Code, can't run there. Ask the user to sign in to Claude on ${name} (Settings › Account there) and try again.`,
    });
  }
  const request: MoveRequest = {
    deviceId: device.deviceId,
    name,
    brief: brief.length > BRIEF_MAX_CHARS ? `${brief.slice(0, BRIEF_MAX_CHARS)}\n[brief cut]` : brief,
  };
  await storage.put(moveKey(turn), request);
  return reply({
    ok: true,
    text: `You move to ${name} as soon as this turn ends: its own Stella continues you there with this whole conversation and your brief, under the same thread id, and your reports, messages and pauses follow you. Files in your cloud workspace stay in the cloud. End this turn now with one short line saying you are moving to ${name}; do no more work here.`,
  });
};

/**
 * After a turn that asked to move, once its transcript is saved: the owner
 * hands the thread to the computer. Undefined when it asked for nothing;
 * otherwise where it runs now, or why it stays.
 */
export const takeAgentMove = async (
  storage: DurableObjectStorage,
  env: Pick<Cloudflare.Env, "OWNER_GATES">,
  turn: TurnRequest,
): Promise<{ moved: string } | { failed: string } | undefined> => {
  const key = moveKey(turn);
  const request = await storage.get<MoveRequest>(key);
  if (!request || !turn.threadId) return undefined;
  const conversationId = turn.conversationId ?? turn.originConversationId;
  try {
    if (!conversationId) throw new Error("this agent has no conversation to report to.");
    const execution = turn.execution;
    const model =
      execution?.engine === "anthropic" && execution.model && execution.model !== "default"
        ? `claude-code/${execution.model}`
        : "claude-code";
    const response = (await ownerGateStub(env.OWNER_GATES, turn.ownerId).ownerInternal({
      name: "agentThreads.cloudHandoff",
      args: {
        ownerGeneration: turn.ownerGeneration,
        handoffId: `move:${(await sha256Hex(`${turn.threadId}\0${turn.turnId}\0${turn.attemptGeneration ?? 1}`)).slice(0, 40)}`,
        threadId: turn.threadId,
        conversationId,
        targetDeviceId: request.deviceId,
        prompt: movedAgentBrief("Stella's cloud", request.brief),
        model,
      },
      ownerGeneration: turn.ownerGeneration,
    })) as RpcResponse<AgentThreadCalls["agentThreads.handoff"]["result"]>;
    if (!response.ok) throw new Error(response.error.message);
    log("info", "cloud_agent_moved", { threadId: turn.threadId, to: request.deviceId });
    return { moved: response.value.where };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "cloud_agent_move_failed", { threadId: turn.threadId, message });
    return { failed: message };
  } finally {
    await storage.delete(key);
  }
};
