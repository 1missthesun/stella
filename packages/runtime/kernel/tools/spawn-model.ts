import type {
  AgentRuntimeEngine,
  SpawnEngineSelection,
  SpawnReasoningEffort,
} from "@stella/contracts/agent-engine";
import { REASONING_EFFORT_LEVELS } from "@stella/contracts/reasoning-effort";
import { STELLA_DEFAULT_MODEL } from "@stella/contracts/stella-api";
import { isRegisteredModelReference } from "../model-catalog.js";
import {
  isOpenEndedModelReference,
  isRegisteredBareStellaModelReference,
} from "../model-routing-matching.js";

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const SPAWN_ENGINE_IDS: Record<
  string,
  Exclude<AgentRuntimeEngine, "default">
> = {
  codex: "codex_cli",
  "claude-code": "claude_code_local",
};

export type SpawnModelSelection =
  | { kind: "default"; reasoningEffort?: SpawnReasoningEffort }
  | { kind: "model"; model: string; reasoningEffort?: SpawnReasoningEffort }
  | {
      kind: "engine";
      engine: SpawnEngineSelection;
      reasoningEffort?: SpawnReasoningEffort;
    };

const SPAWN_REASONING_EFFORTS = new Set<SpawnReasoningEffort>(
  REASONING_EFFORT_LEVELS,
);

const splitSpawnReasoningSuffix = (
  raw: string,
): { model: string; suffix: string } | undefined => {
  const colon = raw.lastIndexOf(":");
  if (colon === -1) return undefined;
  const model = raw.slice(0, colon).trim();
  const suffix = raw
    .slice(colon + 1)
    .trim()
    .toLowerCase();
  return { model, suffix };
};

const invalidSpawnReasoningSuffix = (suffix: string): Error =>
  new Error(
    `Invalid spawn_agent model reasoning suffix ":${suffix}". Expected one of :low, :medium, :high, :xhigh, or :max; open-ended gateway references keep colons verbatim.`,
  );

export const parseSpawnAgentModel = (
  value: unknown,
  canResolveModel: (modelName: string) => boolean = () => false,
): SpawnModelSelection => {
  const raw = toOptionalString(value);
  if (!raw) return { kind: "default" };
  const fullReferenceIsModel =
    isRegisteredModelReference(raw) || isOpenEndedModelReference(raw);
  const suffixParts = splitSpawnReasoningSuffix(raw);
  let modelReference = raw;
  let reasoningEffort: SpawnReasoningEffort | undefined;
  if (!fullReferenceIsModel && suffixParts) {
    const suffixIsEffort = SPAWN_REASONING_EFFORTS.has(
      suffixParts.suffix as SpawnReasoningEffort,
    );
    const slash = suffixParts.model.indexOf("/");
    const head = (
      slash === -1 ? suffixParts.model : suffixParts.model.slice(0, slash)
    ).toLowerCase();
    const baseIsKnownForm =
      suffixParts.model === "default" ||
      suffixParts.model === STELLA_DEFAULT_MODEL ||
      suffixParts.model.toLowerCase() === "stella" ||
      Boolean(SPAWN_ENGINE_IDS[head]) ||
      isRegisteredModelReference(suffixParts.model) ||
      isRegisteredBareStellaModelReference(suffixParts.model) ||
      canResolveModel(suffixParts.model);
    if (baseIsKnownForm && !suffixIsEffort) {
      throw invalidSpawnReasoningSuffix(suffixParts.suffix);
    }
    if (baseIsKnownForm && suffixIsEffort) {
      modelReference = suffixParts.model;
      reasoningEffort = suffixParts.suffix as SpawnReasoningEffort;
    }
  }
  if (modelReference === "default") {
    return { kind: "default", ...(reasoningEffort ? { reasoningEffort } : {}) };
  }
  if (modelReference.toLowerCase() === "stella") {
    return {
      kind: "engine",
      engine: { engine: "default" },
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };
  }
  const slash = modelReference.indexOf("/");
  const head = (
    slash === -1 ? modelReference : modelReference.slice(0, slash)
  ).toLowerCase();
  const engine = SPAWN_ENGINE_IDS[head];
  if (engine) {
    const model =
      slash === -1 ? undefined : modelReference.slice(slash + 1).trim();
    return {
      kind: "engine",
      engine: { engine, ...(model ? { model } : {}) },
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };
  }
  return {
    kind: "model",
    model: modelReference,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
};
