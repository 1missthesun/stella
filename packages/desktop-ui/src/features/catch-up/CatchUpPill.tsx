/**
 * "Summary" (catch-ups inside): the pill above the composer once a busy stretch has gone by
 * (`catchUpOffer`, shared with mobile), and the popover it opens. Opening it
 * asks the cloud for a summary of what is new (`catchUps.request`); every
 * summary so far stays in the popover as its own page, newest at the bottom,
 * scrolled through one page at a time. A line's links jump to the messages
 * it came from.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CatchUp, CatchUpItem, CatchUpLink } from "@stella/contracts/backend/catch-ups";
import { catchUpOffer } from "@stella/contracts/catch-up";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { isUiHiddenChatMessagePayload } from "@stella/contracts/chat-event-visibility";
import { useChatMessages } from "@/context/use-chat-messages";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useLocale, useT } from "@/shared/i18n";
import { Check, CircleDot, CircleQuestionMark, LayoutList, X } from "@/ui/icons";
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

const formatTime = (locale: string, at: number): string =>
  new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(at);

function LinkChip({
  link,
  onJump,
}: {
  link: CatchUpLink;
  onJump: (link: CatchUpLink) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const who = link.role === "user" ? t("app.chat.catchUp.you") : t("app.chat.catchUp.stella");
  return (
    <button
      type="button"
      className="catch-up-link"
      data-role={link.role}
      onClick={() => onJump(link)}
      data-testid="catch-up-link"
    >
      {who} · {formatTime(locale, link.at)}
    </button>
  );
}

function Section({
  kind,
  items,
  onJump,
}: {
  kind: "done" | "ongoing" | "waiting";
  items: CatchUpItem[];
  onJump: (link: CatchUpLink) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;
  const Icon = kind === "done" ? Check : kind === "ongoing" ? CircleDot : CircleQuestionMark;
  return (
    <section className="catch-up-section" data-kind={kind}>
      <h3 className="catch-up-section__title">
        <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
        {t(`app.chat.catchUp.${kind}`)}
      </h3>
      <ul className="catch-up-section__items">
        {items.map((item, index) => (
          <li key={index} className="catch-up-item">
            <span className="catch-up-item__text">{item.text}</span>
            {item.links.length > 0 ? (
              <span className="catch-up-item__links">
                {item.links.map((link) => (
                  <LinkChip key={link.seq} link={link} onJump={onJump} />
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CatchUpPage({
  catchUp,
  index,
  total,
  onJump,
  onRetry,
}: {
  catchUp: CatchUp;
  index: number;
  total: number;
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
      <header className="catch-up-page__head">
        <span className="catch-up-page__when">{formatWhen(locale, catchUp.createdAt)}</span>
        {total > 1 ? (
          <span className="catch-up-page__count">
            {index + 1}/{total}
          </span>
        ) : null}
      </header>
      {catchUp.state === "pending" ? (
        <div className="catch-up-page__status catch-up-page__status--loading" role="status">
          <span className="catch-up-shimmer">{t("app.chat.catchUp.loading")}</span>
        </div>
      ) : catchUp.state === "failed" ? (
        <div className="catch-up-page__status" role="status">
          <span>{t("app.chat.catchUp.failed")}</span>
          {index === total - 1 ? (
            <button type="button" className="catch-up-retry" onClick={onRetry}>
              {t("app.chat.catchUp.retry")}
            </button>
          ) : null}
        </div>
      ) : empty ? (
        <div className="catch-up-page__status">{t("app.chat.catchUp.empty")}</div>
      ) : (
        <div className="catch-up-page__body">
          <Section kind="waiting" items={catchUp.waiting} onJump={onJump} />
          <Section kind="ongoing" items={catchUp.ongoing} onJump={onJump} />
          <Section kind="done" items={catchUp.done} onJump={onJump} />
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
  const messages = useChatMessages();
  const view = useBackendView("catchUps.list", { conversationId });
  const catchUps = useMemo(() => view.value?.catchUps ?? [], [view.value]);
  const offerInput = useMemo(() => offerMessages(messages), [messages]);
  const offer = useMemo(() => catchUpOffer(offerInput, catchUps), [catchUps, offerInput]);
  const pending = catchUps.some((catchUp) => catchUp.state === "pending");
  const [open, setOpen] = useState(false);
  const requestingRef = useRef(false);
  const pagesRef = useRef<HTMLDivElement | null>(null);

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
      if (next && offer.count > 0 && !pending) void request();
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

  // Newest at the bottom: open there, and follow a new page as it lands.
  const newestId = catchUps.at(-1)?.catchUpId;
  useLayoutEffect(() => {
    const node = pagesRef.current;
    if (!open || !node) return;
    node.scrollTop = node.scrollHeight;
  }, [open, newestId]);

  // A summary that just filled in keeps its page in view.
  const newestState = catchUps.at(-1)?.state;
  useEffect(() => {
    const node = pagesRef.current;
    if (!open || !node || newestState !== "ready") return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [newestState, open]);

  if (!offer.offer && !pending && !open) return null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="catch-up-pill"
          data-open={open ? "" : undefined}
          aria-label={t("app.chat.catchUp.pillLabel", { count: offer.count })}
          data-testid="catch-up-pill"
        >
          <LayoutList size={14} strokeWidth={2} aria-hidden="true" />
          <span className="catch-up-pill__label">{t("app.chat.catchUp.pill")}</span>
          {offer.count > 0 ? <span className="catch-up-pill__count">{offer.count}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="catch-up-popover"
      >
        <div className="catch-up" data-testid="catch-up-popover">
          <div className="catch-up__bar">
            <span className="catch-up__title">{t("app.chat.catchUp.title")}</span>
            <button
              type="button"
              className="catch-up__close"
              onClick={() => setOpen(false)}
              aria-label={t("app.chat.catchUp.close")}
              title={t("app.chat.catchUp.close")}
            >
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div className="catch-up__pages" ref={pagesRef} data-testid="catch-up-pages">
            {catchUps.map((catchUp, index) => (
              <CatchUpPage
                key={catchUp.catchUpId}
                catchUp={catchUp}
                index={index}
                total={catchUps.length}
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
