import { createElement } from "react";
import { ChatPanelTab, type ChatPanelOpenRequest } from "@/shell/ChatSidebar";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { useChatMessages } from "@/context/use-chat-messages";
import { TrashTabContent } from "./TrashTabContent";
import { HomeLauncherTab } from "./HomeLauncherTab";
import { displayTabs } from "@/features/workspace-display/tab-store";
import { useFileViewerStageOpen } from "@/features/workspace-display/file-viewer-store";
import { engineOverlay } from "./engine-overlay-store";
import {
  CHAT_DISPLAY_TAB_ID,
  HOME_DISPLAY_TAB_ID,
  TRASH_DISPLAY_TAB_ID,
  registerWorkspaceDefaultTabs,
} from "@/features/workspace-display/default-tabs";
import type { OpenTabOptions } from "@/features/workspace-display/types";
import { showInViewer } from "@/features/workspace-display/open-payload";

export {
  CHAT_DISPLAY_TAB_ID,
  HOME_DISPLAY_TAB_ID,
  TRASH_DISPLAY_TAB_ID,
} from "@/features/workspace-display/default-tabs";

function ChatDisplayTab({
  openRequest,
}: {
  openRequest: ChatPanelOpenRequest | null;
}) {
  const panelExpanded = useFileViewerStageOpen();
  const chat = useChatRuntime();
  const messages = useChatMessages();

  return (
    <ChatPanelTab
      openRequest={openRequest}
      wideLayout={panelExpanded}
      messages={messages}
      isStreaming={chat.conversation.isStreaming}
      answerLanded={chat.conversation.streaming.answerLanded}
      runtimeStatusText={chat.conversation.streaming.runtimeStatusText}
      isCompacting={chat.conversation.streaming.isCompacting}
      activeToolCallId={chat.conversation.streaming.activeToolCallId}
      activeToolName={chat.conversation.streaming.activeToolName}
      isToolActive={chat.conversation.streaming.isToolActive}
      pendingUserMessageId={chat.conversation.pendingUserMessageId}
      hasOlderMessages={chat.conversation.hasOlderMessages}
      hasNewerMessages={chat.conversation.hasNewerMessages}
      isLoadingOlder={chat.conversation.isLoadingOlder}
      isLoadingNewer={chat.conversation.isLoadingNewer}
      isInitialLoading={chat.conversation.isInitialLoading}
      extraTail={chat.conversation.extraTail}
      onLoadOlder={chat.conversation.loadOlderMessages}
      onLoadNewer={chat.conversation.loadNewerMessages}
      onLoadLatest={chat.conversation.loadLatestMessages}
      onSend={chat.conversation.sendMessageWithContext}
      onStop={chat.conversation.cancelCurrentStream}
    />
  );
}

/**
 * The Chat tab: the conversation shown in the viewer while you're on another
 * route (Billing, Apps) and something sends text to Stella.
 */
export function openChatDisplayTab(
  openRequest: ChatPanelOpenRequest | null = null,
  opts?: OpenTabOptions,
): void {
  const activate = opts?.activate ?? true;
  displayTabs.openTab(
    {
      id: CHAT_DISPLAY_TAB_ID,
      kind: "chat",
      title: "Chat",
      render: () => createElement(ChatDisplayTab, { openRequest }),
    },
    { activate, openPanel: displayTabs.getLayoutSnapshot().panelOpen },
  );
  if (activate) showInViewer(CHAT_DISPLAY_TAB_ID);
}

export function openHomeDisplayTab(): void {
  displayTabs.openTab({
    id: HOME_DISPLAY_TAB_ID,
    kind: "home",
    title: "Home",
    tooltip: "Jump into Files, Trash, and more",
    render: () => createElement(HomeLauncherTab),
  });
}

export function ensureChatDisplayTab(): void {
  openChatDisplayTab(null, { activate: false, openPanel: false });
}

export function openTrashDisplayTab(): void {
  displayTabs.openTab(
    {
      id: TRASH_DISPLAY_TAB_ID,
      kind: "trash",
      title: "Trash",
      render: () => createElement(TrashTabContent),
    },
    { activate: true, openPanel: displayTabs.getLayoutSnapshot().panelOpen },
  );
  showInViewer(TRASH_DISPLAY_TAB_ID);
}

export function openModelPicker(): void {
  // The Models control lives in the top bar; it opens in place.
  engineOverlay.setOpen(true);
}

registerWorkspaceDefaultTabs({
  openModelPicker,
});
