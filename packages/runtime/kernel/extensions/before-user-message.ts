import type { RuntimePromptMessage } from "@stella/contracts/protocol";

export type BeforeUserMessagePayload = {
  agentType: string;
  userPrompt: string;
  staleUserReminderText?: string;
  connectorTransitionReminderText?: string;
};

export type BeforeUserMessageHookResult = {
  prependMessages?: RuntimePromptMessage[];
  appendMessages?: RuntimePromptMessage[];
};

