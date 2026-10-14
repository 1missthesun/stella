import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  ENGINE_MODEL_CATALOG,
  type EngineModelCatalog,
  type EngineModelOption,
} from "@stella/contracts/engine-model-catalog";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { normalizeReasoningEffortLevel } from "@stella/contracts/reasoning-effort";
import type {
  AccountProvider,
  ProviderModel,
} from "@stella/contracts/backend/providers";
import { useT } from "../i18n";
import { getBackendClient, readBackendView } from "./backend";
import { authClient } from "./auth-client";
import { getAuthTokenForSubject } from "./auth-token";
import { observeCloudConversationIdentity } from "./cloud-conversation-auth";
import { useTokenOwner } from "./use-token-owner";
import { runOwnerBoundModelRequest } from "./cloud-model-selection";
import {
  fetchStellaCatalog,
  STELLA_DEFAULT_MODEL,
  stellaModelLabel,
  type StellaCatalog,
} from "./stella-model-catalog";
import { notifyError } from "./haptics";
import { userFacingError } from "./user-facing-error";
import { currentServerFeatures } from "./server-features";

export type ModelEngine = Exclude<CloudExecutionSelection["engine"], "provider">;

export const MODEL_ENGINE_OPTIONS: ReadonlyArray<{ id: ModelEngine; label: string }> = [
  { id: "stella", label: "Stella" },
  { id: "anthropic", label: "Claude Code" },
  { id: "chatgpt", label: "ChatGPT" },
];

const EMPTY_CATALOG: StellaCatalog = { models: [], agentKeys: [] };
const EMPTY_ENGINE_MODELS: EngineModelCatalog = { claude: [], chatgpt: [] };

export type ModelOption = {
  id: string;
  label: string;
  description?: string;
  selected: boolean;
  /** False when the account's plan can't use this model. */
  available: boolean;
};

/**
 * What a chat can run on: one of Stella's built-in engines, or a provider
 * whose key or sign-in is saved to the account. Built-ins are keyed by their
 * engine; account providers by `provider:<id>`, so the Anthropic API key and
 * Claude Code never share an id.
 */
export type Brain =
  | {
      id: ModelEngine;
      kind: "engine";
      engine: ModelEngine;
      label: string;
      mark: string;
    }
  | {
      id: string;
      kind: "provider";
      provider: AccountProvider;
      label: string;
      mark: string;
    };

export const providerBrainId = (provider: string) => `provider:${provider}`;

export const brainIdOf = (execution: CloudExecutionSelection): string =>
  execution.engine === "provider"
    ? providerBrainId(execution.provider)
    : execution.engine;

const ENGINE_MARKS: Record<ModelEngine, string> = {
  stella: "stella",
  anthropic: "anthropic",
  chatgpt: "chatgpt",
};

/** Ids the engines own; an account provider with one of these is skipped. */
const ENGINE_OWNED_PROVIDERS = new Set(["stella", "chatgpt"]);

type ProviderModelsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; models: ProviderModel[] };

type LoadedState = {
  scope: string;
  execution: CloudExecutionSelection;
  catalog: StellaCatalog;
  engineModels: EngineModelCatalog;
  connectedProviders: string[];
  providers: AccountProvider[];
};

const engineModelList = (
  engineModels: EngineModelCatalog,
  engine: ModelEngine,
): EngineModelOption[] =>
  engine === "anthropic"
    ? engineModels.claude
    : engine === "chatgpt"
      ? engineModels.chatgpt
      : [];

/** The first model an engine lands on when the user switches to it. */
const defaultModelFor = (
  engine: ModelEngine,
  engineModels: EngineModelCatalog,
): string =>
  engine === "stella"
    ? STELLA_DEFAULT_MODEL
    : (engineModelList(engineModels, engine)[0]?.id ??
      (engine === "anthropic" ? "default" : "gpt-6.1-sol"));

/**
 * The account's model selection. Lists and the saved choice both come from
 * the server, never from a paired computer; the desktop mirrors the saved
 * choice into its local runtime, so one pick applies to cloud and computer
 * turns alike.
 */
