/**
 * "Summary" (catch-ups inside): the pill above the composer once a busy stretch has gone by
 * (`catchUpOffer`, shared with mobile), and the popover it opens. Opening it
 * asks the cloud for a summary of what is new (`catchUps.request`); every
 * summary so far stays in the popover as its own page, oldest on the left and
 * newest on the right, swiped or arrowed through one at a time. Tapping a
 * line jumps to the message it came from.
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { CatchUp, CatchUpItem, CatchUpLink } from "@stella/contracts/backend/catch-ups";
import { CATCH_UP_MIN_NEW_MESSAGES, catchUpOffer, catchUpRows } from "@stella/contracts/catch-up";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { isUiHiddenChatMessagePayload } from "@stella/contracts/chat-event-visibility";
import { useChatMessages } from "@/context/use-chat-messages";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useLocale, useT } from "@/shared/i18n";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CircleQuestionMark,
  LayoutList,
} from "@/ui/icons";
import { Popover } from "@/ui/popover";
import { showToast } from "@/ui/toast";
import { requestMessageJump } from "./message-jump";
import "./catch-up.css";

const visibleMessageText = (message: MessageRecord): string => {
  const text = (message.payload as { text?: unknown } | undefined)?.text;
  return typeof text === "string" ? text : "";
};

/** The user's and Stella's shown messages, as the offer rule reads them. */
const offerMessages = (messages: readonly MessageRecord[]) =>
  messages.flatMap((message) =>
    (message.type === "assistant_message" || message.type === "user_message") &&
    !isUiHiddenChatMessagePayload(message.payload ?? null) &&
    visibleMessageText(message).trim()
      ? [{ role: message.type === "assistant_message" ? "assistant" : "user", at: message.timestamp }]
      : [],
  );

const formatWhen = (locale: string, at: number): string =>
  new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);

/** A separator's time: the day too when it is not the summary's own day. */
const formatGap = (locale: string, at: number, pageAt: number): string =>
  new Intl.DateTimeFormat(
    locale,
    new Date(at).toDateString() === new Date(pageAt).toDateString()
      ? { hour: "numeric", minute: "2-digit" }
      : { weekday: "short", hour: "numeric", minute: "2-digit" },
  ).format(at);

