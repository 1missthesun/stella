export const STELLA_SEND_MESSAGE_EVENT = "stella:send-message";

export type StellaSendMessageDetail = {
  text: string;
  uiVisibility?: "visible" | "hidden";
  triggerKind?: string;
  triggerSource?: string;
  targetAgentId?: string;
};

export function toStellaMessageMetadata(
  detail: StellaSendMessageDetail,
): {
  ui?: { visibility?: "visible" | "hidden" };
  trigger?: { kind?: string; source?: string };
} | undefined {
  const uiVisibility = detail.uiVisibility;
  const triggerKind = detail.triggerKind?.trim();
  const triggerSource = detail.triggerSource?.trim();
  const targetAgentId = detail.targetAgentId?.trim();

  if (!uiVisibility && !triggerKind && !triggerSource && !targetAgentId) {
    return undefined;
  }

  return {
    ...(uiVisibility ? { ui: { visibility: uiVisibility } } : {}),
    ...((triggerKind || triggerSource || targetAgentId)
      ? {
          trigger: {
            ...(triggerKind ? { kind: triggerKind } : {}),
            ...(triggerSource ? { source: triggerSource } : {}),
            ...(targetAgentId ? { targetAgentId } : {}),
          },
        }
      : {}),
  };
}

