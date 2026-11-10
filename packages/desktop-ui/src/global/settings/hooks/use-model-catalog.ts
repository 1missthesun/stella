import { useBackendValue } from "@/platform/backend/use-backend-view";
import type { BillingStatus } from "@stella/contracts/backend/billing";
import { normalizeBillingPlan } from "@stella/contracts/billing-plans";
import { useCallback, useMemo } from "react";
import { isWebsiteHost } from "@/platform/capabilities";
import { useDesktopAuthSession, getAuthSessionSnapshot } from "@/global/auth/services/auth-session";
import { backendClient } from "@/platform/backend/backend-client";
import { fetchStellaModels } from "@/platform/backend/stella-models";
import {
  getProviderDisplayName,
  groupCatalogModelsByProvider,
  listLocalCatalogModels,
  mergeCatalogModels,
  normalizeRuntimeCatalogSnapshot,
  normalizeStellaCatalogModels,
  searchCatalogModels,
  type CatalogDefaultModel,
  type CatalogModel,
  type ManagedRuntimeCatalogPayload,
  type ProviderGroup,
} from "@/global/settings/lib/model-catalog";
import {
  resolveBillingAudience,
  type ManagedModelAudience,
} from "@/global/billing/audience";
import {
  createResourceStore,
  useResourceStore,
} from "@/shared/lib/resource-cache";

type StellaCatalogPayload = {
  models: CatalogModel[];
  defaults: CatalogDefaultModel[];
};

type AuthSessionData =
  | {
      user?: {
        id?: string | null;
        email?: string | null;
        isAnonymous?: boolean | null;
      } | null;
      session?: {
        id?: string | null;
      } | null;
    }
  | null
  | undefined;

const MODEL_CATALOG_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const EMPTY_STELLA: StellaCatalogPayload = { models: [], defaults: [] };
const EMPTY_MANAGED: ManagedRuntimeCatalogPayload = {
  revision: 0,
  directModels: [],
};

const stellaCatalogStore = createResourceStore<string, StellaCatalogPayload>({
  staleMs: MODEL_CATALOG_REFRESH_INTERVAL_MS,
  fetcher: async () => {
    const data = await fetchStellaModels();
    return {
      models: normalizeStellaCatalogModels(data?.data ?? []),
      defaults: data.defaults ?? [],
    };
  },
});

const managedGatewayStore = createResourceStore<"default", ManagedRuntimeCatalogPayload>({
  staleMs: MODEL_CATALOG_REFRESH_INTERVAL_MS,
  accept: (next, current) => next.revision > current.revision,
  fetcher: async (_key, context) => {
    const data = await window.electronAPI?.system?.listLlmModels?.({
      forceRefresh: context.force,
    });
    if (!data) throw new Error("Model catalog IPC bridge is unavailable.");
    return normalizeRuntimeCatalogSnapshot(data);
  },
});

const ACCOUNT_MODELS_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

const accountModelsStore = createResourceStore<string, CatalogModel[]>({
  staleMs: ACCOUNT_MODELS_REFRESH_INTERVAL_MS,
  fetcher: async (key) => {
    const providers = key.slice(key.lastIndexOf("|") + 1).split(",").filter(Boolean);
    const lists = await Promise.all(
      providers.map((provider) =>
        backendClient
          .call("providers.listModels", { provider })
          .then(({ models }) =>
            models.map(
              (model): CatalogModel => ({
                id: `${provider}/${model.id}`,
                modelId: model.id,
                name: model.name || model.id,
                provider,
                providerName: getProviderDisplayName(provider),
                source: "local",
                contextWindow: model.contextWindow,
                input: model.supportsImages ? ["text", "image"] : ["text"],
                reasoning: model.reasoning,
              }),
            ),
          )
          .catch(() => []),
      ),
    );
    return lists.flat();
  },
});

const stopManagedCatalogUpdates =
  typeof window !== "undefined"
    ? window.electronAPI?.system?.onLlmModelsUpdated?.((snapshot) => {
        managedGatewayStore.push(
          "default",
          normalizeRuntimeCatalogSnapshot(snapshot),
        );
      })
    : undefined;
if (import.meta.hot && stopManagedCatalogUpdates) {
  import.meta.hot.dispose(stopManagedCatalogUpdates);
}

function getBillingAudienceKey(
  billingStatus: BillingStatus | undefined,
): string | null {
  return billingStatus ? normalizeBillingPlan(billingStatus.plan) : null;
}

function getSessionCacheKey(sessionData: AuthSessionData): string {
  if (!sessionData) return "signed-out";
  const user = sessionData.user;
  const identity =
    user?.id ?? user?.email ?? sessionData.session?.id ?? "unknown";
  const sessionId = sessionData.session?.id ?? "no-session";
  const kind = user?.isAnonymous === true ? "anonymous" : "account";
  return `${kind}:${identity}:${sessionId}`;
}

