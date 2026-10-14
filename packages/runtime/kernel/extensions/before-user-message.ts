import type { RuntimePromptMessage } from "@stella/contracts/protocol";

export type BeforeUserMessagePayload = {
  agentType: string;
  userPrompt: string;
  staleUserReminderText?: string;
  connectorTransitionReminderText?: string;
};

export type BeforeUserMessageHookResult = {
  /**
   * Messages prepended to the prompt-message array in registration
   * order. Each hook's prepends land before any bundled startup
   * messages and before the user's typed prompt. Use `display: false`
   * (or `uiVisibility: "hidden"`) to keep the message out of the
   * user-facing chat surface.
   */
  prependMessages?: RuntimePromptMessage[];
  /**
   * Messages appended just before the user's typed prompt. Useful for
   * context that should land close to the user's text without sitting
   * inside the bundled startup section.
   */
  appendMessages?: RuntimePromptMessage[];
};

