import { useMemo, type ReactNode } from "react";
import { useCloudChatBridge as useDomCloudChatBridge, type CloudChatBridge } from "@/features/cloud/use-cloud-chat-bridge";
import { CloudConversationStatusTail } from "../../../chat/CloudConversationStatusTail";

export * from "@/features/cloud/use-cloud-chat-bridge";

export function useCloudChatBridge(options: Parameters<typeof useDomCloudChatBridge>[0]): CloudChatBridge {
  const bridge = useDomCloudChatBridge(options);
  const { conversation } = bridge;
  const extraTail = useMemo<ReactNode>(() => (options.enabled ? <CloudConversationStatusTail conversation={conversation} /> : null), [conversation, options.enabled]);
  return { ...bridge, extraTail };
}
