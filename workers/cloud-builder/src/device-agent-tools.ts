import type {
  AgentMessageDelivery,
  AgentThreadControl,
} from "@stella/contracts/backend/agent-threads";
import type {
  CloudAgentControlReceipt,
  CloudAgentControlStatus,
} from "./cloud-agent-dispatch.js";

export type DeviceAgentCaller = Readonly<{
  ownerInternal: (name: string, args: unknown) => Promise<unknown>;
  ownerGeneration: string;
  conversationId: string;
  parentTurnId: string;
  parentThreadId?: string;
}>;

const STATUSES: readonly CloudAgentControlStatus[] = [
  "running",
  "waiting_for_user",
  "resuming",
  "completed",
  "failed",
  "canceled",
];

const receiptStatus = (status: string): CloudAgentControlStatus =>
  status === "paused"
    ? "canceled"
    : STATUSES.includes(status as CloudAgentControlStatus)
      ? (status as CloudAgentControlStatus)
      : "failed";

const receiptOf = (
  control: AgentThreadControl,
  base: { description?: string; executorDeviceId: string },
): CloudAgentControlReceipt => ({
  threadId: control.threadId,
  attemptGeneration: control.attemptGeneration,
  threadUpdatedAt: control.threadUpdatedAt,
  status: receiptStatus(control.status),
  ...(base.description ? { description: base.description } : {}),
  executorDeviceId: base.executorDeviceId,
});

export const spawnDeviceAgent = async (
  caller: DeviceAgentCaller,
  input: {
    clientMsgId: string;
    targetDeviceId: string;
    description: string;
    prompt: string;
    model?: string;
    attachments?: readonly string[];
  },
): Promise<CloudAgentControlReceipt & { waitingForDevice?: boolean }> => {
  const control = (await caller.ownerInternal("agentThreads.spawnOnDevice", {
    ownerGeneration: caller.ownerGeneration,
    conversationId: caller.conversationId,
    parentTurnId: caller.parentTurnId,
    ...(caller.parentThreadId ? { parentThreadId: caller.parentThreadId } : {}),
    clientMsgId: input.clientMsgId,
    targetDeviceId: input.targetDeviceId,
    description: input.description,
    prompt: input.prompt,
    ...(input.model ? { model: input.model } : {}),
    ...(input.attachments?.length ? { attachments: [...input.attachments] } : {}),
  })) as AgentThreadControl;
  return {
    ...receiptOf(control, {
      description: input.description,
      executorDeviceId: input.targetDeviceId,
    }),
    ...(control.waitingForDevice ? { waitingForDevice: true } : {}),
  };
};

export const continueDeviceAgent = async (
  caller: DeviceAgentCaller,
  prior: CloudAgentControlReceipt,
  input: { controlRequestId: string; message: string },
): Promise<{ receipt: CloudAgentControlReceipt; delivery?: AgentMessageDelivery }> => {
  const control = (await caller.ownerInternal("agentThreads.continueOnDevice", {
    ownerGeneration: caller.ownerGeneration,
    conversationId: caller.conversationId,
    threadId: prior.threadId,
    controlRequestId: input.controlRequestId,
    description: prior.description ?? "Continued task",
    prompt: input.message,
  })) as AgentThreadControl;
  return {
    receipt: receiptOf(control, {
      ...(prior.description ? { description: prior.description } : {}),
      executorDeviceId: prior.executorDeviceId!,
    }),
    ...(control.delivery ? { delivery: control.delivery } : {}),
  };
};

export const cancelDeviceAgent = async (
  caller: DeviceAgentCaller,
  prior: CloudAgentControlReceipt,
  controlRequestId: string,
): Promise<CloudAgentControlReceipt> => {
  const result = (await caller.ownerInternal("agentThreads.cancelOnDevice", {
    ownerGeneration: caller.ownerGeneration,
    conversationId: caller.conversationId,
    threadId: prior.threadId,
    controlRequestId,
  })) as { canceled: boolean; control: AgentThreadControl };
  return receiptOf(result.control, {
    ...(prior.description ? { description: prior.description } : {}),
    executorDeviceId: prior.executorDeviceId!,
  });
};