function Section({
  kind,
  items,
  pageAt,
  onJump,
}: {
  kind: "done" | "ongoing" | "waiting";
  items: CatchUpItem[];
  pageAt: number;
  onJump: (link: CatchUpLink) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const rows = useMemo(() => catchUpRows(items), [items]);
  if (items.length === 0) return null;
  const Icon = kind === "done" ? Check : kind === "ongoing" ? CircleDot : CircleQuestionMark;
  return (
    <section className="catch-up-section" data-kind={kind}>
      <h3 className="catch-up-section__title">
        <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
        {t(`app.chat.catchUp.${kind}`)}
      </h3>
      <ul className="catch-up-section__items">
        {rows.map((row, index) =>
          row.kind === "time" ? (
            <li key={`time-${index}`} className="catch-up-time" aria-hidden="true">
              {formatGap(locale, row.at, pageAt)}
            </li>
          ) : (
            <li key={index}>
              {row.item.links[0] ? (
                <button
                  type="button"
                  className="catch-up-item"
                  data-testid="catch-up-link"
                  onClick={() => onJump(row.item.links[0]!)}
                >
                  {row.item.text}
                </button>
              ) : (
                <span className="catch-up-item">{row.item.text}</span>
              )}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function CatchUpPage({
  catchUp,
  newest,
  onJump,
  onRetry,
}: {
  catchUp: CatchUp;
  newest: boolean;
  onJump: (link: CatchUpLink) => void;
  onRetry: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const empty =
    catchUp.done.length === 0 && catchUp.ongoing.length === 0 && catchUp.waiting.length === 0;
  return (
    <article
      className="catch-up-page"
      data-state={catchUp.state}
      data-testid="catch-up-page"
      aria-label={formatWhen(locale, catchUp.createdAt)}
    >
      {catchUp.state === "pending" ? (
        <div className="catch-up-page__status catch-up-page__status--loading" role="status">
          <span className="catch-up-shimmer">{t("app.chat.catchUp.loading")}</span>
        </div>
      ) : catchUp.state === "failed" ? (
        <div className="catch-up-page__status" role="status">
          <span>{t("app.chat.catchUp.failed")}</span>
          {newest ? (
            <button type="button" className="catch-up-retry" onClick={onRetry}>
              {t("app.chat.catchUp.retry")}
            </button>
          ) : null}
        </div>
      ) : empty ? (
        <div className="catch-up-page__status">{t("app.chat.catchUp.empty")}</div>
      ) : (
        <div className="catch-up-page__body">
          <Section kind="waiting" items={catchUp.waiting} pageAt={catchUp.createdAt} onJump={onJump} />
          <Section kind="ongoing" items={catchUp.ongoing} pageAt={catchUp.createdAt} onJump={onJump} />
          <Section kind="done" items={catchUp.done} pageAt={catchUp.createdAt} onJump={onJump} />
        </div>
      )}
    </article>
  );
}

export const CatchUpPill = memo(function CatchUpPill({
  conversationId,
}: {
  conversationId: string;
}) {
  const t = useT();
  const locale = useLocale();
  const messages = useChatMessages();
  const view = useBackendView("catchUps.list", { conversationId });
  const catchUps = useMemo(() => view.value?.catchUps ?? [], [view.value]);
  const offerInput = useMemo(() => offerMessages(messages), [messages]);
  const [now, setNow] = useState(() => Date.now());
  const offer = useMemo(
    () => catchUpOffer(offerInput, catchUps, now),
    [catchUps, now, offerInput],
  );
  // The pill lingers after a summary lands; take it down when that ends.
  useEffect(() => {
    if (!offer.lingerUntil) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, offer.lingerUntil - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
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
      showToast({
        title: t("app.chat.catchUp.failed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    } finally {
      requestingRef.current = false;
    }
  }, [conversationId, t]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      // Only what no catch-up covers yet is worth a new one.
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

  // Oldest on the left, newest on the right: open on the newest, and follow
  // a new page as it lands or fills in. The pages mount with the popover,
  // after this component's own effects, so their node is tracked as state.
  const newest = catchUps.at(-1);
  const newestKey = newest ? `${newest.catchUpId}:${newest.state}` : "";
  const [pagesNode, setPagesNode] = useState<HTMLDivElement | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pagesHeight, setPagesHeight] = useState<number | null>(null);
  const shownKeyRef = useRef<string | null>(null);
  // The page a button or key is sliding to, until the scroller gets there.
  const targetRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const total = catchUps.length;
  const shown = Math.min(pageIndex, Math.max(0, total - 1));

  const goTo = useCallback(
    (next: number, behavior: ScrollBehavior = "smooth") => {
      if (!pagesNode) return;
      const target = Math.max(0, Math.min(next, pagesNode.children.length - 1));
      // Chromium counts an RTL scroller's offset leftwards, below zero.
      const sign = getComputedStyle(pagesNode).direction === "rtl" ? -1 : 1;
      targetRef.current = behavior === "smooth" ? target : null;
      pagesNode.scrollTo({ left: sign * target * pagesNode.clientWidth, behavior });
      setPageIndex(target);
    },
    [pagesNode],
  );

  useLayoutEffect(() => {
    if (!pagesNode) {
      shownKeyRef.current = null;
      return;
    }
    if (!newestKey || shownKeyRef.current === newestKey) return;
    const opening = shownKeyRef.current === null;
    goTo(total - 1, opening ? "instant" : "smooth");
    shownKeyRef.current = newestKey;
    // Take focus on open so the arrow keys page right away.
    if (opening) rootRef.current?.focus({ preventScroll: true });
  }, [goTo, newestKey, pagesNode, total]);

  // The page in view after a swipe or a trackpad scroll.
  const onPagesScroll = useCallback(() => {
    if (!pagesNode || pagesNode.clientWidth === 0) return;
    const position = Math.abs(pagesNode.scrollLeft) / pagesNode.clientWidth;
    if (targetRef.current !== null) {
      if (Math.abs(position - targetRef.current) > 0.02) return;
      targetRef.current = null;
    }
    setPageIndex(Math.round(position));
  }, [pagesNode]);

  // The popover is as tall as the page in view, up to its cap; a longer page
  // scrolls inside itself.
  useLayoutEffect(() => {
    const page = pagesNode?.children[shown] as HTMLElement | undefined;
    if (!page) return;
    const measure = () => setPagesHeight(page.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [pagesNode, shown, catchUps]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const rtl = pagesNode ? getComputedStyle(pagesNode).direction === "rtl" : false;
      const step =
        event.key === "ArrowLeft" ? (rtl ? 1 : -1) : event.key === "ArrowRight" ? (rtl ? -1 : 1) : 0;
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      goTo((targetRef.current ?? shown) + step);
    },
    [goTo, pagesNode, shown],
  );

  // A new summary appearing (from any device) restarts the linger clock.
  useEffect(() => setNow(Date.now()), [catchUps]);

  if (!offer.offer && !pending && !open && !offer.lingerUntil) return null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="catch-up-pill"
          data-open={open ? "" : undefined}
          aria-label={
            offer.count >= CATCH_UP_MIN_NEW_MESSAGES
              ? t("app.chat.catchUp.pillLabel", { count: offer.count })
              : t("app.chat.catchUp.title")
          }
          data-testid="catch-up-pill"
        >
          <LayoutList size={14} strokeWidth={2} aria-hidden="true" />
          <span className="catch-up-pill__label">{t("app.chat.catchUp.pill")}</span>
          {offer.count >= CATCH_UP_MIN_NEW_MESSAGES ? (
            <span className="catch-up-pill__count">{offer.count}</span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="catch-up-popover"
      >
        <div
          ref={rootRef}
          className="catch-up"
          data-testid="catch-up-popover"
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          <div className="catch-up__bar">
            <span className="catch-up__when">
              {catchUps[shown] ? formatWhen(locale, catchUps[shown].createdAt) : t("app.chat.catchUp.title")}
            </span>
            {total > 1 ? (
              <div className="catch-up__pager">
                <button
                  type="button"
                  className="catch-up__nav"
                  aria-label={t("common.previous")}
                  disabled={shown === 0}
                  onClick={() => goTo(shown - 1)}
                  data-testid="catch-up-previous"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span className="catch-up__progress">
                  {t("userAsk.question.progress", { current: shown + 1, total })}
                </span>
                <button
                  type="button"
                  className="catch-up__nav"
                  aria-label={t("common.next")}
                  disabled={shown === total - 1}
                  onClick={() => goTo(shown + 1)}
                  data-testid="catch-up-next"
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
          <div
            className="catch-up__pages"
            ref={setPagesNode}
            onScroll={onPagesScroll}
            style={pagesHeight === null ? undefined : { height: pagesHeight }}
            data-testid="catch-up-pages"
          >
            {catchUps.map((catchUp, index) => (
              <CatchUpPage
                key={catchUp.catchUpId}
                catchUp={catchUp}
                newest={index === total - 1}
                onJump={onJump}
                onRetry={() => void request()}
              />
            ))}
          </div>
        </div>
      </Popover.Content>
    </Popover>
  );
});
