import type { ModelRef } from "@earendil-works/pi-durable";
import { cliEnginePick, onCliEngine } from "../engine/selection.ts";
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
  if (onCliEngine(model)) return cliEnginePick(model, thinkingLevel && REASONING_EFFORTS.has(thinkingLevel) ? thinkingLevel : undefined);
  return `${accountProviderOfRegistryId(model.provider) ?? model.provider}/${model.modelId}${effort}`;
};
