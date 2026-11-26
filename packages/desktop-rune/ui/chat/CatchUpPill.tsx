import { serverNow } from "@stella/contracts/server-clock";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatchUp, CatchUpItem, CatchUpLink } from "@stella/contracts/backend/catch-ups";
import { CATCH_UP_MIN_NEW_MESSAGES, catchUpOffer, catchUpRows } from "@stella/contracts/catch-up";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { isUiHiddenChatMessagePayload } from "@stella/contracts/chat-event-visibility";
import { useChatMessages } from "@/context/use-chat-messages";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useLocale, useT } from "@/shared/i18n";
import { showToast } from "@/ui/toast";
import { requestMessageJump } from "@/features/catch-up/message-jump";
import { APP_TEXT, BODY_TEXT, Popover, PopoverContent, PopoverTrigger } from "../kit/compat";
import { Icon, Icons, withStroke, type IconData } from "../kit";
import { derive, fontSize, mix, mixOklch, radius, useTokens, weight } from "../theme";
import { panelSurface } from "./surfaces";
import { TextShimmer } from "./TextShimmer";

const visibleMessageText = (message: MessageRecord): string => {
  const text = (message.payload as { text?: unknown } | undefined)?.text;
  return typeof text === "string" ? text : "";
};

const offerMessages = (messages: readonly MessageRecord[]) =>
  messages.flatMap((message) =>
    (message.type === "assistant_message" || message.type === "user_message") && !isUiHiddenChatMessagePayload(message.payload ?? null) && visibleMessageText(message).trim()
      ? [{ role: message.type === "assistant_message" ? "assistant" : "user", at: message.timestamp }]
      : [],
  );

const formatWhen = (locale: string, at: number): string => new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);

