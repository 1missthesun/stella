import type { ModelRef } from "@earendil-works/pi-durable";
import { CLAUDE_CODE_PROVIDER_ID, onClaudeCode } from "../engine/selection.ts";
import { accountProviderOfRegistryId } from "../provider/account-byok.ts";
import { parseStellaModelId, STELLA_PROVIDER_ID } from "../provider/stella.ts";

const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

export const agentMoveModel = (model: ModelRef | undefined, thinkingLevel?: string): string | undefined => {
  if (!model) return undefined;
  const effort = thinkingLevel && REASONING_EFFORTS.has(thinkingLevel) ? `:${thinkingLevel}` : "";
  if (model.provider === STELLA_PROVIDER_ID) {
    const alias = parseStellaModelId(model.modelId)?.alias;
    return alias ? `${alias.startsWith("stella/") ? alias : `stella/${alias}`}${effort}` : undefined;
  }
  if (onClaudeCode(model)) {
    return `${CLAUDE_CODE_PROVIDER_ID}${model.modelId && model.modelId !== "default" ? `/${model.modelId}` : ""}${effort}`;
  }
  return `${accountProviderOfRegistryId(model.provider) ?? model.provider}/${model.modelId}${effort}`;
};
