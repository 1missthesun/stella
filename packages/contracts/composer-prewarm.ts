import type { CloudExecutionSelection } from "./agent-engine";

export type ComposerPrewarmTarget = "cloud" | "automatic";

export type ComposerPrewarmRequest = {
  target?: ComposerPrewarmTarget;
  execution?: CloudExecutionSelection;
};

export const composerPrewarmPath = (conversationId: string): string =>
  `/conversations/${encodeURIComponent(conversationId)}/prewarm`;

export const composerPrewarmTargetOf = (
  value: unknown,
): ComposerPrewarmTarget | undefined =>
  value === "cloud" || value === "automatic" ? value : undefined;
