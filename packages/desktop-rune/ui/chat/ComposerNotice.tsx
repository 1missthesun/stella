import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CONNECT_PLAN_COPY as COPY } from "@stella/contracts/connect-plan-offer";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { DEFAULT_REASONING_EFFORT } from "@stella/contracts/reasoning-effort";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { FOUND_VIA_ANSWERS, type FoundViaChoice } from "@stella/contracts/telemetry/anonymous-counts";
import { useT } from "@/shared/i18n";
import {
  dismissComposerNotice,
  registerComposerNoticeSurface,
  useComposerNotice,
  type ComposerNotice as ComposerNoticeRecord,
  type ComposerNoticeAction,
  type ComposerNoticeKind,
} from "@/features/chat/composer-notice-store";
import { ClaudeSignInNotice } from "@/features/claude/ClaudeSignInNotice";
import { useConnectPlanHeadsUp } from "@/features/chat/connect-plan/use-connect-plan-heads-up";
import { useClaudeLoginHeadsUp } from "@/features/claude/use-claude-login-heads-up";
import { connectPlanChatGptOnly, openPlans } from "@/features/chat/connect-plan/connect-plan";
import { ChatMessagesContext } from "@/context/chat-messages-context";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
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
import { buildEngineRoutingPatch, buildEngineTransitionReasoningPatch } from "@/global/settings/lib/engine-model-routing";
import { API_KEY_PROVIDERS, ASSISTANT_AGENT_KEYS, DEFAULT_MODEL_BY_PROVIDER } from "@/global/settings/lib/provider-default-models";
import { switchEngine } from "@/global/settings/lib/switch-engine";
import { STELLA_SEND_MESSAGE_EVENT } from "@/shared/lib/stella-send-message";
import { uiState } from "@/platform/ui-state";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import { FOUND_VIA_CHOICE_KEY, finishNudge } from "@/features/nudges/usage-nudges-store";
import { BrandIcon, Button, Input, Select, showToast } from "../kit/compat";
import { Icon, Icons, type IconData } from "../kit";
import { derive, mixOklch, radius, useTokens } from "../theme";

const KIND_ICON: Record<ComposerNoticeKind, IconData> = {
  "sign-in": Icons.stella.LogIn,
  upgrade: Icons.stella.Lock,
  limit: Icons.stella.AlertCircle,
  provider: Icons.stella.KeyRound,
};

const NARROW_W = 600;

function useNoticeLook() {
  const t = useTokens();
  return derive(t, "composer-notice", (k) => ({
    tile: mixOklch(k.c.foreground, 5, "transparent"),
    dismissHover: mixOklch(k.c.foreground, 8, "transparent"),
    optionHover: mixOklch(k.c.foreground, 6, "transparent"),
    pill: mixOklch(k.c.foreground, 12, "transparent"),
    pillHover: mixOklch(k.c.foreground, 24, "transparent"),
    pillHoverFill: mixOklch(k.c.foreground, 4, "transparent"),
  }));
}

/** `.composer-notice`: centred over the composer at min(50rem, 100% − 96px), or the full width when compact. */
function NoticeFrame({
  compact,
  column,
  alignStart,
  pad,
  dismiss,
  label,
  role = "status",
  children,
}: {
  compact: boolean;
  column?: boolean;
  alignStart?: boolean;
  pad?: { y: number; compactY: number };
  dismiss: { label: string; onPress: () => void; inset: number };
  label?: string;
  role?: "status" | "group";
  children: ReactNode;
}) {
  const t = useTokens();
  const l = useNoticeLook();
  const [narrow, setNarrow] = useState(false);
  const py = compact ? (pad?.compactY ?? 9) : (pad?.y ?? 12);
  const frame = (
    <box
      role={role}
      label={label}
      w="full"
      maxW={compact ? undefined : 800}
      pt={py}
      pb={py}
      pl={compact ? 10 : 14}
      pr={compact ? 32 : 40}
      border={t.c.border}
      radius={compact ? radius.xl : radius["2xl"]}
      fill={t.c.surfaceInset}
      enter={{ opacity: 0, y: 6, dur: 0.2, bounce: 0 }}
    >
      {column ? (
        <col w="full" gap={10} align="stretch">
          {children}
        </col>
      ) : (
        <row w="full" align={alignStart ? "start" : "center"} gap={compact ? 9 : 12} wrap={compact && !alignStart}>
          {children}
        </row>
      )}
      <box absolute={{ top: dismiss.inset, right: dismiss.inset }} w={24} h={24} center radius={radius.full} hoverFill={l.dismissHover} hoverGroup role="button" focusable cursor="pointer" label={dismiss.label} onPress={dismiss.onPress}>
        <icon svg={Icons.stella.X.body} name={Icons.stella.X.name} view={Icons.stella.X.view} size={14} color={t.c.textWeak} hoverColor={t.c.textStrong} />
      </box>
    </box>
  );
  if (compact) return <col w="full" mb={8}>{frame}</col>;
  return (
    <row w="full" justify="center" px={narrow ? 8 : 48} mb={10} onLayout={(r) => setNarrow(r.w < NARROW_W)}>
      {frame}
    </row>
  );
}

