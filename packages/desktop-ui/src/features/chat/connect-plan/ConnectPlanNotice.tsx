import { useCallback, useContext, useRef, useState } from "react";
import { CONNECT_PLAN_COPY as COPY } from "@stella/contracts/connect-plan-offer";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { DEFAULT_REASONING_EFFORT } from "@stella/contracts/reasoning-effort";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { Button } from "@/ui/button";
import { BrandIcon } from "@/ui/brand-icon";
import { KeyRound, Lock, Plug, X } from "@/ui/icons";
import { Select } from "@/ui/select";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import { ChatMessagesContext } from "@/context/chat-messages-context";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
import type { ComposerNotice } from "@/features/chat/composer-notice-store";
import { announceChatGptPlanUse } from "@/features/chatgpt/ChatGptBrand";
import { useChatGptProfiles } from "@/features/chatgpt/use-chatgpt-profiles";
import { ClaudeLoginPrompt } from "@/features/claude/ClaudeLoginPrompt";
import { ClaudeCliInstallStatus } from "@/features/claude/ClaudeCliInstallStatus";
import { useClaudeInstallThenSignIn } from "@/features/claude/use-claude-cli-install";
import { useClaudeLocalAccounts } from "@/features/claude/use-claude-local-accounts";
import { useClaudeLogin } from "@/features/claude/use-claude-login";
import { cloudEnginesApi, useCloudEngines } from "@/features/cloud/cloud-engines-api";
import { publishCloudExecutionSelection } from "@/features/cloud/cloud-execution-store";
import { cloudSendRecovery } from "@/features/cloud/cloud-send-recovery";
import { EngineConnectPrompt } from "@/features/cloud/EngineConnectPrompt";
import { useEngineConnect } from "@/features/cloud/use-engine-connect";
import { useLlmCredentials } from "@/global/settings/hooks/use-llm-credentials";
import { LLM_PROVIDERS } from "@/global/settings/lib/llm-providers";
import {
  buildEngineRoutingPatch,
  buildEngineTransitionReasoningPatch,
} from "@/global/settings/lib/engine-model-routing";
import {
  API_KEY_PROVIDERS,
  ASSISTANT_AGENT_KEYS,
  DEFAULT_MODEL_BY_PROVIDER,
} from "@/global/settings/lib/provider-default-models";
import { switchEngine } from "@/global/settings/lib/switch-engine";
import { STELLA_SEND_MESSAGE_EVENT } from "@/shared/lib/stella-send-message";
import { connectPlanChatGptOnly, openPlans } from "./connect-plan";
import "@/app/chat/composer-notice.css";
import "./connect-plan.css";

type OptionId = "chatgpt" | "claude" | "apikey";
type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

/** The model a cloud ChatGPT run starts on, as in Settings → Account. */
const CLOUD_CHATGPT_MODEL = "gpt-6.1-sol";

type KeptMessage =
  /** The cloud refused it before it was sent; it waits in the chat as "Not sent". */
  | { kind: "unsent"; clientMsgId: string; text: string }
  /** It was sent and the reply failed; send the same words again. */
  | { kind: "text"; text: string };

/** The person's latest message in the chat on screen. */
const lastOwnMessage = (messages: readonly MessageRecord[] | null): KeptMessage | null => {
  if (!messages) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type !== "user_message") continue;
    const text = message.payload?.text;
    if (typeof text !== "string" || !text.trim()) return null;
    return message.payload?.sendFailed
      ? { kind: "unsent", clientMsgId: message._id, text }
      : { kind: "text", text };
  }
  return null;
};

/**
 * Send the kept message on the plan just connected. A "Not sent" one is
 * replaced rather than retried: its retry would reuse the engine it was
 * first sent with, which is the one that ran out.
 */
const sendKept = (kept: KeptMessage): void => {
  if (kept.kind === "unsent") cloudSendRecovery()?.dismiss(kept.clientMsgId);
  window.dispatchEvent(new CustomEvent(STELLA_SEND_MESSAGE_EVENT, { detail: { text: kept.text } }));
};

