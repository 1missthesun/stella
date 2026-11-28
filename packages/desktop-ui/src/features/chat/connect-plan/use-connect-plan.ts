import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { isPaidBillingPlan, PLAN_CATALOG } from "@stella/contracts/billing-plans";
import { ANTIGRAVITY_MODEL_IDS, antigravityModelInUse } from "@stella/contracts/engine-model-catalog";
import { DEFAULT_REASONING_EFFORT } from "@stella/contracts/reasoning-effort";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { showToast } from "@/ui/toast";
import { useLocale, useT } from "@/shared/i18n";
import { ChatMessagesContext } from "@/context/chat-messages-context";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
import { getBillingReturnUrl } from "@/global/billing/billing-return-url";
import { backendClient } from "@/platform/backend/backend-client";
import { isSelfHostedServer } from "@/platform/backend/server-discovery";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { openExternalUrl } from "@/platform/electron/open-external";
import type { ComposerNotice } from "@/features/chat/composer-notice-store";
import { useAntigravity } from "@/features/antigravity/use-antigravity";
import { announceChatGptPlanUse } from "@/features/chatgpt/ChatGptBrand";
import { useChatGptProfiles } from "@/features/chatgpt/use-chatgpt-profiles";
import { useClaudeInstallThenSignIn } from "@/features/claude/use-claude-cli-install";
import { useClaudeLocalAccounts } from "@/features/claude/use-claude-local-accounts";
import { useClaudeLogin } from "@/features/claude/use-claude-login";
import { cloudEnginesApi, useCloudEngines } from "@/features/cloud/cloud-engines-api";
import { publishCloudExecutionSelection } from "@/features/cloud/cloud-execution-store";
import { cloudSendRecovery } from "@/features/cloud/cloud-send-recovery";
import { useEngineConnect } from "@/features/cloud/use-engine-connect";
import {
  buildEngineRoutingPatch,
  buildEngineTransitionReasoningPatch,
} from "@/global/settings/lib/engine-model-routing";
import { ASSISTANT_AGENT_KEYS } from "@/global/settings/lib/provider-default-models";
import { switchEngine } from "@/global/settings/lib/switch-engine";
import { STELLA_SEND_MESSAGE_EVENT } from "@/shared/lib/stella-send-message";
import { connectPlanChatGptOnly, openOtherModels } from "./connect-plan";

const K = "chat.connectPlan";

export type ConnectPlanOptionId = "chatgpt" | "claude" | "gemini";

export type ConnectPlanOption = {
  id: ConnectPlanOptionId;
  label: string;
  brand: "openai" | "anthropic" | "antigravity";
  pending: boolean;
  disabled: boolean;
};

export type ConnectPlanFlow =
  | "claude-install"
  | "claude-login"
  | "chatgpt-connect"
  | "gemini"
  | "waiting"
  | null;

const CLOUD_CHATGPT_MODEL = "gpt-6.1-sol";

type KeptMessage =
  | { kind: "unsent"; clientMsgId: string; text: string }
  | { kind: "text"; text: string };

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

const sendKept = (kept: KeptMessage): void => {
  if (kept.kind === "unsent") cloudSendRecovery()?.dismiss(kept.clientMsgId);
  window.dispatchEvent(new CustomEvent(STELLA_SEND_MESSAGE_EVENT, { detail: { text: kept.text } }));
};

