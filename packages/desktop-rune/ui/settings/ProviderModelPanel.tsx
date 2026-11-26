import { BrandIcon, Check, ChevronDown, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, Input, KeyRound, Lightbulb, LogIn, LogOut, Press, RefreshCw, Search, Star, T, X, tx } from "../kit/compat";
import { useProviderModelPicker } from "./ProviderModelPicker.styles";
import { useAgentModelPicker } from "./AgentModelPicker.styles";
import { InAgentModelPicker } from "./model-picker-scope";
import { useEnginePlace } from "../global/execution-placement/engine-place.styles";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readEngineModelFavorites, sortByFavorites, toggleEngineModelFavorite, } from "@/features/workspace-display/engine-model-favorites";
import {
  getStellaResolvedModelName,
  searchCatalogModels,
  type CatalogModel,
  type ProviderGroup,
} from "@/global/settings/lib/model-catalog";
import {
  compareProviderRailOrder,
  LLM_PROVIDERS,
  isApiKeyOnlyPlaceholder,
  type LlmProviderEntry,
} from "@/global/settings/lib/llm-providers";
import { findApiKey, findOauthCredential, findOauthProvider, useLlmCredentials, } from "@/global/settings/hooks/use-llm-credentials";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
import { useAccountProviders } from "@/features/cloud/cloud-engines-api";
import { backendClient } from "@/platform/backend/backend-client";
import { providerOnlyHere, type ModelDestination } from "@/features/execution-placement/use-model-destination";
import { useT } from "@/shared/i18n";
import { DEFAULT_REASONING_EFFORT, REASONING_EFFORT_LEVELS, type ReasoningEffortLevel, } from "@stella/contracts/reasoning-effort";
export type ReasoningEffort = ReasoningEffortLevel;

const REASONING_OPTIONS: ReadonlyArray<{
  id: ReasoningEffort;
  labelKey: string;
}> = REASONING_EFFORT_LEVELS.map((id) => ({
    id,
    labelKey: `settings.modelPicker.reasoning.${id}`,
}));
const STELLA_PROVIDER_KEY = "stella";
const LOCAL_PROVIDER_KEY = "local";
const DEFAULT_TARGET = "__default__";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
export type ProviderTab = {
  key: string;
  label: string;
  models: CatalogModel[];
  llmEntry: LlmProviderEntry | undefined;
  runtimeManaged: boolean;
  runtimeManagedAuth: boolean;
  runtimeCredentialless: boolean;
};

type HeaderActionDescriptor = {
  connect: {
    label: string;
    onClick: () => void;
    disabled: boolean | undefined;
  } | null;
  signOut: {
    armed: boolean | undefined;
    disabled: boolean | undefined;
    label: string;
    title: string;
    onClick: () => void;
  } | null;
};

export type ProviderModelExtraSection = {
  key: string;
  label: string;
  brandKey?: string;
  badge?: string;
  selected?: boolean;
  content: () => ReactNode;
};

export interface ProviderModelPanelProps {
  value: string;
  defaultLabel: string;
  currentLabel: string;
  groups: readonly ProviderGroup[];
  onSelect: (value: string, anchor?: HTMLElement) => void;
  disabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  onSelectReasoning?: (modelId: string, effort: ReasoningEffort) => void;
  restrictStellaPicks?: boolean;
  restrictedPlanLabel?: string | null;
  ariaLabel?: string;
  hideDefaultRow?: boolean;
  selectedHeaderKicker?: string;
  hideSelectedTitle?: boolean;
  hideSearch?: boolean;
  hideSelectionCheck?: boolean;
  disableNonStellaProviders?: boolean;
  disabledProviderReason?: string;
  hideProviderLabel?: boolean;
  visibleProviders?: readonly string[];
  hiddenProviders?: readonly string[];
  favoriteScope?: string;
  hideGroupHead?: boolean;
  headerActionsTarget?: (descriptor: HeaderActionDescriptor | null) => void;
  authOpenRequest?: number;
  onRequestSearchClose?: () => void;
  collapsibleGroups?: boolean;
  activeSectionKey?: string | null;
  focusSection?: { section: string; seq: number } | null;
  extraSections?: readonly ProviderModelExtraSection[];
  sectionOrder?: readonly string[] | null;
  onExtraSectionExpanded?: (sectionKey: string, open: boolean) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  catalogError?: string | null;
  selectedRowExtra?: ReactNode;
  destination?: ModelDestination;
}