function NoticeTile({ icon, compact, color, plain }: { icon: IconData; compact: boolean; color?: string; plain?: boolean }) {
  const t = useTokens();
  const l = useNoticeLook();
  const size = compact ? 28 : 34;
  return (
    <box w={size} h={size} radius={compact ? 8 : 10} border={t.c.border} fill={plain ? undefined : l.tile} center shrink={false}>
      <Icon icon={icon} size={compact ? 14 : 16} color={color ?? t.c.textWeak} />
    </box>
  );
}

function NoticeTitle({ children, compact, lineHeight }: { children: ReactNode; compact: boolean; lineHeight?: number }) {
  const t = useTokens();
  const size = compact ? 12.5 : 13;
  return (
    <text size={size} weight={600} lineHeight={lineHeight ?? Math.round(size * 1.45)} color={t.c.textStrong}>
      {children}
    </text>
  );
}

function NoticeSub({ children, compact, mt = 2, grow }: { children: ReactNode; compact: boolean; mt?: number; grow?: boolean }) {
  const t = useTokens();
  const size = compact ? 11.5 : 12.5;
  return (
    <text size={size} lineHeight={Math.round(size * 1.35 * 100) / 100} color={t.c.textWeak} maxLines={3} truncate mt={mt} grow={grow ? 1 : undefined} minW={0}>
      {children}
    </text>
  );
}

function NoticeActions({ compact, children, wide }: { compact: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <row align="center" gap={8} shrink={false} w={compact && wide ? "full" : undefined} justify={compact && wide ? "end" : undefined}>
      {children}
    </row>
  );
}

const PILL_STYLE = { h: 28 } as const;

export const ComposerNotice = ({ compact = false, conversationId }: { compact?: boolean; conversationId?: string | null }) => {
  const t = useT();
  const tokens = useTokens();
  const notice = useComposerNotice(conversationId);

  useEffect(() => registerComposerNoticeSurface(), []);
  useConnectPlanHeadsUp(conversationId ?? null);
  useClaudeLoginHeadsUp();

  if (!notice) return null;
  if (notice.connectPlan) return <ConnectPlanNotice key={notice.id} notice={notice} compact={compact} onDismiss={() => dismissComposerNotice(notice.id)} />;
  if (notice.foundVia) return <FoundViaNotice key={notice.id} compact={compact} onClose={() => dismissComposerNotice(notice.id)} />;
  if (notice.claudeSignIn) return <ClaudeSignInNotice key={notice.id} notice={notice} compact={compact} onDismiss={() => dismissComposerNotice(notice.id)} />;

  const run = (action: ComposerNoticeAction) => {
    dismissComposerNotice(notice.id);
    action.onClick();
  };
  const inline = notice.kind === "limit";
  const actions =
    notice.action || notice.secondaryAction ? (
      <NoticeActions compact={compact} wide={!inline}>
        {notice.secondaryAction ? (
          <Button variant="ghost" className="pill-btn composer-notice__secondary" {...PILL_STYLE} onClick={() => run(notice.secondaryAction!)}>
            {notice.secondaryAction.label}
          </Button>
        ) : null}
        {notice.action ? (
          <Button variant="primary" className="pill-btn pill-btn--primary composer-notice__primary" {...PILL_STYLE} onClick={() => run(notice.action!)}>
            {notice.action.label}
          </Button>
        ) : null}
      </NoticeActions>
    ) : null;

  return (
    <NoticeFrame
      compact={compact}
      alignStart={inline}
      pad={inline ? { y: 9, compactY: 7 } : undefined}
      label={notice.title}
      dismiss={{ label: t("common.close"), onPress: () => dismissComposerNotice(notice.id), inset: inline ? (compact ? 4 : 6) : compact ? 6 : 8 }}
    >
      <NoticeTile icon={KIND_ICON[notice.kind]} compact={compact} color={inline ? tokens.colors.warning : undefined} />
      <col grow={1} minW={0}>
        <NoticeTitle compact={compact} lineHeight={inline ? (compact ? 17 : 18) : undefined}>
          {notice.title}
        </NoticeTitle>
        {inline ? (
          <row align="center" gap={10} mt={compact ? 6 : 8} mr={compact ? -23 : -29}>
            <NoticeSub compact={compact} mt={0} grow>
              {notice.description ?? ""}
            </NoticeSub>
            {actions}
          </row>
        ) : notice.description ? (
          <NoticeSub compact={compact}>{notice.description}</NoticeSub>
        ) : null}
      </col>
      {inline ? null : actions}
    </NoticeFrame>
  );
};

