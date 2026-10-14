import type {
  AutomaticExecutionAdmissionInput,
  AutomaticExecutionStatusSnapshot,
} from "./execution-placement-core";

export type PlacementAttachment = { path: string; kind: "image" | "file" };

export const unifiedChatPlacementAdmission = (args: {
  dispatchId: string;
  userMessageEventId?: string;
  conversationId: string;
  prompt: string;
  attachments?: readonly PlacementAttachment[];
}): AutomaticExecutionAdmissionInput => {
  const attachments = args.attachments ?? [];
  return {
    idempotencyKey: args.dispatchId,
    ...(args.userMessageEventId ? { userMessageEventId: args.userMessageEventId } : {}),
    conversationId: args.conversationId,
    kind: "chat",
    prompt: args.prompt,
    subject: "computer",
    requiredCapabilities: attachments.length ? ["chat", "attachments"] : ["chat"],
    ...(attachments.length
      ? { attachments: attachments.map((entry) => entry.path) }
      : {}),
  };
};

export const unifiedChatPlacementStatusText = (
  dispatch: AutomaticExecutionStatusSnapshot,
): string | undefined =>
  dispatch.state === "cancel_pending" ? "Stopping" : undefined;
