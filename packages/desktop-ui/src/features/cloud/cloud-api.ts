export type CloudConversation = {
  conversationId: string;
  ownerId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastPreview?: string;
  lastRole?: string;
  activity?: string;
};

export type { WorkspaceApp as CloudApp } from "@stella/contracts/workspace-apps";

export type CloudAgentThread = {
  threadId: string;
  ownerId: string;
  conversationId: string;
  parentTurnId?: string;
  parentThreadId?: string;
  description: string;
  placement: string;
  agentType: string;
  status: string;
  resultJson?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
};