const answerFoundVia = (choice: FoundViaChoice, close: () => void) => {
  uiState.setItem(FOUND_VIA_CHOICE_KEY, choice);
  recordAnonymousCount({ type: "found_via", answer: choice });
  finishNudge("foundVia");
  close();
};

export function FoundViaNotice({ compact, onClose }: { compact: boolean; onClose: () => void }) {
  const t = useT();
  const tokens = useTokens();
  const l = useNoticeLook();
  return (
    <NoticeFrame compact={compact} alignStart role="group" label={t("nudges.foundVia.title")} dismiss={{ label: t("nudges.foundVia.skip"), onPress: () => answerFoundVia("skipped", onClose), inset: compact ? 6 : 8 }}>
      <NoticeTile icon={Icons.stella.Search} compact={compact} />
      <col grow={1} minW={0}>
        <NoticeTitle compact={compact}>{t("nudges.foundVia.title")}</NoticeTitle>
        <NoticeSub compact={compact}>{t("nudges.foundVia.body")}</NoticeSub>
        <row wrap gap={6} mt={10}>
          {FOUND_VIA_ANSWERS.map((choice) => (
            <box
              key={choice}
              role="button"
              focusable
              focusRing={{ width: 2, offset: 0, color: tokens.c.ring }}
              py={5 + 1}
              px={11 + 1}
              radius={radius.full}
              border={l.pill}
              hoverBorder={l.pillHover}
              hoverFill={l.pillHoverFill}
              pressScale={0.97}
              motion={{ dur: 0.16, bounce: 0 }}
              onPress={() => answerFoundVia(choice, onClose)}
            >
              <text size={12.5} lineHeight={15} color={tokens.c.textBase}>
                {t(`nudges.foundVia.answers.${choice}`)}
              </text>
            </box>
          ))}
        </row>
      </col>
    </NoticeFrame>
  );
}

type OptionId = "chatgpt" | "claude" | "apikey";
type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

const CLOUD_CHATGPT_MODEL = "gpt-6.1-sol";

type KeptMessage = { kind: "unsent"; clientMsgId: string; text: string } | { kind: "text"; text: string };

const lastOwnMessage = (messages: readonly MessageRecord[] | null): KeptMessage | null => {
  if (!messages) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type !== "user_message") continue;
    const text = message.payload?.text;
    if (typeof text !== "string" || !text.trim()) return null;
    return message.payload?.sendFailed ? { kind: "unsent", clientMsgId: message._id, text } : { kind: "text", text };
  }
  return null;
};

const sendKept = (kept: KeptMessage): void => {
  if (kept.kind === "unsent") cloudSendRecovery()?.dismiss(kept.clientMsgId);
  window.dispatchEvent(new CustomEvent(STELLA_SEND_MESSAGE_EVENT, { detail: { text: kept.text } }));
};

const routeToApiKeyProvider = async (provider: string): Promise<boolean> => {
  const system = window.electronAPI?.system;
  const preferences = await system?.getLocalModelPreferences?.();
  const model = DEFAULT_MODEL_BY_PROVIDER[provider];
  if (!system?.setLocalModelPreferences || !preferences || !model) return false;
  const enginePatch =
    preferences.agentRuntimeEngine === "default" ? {} : { ...buildEngineRoutingPatch(preferences, "default"), ...buildEngineTransitionReasoningPatch(preferences, "default") };
  const modelOverrides = { ...(enginePatch.modelOverrides ?? preferences.modelOverrides ?? {}) };
  for (const key of ASSISTANT_AGENT_KEYS) modelOverrides[key] = model;
  await system.setLocalModelPreferences({ ...enginePatch, modelOverrides });
  window.dispatchEvent(new CustomEvent("stella:local-model-preferences-changed"));
  return true;
};

