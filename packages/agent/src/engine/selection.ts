import type { ModelRef } from "@earendil-works/pi-durable";

export const CLAUDE_CODE_PROVIDER_ID = "claude-code";
export const CLAUDE_CODE_ENGINE_EXTENSION = "claude-code-engine";

export const onClaudeCode = (model: ModelRef | undefined): boolean => model?.provider === CLAUDE_CODE_PROVIDER_ID;

export const engineExtensionChange = (model: ModelRef | undefined): { add?: { name: string }[] } =>
  onClaudeCode(model) ? { add: [{ name: CLAUDE_CODE_ENGINE_EXTENSION }] } : {};