const formatGap = (locale: string, at: number, pageAt: number): string =>
  new Intl.DateTimeFormat(locale, new Date(at).toDateString() === new Date(pageAt).toDateString() ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" }).format(at);

const POPOVER_W = 480;
const PAGE_MAX_H = 448;
const TNUM = "'tnum' 1";
const PAGER_KEYS = ["ArrowLeft", "ArrowRight"];
const SECTION_ICON = { done: Icons.stella.Check, ongoing: Icons.stella.CircleDot, waiting: Icons.stella.CircleQuestionMark } as const;
const APP_TRACKING = APP_TEXT.size * APP_TEXT.em;
const FAMILY = BODY_TEXT.family;
const body = (size: number) => ({ family: FAMILY, size, lineHeight: size * BODY_TEXT.lh });
const SHIMMER_LOOK = { ...body(fontSize.base), weight: weight.regular };

const useCatchUpLook = () =>
  derive(useTokens(), "chat:catch-up", (k) => ({
    count: mixOklch(k.c.primary, 16, "transparent"),
    navHover: mixOklch(k.c.foreground, 7, "transparent"),
    itemHover: mix(k.c.chatAssistantBubbleText, 7, "transparent"),
  }));

function Section({ kind, items, pageAt, onJump }: { kind: "done" | "ongoing" | "waiting"; items: CatchUpItem[]; pageAt: number; onJump: (link: CatchUpLink) => void }) {
  const t = useT();
  const locale = useLocale();
  const c = useTokens().c;
  const look = useCatchUpLook();
  const rows = useMemo(() => catchUpRows(items), [items]);
  if (items.length === 0) return null;
  const titleColor = kind === "waiting" ? c.primary : c.mutedForeground;
  return (
    <col w="full" align="stretch">
      <row align="center" gap={6} mb={4}>
        <Icon icon={withStroke(SECTION_ICON[kind], 2.2)} size={13} color={titleColor} />
        <text {...body(fontSize["2xs"])} weight={weight.semibold} tracking={fontSize["2xs"] * 0.02} textCase="upper" color={titleColor}>
          {t(`app.chat.catchUp.${kind}`)}
        </text>
      </row>
      <col w="full" align="stretch">
        {rows.map((row, index) =>
          row.kind === "time" ? (
            <text key={`time-${index}`} pt={4} pb={2} w="full" textAlign="center" {...body(fontSize["2xs"])} features={TNUM} color={c.mutedForeground}>
              {formatGap(locale, row.at, pageAt)}
            </text>
          ) : row.item.links[0] ? (
            <box key={index} role="button" label={row.item.text} focusable mx={-6} py={3} px={6} radius={radius.md} hoverFill={look.itemHover} focusRing={{ width: 2, offset: -2, color: c.ring }} onPress={() => onJump(row.item.links[0]!)}>
              <text family={FAMILY} size={fontSize.base} lineHeight={fontSize.base * 1.4} color={c.chatAssistantBubbleText}>
                {row.item.text}
              </text>
            </box>
          ) : (
            <text key={index} mx={-6} py={3} px={6} family={FAMILY} size={fontSize.base} lineHeight={fontSize.base * 1.4} color={c.chatAssistantBubbleText} selectable>
              {row.item.text}
            </text>
          ),
        )}
      </col>
    </col>
  );
}

function CatchUpPage({ catchUp, newest, onJump, onRetry }: { catchUp: CatchUp; newest: boolean; onJump: (link: CatchUpLink) => void; onRetry: () => void }) {
  const t = useT();
  const locale = useLocale();
  const tokens = useTokens();
  const c = tokens.c;
  const panel = panelSurface(tokens);
  const empty = catchUp.done.length === 0 && catchUp.ongoing.length === 0 && catchUp.waiting.length === 0;
  const status = (children: React.ReactNode, live = true) => (
    <col role={live ? "status" : undefined} align="start" gap={10} pt={6}>
      {children}
    </col>
  );
  return (
    <col role="article" label={formatWhen(locale, catchUp.createdAt)} w="full" maxH={PAGE_MAX_H} scrollY pt={8} px={16} pb={14} align="stretch" selectionGroup>
      {catchUp.state === "pending" ? (
        status(<TextShimmer text={t("app.chat.catchUp.loading")} look={SHIMMER_LOOK} durationMs={1400} color={c.mutedForeground} />)
      ) : catchUp.state === "failed" ? (
        status(
          <>
            <text {...body(fontSize.base)} color={c.mutedForeground}>
              {t("app.chat.catchUp.failed")}
            </text>
            {newest ? (
              <box role="button" label={t("app.chat.catchUp.retry")} focusable py={5} px={12} radius={radius.full} border={panel.border} hoverBorder={panel.hoverBorder} onPress={onRetry}>
                <text {...body(fontSize.sm)} color={c.textStrong}>
                  {t("app.chat.catchUp.retry")}
                </text>
              </box>
            ) : null}
          </>,
        )
      ) : empty ? (
        status(
          <text {...body(fontSize.base)} color={c.mutedForeground}>
            {t("app.chat.catchUp.empty")}
          </text>,
          false,
        )
      ) : (
        <col w="full" gap={12} align="stretch">
          <Section kind="waiting" items={catchUp.waiting} pageAt={catchUp.createdAt} onJump={onJump} />
          <Section kind="ongoing" items={catchUp.ongoing} pageAt={catchUp.createdAt} onJump={onJump} />
          <Section kind="done" items={catchUp.done} pageAt={catchUp.createdAt} onJump={onJump} />
        </col>
      )}
    </col>
  );
}

function PagerButton({ label, icon, disabled, onPress }: { label: string; icon: IconData; disabled: boolean; onPress: () => void }) {
  const c = useTokens().c;
  const look = useCatchUpLook();
  return (
    <box role="button" label={label} focusable={!disabled} disabled={disabled} w={28} h={28} center radius={radius.full} hoverFill={disabled ? undefined : look.navHover} focusRing={{ width: 2, offset: 1, color: c.ring }} onPress={disabled ? undefined : onPress}>
      <Icon icon={icon} size={16} color={disabled ? c.textWeaker : c.textBase} />
    </box>
  );
}

/** desktop-ui's `CatchUpPill`: the "catch up" pill over the composer and its paged summaries of what happened. */
export const CatchUpPill = memo(function CatchUpPill({ conversationId }: { conversationId: string }) {
  const t = useT();
  const locale = useLocale();
  const tokens = useTokens();
  const c = tokens.c;
  const panel = panelSurface(tokens);
  const look = useCatchUpLook();
  const messages = useChatMessages();
  const view = useBackendView("catchUps.list", { conversationId });
  const catchUps = useMemo(() => view.value?.catchUps ?? [], [view.value]);
  const offerInput = useMemo(() => offerMessages(messages), [messages]);
  const [now, setNow] = useState(() => serverNow());
  const offer = useMemo(() => catchUpOffer(offerInput, catchUps, now), [catchUps, now, offerInput]);
  useEffect(() => {
    if (!offer.lingerUntil) return;
    const timer = setTimeout(() => setNow(serverNow()), Math.max(0, offer.lingerUntil - serverNow()) + 50);
    return () => clearTimeout(timer);
  }, [offer.lingerUntil]);
  const pending = catchUps.some((catchUp) => catchUp.state === "pending");
  const [open, setOpen] = useState(false);
  const requestingRef = useRef(false);

  const request = useCallback(async () => {
    if (requestingRef.current) return;
    requestingRef.current = true;
    try {
      await backendClient.call("catchUps.request", { conversationId });
    } catch (error) {
      showToast({ title: t("app.chat.catchUp.failed"), description: error instanceof Error ? error.message : undefined, variant: "error" });
    } finally {
      requestingRef.current = false;
    }
  }, [conversationId, t]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next && offer.count >= CATCH_UP_MIN_NEW_MESSAGES && !pending) void request();
    },
    [offer.count, pending, request],
  );

  const onJump = useCallback(
    (link: CatchUpLink) => {
      setOpen(false);
      requestMessageJump(conversationId, link.messageIds);
    },
    [conversationId],
  );

  const total = catchUps.length;
  const newest = catchUps.at(-1);
  const newestKey = newest ? `${newest.catchUpId}:${newest.state}` : "";
  const [pageIndex, setPageIndex] = useState(0);
  const [slideFrom, setSlideFrom] = useState(0);
  const shownKeyRef = useRef<string | null>(null);
  const shown = Math.min(pageIndex, Math.max(0, total - 1));

  const goTo = useCallback(
    (next: number, animate = true) => {
      const target = Math.max(0, Math.min(next, total - 1));
      setSlideFrom(animate ? Math.sign(target - shown) : 0);
      setPageIndex(target);
    },
    [shown, total],
  );

  useEffect(() => {
    if (!open) {
      shownKeyRef.current = null;
      return;
    }
    if (!newestKey || shownKeyRef.current === newestKey) return;
    goTo(total - 1, shownKeyRef.current !== null);
    shownKeyRef.current = newestKey;
  }, [goTo, newestKey, open, total]);

  useEffect(() => setNow(serverNow()), [catchUps]);

  if (!offer.offer && !pending && !open && !offer.lingerUntil) return null;

  const counted = offer.count >= CATCH_UP_MIN_NEW_MESSAGES;
  const page = catchUps[shown];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <row
          role="button"
          label={counted ? t("app.chat.catchUp.pillLabel", { count: offer.count }) : t("app.chat.catchUp.title")}
          focusable
          align="center"
          gap={6}
          shrink={false}
          h={28}
          mb={6}
          pl={9 + 1}
          pr={10 + 1}
          radius={radius.full}
          border={open ? panel.hoverBorder : panel.border}
          hoverBorder={panel.hoverBorder}
          fill={c.background}
          gradient={panel.gradient}
          shadows={panel.shadows}
          hoverColor={c.textStrong}
          focusRing={{ width: 2, offset: -2, color: c.ring }}
          enter={{ opacity: 0, y: 4, dur: 0.18, bounce: 0 }}
        >
          <Icon icon={withStroke(Icons.stella.LayoutList, 2)} size={14} color={c.textWeak} />
          <text size={fontSize.sm} lineHeight={fontSize.sm * 1.3} tracking={APP_TRACKING} weight={weight.medium} color={open ? c.textStrong : c.textBase} nowrap>
            {t("app.chat.catchUp.pill")}
          </text>
          {counted ? (
            <box minW={18} h={18} px={5} center radius={radius.full} fill={look.count}>
              <text size={fontSize["2xs"]} tracking={APP_TRACKING} weight={weight.semibold} features={TNUM} color={c.textStrong}>
                {String(offer.count)}
              </text>
            </box>
          ) : null}
        </row>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} w={POPOVER_W} minW={0} maxW={POPOVER_W} clip={radius["3xl"]} radius={radius["3xl"]} fill={c.background} gradient={tokens.gradient.assistantBubble}>
        <col
          role="group"
          label={t("app.chat.catchUp.title")}
          w="full"
          align="stretch"
          focusable
          autoFocus
          keys={total > 1 ? PAGER_KEYS : undefined}
          onKey={(e) => goTo(shown + (e.key === "ArrowLeft" ? -1 : 1))}
        >
          <row align="center" gap={8} minH={40} pt={6} pr={8} pl={16}>
            <text grow={1} minW={0} {...body(fontSize.base)} weight={weight.semibold} color={c.textStrong} nowrap truncate>
              {page ? formatWhen(locale, page.createdAt) : t("app.chat.catchUp.title")}
            </text>
            {total > 1 ? (
              <row align="center" gap={2} shrink={false}>
                <PagerButton label={t("common.previous")} icon={Icons.stella.ChevronLeft} disabled={shown === 0} onPress={() => goTo(shown - 1)} />
                <text minW={fontSize.sm * 3.6} textAlign="center" {...body(fontSize.sm)} features={TNUM} color={c.textWeak}>
                  {t("userAsk.question.progress", { current: shown + 1, total })}
                </text>
                <PagerButton label={t("common.next")} icon={Icons.stella.ChevronRight} disabled={shown === total - 1} onPress={() => goTo(shown + 1)} />
              </row>
            ) : null}
          </row>
          <col w="full" clip={0} align="stretch" layout={0.16}>
            {page ? (
              <col key={page.catchUpId} w="full" align="stretch" enter={slideFrom ? { x: slideFrom * POPOVER_W * 0.3, opacity: 0, dur: 0.22, bounce: 0 } : undefined}>
                <CatchUpPage catchUp={page} newest={shown === total - 1} onJump={onJump} onRetry={() => void request()} />
              </col>
            ) : null}
          </col>
        </col>
      </PopoverContent>
    </Popover>
  );
});