const normalizeResolvedModelId = (modelId: string): string => modelId.trim().replace(/^stella\//, "").toLowerCase();
const resolvedModelIdentity = (model: CatalogModel): string => normalizeResolvedModelId(model.upstreamModel || getStellaResolvedModelName(model));
const modelMatchesDefault = (model: CatalogModel, defaultModel: string): boolean => Boolean(defaultModel) &&
    (model.id === defaultModel ||
        resolvedModelIdentity(model) === normalizeResolvedModelId(defaultModel) ||
        getStellaResolvedModelName(model).trim().toLowerCase() ===
            defaultModel.trim().toLowerCase());
const dedupeStellaModels = (models: readonly CatalogModel[], selectedModelId: string): CatalogModel[] => {
    const byResolvedModel = new Map<string, CatalogModel>();
    for (const model of models) {
        const identity = resolvedModelIdentity(model);
        const existing = byResolvedModel.get(identity);
        if (!existing ||
            model.id === selectedModelId ||
            (existing.id !== selectedModelId &&
                existing.allowedForAudience === false &&
                model.allowedForAudience !== false)) {
            byResolvedModel.set(identity, model);
        }
    }
    return Array.from(byResolvedModel.values());
};
export const providerUsesRuntimeManagedAuth = (tab: Pick<ProviderTab, "runtimeManagedAuth" | "runtimeCredentialless">): boolean => tab.runtimeManagedAuth || tab.runtimeCredentialless;
export function buildProviderTabs(groups: readonly ProviderGroup[], visibleProviders?: readonly string[], hiddenProviders?: readonly string[]): ProviderTab[] {
    const tabs = new Map<string, ProviderTab>();
    for (const entry of LLM_PROVIDERS) {
        if (visibleProviders && !visibleProviders.includes(entry.key)) {
            continue;
        }
        if (hiddenProviders?.includes(entry.key)) {
            continue;
        }
        tabs.set(entry.key, {
            key: entry.key,
            label: entry.label,
            models: [],
            llmEntry: entry,
            runtimeManaged: false,
            runtimeManagedAuth: false,
            runtimeCredentialless: false,
        });
    }
    for (const group of groups) {
        if (visibleProviders && !visibleProviders.includes(group.provider)) {
            continue;
        }
        if (hiddenProviders?.includes(group.provider)) {
            continue;
        }
        const models = group.models;
        tabs.set(group.provider, {
            key: group.provider,
            label: group.providerName,
            models,
            llmEntry: LLM_PROVIDERS.find((entry) => entry.key === group.provider),
            runtimeManaged: group.runtimeManaged,
            runtimeManagedAuth: group.runtimeManagedAuth,
            runtimeCredentialless: group.runtimeCredentialless,
        });
    }
    return Array.from(tabs.values()).sort((a, b) => compareProviderRailOrder(a.key, b.key, a.label, b.label));
}
export function ProviderModelPanel({ value, defaultLabel, currentLabel, groups, onSelect, disabled = false, reasoningEffort, onSelectReasoning, restrictStellaPicks = false, restrictedPlanLabel, ariaLabel, hideDefaultRow = false, selectedHeaderKicker, hideSelectedTitle = false, hideSearch = false, hideSelectionCheck = false, disableNonStellaProviders = false, disabledProviderReason, hideProviderLabel = false, visibleProviders, hiddenProviders, favoriteScope, hideGroupHead = false, headerActionsTarget, authOpenRequest = 0, onRequestSearchClose, collapsibleGroups = false, activeSectionKey = null, focusSection = null, extraSections = [], sectionOrder = null, onExtraSectionExpanded, onRefresh, refreshing = false, catalogError = null, selectedRowExtra = null, destination, }: ProviderModelPanelProps) {
  const s = useProviderModelPicker();
  const sAgent = useAgentModelPicker();
  const inAgentPicker = useContext(InAgentModelPicker);
  const sEnginePlace = useEnginePlace();
    const t = useT();
    const credentials = useLlmCredentials();
    const { isAuthenticated } = useAuthState();
    const accountProviders = useAccountProviders(isAuthenticated);
    const accountConnected = useMemo(() => new Set((accountProviders?.providers ?? [])
        .filter((provider) => provider.connection?.status === "ok")
        .map((provider) => provider.id)), [accountProviders]);
    const accountCatalog = useMemo(() => new Set((accountProviders?.providers ?? []).map((provider) => provider.id)), [accountProviders]);
    const accountHolds = useMemo(() => new Set((accountProviders?.providers ?? [])
        .filter((provider) => provider.connection !== null)
        .map((provider) => provider.id)), [accountProviders]);
    const savesToAccount = isAuthenticated && accountCatalog.size > 0;
    const cancelOAuth = credentials.cancelOAuth;
    const tabs = useMemo(() => buildProviderTabs(groups, visibleProviders, hiddenProviders), [groups, hiddenProviders, visibleProviders]);
    const [favorites, setFavorites] = useState<string[]>(() => favoriteScope ? readEngineModelFavorites(favoriteScope) : []);
    const disabledProviderSet = useMemo(() => new Set(disableNonStellaProviders
        ? tabs
            .map((tab) => tab.key)
            .filter((key) => key !== STELLA_PROVIDER_KEY)
        : []), [disableNonStellaProviders, tabs]);
    const [query, setQuery] = useState("");
    const searchInputId = `model-picker-search-${useId()}`;
    const searchVisible = !hideSearch;
    useEffect(() => {
        if (searchVisible)
            void stella.engine.focus(searchInputId);
    }, [searchVisible, searchInputId]);
    const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
    const [draftKey, setDraftKey] = useState("");
    const [savingProvider, setSavingProvider] = useState<string | null>(null);
    const [oauthProvider, setOauthProvider] = useState<string | null>(null);
    const oauthAttemptRef = useRef<{ provider: string; cancelled: boolean } | null>(null);
    const [authError, setAuthError] = useState<string | null>(null);
    const [customModelId, setCustomModelId] = useState("");
    const [localBaseUrl, setLocalBaseUrl] = useState(DEFAULT_LOCAL_BASE_URL);
    const [localModelId, setLocalModelId] = useState("");
    const sections = useMemo(() => {
        const trimmed = hideSearch ? "" : query.trim();
        const result: Array<{ tab: ProviderTab; models: CatalogModel[] }> = [];
        for (const tab of tabs) {
            const searched = trimmed
                ? searchCatalogModels(tab.models, trimmed)
                : tab.models;
            const sorted = favoriteScope
                ? sortByFavorites(searched, favorites)
                : searched;
            let visibleModels = tab.key === STELLA_PROVIDER_KEY
                ? dedupeStellaModels(sorted, value)
                : sorted;
            if (tab.key !== STELLA_PROVIDER_KEY &&
                tab.key !== LOCAL_PROVIDER_KEY &&
                value.startsWith(`${tab.key}/`) &&
                !tab.models.some((model) => model.id === value) &&
                (!trimmed ||
                    value.toLowerCase().includes(trimmed.toLowerCase()))) {
                const customSlug = value.slice(tab.key.length + 1);
                const customModel: CatalogModel = {
                    id: value,
                    name: customSlug,
                    provider: tab.key,
                    providerName: tab.label,
                    modelId: customSlug,
                    source: "local",
                };
                visibleModels = [customModel, ...visibleModels];
            }
            if (trimmed && visibleModels.length === 0)
                continue;
            result.push({ tab, models: visibleModels });
        }
        return result;
    }, [tabs, favoriteScope, favorites, hideSearch, query, value]);
    const toggleFavorite = useCallback((modelId: string) => {
        if (!favoriteScope)
            return;
        setFavorites(toggleEngineModelFavorite(favoriteScope, modelId));
    }, [favoriteScope]);
    const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(activeSectionKey ? [activeSectionKey] : []));
    useEffect(() => {
        if (!activeSectionKey)
            return;
        setOpenSections((current) => {
            if (current.has(activeSectionKey))
                return current;
            const next = new Set(current);
            next.add(activeSectionKey);
            return next;
        });
    }, [activeSectionKey]);
    const toggleSection = useCallback((sectionKey: string) => {
        setOpenSections((current) => {
            const next = new Set(current);
            if (next.has(sectionKey)) {
                next.delete(sectionKey);
            }
            else {
                next.add(sectionKey);
            }
            return next;
        });
    }, []);
    const extraSectionKeys = extraSections.map((extra) => extra.key).join("\0");
    const reportedOpenExtrasRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!onExtraSectionExpanded)
            return;
        const reported = reportedOpenExtrasRef.current;
        for (const key of extraSectionKeys ? extraSectionKeys.split("\0") : []) {
            const open = openSections.has(key);
            if (open === reported.has(key))
                continue;
            if (open)
                reported.add(key);
            else
                reported.delete(key);
            onExtraSectionExpanded(key, open);
        }
    }, [extraSectionKeys, onExtraSectionExpanded, openSections]);
    const handlePick = useCallback((modelId: string, anchor?: HTMLElement) => {
        if (disabled)
            return;
        onSelect(modelId === DEFAULT_TARGET ? "" : modelId, anchor);
    }, [disabled, onSelect]);
    const cancelPendingOAuth = useCallback(async (providerKey?: string | null) => {
        const attempt = oauthAttemptRef.current;
        if (!attempt || (providerKey && attempt.provider !== providerKey))
            return;
        attempt.cancelled = true;
        setOauthProvider((current) => current === attempt.provider ? null : current);
        await cancelOAuth(attempt.provider);
    }, [cancelOAuth]);
    const toggleExpanded = useCallback((providerKey: string | null) => {
        const pendingProvider = oauthAttemptRef.current?.provider;
        if (pendingProvider && pendingProvider !== providerKey) {
            void cancelPendingOAuth(pendingProvider);
        }
        setExpandedProvider(providerKey);
        if (providerKey && collapsibleGroups) {
            setOpenSections((current) => current.has(providerKey)
                ? current
                : new Set(current).add(providerKey));
        }
        setDraftKey("");
        setAuthError(null);
    }, [cancelPendingOAuth, collapsibleGroups]);
    useEffect(() => () => {
        const attempt = oauthAttemptRef.current;
        if (attempt) {
            attempt.cancelled = true;
            void cancelOAuth(attempt.provider);
        }
    }, [cancelOAuth]);
    useEffect(() => {
        const pendingProvider = oauthAttemptRef.current?.provider;
        if (pendingProvider && !tabs.some((tab) => tab.key === pendingProvider)) {
            void cancelPendingOAuth(pendingProvider);
        }
    }, [cancelPendingOAuth, tabs]);
    const [signOutArmed, setSignOutArmed] = useState<string | null>(null);
    const [signingOut, setSigningOut] = useState<string | null>(null);
    const signOutTimerRef = useRef<number | null>(null);
    const handleSignOut = useCallback(async (providerKey: string) => {
        if (signOutArmed !== providerKey) {
            setSignOutArmed(providerKey);
            if (signOutTimerRef.current) {
                window.clearTimeout(signOutTimerRef.current);
            }
            signOutTimerRef.current = window.setTimeout(() => setSignOutArmed(null), 3000);
            return;
        }
        if (signOutTimerRef.current) {
            window.clearTimeout(signOutTimerRef.current);
            signOutTimerRef.current = null;
        }
        setSignOutArmed(null);
        setSigningOut(providerKey);
        try {
            if (accountHolds.has(providerKey)) {
                await backendClient.call("providers.remove", { provider: providerKey });
            }
            if (findApiKey(credentials.apiKeys, providerKey)) {
                await credentials.removeApiKey(providerKey);
            }
            if (findOauthCredential(credentials.oauthCredentials, providerKey)) {
                await credentials.logoutOAuth(providerKey);
            }
        }
        catch {}
        finally {
            setSigningOut(null);
        }
    }, [accountHolds, credentials.apiKeys, credentials.oauthCredentials, credentials.logoutOAuth, credentials.removeApiKey, signOutArmed]);
    const handleSaveKey = useCallback(async (providerKey: string, label: string) => {
        const trimmed = draftKey.trim();
        if (!trimmed)
            return;
        setSavingProvider(providerKey);
        setAuthError(null);
        try {
            let accountError: string | null = null;
            if (savesToAccount && accountCatalog.has(providerKey)) {
                try {
                    await backendClient.call("providers.setApiKey", { provider: providerKey, apiKey: trimmed });
                }
                catch (caught) {
                    if ((caught as { reason?: unknown } | null)?.reason === "invalid_api_key") {
                        setAuthError(t("settings.modelPicker.errors.accountKeyRejected", { provider: label }));
                        return;
                    }
                    accountError = caught instanceof Error ? caught.message : "";
                }
            }
            await credentials.saveApiKey(providerKey, label, trimmed);
            setDraftKey("");
            if (accountError !== null) {
                setAuthError(t("settings.modelPicker.errors.accountSaveFailed"));
                return;
            }
            setExpandedProvider(null);
        }
        catch (caught) {
            setAuthError(caught instanceof Error
                ? caught.message
                : t("settings.modelPicker.errors.saveApiKey"));
        }
        finally {
            setSavingProvider(null);
        }
    }, [accountCatalog, credentials, draftKey, savesToAccount, t]);
    const handleLoginOAuth = useCallback(async (providerKey: string) => {
        const previousAttempt = oauthAttemptRef.current;
        if (previousAttempt) {
            await cancelPendingOAuth(previousAttempt.provider);
        }
        const attempt = { provider: providerKey, cancelled: false };
        oauthAttemptRef.current = attempt;
        setOauthProvider(providerKey);
        setAuthError(null);
        try {
            await credentials.loginOAuth(providerKey);
            if (!attempt.cancelled) {
                setExpandedProvider(null);
            }
        }
        catch (caught) {
            if (!attempt.cancelled) {
                setAuthError(caught instanceof Error
                    ? caught.message
                    : t("settings.modelPicker.errors.oauthLogin"));
            }
        }
        finally {
            if (oauthAttemptRef.current === attempt) {
                oauthAttemptRef.current = null;
                setOauthProvider(null);
            }
        }
    }, [cancelPendingOAuth, credentials, t]);
    const handleSubmitCustomModel = useCallback((provider: string) => {
        const trimmed = customModelId.trim();
        if (!trimmed)
            return;
        onSelect(trimmed.startsWith(`${provider}/`) ? trimmed : `${provider}/${trimmed}`);
    }, [onSelect, customModelId]);
    const handleSubmitLocal = useCallback(() => {
        const modelId = localModelId.trim();
        if (!modelId)
            return;
        const baseUrl = localBaseUrl.trim() || DEFAULT_LOCAL_BASE_URL;
        const encodedBaseUrl = encodeURIComponent(baseUrl);
        onSelect(modelId.startsWith(`${LOCAL_PROVIDER_KEY}/`)
            ? modelId
            : `${LOCAL_PROVIDER_KEY}/${encodedBaseUrl}/${modelId}`);
    }, [localBaseUrl, localModelId, onSelect]);
    const trimmedQuery = query.trim();
    const isDefaultSelected = !value;
    const inlineProviderActions = searchVisible && hideSelectedTitle && hideProviderLabel && tabs.length === 1;
    const renderSearchBar = () => (<row {...s.modelPickerSearch} {...(inlineProviderActions || onRefresh ? s.modelPickerSearchRow_modelPickerSearch : null)}>
        <Search size={13} strokeWidth={1.75} color={s.modelPickerSearch.color} />
        <Input id={searchInputId} type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
            if (e.key === "Escape") {
                setQuery("");
                onRequestSearchClose?.();
            }
        }} placeholder={t("settings.modelPicker.searchPlaceholder")} spellCheck={false} autoComplete="off" label={t("settings.modelPicker.searchAriaLabel")} disabled={disabled} {...s.modelPickerSearch_input} />
        {onRequestSearchClose ? (<Press text={tx(s.modelPickerSearch)} {...s.modelPickerSearchClose} label={t("settings.modelPicker.closeSearch")} onPress={() => {
                setQuery("");
                onRequestSearchClose();
            }}>
            <X size={13} strokeWidth={1.75} color={s.modelPickerSearchClose.color} />
          </Press>) : null}
      </row>);
    const getSectionContext = (tab: ProviderTab) => {
        const isStella = tab.key === STELLA_PROVIDER_KEY;
        const isLocal = tab.key === LOCAL_PROVIDER_KEY;
        const isOpenRouter = tab.key === "openrouter";
        const apiKey = findApiKey(credentials.apiKeys, tab.key);
        const oauthCred = findOauthCredential(credentials.oauthCredentials, tab.key);
        const oauthEntry = findOauthProvider(credentials.oauthProviders, tab.key);
        const llmEntry = tab.llmEntry ??
            (!isStella
                ? {
                    key: tab.key,
                    label: tab.label,
                    placeholder: t("settings.modelPicker.apiKeyPlaceholder"),
                }
                : undefined);
        const localCredential = Boolean(apiKey) || Boolean(oauthCred);
        const onAccount = !isStella && !localCredential && accountConnected.has(tab.key);
        const connected = isStella || localCredential || onAccount;
        const usesRuntimeManagedAuth = providerUsesRuntimeManagedAuth(tab);
        const requiresAuth = !isStella &&
            !isLocal &&
            !usesRuntimeManagedAuth &&
            !connected &&
            Boolean(llmEntry);
        const supportsApiKey = Boolean(llmEntry) &&
            !isApiKeyOnlyPlaceholder(llmEntry?.placeholder ?? "");
        const supportsOAuth = Boolean(oauthEntry);
        const onlyHere = Boolean(destination) && !requiresAuth && providerOnlyHere(destination!, tab.key);
        const sectionDisabled = disabled || onlyHere || disabledProviderSet.has(tab.key);
        const removable = Boolean(apiKey) || Boolean(oauthCred) || (isAuthenticated && accountHolds.has(tab.key));
        const armed = signOutArmed === tab.key;
        const isSigningOut = signingOut === tab.key;
        const expanded = expandedProvider === tab.key;
        const acceptsModelId = !isStella && !isLocal;
        const hasCustomInputs = isLocal || acceptsModelId;
        const keyToAccount = savesToAccount && accountCatalog.has(tab.key);
        const authDescription = supportsOAuth && supportsApiKey
            ? t(keyToAccount ? "settings.modelPicker.authHint.bothAccount" : "settings.modelPicker.authHint.both")
            : supportsOAuth
                ? t("settings.modelPicker.authHint.oauth")
                : t(keyToAccount ? "settings.modelPicker.authHint.apiKeyAccount" : "settings.modelPicker.authHint.apiKey");
        return {
            tab,
            isStella,
            isLocal,
            isOpenRouter,
            acceptsModelId,
            llmEntry,
            requiresAuth,
            supportsApiKey,
            supportsOAuth,
            sectionDisabled,
            removable,
            armed,
            isSigningOut,
            expanded,
            hasCustomInputs,
            authDescription,
            onAccount,
            onlyHere,
        };
    };
    const renderGroupActions = ({ tab, requiresAuth, supportsOAuth, sectionDisabled, removable, armed, isSigningOut, expanded, hasCustomInputs, }: ReturnType<typeof getSectionContext>) => requiresAuth ? (<Press {...s.modelPickerGroupConnect} onPress={() => toggleExpanded(expanded ? null : tab.key)} disabled={sectionDisabled} {...((expanded || undefined) ? s.modelPickerGroupConnectOpen : null)} {...((sectionDisabled) ? s.modelPickerGroupConnectDisabled : null)}>
        {expanded
            ? t("settings.modelPicker.actions.cancel")
            : supportsOAuth
                ? t("settings.modelPicker.actions.signIn")
                : t("settings.modelPicker.actions.addKey")}
      </Press>) : (<>
        {hasCustomInputs ? (<Press {...s.modelPickerGroupConnect} onPress={() => toggleExpanded(expanded ? null : tab.key)} disabled={sectionDisabled} {...((expanded || undefined) ? s.modelPickerGroupConnectOpen : null)} {...((sectionDisabled) ? s.modelPickerGroupConnectDisabled : null)}>
            {expanded
                ? t("settings.modelPicker.actions.cancel")
                : t("settings.modelPicker.actions.custom")}
          </Press>) : null}
        {removable ? (<Press {...s.modelPickerGroupSignout} disabled={isSigningOut} label={armed
                ? t("settings.modelPicker.signOut.confirmAriaLabel", { provider: tab.label })
                : t("settings.modelPicker.signOut.ariaLabel", { provider: tab.label })} title={armed
                ? t("settings.modelPicker.signOut.confirmTitle")
                : t("settings.modelPicker.signOut.ariaLabel", { provider: tab.label })} onPress={(event) => {
                event.stopPropagation();
                void handleSignOut(tab.key);
            }} {...((armed || undefined) ? s.modelPickerGroupSignoutArmed : null)} {...((isSigningOut) ? s.modelPickerGroupSignoutDisabled : null)}>
            {armed ? (<Check size={13} strokeWidth={2} color={s.modelPickerGroupSignout.color} />) : (<LogOut size={13} strokeWidth={1.75} color={s.modelPickerGroupSignout.color} />)}
          </Press>) : null}
      </>);
    const liftActionsToHeader = Boolean(headerActionsTarget) && tabs.length === 1;
    const section = tabs.length === 1 ? getSectionContext(tabs[0]) : null;
    useEffect(() => {
        if (!authOpenRequest || !section?.requiresAuth)
            return;
        setAuthError(null);
        setDraftKey("");
        setExpandedProvider(section.tab.key);
    }, [authOpenRequest, section?.requiresAuth, section?.tab.key]);
    const focusTab = focusSection ? tabs.find((tab) => tab.key === focusSection.section) : undefined;
    const focusNeedsKey = focusTab ? getSectionContext(focusTab).requiresAuth : false;
    const handledFocusRef = useRef(0);
    useEffect(() => {
        if (!focusSection || !focusTab || handledFocusRef.current === focusSection.seq)
            return;
        handledFocusRef.current = focusSection.seq;
        const key = focusTab.key;
        setOpenSections((current) => current.has(key) ? current : new Set(current).add(key));
        if (focusNeedsKey) {
            setAuthError(null);
            setDraftKey("");
            setExpandedProvider(key);
        }
        requestAnimationFrame(() => {
            document
                .querySelector(`.model-picker-group[data-section="${CSS.escape(key)}"]`)
                ?.scrollIntoView({ block: "nearest" });
        });
    }, [focusSection, focusTab, focusNeedsKey]);
    const { requiresAuth: liftedRequiresAuth, supportsOAuth: liftedSupportsOAuth, expanded: liftedExpanded, sectionDisabled: liftedSectionDisabled, removable: liftedRemovable, armed: liftedArmed, isSigningOut: liftedIsSigningOut, hasCustomInputs: liftedHasCustomInputs, } = section ?? {};
    const liftedTabKey = section?.tab.key;
    const liftedTabLabel = section?.tab.label;
    const liftedDescriptor = useMemo(() => {
        if (!liftedTabKey)
            return null;
        const connect = liftedRequiresAuth || liftedHasCustomInputs
            ? {
                label: liftedExpanded
                    ? t("settings.modelPicker.actions.cancel")
                    : liftedRequiresAuth
                        ? liftedSupportsOAuth
                            ? t("settings.modelPicker.actions.signIn")
                            : t("settings.modelPicker.actions.addKey")
                        : t("settings.modelPicker.actions.custom"),
                onClick: () => toggleExpanded(liftedExpanded ? null : liftedTabKey),
                disabled: liftedSectionDisabled,
            }
            : null;
        const signOut = liftedRemovable
            ? {
                armed: liftedArmed,
                disabled: liftedIsSigningOut,
                label: liftedArmed
                    ? t("settings.modelPicker.signOut.confirmAriaLabel", { provider: liftedTabLabel ?? "" })
                    : t("settings.modelPicker.signOut.ariaLabel", { provider: liftedTabLabel ?? "" }),
                title: liftedArmed
                    ? t("settings.modelPicker.signOut.confirmTitle")
                    : t("settings.modelPicker.signOut.ariaLabel", { provider: liftedTabLabel ?? "" }),
                onClick: () => void handleSignOut(liftedTabKey),
            }
            : null;
        return connect || signOut ? { connect, signOut } : null;
    }, [handleSignOut, liftedArmed, liftedExpanded, liftedHasCustomInputs, liftedIsSigningOut, liftedRemovable, liftedRequiresAuth, liftedSectionDisabled, liftedSupportsOAuth, liftedTabKey, liftedTabLabel, t, toggleExpanded]);
    useEffect(() => {
        if (!headerActionsTarget || tabs.length !== 1)
            return undefined;
        headerActionsTarget(liftedDescriptor);
        return () => headerActionsTarget(null);
    }, [headerActionsTarget, liftedDescriptor, tabs.length]);
    const renderSearch = renderSearchBar;
    const renderSection = (tab: ProviderTab, models: CatalogModel[]) => {
        const section = getSectionContext(tab);
        const { isStella, isLocal, isOpenRouter, acceptsModelId, llmEntry, requiresAuth, supportsApiKey, supportsOAuth, sectionDisabled, expanded, authDescription, } = section;
        const restrictThisStella = isStella && restrictStellaPicks;
        const resolveDefaultToModel = isStella &&
            (hideDefaultRow ||
                (hideSelectedTitle &&
                    visibleProviders?.length === 1 &&
                    visibleProviders[0] === STELLA_PROVIDER_KEY));
        const showDefaultRow = !resolveDefaultToModel && isStella && !trimmedQuery;
        const handleRowPick = requiresAuth
            ? () => toggleExpanded(expanded ? null : tab.key)
            : handlePick;
        const showGroupHead = collapsibleGroups ||
            (!hideGroupHead &&
                !inlineProviderActions &&
                !liftActionsToHeader &&
                (!hideProviderLabel || requiresAuth || section.hasCustomInputs || section.removable));
        const open = !collapsibleGroups || Boolean(trimmedQuery) || openSections.has(tab.key);
        const sectionHoldsSelection = isStella
            ? isDefaultSelected || (value ?? "").startsWith("stella/")
            : models.some((model) => model.id === value);
        return (<col {...s.modelPickerGroup} key={tab.key} role="group" label={tab.label}>
        {showGroupHead ? (<row w="full" {...s.modelPickerGroupHead} title={disabledProviderSet.has(tab.key)
                ? disabledProviderReason
                : undefined} {...(((!collapsibleGroups && hideProviderLabel) || undefined) ? s.modelPickerGroupHeadLabelHidden : null)} {...((collapsibleGroups || undefined) ? s.modelPickerGroupHeadCollapsible : null)}>
          {collapsibleGroups ? (<Press {...s.modelPickerGroupToggle} expanded={open} onPress={() => {
                toggleSection(tab.key);
                if (!open && requiresAuth && models.length === 0) {
                    toggleExpanded(tab.key);
                }
                else if (open && expanded) {
                    toggleExpanded(null);
                }
            }} disabled={Boolean(trimmedQuery)}>
              <row {...s.modelPickerGroupIcon}>
                <BrandIcon brand={tab.key} size={13} />
              </row>
              <T {...tx(s.modelPickerGroupToggle)} {...s.modelPickerGroupLabel}>{tab.label}</T>
              {section.onAccount ? (<T {...tx(s.modelPickerGroupToggle)} {...s.modelPickerGroupNote} title={t("settings.modelPicker.accountKeyTitle")}>
                  {t("settings.modelPicker.accountKey")}
                </T>) : section.onlyHere ? (<T {...tx(s.modelPickerGroupToggle)} {...s.modelPickerGroupNote}>
                  {t("settings.engineAccounts.whereComputer")}
                </T>) : null}
              {!open && sectionHoldsSelection ? (<Check size={12} strokeWidth={2} {...s.modelPickerGroupCheck} color={s.modelPickerGroupCheck.color} />) : null}
              <col grow={1} />
              <box shrink={false} rotate={open ? Math.PI : 0} motion={s.modelPickerGroupChevron.motion}>
                <ChevronDown size={13} strokeWidth={1.75} color={s.modelPickerGroupChevron.color} />
              </box>
            </Press>) : hideProviderLabel ? null : (<>
              <row {...s.modelPickerGroupIcon}>
                <BrandIcon brand={tab.key} size={13} />
              </row>
              <T {...s.modelPickerGroupLabel}>{tab.label}</T>
              {section.onAccount ? (<T {...s.modelPickerGroupNote} title={t("settings.modelPicker.accountKeyTitle")}>
                  {t("settings.modelPicker.accountKey")}
                </T>) : section.onlyHere ? (<T {...s.modelPickerGroupNote}>
                  {t("settings.engineAccounts.whereComputer")}
                </T>) : null}
            </>)}
          {/* Overlay, not a column: the actions are absolutely positioned
              over the row's right end, so the toggle keeps the full width
              and every group's chevron stays in one column. */}
          <T {...s.modelPickerGroupActions}>{renderGroupActions(section)}</T>
        </row>) : null}

        {open && requiresAuth && expanded ? (<col {...s.modelPickerConnect}>
            <T w="full" {...s.modelPickerConnectHint}>{authDescription}</T>
            {supportsOAuth ? (<Press {...s.modelPickerConnectOauth} onPress={() => oauthProvider === tab.key
                    ? void cancelPendingOAuth(tab.key)
                    : void handleLoginOAuth(tab.key)} disabled={sectionDisabled && oauthProvider !== tab.key} {...((sectionDisabled && oauthProvider !== tab.key) ? s.modelPickerConnectOauthDisabled : null)}>
                <LogIn size={13} strokeWidth={1.75} color={s.modelPickerConnectOauth.color} />
                {oauthProvider === tab.key
                        ? t("settings.modelPicker.cancelSignIn")
                        : t("settings.modelPicker.signInWith", { provider: tab.label })}
              </Press>) : null}
            {supportsApiKey ? (<row {...s.modelPickerConnectField}>
                <KeyRound size={13} strokeWidth={1.75} color={s.modelPickerConnectField.color} />
                <Input type="password" placeholder={llmEntry?.placeholder ?? t("settings.modelPicker.apiKeyPlaceholder")} value={draftKey} onChange={(e) => setDraftKey(e.target.value)} onKeyDown={(e) => {
                        if (e.key === "Enter")
                            handleSaveKey(tab.key, tab.label);
                    }} autoFocus={!supportsOAuth} disabled={sectionDisabled} label={t("settings.modelPicker.apiKeyAriaLabel", { provider: tab.label })} spellCheck={false} autoComplete="off" />
                <Press text={tx(s.modelPickerConnectField)} {...s.modelPickerConnectGo} onPress={() => handleSaveKey(tab.key, tab.label)} disabled={!draftKey.trim() ||
                        savingProvider === tab.key ||
                        sectionDisabled} {...((!draftKey.trim() ||
                        savingProvider === tab.key ||
                        sectionDisabled) ? s.modelPickerConnectGoDisabled : null)}>
                  {savingProvider === tab.key
                    ? t("settings.modelPicker.saving")
                    : t("common.save")}
                </Press>
              </row>) : null}
            {authError ? (<T w="full" {...s.modelPickerConnectError} role="alert">
                {authError}
              </T>) : null}
          </col>) : null}
        {open && section.onlyHere && destination && destination.kind !== "here" ? (<T w="full" {...sEnginePlace.enginePlaceLine} role="note">
            {t("settings.modelPlace.onlyHere", { place: destination.placeStart })}
          </T>) : null}
        {!open ? null : <>
          {isLocal && expanded ? (<col {...s.modelPickerConnect}>
              <T w="full" {...s.modelPickerConnectHint}>
                {t("settings.modelPicker.local.hint")}
              </T>
              <row {...s.modelPickerConnectField}>
                <Input placeholder={DEFAULT_LOCAL_BASE_URL} value={localBaseUrl} onChange={(e) => setLocalBaseUrl(e.target.value)} disabled={sectionDisabled} label={t("settings.modelPicker.local.serverUrlAriaLabel")} spellCheck={false} autoComplete="off" />
              </row>
              <row {...s.modelPickerConnectField}>
                <Input placeholder="llama3.2" value={localModelId} onChange={(e) => setLocalModelId(e.target.value)} onKeyDown={(e) => {
                    if (e.key === "Enter")
                        handleSubmitLocal();
                }} disabled={sectionDisabled} label={t("settings.modelPicker.local.modelNameAriaLabel")} spellCheck={false} autoComplete="off" />
                <Press text={tx(s.modelPickerConnectField)} {...s.modelPickerConnectGo} onPress={handleSubmitLocal} disabled={!localModelId.trim() || sectionDisabled} {...((!localModelId.trim() || sectionDisabled) ? s.modelPickerConnectGoDisabled : null)}>
                  {t("settings.modelPicker.use")}
                </Press>
              </row>
            </col>) : null}

          {acceptsModelId && !requiresAuth && expanded ? (<col {...s.modelPickerConnect}>
              <T w="full" {...s.modelPickerConnectHint}>
                {isOpenRouter ? (<>
                    {t("settings.modelPicker.openRouter.hintBefore")}{" "}
                    <T {...tx(s.modelPickerConnectHint)}>vendor/model</T>{" "}
                    {t("settings.modelPicker.openRouter.hintAfter")}
                  </>) : t("settings.modelPicker.customModel.hint", { provider: tab.label })}
              </T>
              <row {...s.modelPickerConnectField}>
                <Input placeholder={isOpenRouter ? "anthropic/claude-opus-4.7" : (models.at(-1)?.modelId ?? "")} value={customModelId} onChange={(e) => setCustomModelId(e.target.value)} onKeyDown={(e) => {
                    if (e.key === "Enter")
                        handleSubmitCustomModel(tab.key);
                }} disabled={sectionDisabled} label={t("settings.modelPicker.customModel.modelIdAriaLabel", { provider: tab.label })} spellCheck={false} autoComplete="off" />
                <Press text={tx(s.modelPickerConnectField)} {...s.modelPickerConnectGo} onPress={() => handleSubmitCustomModel(tab.key)} disabled={!customModelId.trim() || sectionDisabled} {...((!customModelId.trim() || sectionDisabled) ? s.modelPickerConnectGoDisabled : null)}>
                  {t("settings.modelPicker.use")}
                </Press>
              </row>
            </col>) : null}

          <col {...s.modelPickerModels}>
            {showDefaultRow ? (<Press {...s.modelPickerModel} role="option" selected={isDefaultSelected} onPress={() => handlePick(DEFAULT_TARGET)} disabled={sectionDisabled} {...((isDefaultSelected || undefined) ? s.modelPickerModelSelected : null)}>
                <col {...s.modelPickerModelText}>
                  <T {...tx(s.modelPickerModel)} {...s.modelPickerModelName} {...s.modelPickerModelDefault_modelPickerModelName}>
                    {defaultLabel}
                  </T>
                </col>
                {!hideSelectionCheck && isDefaultSelected ? (<Check size={13} {...s.modelPickerModelCheck} color={s.modelPickerModelCheck.color} />) : null}
              </Press>) : null}
            {showDefaultRow && isDefaultSelected && selectedRowExtra ? (<row w="full" {...s.modelPickerSelectedExtra}>{selectedRowExtra}</row>) : null}
            {models.map((model) => {
                const selected = isDefaultSelected
                    ? resolveDefaultToModel && modelMatchesDefault(model, currentLabel)
                    : model.id === value;
                const rowRestricted = restrictThisStella &&
                    model.provider === STELLA_PROVIDER_KEY &&
                    !selected &&
                    model.allowedForAudience === false;
                return (<col key={model.id}>
                    <ModelRow model={model} selected={selected} rowRestricted={rowRestricted} restrictedPlanLabel={restrictedPlanLabel ?? null} restrictedReason={rowRestricted && !restrictedPlanLabel
                        ? (disabledProviderReason ?? null)
                        : null} onPick={handleRowPick} disabled={sectionDisabled} favorite={favorites.includes(model.id)} showFavorite={Boolean(favoriteScope)} onToggleFavorite={toggleFavorite} reasoningEffort={reasoningEffort} onSelectReasoning={onSelectReasoning} hideSelectionCheck={hideSelectionCheck} />
                    {selected && selectedRowExtra ? (<row w="full" {...s.modelPickerSelectedExtra}>{selectedRowExtra}</row>) : null}
                  </col>);
            })}
          </col>
        </>}
      </col>);
    };
    const renderExtraSection = (extra: ProviderModelExtraSection) => {
        const open = openSections.has(extra.key);
        return (<col {...s.modelPickerGroup} key={extra.key} role="group" label={extra.label}>
        <row w="full" {...s.modelPickerGroupHead} {...s.modelPickerGroupHeadCollapsible}>
          <Press {...s.modelPickerGroupToggle} expanded={open} onPress={() => toggleSection(extra.key)}>
            <row {...s.modelPickerGroupIcon}>
              <BrandIcon brand={extra.brandKey ?? extra.key} size={13} />
            </row>
            <T {...tx(s.modelPickerGroupToggle)} {...s.modelPickerGroupLabel}>{extra.label}</T>
            {extra.badge ? (<T {...tx(s.modelPickerGroupToggle)} {...s.modelPickerGroupNote}>{extra.badge}</T>) : null}
            {!open && extra.selected ? (<Check size={12} strokeWidth={2} {...s.modelPickerGroupCheck} color={s.modelPickerGroupCheck.color} />) : null}
            <col grow={1} />
              <box shrink={false} rotate={open ? Math.PI : 0} motion={s.modelPickerGroupChevron.motion}>
                <ChevronDown size={13} strokeWidth={1.75} color={s.modelPickerGroupChevron.color} />
              </box>
          </Press>
        </row>
        {open ? extra.content() : null}
      </col>);
    };
    const orderedSections = useMemo(() => {
        const entries: Array<
          | { kind: "catalog"; key: string; tab: ProviderTab; models: CatalogModel[] }
          | { kind: "extra"; key: string; extra: ProviderModelExtraSection }
        > = sections.map(({ tab, models }) => ({
            kind: "catalog",
            key: tab.key,
            tab,
            models,
        }));
        if (!trimmedQuery) {
            for (const extra of extraSections) {
                entries.push({ kind: "extra", key: extra.key, extra });
            }
        }
        if (sectionOrder?.length) {
            const rank = new Map(sectionOrder.map((key, index) => [key, index]));
            entries.sort((a, b) => (rank.get(a.key) ?? sectionOrder.length) -
                (rank.get(b.key) ?? sectionOrder.length));
        }
        return entries;
    }, [extraSections, sections, sectionOrder, trimmedQuery]);
    return (<col {...s.modelPickerShell} {...(inAgentPicker ? sAgent.agentModelPicker_modelPickerShell : { h: Math.min(480, Math.max(360, window.innerHeight * 0.6)) })} role="group" label={ariaLabel}>
      <col {...s.modelPickerPaneInner}>
        {hideSelectedTitle ? null : (<row {...s.modelPickerPaneHeader}>
            <row {...s.modelPickerPaneTitle}>
              <T {...s.modelPickerPaneKicker}>
                {selectedHeaderKicker ?? t("settings.modelPicker.selected")}
              </T>
              <T {...s.modelPickerPaneCurrent} title={currentLabel}>
                {currentLabel}
              </T>
            </row>
          </row>)}

        {!searchVisible ? null : inlineProviderActions || onRefresh ? (<row {...s.modelPickerSearchRow}>
            {renderSearch()}
            {inlineProviderActions ? (<T {...s.modelPickerSearchAction}>
                {renderGroupActions(getSectionContext(tabs[0]))}
              </T>) : null}
            {onRefresh ? (<Press {...s.modelPickerRefresh} onPress={onRefresh} disabled={disabled || refreshing} label={t("settings.modelPicker.refresh")} title={t("settings.modelPicker.refresh")} {...((disabled || refreshing) ? s.modelPickerRefreshDisabled : null)}>
                <RefreshCw size={13} strokeWidth={1.75} data-spinning={refreshing || undefined} color={s.modelPickerRefresh.color} />
              </Press>) : null}
          </row>) : renderSearch()}

        {catalogError ? (<row w="full" {...s.modelPickerLoadError} role="status">
            <T {...tx(s.modelPickerLoadError)}>{t("settings.modelPicker.loadFailed")}</T>
            {onRefresh ? (<Press text={tx(s.modelPickerLoadError)} {...s.modelPickerLoadErrorRetry} onPress={onRefresh} disabled={disabled || refreshing} {...((disabled || refreshing) ? s.modelPickerLoadErrorRetryDisabled : null)}>
                {t("settings.modelPicker.retry")}
              </Press>) : null}
          </row>) : null}


        <col {...s.modelPickerGroups} role="listbox">
          {orderedSections.length === 0 ? (<T w="full" {...s.modelPickerEmpty}>
              {tabs.length === 0
                ? t("settings.modelPicker.empty.none")
                : t("settings.modelPicker.empty.noMatch")}
            </T>) : (orderedSections.map((entry) => entry.kind === "extra"
                ? renderExtraSection(entry.extra)
                : renderSection(entry.tab, entry.models)))}
        </col>
      </col>
    </col>);
}
type ModelRowProps = {
    model: CatalogModel;
    selected: boolean;
    rowRestricted: boolean;
    restrictedPlanLabel: string | null;
    restrictedReason: string | null;
    onPick: (modelId: string, anchor?: HTMLElement) => void;
    disabled: boolean;
    favorite: boolean;
    showFavorite: boolean;
    onToggleFavorite: (modelId: string) => void;
    reasoningEffort?: ReasoningEffort;
    onSelectReasoning?: (modelId: string, effort: ReasoningEffort) => void;
    hideSelectionCheck: boolean;
};

