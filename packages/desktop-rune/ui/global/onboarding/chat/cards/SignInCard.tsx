import { BrandIcon, Button, Check, Form, Input, KeyRound, LogIn, Press, Select, T, tx } from "../../../../kit/compat";
import { useOnboardingChat } from "../onboarding-chat.styles";
import { mixOklch, useTokens } from "../../../../theme";
import { useSelfHost } from "../../../self-host/self-host.styles";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LLM_PROVIDERS } from "@/global/settings/lib/llm-providers";
import {
  API_KEY_PROVIDERS,
  ASSISTANT_AGENT_KEYS,
  DEFAULT_MODEL_BY_PROVIDER,
} from "@/global/settings/lib/provider-default-models";
import { useLlmCredentials } from "@/global/settings/hooks/use-llm-credentials";
import { useT } from "@/shared/i18n";
import { AuthDialog } from "../../../auth/AuthDialog";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
import { useCloudEngines } from "@/features/cloud/cloud-engines-api";
import { ClaudeLoginPrompt } from "../../../claude/ClaudeLoginPrompt";
import { useClaudeLocalAccounts } from "@/features/claude/use-claude-local-accounts";
import { useClaudeLogin } from "@/features/claude/use-claude-login";
import { useClaudeInstallThenSignIn } from "@/features/claude/use-claude-cli-install";
import { ClaudeCliInstallStatus } from "../../../claude/ClaudeCliInstallStatus";
import { EngineConnectPrompt } from "../../../cloud/EngineConnectPrompt";
import { useEngineConnect } from "@/features/cloud/use-engine-connect";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { announceChatGptPlanUse } from "../../../chatgpt/ChatGptBrand";
import { useChatGptProfiles } from "@/features/chatgpt/use-chatgpt-profiles";
import {
  buildEngineRoutingPatch,
  buildEngineTransitionReasoningPatch,
  type ModelPickerEngine,
} from "@/global/settings/lib/engine-model-routing";
import type { OnboardingChatAnswer } from "@/global/onboarding/chat/onboarding-chat-flow";
import { selfHostDialogs, useDesktopServerState } from "@/global/self-host/self-host-store";
import {
  useSelfHostedServer,
  useServerDiscovery,
  useServerFeature,
} from "@/platform/backend/server-discovery";
import { switchEngine } from "@/global/settings/lib/switch-engine";
import { uiState } from "@/platform/ui-state";

type SignInCardProps = {
  active: boolean;
  answered: OnboardingChatAnswer | undefined;
  onAnswer: (answer: OnboardingChatAnswer) => void;
};

type OptionId = "stella" | "claude" | "chatgpt" | "apikey";

type Option = {
  id: OptionId;
  engine: ModelPickerEngine;
  brand: string;
};

const CHECK_SVG = '<path d="M5 12.8 9.9 17.7 19 7.3" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>';
const SPINNER_SVG = (head: string, track: string) =>
  `<circle cx="9" cy="9" r="8" fill="none" stroke="${track}" stroke-width="2"/><path d="M2.343 3.343A8 8 0 0 1 15.657 3.343" fill="none" stroke="${head}" stroke-width="2"/>`;

const BASE_OPTIONS: Option[] = [
  { id: "stella", engine: "default", brand: "stella" },
  { id: "claude", engine: "claude_code_local", brand: "anthropic" },
  { id: "chatgpt", engine: "codex_cli", brand: "openai" },
];

const API_KEY_OPTION: Option = { id: "apikey", engine: "default", brand: "key" };

const ENGINE_TO_OPTION: Record<ModelPickerEngine, OptionId> = {
  default: "stella",
  claude_code_local: "claude",
  codex_cli: "chatgpt",
};

type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

const ENGINE_DEFAULT_DECIDED_KEY = "stella-onboarding-engine-default-decided";

const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

const isApiKeyModel = (model: string | undefined): boolean => {
  const provider = model?.split("/")[0];
  return Boolean(provider && DEFAULT_MODEL_BY_PROVIDER[provider]);
};

const readSelection = async (): Promise<{
  engine: ModelPickerEngine;
  apiKeyModel: boolean;
} | null> => {
  const preferences = await window.electronAPI?.system?.getLocalModelPreferences?.();
  if (!preferences) return null;
  return {
    engine: (preferences.agentRuntimeEngine as ModelPickerEngine | undefined) ?? "default",
    apiKeyModel: isApiKeyModel(preferences.modelOverrides?.orchestrator),
  };
};

