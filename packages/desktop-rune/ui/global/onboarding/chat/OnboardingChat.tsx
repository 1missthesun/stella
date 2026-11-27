import { Button, Press, Select, T, tx } from "../../../kit/compat";
import { useOnboardingChat as useOnboardingChatSheet } from "./onboarding-chat.styles";
import { useTokens, type Style } from "../../../theme";
import { useFullShellChat } from "../../shared/full-shell.chat.styles";
import { useCompactConversation } from "../../shared/compact-conversation.styles";
import { useFullShellLayout } from "../../shared/full-shell.layout.styles";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { InlineWorkingIndicator } from "@/app/chat/InlineWorkingIndicator";
import { Markdown } from "@/app/chat/Markdown";
import { LegalDialog } from "../../legal/LegalDialog";
import { StellaCharacter, type StellaCharacterState } from "@/ui/stella-character/StellaCharacter";
import type { StellaMarkHandle } from "@/ui/stella-character/rig";
import { LOCALE_NATIVE_LABELS, useI18n, useT } from "@/shared/i18n";
import { useWindowFocus } from "@/shared/hooks/use-window-focus";
import { OnboardingComposer } from "./OnboardingComposer";
import { SignInCard } from "./cards/SignInCard";
import { ExtrasCard } from "./cards/ExtrasCard";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import { startUsageNudges } from "@/features/nudges/usage-nudges-store";
import { useDesktopServerState } from "@/global/self-host/self-host-store";
import { useSelfHostedServer, useServerDiscovery } from "@/platform/backend/server-discovery";
import type { OnboardingChatStep } from "@/global/onboarding/chat/onboarding-chat-flow";
import {
  useOnboardingChat,
  type OnboardingChatEntry,
  type OnboardingChatHandoff,
} from "@/global/onboarding/chat/use-onboarding-chat";

type OnboardingChatProps = {
  isAuthenticated: boolean;
  onComplete: (handoff: OnboardingChatHandoff) => void;
};

type LegalDocument = "terms" | "privacy";

const MARK_SIZE_PX = 40;
const MARK_OFFSET_PX = MARK_SIZE_PX + 6;
const SPEAKING_MS = 1600;
const SCROLL_ID = "obc-scroll";
const INDICATOR_KEY = "__indicator";
const entryElementId = (id: string) => `obc-entry-${id}`;

const STEP_MOODS: Record<OnboardingChatStep, StellaCharacterState> = {
  signin: "listening",
  extras: "happy",
};

function LegalLine({
  onOpen,
}: {
  onOpen: (document: LegalDocument) => void;
}) {
  const s = useOnboardingChatSheet();
  const t = useT();
  const parts = t("onboarding.legalFooter").split(/\{(\w+)\}/);
  const slots: Record<string, ReactNode> = {
    terms: (
      <Press {...s.obcLegalLink} onPress={() => onOpen("terms")}>
        {t("onboarding.termsOfService")}
      </Press>
    ),
    privacy: (
      <Press {...s.obcLegalLink} onPress={() => onOpen("privacy")}>
        {t("onboarding.privacyPolicy")}
      </Press>
    ),
  };
  return (
    <T w="full" {...s.obcLegal}>
      {parts.map((part, index) =>
        index % 2 === 0 ? (
          <T {...tx(s.obcLegal)} key={index}>{part}</T>
        ) : (
          <T {...tx(s.obcLegal)} key={index}>{slots[part] ?? `{${part}}`}</T>
        ),
      )}
    </T>
  );
}

