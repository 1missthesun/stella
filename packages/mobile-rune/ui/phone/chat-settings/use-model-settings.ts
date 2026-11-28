import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  ANTIGRAVITY_MODEL_IDS,
  antigravityModelInUse,
  antigravityModelOptions,
  ENGINE_MODEL_CATALOG,
  type EngineModelCatalog,
  type EngineModelOption,
} from "@stella/contracts/engine-model-catalog";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { normalizeReasoningEffortLevel, type ReasoningEffortLevel } from "@stella/contracts/reasoning-effort";
import { isComputerOnlyProviderId, type AccountProvider, type ComputerOnlyProviderId, type ProviderModel } from "@stella/contracts/backend/providers";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { fetchStellaModels } from "@/platform/backend/stella-models";
import { useServerFeature } from "@/platform/backend/server-discovery";
import { publishCloudExecutionSelection } from "@/features/cloud/cloud-execution-store";
import { useT } from "@/shared/i18n";
import { phoneAlert } from "../ask";
import { errorText, notifyError } from "./kit";

// packages/mobile's lib/use-cloud-model-settings on the desktop's backend client: the account's
// brains (Stella, Claude Code, ChatGPT, Google Antigravity on a computer, and the providers it
// connected), each one's models, the reasoning effort, and `engines.setExecution` writes, kept in
// order and shown at once (and handed to the cloud chat's next send).

export type ModelEngine = Exclude<CloudExecutionSelection["engine"], "provider">;

export const REASONING_OPTIONS: ReadonlyArray<{ id: ReasoningEffortLevel; label: string }> = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Med" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "XHigh" },
  { id: "max", label: "Max" },
];

const MODEL_ENGINE_OPTIONS: ReadonlyArray<{ id: ModelEngine; label: string }> = [
  { id: "stella", label: "Stella" },
  { id: "anthropic", label: "Claude Code" },
  { id: "chatgpt", label: "ChatGPT" },
];

export const STELLA_DEFAULT_MODEL = "stella/default";

type StellaCatalogModel = { id: string; name: string; allowedForAudience: boolean };

const FALLBACK_STELLA_MODELS: StellaCatalogModel[] = [{ id: STELLA_DEFAULT_MODEL, name: "Stella Recommended", allowedForAudience: true }];

async function fetchStellaCatalog(): Promise<StellaCatalogModel[]> {
  try {
    const parsed = await fetchStellaModels();
    const models = (parsed.data ?? [])
      .filter((model) => model.provider === "stella")
      .map((model) => ({ id: typeof model.id === "string" ? model.id : "", name: typeof model.name === "string" ? model.name : "", allowedForAudience: model.allowedForAudience !== false }))
      .filter((model) => model.id && model.name);
    return models.length > 0 ? models : FALLBACK_STELLA_MODELS;
  } catch {
    return FALLBACK_STELLA_MODELS;
  }
}

export type ModelOption = { id: string; label: string; description?: string; selected: boolean; available: boolean };

export type Brain =
  | { id: ModelEngine; kind: "engine"; engine: ModelEngine; label: string; mark: string }
  | { id: string; kind: "provider"; provider: AccountProvider; label: string; mark: string }
  | { id: string; kind: "computer"; provider: ComputerOnlyProviderId; label: string; mark: string };

export const providerBrainId = (provider: string) => `provider:${provider}`;

const brainIdOf = (execution: CloudExecutionSelection): string => (execution.engine === "provider" ? providerBrainId(execution.provider) : execution.engine);

const ENGINE_MARKS: Record<ModelEngine, string> = { stella: "stella", anthropic: "anthropic", chatgpt: "chatgpt" };

const ENGINE_OWNED_PROVIDERS = new Set(["stella", "chatgpt"]);

const COMPUTER_BRAINS: ReadonlyArray<{ provider: ComputerOnlyProviderId; label: string }> = [{ provider: "antigravity", label: "Google Antigravity" }];

const computerDefaultModel = (reported: readonly string[]): string => antigravityModelOptions(reported)[0]?.id ?? ANTIGRAVITY_MODEL_IDS[0]!;

export type ProviderModelsState = { status: "loading" } | { status: "error" } | { status: "ready"; models: ProviderModel[] };