/** Point this computer's chat at an API key the person just saved. */
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

/**
 * The connect-your-plan card above the composer. First the offer (connect
 * your ChatGPT or Claude plan, plans second); then the plans that work on
 * this host; once one connects, Stella switches to it and sends the message
 * that didn't go through.
 */
export function ConnectPlanNotice({
  notice,
  compact,
  onDismiss,
}: {
  notice: ComposerNotice;
  compact: boolean;
  onDismiss: () => void;
}) {
  const t = useT();
  const state = notice.connectPlan!;
  const chatGptOnly = connectPlanChatGptOnly();
  const messages = useContext(ChatMessagesContext);
  const { isAuthenticated } = useAuthState();
  const engines = useCloudEngines(isAuthenticated && chatGptOnly);
  const chatgpt = useChatGptProfiles();
  const claudeLocal = useClaudeLocalAccounts();
  const credentials = useLlmCredentials();
  const connect = useEngineConnect();
  const apiKeysAvailable = Boolean(window.electronAPI?.system?.saveLlmCredential);
  const [choosing, setChoosing] = useState(Boolean(state.choose) || state.reason === "no-engine");
  const [pending, setPending] = useState<OptionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const [keyProvider, setKeyProvider] = useState<ApiKeyProvider>(API_KEY_PROVIDERS[0]);
  const [keyDraft, setKeyDraft] = useState("");
  const finished = useRef(false);

  // What to send once connected, taken when the card first shows so a
  // later message can't take its place.
  const kept = useRef<KeptMessage | null | undefined>(undefined);
  if (kept.current === undefined) {
    kept.current =
      state.resend || state.reason !== "allowance" ? null : lastOwnMessage(messages);
  }
  const willResend = Boolean(state.resend || kept.current);

  const done = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDismiss();
    const message = kept.current;
    if (state.resend) state.resend();
    else if (message) sendKept(message);
    showToast({
      title: state.resend || message ? COPY.sending : COPY.connected,
      variant: "success",
      duration: 4000,
    });
  }, [onDismiss, state]);

  const selectCloudChatGpt = useCallback(async () => {
    const execution = {
      engine: "chatgpt" as const,
      provider: "chatgpt" as const,
      model: CLOUD_CHATGPT_MODEL,
      reasoningEffort: engines?.execution.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    };
    await cloudEnginesApi.setExecution(execution);
    publishCloudExecutionSelection(execution);
  }, [engines?.execution.reasoningEffort]);

  const { reload: reloadClaudeLocal } = claudeLocal;
  const claudeLogin = useClaudeLogin({
    onSignedIn: () => {
      void reloadClaudeLocal();
      void switchEngine("claude_code_local").then((switched) => {
        if (switched) done();
        else setError(COPY.failed);
      });
    },
  });

  // Claude Code isn't on this computer: install it, then sign in.
  const claudeInstall = useClaudeInstallThenSignIn({
    reload: reloadClaudeLocal,
    signIn: () => void claudeLogin.start({ place: "local", configId: "default" }),
  });
  const { run: installClaude, reset: resetClaudeInstall } = claudeInstall;

  const cloudChatGptConnected = (engines?.connections ?? []).some(
    (row) => row.provider === "chatgpt" && isEngineConnectionUsable(row),
  );

  const run = useCallback(
    async (option: OptionId) => {
      if (pending || claudeLogin.open || claudeInstall.installing) return;
      setError(null);
      resetClaudeInstall();
      if (option === "apikey") {
        setKeyFormOpen((open) => !open);
        return;
      }
      if (option === "claude") {
        if (claudeLocal.signedIn) {
          if (await switchEngine("claude_code_local")) done();
          else setError(COPY.failed);
          return;
        }
        if (claudeLocal.loaded && !claudeLocal.cliInstalled) {
          if (claudeInstall.available) void installClaude();
          else setError(COPY.claudeCliMissing);
          return;
        }
        void claudeLogin.start({
          place: "local",
          ...(claudeLocal.defaultSignedOut ? { configId: "default" } : {}),
        });
        return;
      }
      setPending("chatgpt");
      try {
        if (chatgpt.available) {
          // This computer's own ChatGPT sign-in.
          const ready = chatgpt.usable || Boolean((await chatgpt.signIn())?.planUsage);
          if (!ready) return;
          if (!chatgpt.usable) announceChatGptPlanUse();
          if (await switchEngine("codex_cli")) done();
          else setError(COPY.failed);
          return;
        }
        // The web chat: the account's cloud ChatGPT connection.
        const ready = cloudChatGptConnected || (await connect.start());
        if (!ready) return;
        if (!cloudChatGptConnected) announceChatGptPlanUse();
        await selectCloudChatGpt();
        done();
      } catch (caught) {
        console.warn("[connect-plan] ChatGPT connect failed", caught);
        setError(COPY.failed);
      } finally {
        setPending(null);
      }
    },
    [
      chatgpt,
      claudeLocal.cliInstalled,
      claudeLocal.defaultSignedOut,
      claudeLocal.loaded,
      claudeLocal.signedIn,
      claudeLogin,
      claudeInstall.available,
      claudeInstall.installing,
      installClaude,
      resetClaudeInstall,
      cloudChatGptConnected,
      connect,
      done,
      pending,
      selectCloudChatGpt,
    ],
  );

  const saveApiKey = useCallback(async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setPending("apikey");
    setError(null);
    try {
      const label = LLM_PROVIDERS.find((provider) => provider.key === keyProvider)?.label ?? keyProvider;
      await credentials.saveApiKey(keyProvider, label, trimmed);
      setKeyDraft("");
      if (await routeToApiKeyProvider(keyProvider)) done();
      else setError(COPY.failed);
    } catch (caught) {
      console.warn("[connect-plan] API key save failed", caught);
      setError(COPY.failed);
    } finally {
      setPending(null);
    }
  }, [credentials, done, keyDraft, keyProvider]);

  const cancel = () => {
    claudeLogin.cancel();
    if (pending === "chatgpt") {
      if (chatgpt.available) chatgpt.cancelSignIn();
      else connect.cancel();
    }
  };

  const options: Array<{ id: OptionId; title: string; body: string }> = chatGptOnly
    ? []
    : [
        { id: "chatgpt", title: COPY.chatgptTitle, body: COPY.chatgptBody },
        { id: "claude", title: COPY.claudeTitle, body: COPY.claudeBody },
        ...(apiKeysAvailable
          ? [{ id: "apikey" as const, title: COPY.apiKeyTitle, body: COPY.apiKeyBody }]
          : []),
      ];

  const offering = !choosing;
  const Icon = state.reason === "no-engine" ? Plug : Lock;
  const title = choosing && state.reason !== "no-engine" ? COPY.chooseTitle : notice.title;
  const description =
    choosing && state.reason !== "no-engine"
      ? willResend
        ? COPY.chooseBody
        : COPY.chooseBodyNoResend
      : notice.description;
  const busy =
    pending !== null || claudeLogin.open || claudeInstall.installing || connect.flow !== null;
  const showPlans = state.reason !== "no-engine";

  return (
    <div
      className={`composer-notice composer-notice--upgrade connect-plan${compact ? " composer-notice--compact" : ""}`}
      role="status"
      data-testid="composer-notice"
      data-connect-plan={state.reason}
      data-stage={offering ? "offer" : "choose"}
    >
      <div className="connect-plan__head">
        <div className="composer-notice__icon" aria-hidden>
          <Icon size={compact ? 14 : 16} />
        </div>
        <div className="composer-notice__body">
          <p className="composer-notice__title">{title}</p>
          {description ? <p className="composer-notice__sub">{description}</p> : null}
        </div>
        {offering || chatGptOnly ? (
          <div className="composer-notice__actions">
            {showPlans ? (
              <Button
                type="button"
                variant="ghost"
                className="pill-btn composer-notice__secondary"
                onClick={() => {
                  cancel();
                  onDismiss();
                  openPlans();
                }}
              >
                {COPY.plans}
              </Button>
            ) : null}
            {busy ? null : (
              <Button
                type="button"
                variant="primary"
                className="pill-btn pill-btn--primary composer-notice__primary"
                onClick={() => {
                  if (chatGptOnly) void run("chatgpt");
                  else setChoosing(true);
                }}
              >
                {chatGptOnly ? COPY.connectChatGpt : COPY.connect}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {choosing && options.length > 0 ? (
        <div className="connect-plan__options" role="group" aria-label={COPY.chooseTitle}>
          {options.map((option) => {
            const isPending =
              pending === option.id ||
              (option.id === "claude" && (claudeLogin.open || claudeInstall.installing));
            return (
              <button
                key={option.id}
                type="button"
                className="connect-plan__option"
                aria-label={`${option.title}, ${
                  isPending ? t("common.loading") : t("onboarding.chat.signin.connect")
                }`}
                data-option={option.id}
                data-pending={isPending || undefined}
                disabled={busy && !isPending}
                onClick={() => void (isPending ? undefined : run(option.id))}
              >
                <span className="connect-plan__option-icon" aria-hidden>
                  {option.id === "apikey" ? (
                    <KeyRound size={16} />
                  ) : (
                    <BrandIcon brand={option.id === "chatgpt" ? "openai" : "anthropic"} size={18} />
                  )}
                </span>
                <span className="connect-plan__option-text">
                  <span className="connect-plan__option-title">{option.title}</span>
                  <span className="connect-plan__option-body">{option.body}</span>
                </span>
                <span className="connect-plan__option-state">
                  {isPending ? (
                    <span className="connect-plan__spinner" aria-label={t("common.loading")} />
                  ) : option.id === "apikey" && keyFormOpen ? null : (
                    t("onboarding.chat.signin.connect")
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {keyFormOpen ? (
        <form
          className="connect-plan__key-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveApiKey();
          }}
        >
          <Select
            value={keyProvider}
            onValueChange={(value) => setKeyProvider(value as ApiKeyProvider)}
            aria-label={COPY.apiKeyTitle}
            options={API_KEY_PROVIDERS.map((provider) => ({
              value: provider,
              label: LLM_PROVIDERS.find((entry) => entry.key === provider)?.label ?? provider,
            }))}
          />
          <input
            className="connect-plan__key-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={keyDraft}
            placeholder={LLM_PROVIDERS.find((entry) => entry.key === keyProvider)?.placeholder}
            aria-label={COPY.apiKeyTitle}
            onChange={(event) => setKeyDraft(event.target.value)}
            disabled={pending === "apikey"}
          />
          <Button
            type="submit"
            variant="primary"
            className="pill-btn pill-btn--primary"
            disabled={pending === "apikey" || !keyDraft.trim()}
          >
            {t("common.save")}
          </Button>
        </form>
      ) : null}

      {claudeInstall.state.status === "installing" || claudeInstall.state.status === "error" ? (
        <div className="connect-plan__flow">
          <ClaudeCliInstallStatus state={claudeInstall.state} onRetry={() => void installClaude()} />
        </div>
      ) : claudeLogin.open ? (
        <div className="connect-plan__flow">
          <ClaudeLoginPrompt login={claudeLogin} />
        </div>
      ) : connect.flow ? (
        <div className="connect-plan__flow">
          <EngineConnectPrompt connect={connect} />
        </div>
      ) : pending === "chatgpt" ? (
        <p className="connect-plan__fine">
          {COPY.waiting}{" "}
          <button type="button" className="connect-plan__link" onClick={cancel}>
            {t("common.cancel")}
          </button>
        </p>
      ) : error ? (
        <p className="connect-plan__fine connect-plan__fine--error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="composer-notice__dismiss"
        aria-label={t("common.close")}
        onClick={() => {
          cancel();
          onDismiss();
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