export function OnboardingChat({ isAuthenticated, onComplete }: OnboardingChatProps) {
  const s = useOnboardingChatSheet();
  const tokens = useTokens();
  const sFullShellChat = useFullShellChat();
  const sFullShellLayout = useFullShellLayout();
  const t = useT();
  const { locale, setLocale, supportedLocales } = useI18n();
  const windowFocused = useWindowFocus();
  const [activeLegalDoc, setActiveLegalDoc] = useState<LegalDocument | null>(null);
  const markRef = useRef<StellaMarkHandle | null>(null);

  const canConnectGmail =
    isAuthenticated && Boolean(window.electronAPI?.nativeIntegrations?.enable);
  const {
    entries,
    steps,
    currentStep,
    answers,
    indicator,
    exiting,
    answer,
    finish,
  } = useOnboardingChat({
    onFinished: (handoff) => {
      recordAnonymousCount({ type: "engine_chosen" });
      onComplete(handoff);
    },
  });

  useEffect(() => {
    startUsageNudges(false);
  }, []);

  const [message, setMessage] = useState("");

  const handleSend = useCallback(() => {
    const text = message.trim();
    if (!text) return;
    finish({ composerDraft: { text, send: true } });
  }, [finish, message]);

  const handleSkipAll = useCallback(() => finish({}), [finish]);

  const lastEntryId = entries[entries.length - 1]?.id ?? null;
  const lastEntryKind = entries[entries.length - 1]?.kind ?? null;
  const firstEntryId = entries[0]?.id ?? null;
  const scrolledOnceRef = useRef(false);
  const followRef = useRef(false);
  const land = useCallback(
    (animate: boolean) => {
      if (!lastEntryId) return;
      if (lastEntryKind === "assistant") {
        if (lastEntryId === firstEntryId) void stella.engine.scroll.to(SCROLL_ID, 0, { animate });
        else void stella.engine.scroll.intoView(entryElementId(lastEntryId));
        return;
      }
      void stella.engine.scroll.to(SCROLL_ID, "end", { animate });
    },
    [lastEntryId, lastEntryKind, firstEntryId],
  );
  useLayoutEffect(() => {
    if (!lastEntryId) return;
    const first = !scrolledOnceRef.current;
    scrolledOnceRef.current = true;
    followRef.current = first;
    land(!first);
  }, [lastEntryId, land]);

  useEffect(() => {
    if (!indicator.active) return;
    void stella.engine.scroll.to(SCROLL_ID, "end", { animate: true });
  }, [indicator.active]);

  const contentY = useRef(0);
  const rowY = useRef(new Map<string, number>());
  const [markTop, setMarkTop] = useState<number | null>(null);
  const lastAssistantId =
    [...entries].reverse().find((entry) => entry.kind === "assistant")?.id ?? null;
  const markTarget = indicator.active || indicator.handoff ? INDICATOR_KEY : lastAssistantId;
  const placeMark = useCallback(() => {
    if (!markTarget) return;
    const y = rowY.current.get(markTarget);
    if (y === undefined) return;
    setMarkTop(y - contentY.current - MARK_OFFSET_PX);
  }, [markTarget]);
  useLayoutEffect(() => placeMark(), [placeMark, entries.length]);
  const noteRow = (key: string) => (r: { y: number }) => {
    rowY.current.set(key, r.y);
    if (key === markTarget) placeMark();
  };

  const [speaking, setSpeaking] = useState(false);
  const lastFreshAssistantId =
    [...entries].reverse().find((entry) => entry.kind === "assistant" && entry.fresh)
      ?.id ?? null;
  useEffect(() => {
    if (!lastFreshAssistantId) return;
    setSpeaking(true);
    const timer = window.setTimeout(() => setSpeaking(false), SPEAKING_MS);
    return () => window.clearTimeout(timer);
  }, [lastFreshAssistantId]);

  const progressCount = exiting ? steps.length : steps.indexOf(currentStep);

  const mood: StellaCharacterState = exiting
    ? "celebrate"
    : indicator.active
      ? "writing"
      : speaking
        ? "speaking"
        : STEP_MOODS[currentStep];

  const selfHosted = useSelfHostedServer();
  const discovery = useServerDiscovery();
  const serverState = useDesktopServerState();
  const serverName = discovery?.name || serverState?.name || "";
  const proseFor = (step: OnboardingChatStep): string => {
    if (step === "signin" && selfHosted) {
      return t("selfHost.onboarding.prose", { name: serverName });
    }
    return t(`onboarding.chat.messages.${step}`);
  };

  const cardFor = (step: OnboardingChatStep): ReactNode => {
    const active = currentStep === step && !exiting;
    const answered = answers[step];
    switch (step) {
      case "signin":
        return (
          <SignInCard active={active} answered={answered} onAnswer={(kind) => {
              recordAnonymousCount({ type: "engine_chosen" });
              answer(step, kind);
            }} />
        );
      case "extras":
        return (
          <ExtrasCard active={active} answered={answered} canConnectGmail={canConnectGmail} onAnswer={(kind) => {
              markRef.current?.sparkle();
              answer(step, kind);
            }} />
        );
      default: {
        const exhaustive: never = step;
        return exhaustive;
      }
    }
  };

  const rowGap = (index: number, kind: OnboardingChatEntry["kind"]) => {
    const previous = entries[index - 1];
    if (!previous) return null;
    if (previous.kind === kind) return kind === "assistant" ? s.obcRowAfterAssistant : s.obcRowAfterUser;
    return s.obcRowAfter;
  };

  const renderEntry = (entry: OnboardingChatEntry, index: number) => {
    const enter = entry.fresh ? { opacity: 0, y: 14, scale: 0.84, dur: 0.36, bounce: 0.25 } : undefined;
    if (entry.kind === "user") {
      return (
        <col id={entryElementId(entry.id)} {...s.obcRow} {...rowGap(index, "user")} key={entry.id} onLayout={noteRow(entry.id)}>
          <col {...s.obcItemUser} enter={enter}>
            <T w="full" {...s.obcUserText}>{entry.text}</T>
          </col>
        </col>
      );
    }
    const isFirst = index === 0;
    return (
      <col id={entryElementId(entry.id)} {...s.obcRow} {...rowGap(index, "assistant")} key={entry.id} onLayout={noteRow(entry.id)}>
        <col {...s.obcItemAssistant} enter={enter}>
          <col {...sFullShellChat.assistantMessageText}>
            <Markdown text={proseFor(entry.step)} cacheKey={`onboarding:${entry.step}`} hideHorizontalRules />
          </col>
          {cardFor(entry.step)}
          {isFirst ? <LegalLine onOpen={setActiveLegalDoc} /> : null}
        </col>
      </col>
    );
  };

  return (
    <col {...s.obcSurface} {...((exiting || undefined) ? s.obcSurfaceExiting : null)}>
      <LegalDialog document={activeLegalDoc} onOpenChange={(open) => {
          if (!open) setActiveLegalDoc(null);
        }} />

      <row {...s.obcDragbar}>
        <row absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} align="center" justify="center" inert>
          <row {...s.obcProgress} w={240} maxW="30%" role="progressbar" label={t("onboarding.chat.progress")}>
            {steps.map((step, index) => {
              const state = index < progressCount ? "done" : index === progressCount ? "current" : undefined;
              return (
                <row {...s.obcProgressSeg} key={step}>
                  <box h="full" radius={999} fill={tokens.c.primary} w={state === "done" ? "full" : state === "current" ? "35%" : 0} opacity={state === "current" ? 0.55 : 1} layout={0.7} motion={{ dur: 0.7 }} />
                </row>
              );
            })}
          </row>
        </row>
        <col {...s.obcDragbarLang}>
          <Select value={locale} aria-label={t("common.language")} onValueChange={(value) => setLocale(value)} options={supportedLocales.map((code) => ({
              value: code,
              label: LOCALE_NATIVE_LABELS[code],
            }))} />
        </col>
        <Button {...(s.obcDragbarSkip as Omit<Style, "size">)} size="small" variant="ghost" disabled={exiting} onClick={handleSkipAll}>
          {t("onboarding.chat.skipSetup")}
        </Button>
      </row>

      <col {...sFullShellLayout.fullBodyMain}>
        <col w="full" {...sFullShellLayout.chatViewportRegion}>
          <col id={SCROLL_ID} w="full" {...sFullShellLayout.sessionContent} {...s.obcScroll} onPress={() => (followRef.current = false)}>
            <col {...s.obcContent} pt={108} w="full" maxW={800} onLayout={(r) => {
                contentY.current = r.y;
                placeMark();
                if (followRef.current) land(false);
              }}>
              <col {...s.obcMark} absolute={{ left: 24, top: markTop ?? 0 }} {...(markTop !== null ? s.obcMarkVisible : null)} layout={0.62}>
                <StellaCharacter {...s.obcMarkGlyph} handleRef={markRef} size={MARK_SIZE_PX} state={mood} shape="star" ink="aurora" glow followPointer paused={!windowFocused} />
              </col>
              {entries.map(renderEntry)}
              <col w="full" {...s.obcIndicator} {...(!indicator.active && !indicator.handoff ? s.obcIndicatorIdle : null)} onLayout={noteRow(INDICATOR_KEY)}>
                <InlineWorkingIndicator active={indicator.active} handoff={indicator.handoff} />
              </col>
              <col w="full" {...s.obcTail} />
            </col>
          </col>
        </col>

        <col w="full" {...sFullShellLayout.composerWrap}>
          <OnboardingComposer value={message} onChange={setMessage} onSend={handleSend} disabled={exiting} />
        </col>
      </col>
    </col>
  );
}