export function ConnectPlanNotice({ notice, compact, onDismiss }: { notice: ComposerNoticeRecord; compact: boolean; onDismiss: () => void }) {
  const t = useT();
  const tokens = useTokens();
  const l = useNoticeLook();
  const state = notice.connectPlan!;
  const chatGptOnly = connectPlanChatGptOnly();
  const messages = useContext(ChatMessagesContext);
  const { isAuthenticated } = useAuthState();
  const engines = useCloudEngines(isAuthenticated && chatGptOnly);
  const chatgpt = useChatGptProfiles();
  const claudeLocal = useClaudeLocalAccounts();
  const credentials = useLlmCredentials();
  const connect = useEngineConnect();
  const apiKeysAvailable = Boolean(window.electronAPI?.system);
  const [choosing, setChoosing] = useState(Boolean(state.choose) || state.reason === "no-engine");
  const [pending, setPending] = useState<OptionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const [keyProvider, setKeyProvider] = useState<ApiKeyProvider>(API_KEY_PROVIDERS[0]);
  const [keyDraft, setKeyDraft] = useState("");
  const finished = useRef(false);

  const kept = useRef<KeptMessage | null | undefined>(undefined);
  if (kept.current === undefined) kept.current = state.resend || state.reason !== "allowance" ? null : lastOwnMessage(messages);
  const willResend = Boolean(state.resend || kept.current);

  const done = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDismiss();
    const message = kept.current;
    if (state.resend) state.resend();
    else if (message) sendKept(message);
    showToast({ title: state.resend || message ? COPY.sending : COPY.connected, variant: "success", duration: 4000 });
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
  const claudeInstall = useClaudeInstallThenSignIn({
    reload: reloadClaudeLocal,
    signIn: () => void claudeLogin.start({ place: "local", configId: "default" }),
  });
  const { run: installClaude, reset: resetClaudeInstall } = claudeInstall;
  const cloudChatGptConnected = (engines?.connections ?? []).some((row) => row.provider === "chatgpt" && isEngineConnectionUsable(row));

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
        void claudeLogin.start({ place: "local", ...(claudeLocal.defaultSignedOut ? { configId: "default" } : {}) });
        return;
      }
      setPending("chatgpt");
      try {
        if (chatgpt.available) {
          const ready = chatgpt.usable || Boolean((await chatgpt.signIn())?.planUsage);
          if (!ready) return;
          if (!chatgpt.usable) announceChatGptPlanUse();
          if (await switchEngine("codex_cli")) done();
          else setError(COPY.failed);
          return;
        }
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
        ...(apiKeysAvailable ? [{ id: "apikey" as const, title: COPY.apiKeyTitle, body: COPY.apiKeyBody }] : []),
      ];

  const offering = !choosing;
  const title = choosing && state.reason !== "no-engine" ? COPY.chooseTitle : notice.title;
  const description = choosing && state.reason !== "no-engine" ? (willResend ? COPY.chooseBody : COPY.chooseBodyNoResend) : notice.description;
  const busy = pending !== null || claudeLogin.open || claudeInstall.installing || connect.flow !== null;
  const showPlans = state.reason !== "no-engine";
  const fine = { size: 12, lineHeight: 17, color: tokens.c.textWeak } as const;

  return (
    <NoticeFrame
      compact={compact}
      column
      label={title}
      dismiss={{
        label: t("common.close"),
        onPress: () => {
          cancel();
          onDismiss();
        },
        inset: compact ? 6 : 8,
      }}
    >
      <row w="full" align="center" gap={compact ? 9 : 12} wrap={compact} minW={0}>
        <NoticeTile icon={state.reason === "no-engine" ? Icons.stella.Plug : Icons.stella.Lock} compact={compact} />
        <col grow={1} minW={0}>
          <NoticeTitle compact={compact}>{title}</NoticeTitle>
          {description ? <NoticeSub compact={compact}>{description}</NoticeSub> : null}
        </col>
        {offering || chatGptOnly ? (
          <NoticeActions compact={compact} wide>
            {showPlans ? (
              <Button
                variant="ghost"
                className="pill-btn composer-notice__secondary"
                {...PILL_STYLE}
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
                variant="primary"
                className="pill-btn pill-btn--primary composer-notice__primary"
                {...PILL_STYLE}
                onClick={() => {
                  if (chatGptOnly) void run("chatgpt");
                  else setChoosing(true);
                }}
              >
                {chatGptOnly ? COPY.connectChatGpt : COPY.connect}
              </Button>
            )}
          </NoticeActions>
        ) : null}
      </row>

      {choosing && options.length > 0 ? (
        <col w="full" gap={2} mr={-28} role="group" label={COPY.chooseTitle}>
          {options.map((option) => {
            const isPending = pending === option.id || (option.id === "claude" && (claudeLogin.open || claudeInstall.installing));
            const disabled = busy && !isPending;
            return (
              <row
                key={option.id}
                role="button"
                focusable={!disabled}
                disabled={disabled}
                label={`${option.title}, ${isPending ? t("common.loading") : t("onboarding.chat.signin.connect")}`}
                w="full"
                align="center"
                gap={12}
                py={8}
                px={10}
                radius={radius.lg}
                hoverFill={disabled ? undefined : l.optionHover}
                focusFill={l.optionHover}
                opacity={disabled ? 0.55 : 1}
                cursor={disabled ? undefined : "pointer"}
                onPress={disabled || isPending ? undefined : () => void run(option.id)}
              >
                <box w={34} h={34} radius={10} border={tokens.c.border} center shrink={false}>
                  {option.id === "apikey" ? <Icon icon={Icons.stella.KeyRound} size={16} color={tokens.c.textStrong} /> : <BrandIcon brand={option.id === "chatgpt" ? "openai" : "anthropic"} size={18} />}
                </box>
                <col grow={1} minW={0}>
                  <text size={13} weight={600} lineHeight={19} color={tokens.c.textStrong}>
                    {option.title}
                  </text>
                  <text size={12.5} lineHeight={16.88} color={tokens.c.textWeak}>
                    {option.body}
                  </text>
                </col>
                {isPending ? (
                  <box shrink={false} label={t("common.loading")}>
                    <Icon icon={Icons.stella.LoaderCircle} size={16} strokeWidth={2} color={tokens.c.primary} spin={0.8} />
                  </box>
                ) : option.id === "apikey" && keyFormOpen ? null : (
                  <text size={12.5} weight={500} color={tokens.c.primary} shrink={false}>
                    {t("onboarding.chat.signin.connect")}
                  </text>
                )}
              </row>
            );
          })}
        </col>
      ) : null}

      {keyFormOpen ? (
        <row w="full" align="center" gap={8} mr={-28}>
          <box w={176} shrink={false}>
            <Select
              value={keyProvider}
              onValueChange={(value) => setKeyProvider(value as ApiKeyProvider)}
              aria-label={COPY.apiKeyTitle}
              options={API_KEY_PROVIDERS.map((provider) => ({ value: provider, label: LLM_PROVIDERS.find((entry) => entry.key === provider)?.label ?? provider }))}
            />
          </box>
          <Input
            type="password"
            value={keyDraft}
            spellCheck={false}
            placeholder={LLM_PROVIDERS.find((entry) => entry.key === keyProvider)?.placeholder}
            aria-label={COPY.apiKeyTitle}
            onChange={(event) => setKeyDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveApiKey();
            }}
            disabled={pending === "apikey"}
            grow={1}
            minW={0}
            h={30}
            px={10 + 1}
            border={tokens.c.border}
            radius={radius.lg}
            size={12.5}
            color={tokens.c.textStrong}
          />
          <Button variant="primary" className="pill-btn pill-btn--primary" disabled={pending === "apikey" || !keyDraft.trim()} onClick={() => void saveApiKey()}>
            {t("common.save")}
          </Button>
        </row>
      ) : null}

      {claudeInstall.state.status === "installing" || claudeInstall.state.status === "error" ? (
        <col w="full" mr={-28}>
          <ClaudeCliInstallStatus state={claudeInstall.state} onRetry={() => void installClaude()} />
        </col>
      ) : claudeLogin.open ? (
        <col w="full" mr={-28}>
          <ClaudeLoginPrompt login={claudeLogin} />
        </col>
      ) : connect.flow ? (
        <col w="full" mr={-28}>
          <EngineConnectPrompt connect={connect} />
        </col>
      ) : pending === "chatgpt" ? (
        <row gap={4} align="center">
          <text {...fine}>{COPY.waiting}</text>
          <box role="button" focusable cursor="pointer" onPress={cancel}>
            <text {...fine} color={tokens.c.primary}>
              {t("common.cancel")}
            </text>
          </box>
        </row>
      ) : error ? (
        <text {...fine} role="alert" color={tokens.c.danger}>
          {error}
        </text>
      ) : null}
    </NoticeFrame>
  );
}