export function useModelCatalog() {
  const session = useDesktopAuthSession();
  const sessionData = session.data as AuthSessionData;
  const user = sessionData?.user ?? null;
  const hasConnectedAccount = Boolean(
    sessionData && user?.isAnonymous !== true,
  );
  const sessionCacheScope = getSessionCacheKey(sessionData);
  const billingStatus = useBackendValue(
    "billing.status",
    hasConnectedAccount ? {} : "skip",
  );
  const billingAudienceKey = getBillingAudienceKey(billingStatus);
  const audience = useMemo<ManagedModelAudience | null>(
    () =>
      resolveBillingAudience({
        hasConnectedAccount,
        billingStatus,
      }),
    [billingStatus, hasConnectedAccount],
  );
  const authAudienceKey = useMemo(() => {
    if (session.isPending) return null;
    if (!hasConnectedAccount) return `${sessionCacheScope}:audience:anonymous`;
    // Once billing resolves we key by the precise audience. Until then fetch
    // under a provisional key rather than returning null — the backend derives
    // the real audience (and `allowedForAudience`) from the auth token, not
    // from this client cache key, so the fetched data is already correct; the
    // audience only busts the cache so restricted styling re-evaluates on plan
    // change. Returning null here previously left the picker stuck on
    // "Loading Stella models…" forever whenever the billing query was slow or
    // failed (it swallows errors and never resolves).
    return `${sessionCacheScope}:audience:${billingAudienceKey ?? "pending"}`;
  }, [
    billingAudienceKey,
    hasConnectedAccount,
    session.isPending,
    sessionCacheScope,
  ]);

  const stellaCacheKey = authAudienceKey;

  const stellaQuery = useResourceStore(stellaCatalogStore, stellaCacheKey);
  const managedQuery = useResourceStore(managedGatewayStore, isWebsiteHost() ? null : "default");

  const accountProviders = useBackendValue(
    "providers.get",
    hasConnectedAccount ? {} : "skip",
  );
  const accountModelsKey = useMemo(() => {
    const connected = (accountProviders?.providers ?? [])
      .filter((provider) => provider.connection?.status === "ok")
      .map((provider) => provider.id)
      .sort();
    return connected.length > 0
      ? `${sessionCacheScope}|${connected.join(",")}`
      : null;
  }, [accountProviders, sessionCacheScope]);
  const accountQuery = useResourceStore(accountModelsStore, accountModelsKey);

  const stellaPayload = stellaQuery.data ?? EMPTY_STELLA;
  const managedPayload = managedQuery.data ?? EMPTY_MANAGED;

  const localModels = useMemo(() => isWebsiteHost() ? [] : listLocalCatalogModels(), []);
  const stellaModels = stellaPayload.models;
  const accountModels = accountQuery.data;
  const directModels = useMemo(
    () =>
      mergeCatalogModels(
        mergeCatalogModels(localModels, managedPayload.directModels),
        accountModels ?? [],
      ),
    [accountModels, managedPayload.directModels, localModels],
  );
  const mergedModels = useMemo(
    () => mergeCatalogModels(stellaModels, directModels),
    [directModels, stellaModels],
  );
  const groups = useMemo<ProviderGroup[]>(
    () => groupCatalogModelsByProvider(mergedModels),
    [mergedModels],
  );
  const searchModels = useMemo(
    () => (query: string) => searchCatalogModels(mergedModels, query),
    [mergedModels],
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      stellaQuery.refresh(),
      managedQuery.refresh(),
      accountQuery.refresh(),
    ]);
  }, [accountQuery, managedQuery, stellaQuery]);

  const errorMessage =
    managedPayload.configError ??
    managedQuery.error?.message ??
    managedPayload.catalogError ??
    stellaQuery.error?.message ??
    null;

  return {
    models: stellaModels,
    stellaModels,
    localModels: directModels,
    allModels: mergedModels,
    defaults: stellaPayload.defaults,
    groups,
    loading:
      stellaCacheKey === null ||
      (stellaQuery.isLoading && stellaPayload.models.length === 0),
    error: errorMessage,
    searchModels,
    refresh,
    refreshing: stellaQuery.isFetching || managedQuery.isFetching,
    audience,
  };
}

function buildAnonymousStellaCatalogKey(sessionData: AuthSessionData): string {
  return `${getSessionCacheKey(sessionData)}:audience:anonymous`;
}

export function preloadModelCatalogCache(): void {
  if (!isWebsiteHost()) void managedGatewayStore.ensure("default");

  const session = getAuthSessionSnapshot();
  if (session.isPending) return;

  const sessionData = session.data as AuthSessionData;
  const hasConnectedAccount = Boolean(
    sessionData && sessionData.user?.isAnonymous !== true,
  );
  if (hasConnectedAccount) return;

  void stellaCatalogStore.ensure(buildAnonymousStellaCatalogKey(sessionData));
}
