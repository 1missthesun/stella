/**
 * `agent_status` without a thread_id, and `send_message` to anyone the caller
 * did not start, for both cloud callers: the conversation's orchestrator and
 * a cloud agent. Both read and write through the owner's agent-thread index,
 * which sees every placement and every conversation.
 */

import {
  AGENT_MESSAGE_MAX_CHARS,
  type AgentDirectoryAgentRow,
  type AgentDirectorySessionRow,
  type AgentMessageSender,
} from "@stella/contracts/agent-directory";
import {
  agentMessageDelivery,
  type AgentControlCommand,
  type AgentControlResult,
  type AgentMessageDelivery,
  type AgentPauseResult,
} from "@stella/contracts/backend/agent-threads";

/** The longest a framed message gets: the text plus its `<agent-message>` envelope. */
export const AGENT_MESSAGE_FRAMED_MAX_CHARS = AGENT_MESSAGE_MAX_CHARS + 1_024;

export type AgentMessagingCaller = Readonly<{
  /** `OwnerGate.ownerInternal`, already scoped to the owner and generation. */
  ownerInternal: (name: string, args: unknown) => Promise<unknown>;
  ownerGeneration: string;
}>;

export type AgentDirectory = {
  agents: AgentDirectoryAgentRow[];
  sessions: AgentDirectorySessionRow[];
};

export const readAgentDirectory = async (
  caller: AgentMessagingCaller,
  conversationId: string,
): Promise<AgentDirectory> =>
  (await caller.ownerInternal("agentThreads.directory", {
    ownerGeneration: caller.ownerGeneration,
    conversationId,
  })) as AgentDirectory;

export const sendAgentMessage = async (
  caller: AgentMessagingCaller,
  input: {
    messageId: string;
    to: string;
    text: string;
    from: AgentMessageSender;
    conversationId: string;
  },
): Promise<AgentMessageDelivery> => {
  const result = await controlAgentThread(caller, {
    conversationId: input.conversationId,
    threadId: input.to,
    commandId: input.messageId,
    command: { kind: "message", text: input.text, from: input.from },
  });
  return agentMessageDelivery(result);
};

/** `pause_agent` for an agent wherever it runs, through the owner's one control path. */
export const pauseAgentThread = async (
  caller: AgentMessagingCaller,
  input: { conversationId: string; threadId: string; controlRequestId: string },
): Promise<AgentPauseResult> => {
  const result = await controlAgentThread(caller, {
    conversationId: input.conversationId,
    threadId: input.threadId,
    commandId: input.controlRequestId,
    command: { kind: "pause" },
  });
  return {
    threadId: result.threadId,
    outcome:
      result.outcome === "held" || result.outcome === "not_running" ? result.outcome : "paused",
    status: result.status ?? "unknown",
    attemptGeneration: result.attemptGeneration ?? 0,
    where: result.where ?? "in Stella's cloud",
    ...(result.note ? { note: result.note } : {}),
  };
};

export const controlAgentThread = async (
  caller: AgentMessagingCaller,
  input: {
    conversationId: string;
    threadId: string;
    commandId: string;
    command: AgentControlCommand;
  },
): Promise<AgentControlResult> =>
  (await caller.ownerInternal("agentThreads.control", {
    ownerGeneration: caller.ownerGeneration,
    ...input,
  })) as AgentControlResult;