const routeToApiKeyProvider = async (provider: string): Promise<boolean> => {
  const system = window.electronAPI?.system;
  const preferences = await system?.getLocalModelPreferences?.();
  const model = DEFAULT_MODEL_BY_PROVIDER[provider];
  if (!system?.setLocalModelPreferences || !preferences || !model) return false;
  const enginePatch =
    preferences.agentRuntimeEngine === "default"
      ? {}
      : {
          ...buildEngineRoutingPatch(preferences, "default"),
          ...buildEngineTransitionReasoningPatch(preferences, "default"),
        };
  const modelOverrides = {
    ...(enginePatch.modelOverrides ?? preferences.modelOverrides ?? {}),
  };
  for (const key of ASSISTANT_AGENT_KEYS) modelOverrides[key] = model;
  await system.setLocalModelPreferences({ ...enginePatch, modelOverrides });
  window.dispatchEvent(new CustomEvent("stella:local-model-preferences-changed"));
  return true;
};

export function SignInCard({ active, answered, onAnswer }: SignInCardProps) {
  const s = useOnboardingChat();
  const tokens = useTokens();
  const sSelfHost = useSelfHost();
  const t = useT();
  const session = useAuthSessionState();
  const { isAuthenticated } = useAuthState();
  const engines = useCloudEngines(isAuthenticated);
  const connect = useEngineConnect();
  const chatgpt = useChatGptProfiles();
  const claudeLocal = useClaudeLocalAccounts();
  const credentials = useLlmCredentials();
  const apiKeysAvailable = Boolean(window.electronAPI?.system?.saveLlmCredential);
  const managedModels = useServerFeature("managedModels");
  const selfHosted = useSelfHostedServer();
  const discovery = useServerDiscovery();
  const options = useMemo(() => {
    const base =
      managedModels && !selfHosted
        ? BASE_OPTIONS
        : BASE_OPTIONS.filter((option) => option.id !== "stella");
    return apiKeysAvailable ? [...base, API_KEY_OPTION] : base;
  }, [apiKeysAvailable, managedModels, selfHosted]);
  const [authOpen, setAuthOpen] = useState(false);
  const serverState = useDesktopServerState();
  const serverName =
    discovery?.name || serverState?.name || (serverState?.backendUrl ? hostOf(serverState.backendUrl) : "");
  const [pending, setPending] = useState<OptionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<ModelPickerEngine | null>(null);
  const [apiKeyModel, setApiKeyModel] = useState(false);
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const [keyProvider, setKeyProvider] = useState<ApiKeyProvider>(API_KEY_PROVIDERS[0]);
  const [keyDraft, setKeyDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    void readSelection().then((current) => {
      if (cancelled || !current) return;
      setEngine(current.engine);
      setApiKeyModel(current.apiKeyModel);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectedApiKeyProvider =
    credentials.apiKeys.find((key) => DEFAULT_MODEL_BY_PROVIDER[key.provider])
      ?.provider ?? null;

  const connected = useMemo<Record<OptionId, boolean>>(() => {
    const connections = engines?.connections ?? [];
    return {
      stella: managedModels && !selfHosted && session.hasConnectedAccount,
      claude: claudeLocal.available
        ? claudeLocal.signedIn
        : connections.some((row) => row.provider === "anthropic" && isEngineConnectionUsable(row)),
      chatgpt: chatgpt.available
        ? chatgpt.usable
        : connections.some((row) => row.provider === "chatgpt" && isEngineConnectionUsable(row)),
      apikey: apiKeysAvailable && connectedApiKeyProvider !== null,
    };
  }, [
    apiKeysAvailable,
    chatgpt.available,
    chatgpt.usable,
    claudeLocal.available,
    claudeLocal.signedIn,
    connectedApiKeyProvider,
    engines?.connections,
    managedModels,
    selfHosted,
    session.hasConnectedAccount,
  ]);
  const serverModels = selfHosted && managedModels;
  const anyConnected =
    serverModels ||
    connected.stella ||
    connected.claude ||
    connected.chatgpt ||
    connected.apikey;
  const inUse: OptionId | null = engine
    ? engine === "default" && apiKeyModel
      ? "apikey"
      : ENGINE_TO_OPTION[engine]
    : null;
  const lensOn: OptionId | null = inUse && connected[inUse] ? inUse : null;

  const { start: startConnect, cancel: cancelConnect } = connect;
  const { signIn: signInChatGpt, cancelSignIn: cancelChatGptSignIn } = chatgpt;

  const applyEngine = useCallback(
    async (option: Option) => {
      if (option.id === "apikey") {
        if (connectedApiKeyProvider && (await routeToApiKeyProvider(connectedApiKeyProvider))) {
          setEngine("default");
          setApiKeyModel(true);
        }
        return;
      }
      if (await switchEngine(option.engine)) {
        setEngine(option.engine);
        setApiKeyModel(false);
      }
    },
    [connectedApiKeyProvider],
  );

  const saveApiKey = useCallback(async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setPending("apikey");
    setError(null);
    try {
      const label =
        LLM_PROVIDERS.find((provider) => provider.key === keyProvider)?.label ?? keyProvider;
      await credentials.saveApiKey(keyProvider, label, trimmed);
      if (await routeToApiKeyProvider(keyProvider)) {
        setEngine("default");
        setApiKeyModel(true);
      }
      setKeyDraft("");
      setKeyFormOpen(false);
    } catch (caught) {
      console.warn("[onboarding-chat] API key save failed", caught);
      setError(t("onboarding.chat.signin.error"));
    } finally {
      setPending(null);
    }
  }, [credentials, keyDraft, keyProvider, t]);

  const handleContinue = useCallback(async () => {
    if (!connected.stella && !lensOn) {
      const fallback = options.find((option) => option.id !== "stella" && connected[option.id]);
      if (fallback) await applyEngine(fallback);
    }
    onAnswer("done");
  }, [applyEngine, connected, lensOn, onAnswer, options]);

  const claudeReady = claudeLocal.loaded && claudeLocal.cliInstalled && claudeLocal.signedIn;
  useEffect(() => {
    if (!active || answered !== undefined || engine === null || !claudeLocal.loaded) return;
    if (uiState.getItem(ENGINE_DEFAULT_DECIDED_KEY)) return;
    uiState.setItem(ENGINE_DEFAULT_DECIDED_KEY, "1");
    if (engine === "default" && !apiKeyModel && claudeReady) void applyEngine(BASE_OPTIONS[1]!);
  }, [active, answered, apiKeyModel, applyEngine, claudeLocal.loaded, claudeReady, engine]);

  const { reload: reloadClaudeLocal } = claudeLocal;
  const claudeLogin = useClaudeLogin({
    onSignedIn: () => {
      void reloadClaudeLocal();
      void applyEngine(BASE_OPTIONS[1]!);
    },
  });
  const { start: startClaudeLogin } = claudeLogin;
  const cliInstall = useClaudeInstallThenSignIn({
    reload: reloadClaudeLocal,
    signIn: () => void startClaudeLogin({ place: "local", configId: "default" }),
  });
  const { run: installClaudeThenSignIn, reset: resetClaudeInstall } = cliInstall;
  const busyOption: OptionId | null =
    pending ?? (claudeLogin.open || cliInstall.installing ? "claude" : null);

  const handleRow = useCallback(
    async (option: Option) => {
      if (busyOption) return;
      setError(null);
      resetClaudeInstall();
      if (connected[option.id]) {
        await applyEngine(option);
        return;
      }
      if (option.id === "stella") {
        setAuthOpen(true);
        return;
      }
      if (option.id === "apikey") {
        setKeyFormOpen((open) => !open);
        return;
      }
      if (option.id === "claude") {
        if (claudeLocal.available && !claudeLocal.cliInstalled) {
          if (cliInstall.available) void installClaudeThenSignIn();
          else setError(t("onboarding.chat.signin.claudeCliMissing"));
          return;
        }
        void startClaudeLogin(
          claudeLocal.available
            ? { place: "local", ...(claudeLocal.defaultSignedOut ? { configId: "default" } : {}) }
            : { place: "cloud" },
        );
        return;
      }
      setPending(option.id);
      try {
        if (option.id === "chatgpt" && chatgpt.available) {
          const profile = await signInChatGpt();
          if (profile?.planUsage) {
            announceChatGptPlanUse();
            await applyEngine(option);
          }
        } else if (await startConnect()) {
          announceChatGptPlanUse();
          await applyEngine(option);
        }
      } catch (caught) {
        console.warn("[onboarding-chat] Subscription sign-in failed", caught);
        setError(t("onboarding.chat.signin.error"));
      } finally {
        setPending(null);
      }
    },
    [
      applyEngine,
      busyOption,
      chatgpt.available,
      claudeLocal.available,
      claudeLocal.cliInstalled,
      claudeLocal.defaultSignedOut,
      cliInstall.available,
      connected,
      installClaudeThenSignIn,
      resetClaudeInstall,
      signInChatGpt,
      startClaudeLogin,
      startConnect,
      t,
    ],
  );

  const handleCancel = useCallback(() => {
    if (pending === "chatgpt" && chatgpt.available) cancelChatGptSignIn();
    else if (pending === "chatgpt") cancelConnect();
  }, [cancelChatGptSignIn, cancelConnect, chatgpt.available, pending]);

  const listY = useRef(0);
  const rowRects = useRef(new Map<string, { y: number; h: number }>());
  const [lens, setLens] = useState<{ top: number; height: number } | null>(null);
  const placeLens = useCallback(() => {
    const row = lensOn ? rowRects.current.get(lensOn) : undefined;
    setLens(row ? { top: row.y - listY.current, height: row.h } : null);
  }, [lensOn]);
  useLayoutEffect(() => placeLens(), [placeLens, answered]);

  if (answered !== undefined) {
    const label =
      lensOn && lensOn !== "stella"
        ? t("onboarding.chat.signin.settledEngine", {
            name: t(`onboarding.chat.signin.options.${lensOn}.title`),
          })
        : selfHosted
          ? t("selfHost.onboarding.settled", { name: serverName })
          : anyConnected
            ? t("onboarding.chat.signin.settledStella")
            : t("onboarding.chat.signin.settledNone");
    return (
      <col {...s.obcCard} {...((true) ? s.obcCardSettled : null)}>
        <row {...s.obcCardSettledIcon}>
          {anyConnected ? <Check size={15} color={s.obcCardSettledIcon.color} /> : <KeyRound size={15} color={s.obcCardSettledIcon.color} />}
        </row>
        <col {...s.obcCardSettledText}>
          <T {...s.obcCardSettledTitle}>{label}</T>
          <T {...s.obcCardSettledDesc}>
            {anyConnected || selfHosted
              ? t("onboarding.chat.signin.settledDesc")
              : t("onboarding.chat.signin.settledNoneDesc")}
          </T>
        </col>
      </col>
    );
  }

  return (
    <col {...s.obcCard}>
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
      <col {...s.obcCardSection}>
        {selfHosted ? (
          <>
            <row role="heading" {...s.obcCardTitle} {...sSelfHost.selfHostOnboardingTitle}>
              <Check size={15} color={s.obcCardTitle.color} />
              {t("selfHost.onboarding.title", { name: serverName })}
            </row>
            <T w="full" {...s.obcCardBody}>
              {t(serverModels ? "selfHost.onboarding.bodyOptional" : "selfHost.onboarding.body")}
            </T>
          </>
        ) : (
          <>
            <T role="heading" {...s.obcCardTitle}>{t("onboarding.chat.signin.title")}</T>
            <T w="full" {...s.obcCardBody}>{t("onboarding.chat.signin.body")}</T>
          </>
        )}
      </col>

      <col {...s.obcSignin} onLayout={(r) => {
          listY.current = r.y;
          placeLens();
        }}>
        <row {...s.obcSigninLens} {...(lens ? { y: lens.top, h: lens.height } : null)} {...(lens ? s.obcSigninLensVisible : null)} />
        {options.map((option, index) => {
          const isConnected = connected[option.id];
          const isPending = busyOption === option.id;
          const isInUse = lensOn === option.id;
          const detail =
            option.id === "stella" && isConnected && session.user?.email
              ? session.user.email
              : t(`onboarding.chat.signin.options.${option.id}.body`);
          return (
            <Press {...s.obcSigninRow} key={option.id} onLayout={(r) => {
                rowRects.current.set(option.id, { y: r.y, h: r.h });
                if (option.id === lensOn) placeLens();
              }} disabled={!active || (busyOption !== null && !isPending)} selected={isInUse} label={`${t(`onboarding.chat.signin.options.${option.id}.title`)}, ${
                isPending
                  ? t("common.loading")
                  : isConnected
                    ? t(isInUse ? "onboarding.chat.signin.inUse" : "onboarding.chat.signin.use")
                    : t(
                        option.id === "stella"
                          ? "onboarding.chat.signin.signIn"
                          : "onboarding.chat.signin.connect",
                      )
              }`} onPress={() => void (isPending ? undefined : handleRow(option))} {...((isInUse || undefined) ? s.obcSigninRowInUse : null)} {...((isPending || undefined) ? s.obcSigninRowPending : null)} {...((!active || (busyOption !== null && !isPending)) ? s.obcSigninRowDisabled : null)}>
              <box {...s.obcSigninIcon}>
                {option.id === "apikey" ? (
                  <KeyRound size={18} />
                ) : (
                  <BrandIcon brand={option.brand} size={20} />
                )}
              </box>
              <col {...s.obcSigninText}>
                <T {...tx(s.obcSigninRow)} {...s.obcSigninTitle}>
                  {t(`onboarding.chat.signin.options.${option.id}.title`)}
                </T>
                <T {...tx(s.obcSigninRow)} {...s.obcSigninDesc}>{detail}</T>
              </col>
              <row {...s.obcSigninState}>
                {isPending ? (
                  <icon mr={8} svg={SPINNER_SVG(tokens.c.primary, mixOklch(tokens.c.foreground, 12, "transparent"))} name={`obc/spinner-${tokens.themeId}-${tokens.dark}`} view={18} size={18} spin={0.8} title={t("common.loading")} />
                ) : isConnected ? (
                  <row {...s.obcSigninBadge} {...(isInUse ? s.obcSigninRowInUse_obcSigninBadge : null)} enter={{ opacity: 0, scale: 0.6, dur: 0.52, bounce: 0.35 }}>
                    <icon svg={CHECK_SVG} name="obc/check" view={24} size={13} color={(isInUse ? s.obcSigninRowInUse_obcSigninBadge : s.obcSigninBadge).color} />
                    {isInUse
                      ? t("onboarding.chat.signin.inUse")
                      : t("onboarding.chat.signin.use")}
                  </row>
                ) : (
                  <row {...s.obcSigninAction}>
                    {option.id === "stella" ? <LogIn size={13} color={s.obcSigninAction.color} /> : null}
                    {t(
                      option.id === "stella"
                        ? "onboarding.chat.signin.signIn"
                        : "onboarding.chat.signin.connect",
                    )}
                  </row>
                )}
              </row>
            </Press>
          );
        })}
      </col>

      {keyFormOpen ? (
        <Form {...s.obcSigninKeyForm} onSubmit={(event) => {
            event.preventDefault();
            void saveApiKey();
          }}>
          <Select value={keyProvider} onValueChange={(value) => setKeyProvider(value)} aria-label={t("onboarding.chat.signin.options.apikey.title")} options={API_KEY_PROVIDERS.map((provider) => ({
              value: provider,
              label: LLM_PROVIDERS.find((entry) => entry.key === provider)?.label ?? provider,
            }))} />
          <Input {...s.obcSigninKeyInput} type="password" autoComplete="off" spellCheck={false} value={keyDraft} placeholder={LLM_PROVIDERS.find((entry) => entry.key === keyProvider)?.placeholder} label={t("onboarding.chat.signin.options.apikey.title")} onChange={(event) => setKeyDraft(event.target.value)} disabled={!active || pending === "apikey"} />
          <Button type="submit" variant="primary" disabled={!active || pending === "apikey" || !keyDraft.trim()}>
            {t("common.save")}
          </Button>
        </Form>
      ) : null}

      {cliInstall.state.status === "installing" || cliInstall.state.status === "error" ? (
        <ClaudeCliInstallStatus state={cliInstall.state} onRetry={() => void installClaudeThenSignIn()} />
      ) : claudeLogin.open ? (
        <ClaudeLoginPrompt login={claudeLogin} />
      ) : connect.flow ? (
        <EngineConnectPrompt connect={connect} />
      ) : pending && pending !== "stella" && pending !== "apikey" ? (
        <T w="full" {...s.obcCardFine}>
          {t("onboarding.chat.signin.waiting")}{" "}
          <Press text={tx(s.obcCardFine)} {...s.obcLinkBtn} onPress={handleCancel}>
            {t("common.cancel")}
          </Press>
        </T>
      ) : error ? (
        <T w="full" {...s.obcCardFine} {...s.obcCardFineError} role="alert">
          {error}
        </T>
      ) : (
        <T w="full" {...s.obcCardFine}>{t("onboarding.chat.signin.fineOwnPlan")}</T>
      )}

      <row {...s.obcActions}>
        <Button variant="primary" disabled={!active || busyOption !== null} onClick={() => void handleContinue()}>
          {t("common.continue")}
        </Button>
        <row {...s.obcActionsSpacer} />
        {selfHosted ? null : (
          <T {...s.obcActionsHint}>{t("onboarding.chat.signin.hint")}</T>
        )}
      </row>
      {serverState?.canSwitch && !serverState.selfHosted ? (
        <T w="full" {...s.obcCardFine}>
          <Press text={tx(s.obcCardFine)} {...sSelfHost.selfHostSigninLink} disabled={!active} onPress={() => selfHostDialogs.openConnect()}>
            {t("selfHost.onboarding.link")}
          </Press>
        </T>
      ) : null}
    </col>
  );
}