export function useCloudModelSettings(active: boolean) {
  const t = useT();
  const session = authClient.useSession();
  const identity = useMemo(
    () => observeCloudConversationIdentity(session.data),
    [session.data?.user?.id, session.data?.session?.id],
  );
  const owner = useTokenOwner(identity).identity;
  const scope = owner ? `${owner.identityKey}:${owner.identityRevision}` : null;
  const currentScope = useRef<string | null>(scope);
  const writePending = useRef(false);
  /** The newest pick still to be saved; picks made mid-save collapse into it. */
  const desired = useRef<CloudExecutionSelection | null>(null);
  const readRevision = useRef(0);
  const [state, setState] = useState<LoadedState | null>(null);
  const [loading, setLoading] = useState(false);
  const [providerModels, setProviderModels] = useState<
    Record<string, ProviderModelsState>
  >({});
  const providerModelsRef = useRef(providerModels);
  providerModelsRef.current = providerModels;
  useLayoutEffect(() => {
    currentScope.current = scope;
    writePending.current = false;
    desired.current = null;
    setLoading(false);
    setProviderModels({});
    return () => { currentScope.current = null; };
  }, [scope]);
  const loaded = state?.scope === scope ? state : null;
  const execution = loaded?.execution ?? null;
  const catalog = loaded?.catalog ?? EMPTY_CATALOG;
  const engineModels = loaded?.engineModels ?? EMPTY_ENGINE_MODELS;
  const connectedProviders = loaded?.connectedProviders;
  const providers = loaded?.providers;

  const refresh = useCallback(async () => {
    if (!owner || !scope || !active || writePending.current) return;
    const revision = ++readRevision.current;
    setLoading(true);
    try {
      const next = await runOwnerBoundModelRequest({
        getToken: () => getAuthTokenForSubject(owner.expectedSubject),
        isCurrent: () => currentScope.current === scope && readRevision.current === revision,
        request: async (token) => {
          const [settings, catalog, chatgptModels, providerSettings] = await Promise.all([
            readBackendView("engines.get", {}),
            fetchStellaCatalog({ headers: { Authorization: `Bearer ${token}` } }),
            // The cloud's ChatGPT account's own list; Stella's catalog
            // stands in while none is signed in or the list is unavailable.
            getBackendClient()
              .call("engines.listModels", { provider: "chatgpt" })
              .catch(() => null),
            // A server without account provider keys lists none.
            readBackendView("providers.get", {}).catch(() => null),
          ]);
          return {
            execution: settings.selection ?? settings.execution,
            providers: (providerSettings?.providers ?? []).filter(
              (provider) => !ENGINE_OWNED_PROVIDERS.has(provider.id),
            ),
            connectedProviders: settings.connections
              .filter(isEngineConnectionUsable)
              .map((row) => row.provider),
            engineModels: chatgptModels?.models.length
              ? { ...ENGINE_MODEL_CATALOG, chatgpt: chatgptModels.models }
              : ENGINE_MODEL_CATALOG,
            catalog,
          };
        },
      });
      if (next) setState({ scope, ...next });
    } catch (error) {
      if (currentScope.current === scope) {
        Alert.alert(t("settings.compactModelList.loadFailed"), userFacingError(error));
      }
    } finally {
      if (currentScope.current === scope && readRevision.current === revision) setLoading(false);
    }
  }, [owner, scope, active, t]);
  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * A pick shows at once and is saved behind it. Picks made while a save is
   * in flight are not dropped: the newest one is saved next. A failed save
   * puts back the last selection the server accepted and says so.
   */
  const apply = useCallback((next: CloudExecutionSelection) => {
    if (!active || !owner || !scope || !loaded) return;
    ++readRevision.current;
    setLoading(false);
    setState((current) => (current?.scope === scope ? { ...current, execution: next } : current));
    desired.current = next;
    if (writePending.current) return;
    writePending.current = true;
    let saved = loaded.execution;
    void (async () => {
      try {
        while (desired.current && currentScope.current === scope) {
          const target = desired.current;
          desired.current = null;
          await runOwnerBoundModelRequest({
            getToken: () => getAuthTokenForSubject(owner.expectedSubject),
            isCurrent: () => currentScope.current === scope,
            request: async () => {
              await getBackendClient().call("engines.setExecution", { execution: target });
            },
          });
          saved = target;
        }
      } catch (error) {
        if (currentScope.current === scope) {
          desired.current = null;
          setState((current) => (current?.scope === scope ? { ...current, execution: saved } : current));
          notifyError();
          Alert.alert(t("app.chat.miniModelPicker.updateFailedTitle"), userFacingError(error));
        }
      } finally {
        if (currentScope.current === scope) writePending.current = false;
      }
    })();
  }, [active, owner, scope, loaded, t]);

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
      setProviderModels((current) => ({ ...current, [provider]: { status: "loading" } }));
      try {
        const result = await getBackendClient().call("providers.listModels", { provider });
        if (currentScope.current !== requestScope) return null;
        setProviderModels((current) => ({
          ...current,
          [provider]: { status: "ready", models: result.models },
        }));
        return result.models;
      } catch {
        if (currentScope.current !== requestScope) return null;
        setProviderModels((current) => ({ ...current, [provider]: { status: "error" } }));
        return null;
      }
    },
    [scope],
  );

  useEffect(() => {
    if (execution?.engine === "provider") void loadProviderModels(execution.provider);
  }, [execution, loadProviderModels]);

  const selectProviderModel = useCallback(
    (provider: string, model: string) => {
      if (!execution) return;
      const reasoningEffort =
        execution.engine === "provider" && execution.provider === provider
          ? execution.reasoningEffort
          : effort;
      void apply({ engine: "provider", provider, model, reasoningEffort });
    },
    [apply, effort, execution],
  );

  const selectEngineModel = useCallback(
    (targetEngine: ModelEngine, model: string) => {
      if (!execution) return;
      if (targetEngine === "stella") {
        const allowed =
          model === STELLA_DEFAULT_MODEL ||
          catalog.models.some((entry) => entry.id === model && entry.allowedForAudience);
        if (!allowed) return;
        void apply({ engine: "stella", provider: "stella", model, reasoningEffort: effort });
        return;
      }
      if (!engineModelList(engineModels, targetEngine).some((entry) => entry.id === model)) {
        return;
      }
      // The chosen effort carries over to the new engine, which maps it to its own levels.
      const reasoningEffort = effort;
      void apply(
        targetEngine === "anthropic"
          ? { engine: "anthropic", provider: "anthropic", model, reasoningEffort }
          : { engine: "chatgpt", provider: "chatgpt", model, reasoningEffort },
      );
    },
    [apply, catalog.models, effort, engineModels, execution],
  );

  const selectEngine = useCallback(
    (targetEngine: ModelEngine) => {
      if (!execution || targetEngine === execution.engine) return;
      selectEngineModel(targetEngine, defaultModelFor(targetEngine, engineModels));
    },
    [engineModels, execution, selectEngineModel],
  );

  const selectEffort = useCallback(
    (next: CloudExecutionSelection["reasoningEffort"]) => {
      if (execution) void apply({ ...execution, reasoningEffort: next });
    },
    [apply, execution],
  );

  const brains = useMemo((): Brain[] => {
    // A self-hosted server without managed models has no "Stella" engine.
    const managed = currentServerFeatures().managedModels;
    const builtIn: Brain[] = MODEL_ENGINE_OPTIONS.filter(
      (option) => managed || option.id !== "stella",
    ).map((option) => ({
      id: option.id,
      kind: "engine",
      engine: option.id,
      label: option.label,
      mark: ENGINE_MARKS[option.id],
    }));
    const accounts: Brain[] = (providers ?? []).map((provider) => ({
      id: providerBrainId(provider.id),
      kind: "provider",
      provider,
      label: provider.label,
      mark: provider.id,
    }));
    return [...builtIn, ...accounts];
  }, [providers]);

  const providerModelState = useCallback(
    (provider: string): ProviderModelsState | undefined => providerModels[provider],
    [providerModels],
  );

  const modelsFor = useCallback(
    (target: string): ModelOption[] => {
      if (target.startsWith("provider:")) {
        const provider = target.slice("provider:".length);
        const state = providerModels[provider];
        const selectedId =
          execution?.engine === "provider" && execution.provider === provider
            ? execution.model
            : null;
        const models = state?.status === "ready" ? state.models : [];
        const options = models.map((model) => ({
          id: model.id,
          label: model.name,
          selected: model.id === selectedId,
          available: true,
        }));
        if (selectedId && !options.some((option) => option.selected)) {
          options.unshift({ id: selectedId, label: selectedId, selected: true, available: true });
        }
        return options;
      }
      const targetEngine = target as ModelEngine;
      const selectedId = execution?.engine === targetEngine ? execution.model : null;
      if (targetEngine === "stella") {
        // The opaque default is always selectable, even when the catalog
        // lists no concrete model for this plan.
        const models = catalog.models.some((model) => model.id === STELLA_DEFAULT_MODEL)
          ? catalog.models
          : [
              { id: STELLA_DEFAULT_MODEL, name: "Stella Recommended", allowedForAudience: true },
              ...catalog.models,
            ];
        return models.map((model) => ({
          id: model.id,
          label: model.name,
          selected: model.id === selectedId,
          available: model.allowedForAudience,
        }));
      }
      return engineModelList(engineModels, targetEngine).map((model) => ({
        id: model.id,
        label: model.name,
        description: model.description,
        selected: model.id === selectedId,
        available: true,
      }));
    },
    [catalog.models, engineModels, execution, providerModels],
  );

  const label = useMemo(() => {
    if (!execution) return "Stella";
    if (execution.engine === "provider") {
      const state = providerModels[execution.provider];
      const name =
        (state?.status === "ready"
          ? state.models.find((model) => model.id === execution.model)?.name
          : undefined) ?? execution.model;
      return name;
    }
    if (execution.engine === "stella") return stellaModelLabel(catalog, execution.model);
    const name =
      engineModelList(engineModels, execution.engine).find((model) => model.id === execution.model)
        ?.name ?? execution.model;
    return execution.engine === "anthropic" ? `Claude Code · ${name}` : name;
  }, [catalog, engineModels, execution, providerModels]);

  // The compact composer picker only lists models this plan can use.
  const models = useMemo(
    () => modelsFor(brainId).filter((model) => model.available),
    [brainId, modelsFor],
  );

  const currentProviderModel =
    execution?.engine === "provider"
      ? (() => {
          const state = providerModels[execution.provider];
          return state?.status === "ready"
            ? state.models.find((model) => model.id === execution.model)
            : undefined;
        })()
      : undefined;
  const supportsEffortSelection = Boolean(
    execution &&
      (execution.engine !== "provider" || currentProviderModel?.reasoning !== false),
  );

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
      label,
      effort,
      // Every engine takes the user's effort; only a provider model that
      // cannot reason hides it.
      supportsEffortSelection,
      /** Providers connected for cloud runs; undefined until loaded. */
      connectedProviders,
      models,
      modelsFor,
      selectModel: (model: string) =>
        execution?.engine === "provider"
          ? selectProviderModel(execution.provider, model)
          : selectEngineModel(engine as ModelEngine, model),
      selectEngineModel,
      selectEngine,
      selectEffort,
    }),
    [
      brainId,
      brains,
      providers,
      providerModelState,
      loadProviderModels,
      selectProviderModel,
      supportsEffortSelection,
      connectedProviders,
      effort,
      engine,
      execution,
      label,
      loading,
      models,
      modelsFor,
      refresh,
      selectEffort,
      selectEngine,
      selectEngineModel,
    ],
  );
}

export type ModelSettings = ReturnType<typeof useCloudModelSettings>;
