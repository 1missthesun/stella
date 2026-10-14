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
  type AgentStopResult,
} from "@stella/contracts/backend/agent-threads";

export const AGENT_MESSAGE_FRAMED_MAX_CHARS = AGENT_MESSAGE_MAX_CHARS + 1_024;

export type AgentMessagingCaller = Readonly<{
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
  threadIds?: string[],
): Promise<AgentDirectory> =>
  (await caller.ownerInternal("agentThreads.directory", {
    ownerGeneration: caller.ownerGeneration,
    conversationId,
    ...(threadIds?.length ? { threadIds } : {}),
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

export const stopAgentThread = async (
  caller: AgentMessagingCaller,
  input: { conversationId: string; threadId: string; controlRequestId: string; requesterThreadId?: string },
): Promise<AgentStopResult> =>
  (await caller.ownerInternal("agentThreads.stop", {
    ownerGeneration: caller.ownerGeneration,
    ...input,
  })) as AgentStopResult;

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
