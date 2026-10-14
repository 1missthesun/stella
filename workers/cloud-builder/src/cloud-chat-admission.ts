import type { OwnerModelGrant } from "./owner-model-grants.js";
import type { CloudTurnStartRequest } from "@stella/contracts/turn-plane/turn-start";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import type { DevicesResponse } from "@stella/contracts/turn-plane/placement";
import type { OwnerHomeContext } from "./owner-home-context.js";

export type AdmittedCloudChat = {
  version: 1;
  ownerId: string;
  ownerGeneration: string;
  conversationId: string;
  clientMsgId: string;
  fingerprint: string;
  turnId: string;
  leaseId: string;
  fenceGeneration: string;
  admittedAt: number;
  snapshot: OwnerSnapshot;
  ownerModelGrant?: OwnerModelGrant;
};
export type CloudChatPreparation = {
  homeContext?: OwnerHomeContext;
  destinations?: DevicesResponse;
};
export type CloudChatHandoff =
  | { phase: "allocating"; turnId: string; leaseId: string }
  | { phase: "registered"; authority: AdmittedCloudChat }
  | { phase: "retired"; turnId: string; leaseId: string };
export const cloudChatHandoffKey = (dispatchId: string) =>
  `cloudChatHandoff:${dispatchId}`;
export const cloudChatTurnKey = (turnId: string) =>
  `cloudChatHandoffTurn:${turnId}`;

export const chatTurnFingerprintSource = (
  ownerId: string,
  conversationId: string,
  request: CloudTurnStartRequest,
): string =>
  JSON.stringify({
    kind: "chat",
    ownerId,
    conversationId,
    clientMsgId: request.clientMsgId,
    originUserMessageId: request.originUserMessageId,
    prompt: request.prompt,
    execution: request.execution
      ? {
          engine: request.execution.engine,
          provider: request.execution.provider,
          model: request.execution.model,
          reasoningEffort: request.execution.reasoningEffort,
        }
      : undefined,
    lane: request.lane,
    source: request.source,
    title: request.title,
    hiddenMessage: request.hiddenMessage,
    locale: request.locale,
    attachments: request.attachments,
    context: request.context,
    agentThreadControl: request.agentThreadControl
      ? {
          threadId: request.agentThreadControl.threadId,
          attemptGeneration: request.agentThreadControl.attemptGeneration,
          threadUpdatedAt: request.agentThreadControl.threadUpdatedAt,
          status: request.agentThreadControl.status,
          lifecycleReport: request.agentThreadControl.lifecycleReport,
        }
      : undefined,
    agentRuntime: request.agentRuntime,
    piAgent: request.piAgent,
  });