const routeAssistantToModel = async (model: string): Promise<boolean> => {
  const system = window.electronAPI?.system;
  const preferences = await system?.getLocalModelPreferences?.();
  if (!system?.setLocalModelPreferences || !preferences) return false;
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

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function useConnectPlan({
  notice,
  onDismiss,
}: {
  notice: ComposerNotice;
  onDismiss: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const state = notice.connectPlan!;
  const chatGptOnly = connectPlanChatGptOnly();
  const messages = useContext(ChatMessagesContext);
  const { isAuthenticated } = useAuthState();
  const engines = useCloudEngines(isAuthenticated && chatGptOnly);
  const chatgpt = useChatGptProfiles();
  const claudeLocal = useClaudeLocalAccounts();
  const antigravity = useAntigravity();
  const connect = useEngineConnect();
  const [pending, setPending] = useState<ConnectPlanOptionId | "plus" | null>(null);
  const [geminiStarted, setGeminiStarted] = useState(false);
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);

  const kept = useRef<KeptMessage | null | undefined>(undefined);
  if (kept.current === undefined) {
    kept.current =
      state.resend || state.reason !== "allowance" ? null : lastOwnMessage(messages);
  }

  const finish = useCallback(
    (doneTitleKey: "connected" | "plusReady") => {
      if (finished.current) return;
      finished.current = true;
      onDismiss();
      const message = kept.current;
      if (state.resend) state.resend();
      else if (message) sendKept(message);
      const resending = Boolean(state.resend || message);
      showToast({
        title: t(
          doneTitleKey === "plusReady"
            ? resending
              ? `${K}.plusSending`
              : `${K}.plusReady`
            : resending
              ? `${K}.sending`
              : `${K}.connected`,
        ),
        variant: "success",
        duration: 4000,
      });
    },
    [onDismiss, state, t],
  );
  const done = useCallback(() => finish("connected"), [finish]);

  const billing = useBackendValue("billing.status", checkoutOpened ? {} : "skip");
  const upgraded = Boolean(billing && isPaidBillingPlan(billing.plan));
  useEffect(() => {
    if (checkoutOpened && upgraded) finish("plusReady");
  }, [checkoutOpened, finish, upgraded]);

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
        else setError(t(`${K}.failed`));
      });
    },
  });

  const claudeInstall = useClaudeInstallThenSignIn({
    reload: reloadClaudeLocal,
    signIn: () => void claudeLogin.start({ place: "local", configId: "default" }),
  });
  const { run: installClaude, reset: resetClaudeInstall } = claudeInstall;

  const cloudChatGptConnected = (engines?.connections ?? []).some(
    (row) => row.provider === "chatgpt" && isEngineConnectionUsable(row),
  );

  const geminiModel = `antigravity/${antigravityModelInUse(ANTIGRAVITY_MODEL_IDS[0]!, antigravity.status?.models)}`;
  const geminiRunning = antigravity.signIn.state === "running";
  const claudeBusy = claudeLogin.open || claudeInstall.installing;
  const busy =
    pending !== null || claudeBusy || connect.flow !== null || (geminiStarted && geminiRunning);

  const startGemini = useCallback(async () => {
    setGeminiStarted(true);
    if (await antigravity.start()) {
      if (await routeAssistantToModel(geminiModel)) done();
      else setError(t(`${K}.failed`));
    }
  }, [antigravity, done, geminiModel, t]);

  const run = useCallback(
    async (option: ConnectPlanOptionId) => {
      if (busy) return;
      setError(null);
      resetClaudeInstall();
      if (option === "gemini") {
        if (antigravity.status?.signedIn) {
          if (await routeAssistantToModel(geminiModel)) done();
          else setError(t(`${K}.failed`));
          return;
        }
        await startGemini();
        return;
      }
      if (option === "claude") {
        if (claudeLocal.signedIn) {
          if (await switchEngine("claude_code_local")) done();
          else setError(t(`${K}.failed`));
          return;
        }
        if (claudeLocal.loaded && !claudeLocal.cliInstalled) {
          if (claudeInstall.available) void installClaude();
          else setError(t(`${K}.claudeCliMissing`));
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
          const ready = chatgpt.usable || Boolean((await chatgpt.signIn())?.planUsage);
          if (!ready) return;
          if (!chatgpt.usable) announceChatGptPlanUse();
          if (await switchEngine("codex_cli")) done();
          else setError(t(`${K}.failed`));
          return;
        }
        const ready = cloudChatGptConnected || (await connect.start());
        if (!ready) return;
        if (!cloudChatGptConnected) announceChatGptPlanUse();
        await selectCloudChatGpt();
        done();
      } catch (caught) {
        console.warn("[connect-plan] ChatGPT connect failed", caught);
        setError(t(`${K}.failed`));
      } finally {
        setPending(null);
      }
    },
    [
      antigravity.status?.signedIn,
      busy,
      chatgpt,
      claudeInstall.available,
      claudeLocal.cliInstalled,
      claudeLocal.defaultSignedOut,
      claudeLocal.loaded,
      claudeLocal.signedIn,
      claudeLogin,
      cloudChatGptConnected,
      connect,
      done,
      geminiModel,
      installClaude,
      resetClaudeInstall,
      selectCloudChatGpt,
      startGemini,
      t,
    ],
  );

  const cancel = useCallback(() => {
    claudeLogin.cancel();
    if (geminiStarted && geminiRunning) antigravity.cancel();
    if (pending === "chatgpt") {
      if (chatgpt.available) chatgpt.cancelSignIn();
      else connect.cancel();
    }
  }, [antigravity, chatgpt, claudeLogin, connect, geminiRunning, geminiStarted, pending]);

  const close = useCallback(() => {
    cancel();
    onDismiss();
  }, [cancel, onDismiss]);

  const options = useMemo<ConnectPlanOption[]>(() => {
    const entry = (
      id: ConnectPlanOptionId,
      label: string,
      brand: ConnectPlanOption["brand"],
      isPending: boolean,
    ): ConnectPlanOption => ({ id, label, brand, pending: isPending, disabled: busy && !isPending });
    if (chatGptOnly) {
      return [entry("chatgpt", t(`${K}.connectChatGpt`), "openai", pending === "chatgpt" || connect.flow !== null)];
    }
    return [
      entry("chatgpt", "ChatGPT", "openai", pending === "chatgpt"),
      entry("claude", "Claude", "anthropic", claudeBusy),
      ...(antigravity.status
        ? [entry("gemini", "Gemini", "antigravity", geminiStarted && geminiRunning)]
        : []),
    ];
  }, [antigravity.status, busy, chatGptOnly, claudeBusy, connect.flow, geminiRunning, geminiStarted, pending, t]);

  const flow: ConnectPlanFlow =
    claudeInstall.state.status === "installing" || claudeInstall.state.status === "error"
      ? "claude-install"
      : claudeLogin.open
        ? "claude-login"
        : connect.flow
          ? "chatgpt-connect"
          : geminiStarted && antigravity.signIn.state !== "idle"
            ? "gemini"
            : pending === "chatgpt"
              ? "waiting"
              : null;

  const plusPrice = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: PLAN_CATALOG.plus.currency.toUpperCase(),
        maximumFractionDigits: 0,
      }).format(PLAN_CATALOG.plus.monthlyPriceCents / 100),
    [locale],
  );

  const startPlus = useCallback(async () => {
    if (pending) return;
    setError(null);
    setPending("plus");
    try {
      const session = await backendClient.call("billing.checkout", {
        plan: "plus",
        returnUrl: await getBillingReturnUrl(),
      });
      openExternalUrl(session.url);
      setCheckoutOpened(true);
    } catch (caught) {
      setError(errorText(caught, t("billing.v3.notice.checkoutFailed")));
    } finally {
      setPending(null);
    }
  }, [pending, t]);

  const plus =
    state.reason !== "no-engine" && isAuthenticated && !isSelfHostedServer()
      ? {
          lead: t(`${K}.noPlan`),
          label: t(`${K}.plus`, { price: plusPrice }),
          busy: pending === "plus",
          opened: checkoutOpened,
          start: () => void startPlus(),
        }
      : null;

  const other = chatGptOnly
    ? null
    : {
        label: t(`${K}.otherWays`),
        open: () => {
          close();
          openOtherModels();
        },
      };

  return {
    t,
    reason: state.reason,
    title: notice.title,
    description: notice.description,
    options,
    run: (id: ConnectPlanOptionId) => void run(id),
    flow,
    claudeInstall,
    installClaude: () => void installClaude(),
    claudeLogin,
    connect,
    antigravity,
    retryGemini: () => void startGemini(),
    cancel,
    close,
    plus,
    other,
    fine: checkoutOpened ? t("billing.v3.notice.checkoutOpened") : null,
    waiting: t(`${K}.waiting`),
    error,
  };
}

export type ConnectPlanController = ReturnType<typeof useConnectPlan>;
