import type { ModelRef } from "@earendil-works/pi-durable";

export const CLAUDE_CODE_PROVIDER_ID = "claude-code";
export const CLAUDE_CODE_ENGINE_EXTENSION = "claude-code-engine";

export const ANTIGRAVITY_CLI_PROVIDER_ID = "antigravity";
export const ANTIGRAVITY_CLI_ENGINE_EXTENSION = "antigravity-cli-engine";

export const CLI_ENGINE_EXTENSIONS: ReadonlySet<string> = new Set([CLAUDE_CODE_ENGINE_EXTENSION, ANTIGRAVITY_CLI_ENGINE_EXTENSION]);

export const onClaudeCode = (model: ModelRef | undefined): boolean => model?.provider === CLAUDE_CODE_PROVIDER_ID;
export const onAntigravityCli = (model: ModelRef | undefined): boolean => model?.provider === ANTIGRAVITY_CLI_PROVIDER_ID;
export const onCliEngine = (model: ModelRef | undefined): boolean => onClaudeCode(model) || onAntigravityCli(model);

export const cliEnginePick = (model: ModelRef, thinkingLevel?: string): string => {
  const effort = thinkingLevel && thinkingLevel !== "off" && thinkingLevel !== "minimal" ? `:${thinkingLevel}` : "";
  const modelId = model.modelId.trim();
  return `${model.provider}${modelId && modelId !== "default" ? `/${modelId}` : ""}${effort}`;
};

export const engineExtensionChange = (model: ModelRef | undefined): { add?: { name: string }[] } =>
  onClaudeCode(model)
    ? { add: [{ name: CLAUDE_CODE_ENGINE_EXTENSION }] }
    : onAntigravityCli(model)
      ? { add: [{ name: ANTIGRAVITY_CLI_ENGINE_EXTENSION }] }
      : {};