const ModelRow = memo(function ModelRow({ model, selected, rowRestricted, restrictedPlanLabel, restrictedReason, onPick, disabled, favorite, showFavorite, onToggleFavorite, reasoningEffort, onSelectReasoning, hideSelectionCheck, }: ModelRowProps) {
  const s = useProviderModelPicker();
    const t = useT();
    const [reasoningOpen, setReasoningOpen] = useState(false);
    const showReasoning = Boolean(onSelectReasoning);
    const hasActions = showReasoning || showFavorite;
    const isStellaModel = model.provider === STELLA_PROVIDER_KEY;
    const displayName = isStellaModel
        ? getStellaResolvedModelName(model)
        : model.name;
    return (<row {...s.modelPickerModelRow}>
      <Press {...s.modelPickerModel} {...s.modelPickerModelRow_modelPickerModel} role="option" selected={selected} aria-disabled={rowRestricted || undefined} title={rowRestricted && restrictedPlanLabel
            ? t("settings.modelPicker.restrictedPlan", { plan: restrictedPlanLabel })
            : rowRestricted
                ? (restrictedReason ?? undefined)
                : undefined} onPress={() => onPick(model.id)} disabled={disabled || rowRestricted} {...((selected || undefined) ? s.modelPickerModelSelected : null)} {...((rowRestricted || undefined) ? s.modelPickerModelRestricted : null)}>
        <col {...s.modelPickerModelText}>
          <T {...tx(selected ? { ...s.modelPickerModel, ...s.modelPickerModelSelected } : s.modelPickerModel)} {...s.modelPickerModelName}>{displayName}</T>
        </col>
        {!hideSelectionCheck && selected ? (<Check size={13} {...s.modelPickerModelCheck} color={s.modelPickerModelCheck.color} />) : null}
      </Press>
      {hasActions ? (<row {...s.modelPickerModelActions} {...((reasoningOpen || undefined) ? s.modelPickerModelActionsOpen : null)}>
          {showReasoning ? (<DropdownMenu open={reasoningOpen} onOpenChange={setReasoningOpen}>
              <DropdownMenuTrigger asChild>
                <Press {...s.modelPickerModelReason} label={t("settings.modelPicker.reasoning.label")} title={t("settings.modelPicker.reasoning.label")} disabled={disabled || rowRestricted} onPress={(event) => event.stopPropagation()} {...(((selected &&
                    reasoningEffort &&
                    reasoningEffort !== DEFAULT_REASONING_EFFORT) ||
                    undefined) ? s.modelPickerModelReasonActive : null)} {...((disabled || rowRestricted) ? s.modelPickerModelReasonDisabled : null)}>
                  <Lightbulb size={14} strokeWidth={1.75} color={s.modelPickerModelReason.color} />
                </Press>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" sideOffset={6}>
                <DropdownMenuRadioGroup value={reasoningEffort ?? DEFAULT_REASONING_EFFORT} onValueChange={(value) => onSelectReasoning?.(model.id, value as ReasoningEffort)}>
                  {REASONING_OPTIONS.map((option) => (<DropdownMenuRadioItem key={option.id} value={option.id}>
                      {t(option.labelKey)}
                    </DropdownMenuRadioItem>))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>) : null}
          {showFavorite ? (<Press {...s.modelPickerModelStar} selected={favorite} label={favorite
                    ? t("settings.modelPicker.favorite.remove")
                    : t("settings.modelPicker.favorite.add")} title={favorite
                    ? t("settings.modelPicker.favorite.remove")
                    : t("settings.modelPicker.favorite.addTitle")} disabled={disabled || rowRestricted} onPress={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(model.id);
                }} {...((favorite || undefined) ? s.modelPickerModelStarFavorite : null)} {...((disabled || rowRestricted) ? s.modelPickerModelStarDisabled : null)}>
              <Star size={14} strokeWidth={1.75} color={s.modelPickerModelStar.color} />
            </Press>) : null}
        </row>) : null}
    </row>);
});
