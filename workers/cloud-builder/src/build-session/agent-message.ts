import type { RpcResponse } from "@stella/contracts/backend/protocol";
import type { AgentTaskMessageResult } from "@stella/contracts/backend/agent-threads";
import type { CloudAgentMessageResponse } from "@stella/executor-cloud/cloud-agent-message-protocol";
import { sha256Hex } from "../hash.js";
import { ownerGateStub } from "../rpc-release.js";
import type { TurnRequest } from "./shared/types.js";

const reply = (body: CloudAgentMessageResponse) => Response.json(body, { headers: { "cache-control": "no-store" } });

/**
 * A cloud task's `send_message`. The sender is the turn's own thread, never
 * what the model says; the owner routes it (Stella and the task's lead
 * durably) or, with `done`, only checks that it is for whoever started the
 * task, since the executor files a finished report as the turn ends.
 */
export const serveAgentMessageRequest = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES">,
  turn: Pick<TurnRequest, "ownerId" | "ownerGeneration" | "turnId" | "attemptGeneration" | "threadId" | "agentRole">,
  body: Record<string, unknown>,
): Promise<Response> => {
  if (turn.agentRole === "orchestrator" || !turn.threadId) return reply({ ok: false, error: "Only an agent sends messages this way." });
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const callId = typeof body.callId === "string" ? body.callId : "";
  const done = body.done === true;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!to || !callId || (!done && !message)) return reply({ ok: false, error: "Pass thread_id and message." });
  const messageId = `cloud-msg:${(await sha256Hex(`${turn.threadId}\0${turn.turnId}\0${turn.attemptGeneration ?? 1}\0${callId}`)).slice(0, 48)}`;
  const response = (await ownerGateStub(env.OWNER_GATES, turn.ownerId).ownerInternal({
    name: "agentThreads.taskMessage",
    args: {
      ownerGeneration: turn.ownerGeneration,
      threadId: turn.threadId,
      messageId,
      to,
      ...(done ? { done: true } : { text: message }),
    },
    ownerGeneration: turn.ownerGeneration,
  })) as RpcResponse<AgentTaskMessageResult>;
  if (!response.ok) return reply({ ok: false, error: response.error.message });
  return reply({ ok: true, text: response.value.text, starter: response.value.starter });
};