type Loaded = { scope: string; catalog: StellaCatalogModel[]; engineModels: EngineModelCatalog };

const engineModelList = (engineModels: EngineModelCatalog, engine: ModelEngine): EngineModelOption[] =>
  engine === "anthropic" ? engineModels.claude : engine === "chatgpt" ? engineModels.chatgpt : [];

const defaultModelFor = (engine: ModelEngine, engineModels: EngineModelCatalog): string =>
  engine === "stella" ? STELLA_DEFAULT_MODEL : (engineModelList(engineModels, engine)[0]?.id ?? (engine === "anthropic" ? "default" : "gpt-6.1-sol"));

/** `scope` names the signed-in account (null: signed out, or the phone is using a computer). */
export function useModelSettings(scope: string | null) {
  const t = useT();
  const managedModels = useServerFeature("managedModels");
  const on = scope ? {} : ("skip" as const);
  const engines = useBackendValue("engines.get", on);
  const providerSettings = useBackendValue("providers.get", on);
  const devices = useBackendValue("devices.list", on);

  const currentScope = useRef<string | null>(scope);
  const writing = useRef(false);
  const desired = useRef<CloudExecutionSelection | null>(null);
  const readRevision = useRef(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [local, setLocal] = useState<{ scope: string; execution: CloudExecutionSelection } | null>(null);
  const [loading, setLoading] = useState(false);
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModelsState>>({});
  const providerModelsRef = useRef(providerModels);
  providerModelsRef.current = providerModels;

  useLayoutEffect(() => {
    currentScope.current = scope;
    writing.current = false;
    desired.current = null;
    setLoading(false);
    setLocal(null);
    setProviderModels({});
    return () => {
      currentScope.current = null;
    };
  }, [scope]);

  const serverExecution = engines ? (engines.selection ?? engines.execution) : null;
  useEffect(() => {
    if (!writing.current) setLocal(null);
  }, [serverExecution?.engine, serverExecution?.provider, serverExecution?.model, serverExecution?.reasoningEffort]);

  const execution = (local?.scope === scope ? local.execution : null) ?? serverExecution;
  const current = loaded?.scope === scope ? loaded : null;
  const catalog = current?.catalog ?? [];
  const engineModels = current?.engineModels ?? ENGINE_MODEL_CATALOG;
  const connectedProviders = useMemo(() => engines?.connections.filter(isEngineConnectionUsable).map((row) => row.provider), [engines]);
  const providers = useMemo(() => providerSettings?.providers.filter((provider) => !ENGINE_OWNED_PROVIDERS.has(provider.id)), [providerSettings]);

  /** The Stella catalog and ChatGPT's own model list, read again each time the drawer opens. */
  const refresh = useCallback(async () => {
    if (!scope) return;
    const revision = ++readRevision.current;
    setLoading(true);
    try {
      const [stella, chatgptModels] = await Promise.all([fetchStellaCatalog(), backendClient.call("engines.listModels", { provider: "chatgpt" }).catch(() => null)]);
      if (currentScope.current !== scope || readRevision.current !== revision) return;
      setLoaded({
        scope,
        catalog: stella,
        engineModels: chatgptModels?.models.length ? { ...ENGINE_MODEL_CATALOG, chatgpt: chatgptModels.models } : ENGINE_MODEL_CATALOG,
      });
    } finally {
      if (currentScope.current === scope && readRevision.current === revision) setLoading(false);
    }
  }, [scope]);

  const computerSignIns = useMemo(() => {
    const signedIn: Record<string, string[]> = {};
    for (const device of devices?.devices ?? []) {
      if (!device.online) continue;
      for (const { provider } of COMPUTER_BRAINS) {
        if (!device.availability?.capabilities.includes(provider)) continue;
        (signedIn[provider] ??= []).push(device.label?.trim() || "your computer");
      }
    }
    return signedIn;
  }, [devices]);

  const antigravityModels = useMemo(
    () => (devices?.devices ?? []).flatMap((device) => (device.online && device.availability?.capabilities.includes("antigravity") ? (device.availability.antigravityModels ?? []) : [])),
    [devices],
  );

  const apply = useCallback(
    (next: CloudExecutionSelection) => {
      if (!scope || !serverExecution) return;
      ++readRevision.current;
      setLocal({ scope, execution: next });
      publishCloudExecutionSelection(next);
      desired.current = next;
      if (writing.current) return;
      writing.current = true;
      let saved: CloudExecutionSelection = serverExecution;
      void (async () => {
        try {
          while (desired.current && currentScope.current === scope) {
            const target = desired.current;
            desired.current = null;
            await backendClient.call("engines.setExecution", { execution: target });
            saved = target;
          }
        } catch (error) {
          if (currentScope.current === scope) {
            desired.current = null;
            setLocal({ scope, execution: saved });
            publishCloudExecutionSelection(saved);
            notifyError();
            void phoneAlert(t("app.chat.miniModelPicker.updateFailedTitle"), errorText(error), "OK");
          }
        } finally {
          if (currentScope.current === scope) writing.current = false;
        }
      })();
    },
    [scope, serverExecution, t],
  );

  const brainId = execution ? brainIdOf(execution) : "stella";
  const engine: CloudExecutionSelection["engine"] = execution?.engine ?? "stella";
  const effort = normalizeReasoningEffortLevel(execution?.reasoningEffort);

  const loadProviderModels = useCallback(
    async (provider: string, force = false): Promise<ProviderModel[] | null> => {
      const known = providerModelsRef.current[provider];
      if (!force && known?.status === "ready") return known.models;
      if (!force && known?.status === "loading") return null;
      if (!scope) return null;
      const requestScope = scope;
      setProviderModels((all) => ({ ...all, [provider]: { status: "loading" } }));
      try {
        const result = await backendClient.call("providers.listModels", { provider });
        if (currentScope.current !== requestScope) return null;
        setProviderModels((all) => ({ ...all, [provider]: { status: "ready", models: result.models } }));
        return result.models;
      } catch {
        if (currentScope.current !== requestScope) return null;
        setProviderModels((all) => ({ ...all, [provider]: { status: "error" } }));
        return null;
      }
    },
    [scope],
  );

  useEffect(() => {
    if (execution?.engine === "provider" && !isComputerOnlyProviderId(execution.provider)) void loadProviderModels(execution.provider);
  }, [execution?.engine, execution?.provider, loadProviderModels]);

  const selectProviderModel = useCallback(
    (provider: string, model: string) => {
      if (!execution) return;
      const reasoningEffort = execution.engine === "provider" && execution.provider === provider ? execution.reasoningEffort : effort;
      apply({ engine: "provider", provider, model, reasoningEffort });
    },
    [apply, effort, execution],
  );

  const selectEngineModel = useCallback(
    (targetEngine: ModelEngine, model: string) => {
      if (!execution) return;
      if (targetEngine === "stella") {
        const allowed = model === STELLA_DEFAULT_MODEL || catalog.some((entry) => entry.id === model && entry.allowedForAudience);
        if (!allowed) return;
        apply({ engine: "stella", provider: "stella", model, reasoningEffort: effort });
        return;
      }
      if (!engineModelList(engineModels, targetEngine).some((entry) => entry.id === model)) return;
      apply(targetEngine === "anthropic" ? { engine: "anthropic", provider: "anthropic", model, reasoningEffort: effort } : { engine: "chatgpt", provider: "chatgpt", model, reasoningEffort: effort });
    },
    [apply, catalog, effort, engineModels, execution],
  );

  const selectEngine = useCallback(
    (targetEngine: ModelEngine) => {
      if (!execution || targetEngine === execution.engine) return;
      selectEngineModel(targetEngine, defaultModelFor(targetEngine, engineModels));
    },
    [engineModels, execution, selectEngineModel],
  );

  // A server without Stella's own models moves a chat still on Stella to a signed-in engine.
  useEffect(() => {
    if (managedModels || !serverExecution || serverExecution.engine !== "stella" || !connectedProviders) return;
    const target: ModelEngine | null = connectedProviders.includes("anthropic") ? "anthropic" : connectedProviders.includes("chatgpt") ? "chatgpt" : null;
    if (target) selectEngine(target);
  }, [managedModels, serverExecution, connectedProviders, selectEngine]);

  const selectEffort = useCallback(
    (next: ReasoningEffortLevel) => {
      if (execution) apply({ ...execution, reasoningEffort: next });
    },
    [apply, execution],
  );

  const brains = useMemo((): Brain[] => {
    const builtIn: Brain[] = MODEL_ENGINE_OPTIONS.filter((option) => managedModels || option.id !== "stella").map((option) => ({
      id: option.id,
      kind: "engine",
      engine: option.id,
      label: option.label,
      mark: ENGINE_MARKS[option.id],
    }));
    const computer: Brain[] = COMPUTER_BRAINS.map((brain) => ({ id: providerBrainId(brain.provider), kind: "computer", provider: brain.provider, label: brain.label, mark: brain.provider }));
    const accounts: Brain[] = (providers ?? []).map((provider) => ({ id: providerBrainId(provider.id), kind: "provider", provider, label: provider.label, mark: provider.id }));
    return [...builtIn, ...computer, ...accounts];
  }, [managedModels, providers]);

  const providerModelState = useCallback((provider: string): ProviderModelsState | undefined => providerModels[provider], [providerModels]);

  const modelsFor = useCallback(
    (target: string): ModelOption[] => {
      if (target.startsWith("provider:")) {
        const provider = target.slice("provider:".length);
        if (isComputerOnlyProviderId(provider)) {
          const selectedId = execution?.engine === "provider" && execution.provider === provider ? antigravityModelInUse(execution.model, antigravityModels) : null;
          return antigravityModelOptions(antigravityModels).map((model) => ({ id: model.id, label: model.name, description: model.description, selected: model.id === selectedId, available: true }));
        }
        const state = providerModels[provider];
        const selectedId = execution?.engine === "provider" && execution.provider === provider ? execution.model : null;
        const models = state?.status === "ready" ? state.models : [];
        const options: ModelOption[] = models.map((model) => ({ id: model.id, label: model.name, selected: model.id === selectedId, available: true }));
        if (selectedId && !options.some((option) => option.selected)) options.unshift({ id: selectedId, label: selectedId, selected: true, available: true });
        return options;
      }
      const targetEngine = target as ModelEngine;
      const selectedId = execution?.engine === targetEngine ? execution.model : null;
      if (targetEngine === "stella") {
        const models = catalog.some((model) => model.id === STELLA_DEFAULT_MODEL) ? catalog : [...FALLBACK_STELLA_MODELS, ...catalog];
        return models.map((model) => ({ id: model.id, label: model.name, selected: model.id === selectedId, available: model.allowedForAudience }));
      }
      return engineModelList(engineModels, targetEngine).map((model) => ({ id: model.id, label: model.name, description: model.description, selected: model.id === selectedId, available: true }));
    },
    [antigravityModels, catalog, engineModels, execution, providerModels],
  );

  const currentProviderModel =
    execution?.engine === "provider"
      ? (() => {
          const state = providerModels[execution.provider];
          return state?.status === "ready" ? state.models.find((model) => model.id === execution.model) : undefined;
        })()
      : undefined;
  const supportsEffortSelection = Boolean(execution && (execution.engine !== "provider" || currentProviderModel?.reasoning !== false));

  return useMemo(
    () => ({
      execution,
      engine,
      brainId,
      brains,
      providers,
      providerModelState,
      loadProviderModels,
      selectProviderModel,
      loading,
      refresh,
      effort,
      supportsEffortSelection,
      connectedProviders,
      computerSignIns,
      computerDefaultModel: computerDefaultModel(antigravityModels),
      modelsFor,
      selectModel: (model: string) => (execution?.engine === "provider" ? selectProviderModel(execution.provider, model) : selectEngineModel(engine as ModelEngine, model)),
      selectEngineModel,
      selectEngine,
      selectEffort,
    }),
    [
      antigravityModels,
      brainId,
      brains,
      computerSignIns,
      connectedProviders,
      effort,
      engine,
      execution,
      loadProviderModels,
      loading,
      modelsFor,
      providerModelState,
      providers,
      refresh,
      selectEffort,
      selectEngine,
      selectEngineModel,
      selectProviderModel,
      supportsEffortSelection,
    ],
  );
}

export type ModelSettings = ReturnType<typeof useModelSettings>;
