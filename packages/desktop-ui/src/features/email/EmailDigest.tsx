import { useEffect, useRef, useState, type FormEvent } from "react";
import type { EmailBucket, EmailDigest, EmailFocusAction, EmailItem } from "@stella/contracts/backend/email";
import { useNow } from "@/features/app-source/AppSourceCards";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useI18n } from "@/shared/i18n";
import { STELLA_SEND_MESSAGE_EVENT } from "@/shared/lib/stella-send-message";
import { ChevronDown, MoreHorizontal } from "@/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { correctEmail, dismissEmail, emailTime, openGmailThread, senderName } from "./email-items";
import { selectEmailDigest, useSelectedEmailDigest } from "./email-digest-store";
import "./email-digest.css";

const needsYou = (item: EmailItem) => item.bucket === "urgent" || item.bucket === "needs_you";

/**
 * Hands one email to Stella as a plain chat message. A hidden note written
 * just before it names the exact email, so Stella acts on the right one and
 * the answer comes back in the chat like any other.
 */
const askStella = async (item: EmailItem, action: EmailFocusAction, text: string): Promise<void> => {
  await backendClient.call("email.focus", { itemId: item.itemId, action }).catch(() => undefined);
  window.dispatchEvent(new CustomEvent(STELLA_SEND_MESSAGE_EVENT, { detail: { text } }));
};

function DigestItem({ item, showAccount, now }: { item: EmailItem; showAccount: boolean; now: number }) {
  const { t, locale } = useI18n();
  const [archived, setArchived] = useState<boolean | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isArchived = archived ?? Boolean(item.archived);
  const dismissed = item.state === "dismissed";
  const from = senderName(item.from);
  const subject = item.subject;

  const run = (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNotice(null);
    void work()
      .then(() => {
        if (done) setNotice(done);
      })
      .catch((error: unknown) =>
        setNotice(error instanceof Error && error.message ? error.message : t("email.failed")),
      )
      .finally(() => setBusy(false));
  };

  const ask = (action: EmailFocusAction, text: string) =>
    run(async () => {
      await askStella(item, action, text);
      setComposing(false);
      setDraft("");
    }, t("email.digest.sent"));

  const archive = (next: boolean) =>
    run(async () => {
      await backendClient.call("email.archive", { itemId: item.itemId, archived: next });
      setArchived(next);
    });

  const tell = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    ask("tell", t("email.digest.askTell", { from, subject, text }));
  };

  const moveTo: EmailBucket = item.bucket === "worth_knowing" ? "needs_you" : "worth_knowing";

  return (
    <li
      className="email-digest__item"
      data-quiet={isArchived || dismissed || undefined}
      data-busy={busy || undefined}
      data-testid="email-digest-item"
    >
      <div className="email-digest__head">
        <span className="email-digest__from" title={item.from}>
          {from}
        </span>
        {item.bucket === "urgent" ? <span className="email-digest__urgent">{t("email.section.urgent")}</span> : null}
        <span className="email-digest__time">{emailTime(locale, item.receivedAt, now)}</span>
      </div>
      <p className="email-digest__subject">{showAccount ? `${subject} · ${item.account}` : subject}</p>
      {item.line ? <p className="email-digest__line">{item.line}</p> : null}
      {dismissed ? (
        <p className="email-digest__notice">{t("email.card.wontShow")}</p>
      ) : (
        <div className="email-digest__actions">
          <button
            type="button"
            className="email-digest__action"
            disabled={busy}
            onClick={() => ask("reply", t("email.digest.askReply", { from, subject }))}
          >
            {t("email.digest.reply")}
          </button>
          <button
            type="button"
            className="email-digest__action"
            disabled={busy}
            onClick={() => ask("handle", t("email.digest.askHandle", { from, subject }))}
          >
            {t("email.digest.handle")}
          </button>
          <button
            type="button"
            className="email-digest__action"
            disabled={busy}
            onClick={() => archive(!isArchived)}
          >
            {isArchived ? t("email.digest.unarchive") : t("email.digest.archive")}
          </button>
          <button
            type="button"
            className="email-digest__action"
            onClick={() => openGmailThread(item.threadId, item.account)}
          >
            {t("email.digest.open")}
          </button>
          <button
            type="button"
            className="email-digest__action"
            aria-expanded={composing}
            disabled={busy}
            onClick={() => setComposing((open) => !open)}
          >
            {t("email.digest.tell")}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="email-digest__action email-digest__action--icon"
                aria-label={t("email.section.actions")}
                disabled={busy}
              >
                <MoreHorizontal size={15} strokeWidth={1.9} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => run(() => correctEmail(item.itemId, moveTo))}>
                {moveTo === "needs_you" ? t("email.section.moveToNeedsYou") : t("email.section.moveToWorthKnowing")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(() => dismissEmail(item.itemId))}>
                {t("email.notImportant")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {composing ? (
        <form className="email-digest__tell" onSubmit={tell}>
          <textarea
            className="email-digest__tell-input"
            value={draft}
            rows={2}
            autoFocus
            placeholder={t("email.digest.tellPlaceholder")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                tell(event);
              }
              if (event.key === "Escape") setComposing(false);
            }}
          />
          <button type="submit" className="pill-btn pill-btn--primary" disabled={busy || !draft.trim()}>
            {t("email.digest.send")}
          </button>
        </form>
      ) : null}
      {notice ? (
        <p className="email-digest__notice" role="status">
          {notice}
        </p>
      ) : null}
    </li>
  );
}

function Skipped({ items, now }: { items: EmailItem[]; now: number }) {
  const { t, tPlural, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [mattered, setMattered] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  if (items.length === 0) return null;
  const matter = (item: EmailItem) => {
    setFailed(false);
    void correctEmail(item.itemId, "needs_you")
      .then(() => setMattered((current) => new Set([...current, item.itemId])))
      .catch(() => setFailed(true));
  };
  return (
    <section className="email-digest__skipped">
      <button
        type="button"
        className="email-digest__disclosure"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{tPlural("email.digest.skipped", items.length)}</span>
        <ChevronDown size={14} strokeWidth={1.9} aria-hidden="true" />
      </button>
      {open ? (
        <>
          <p className="email-digest__hint">{t("email.digest.skippedHint")}</p>
          <ul className="email-digest__skipped-list">
            {items.map((item) => {
              const done = mattered.has(item.itemId) || (item.corrected && item.bucket !== "noise");
              return (
                <li key={item.itemId} className="email-digest__skipped-row" data-testid="email-skipped-item">
                  <span className="email-digest__skipped-text">
                    <span className="email-digest__skipped-from">{senderName(item.from)}</span>
                    <span className="email-digest__skipped-subject">{item.subject}</span>
                  </span>
                  <span className="email-digest__time">{emailTime(locale, item.receivedAt, now)}</span>
                  {done ? (
                    <span className="email-digest__matter-done">{t("email.digest.matteredDone")}</span>
                  ) : (
                    <button type="button" className="email-digest__matter" onClick={() => matter(item)}>
                      {t("email.digest.mattered")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {failed ? <p className="email-digest__notice">{t("email.failed")}</p> : null}
        </>
      ) : null}
    </section>
  );
}

const counts = (
  digest: EmailDigest,
  tPlural: (key: string, count: number) => string,
  t: (key: string) => string,
): string => {
  if (digest.kind === "urgent") return t("email.section.urgent");
  if (digest.kind === "rule") return t("email.digest.ruleTitle");
  const need = digest.items.filter(needsYou).length;
  const worth = digest.items.length - need;
  return [
    need > 0 ? tPlural("email.card.needYou", need) : null,
    worth > 0 ? tPlural("email.card.worthKnowing", worth) : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

function Digest({ digest, showAccount, now }: { digest: EmailDigest; showAccount: boolean; now: number }) {
  const { t, tPlural, locale } = useI18n();
  const urgentOrNeeds = digest.items.filter(needsYou);
  const worth = digest.items.filter((item) => !needsYou(item));
  const meta = [
    emailTime(locale, digest.createdAt, now),
    digest.sinceAt ? t("email.digest.since", { time: emailTime(locale, digest.sinceAt, now) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="email-digest__doc" data-testid="email-digest">
      <header className="email-digest__header">
        <h1 className="email-digest__title">{counts(digest, tPlural, t)}</h1>
        <p className="email-digest__meta">{meta}</p>
        {digest.ruleText ? <p className="email-digest__rule">“{digest.ruleText}”</p> : null}
      </header>
      {urgentOrNeeds.length > 0 ? (
        <section className="email-digest__group">
          {digest.kind === "summary" ? <h2 className="email-digest__heading">{t("email.section.needsYou")}</h2> : null}
          <ul className="email-digest__list">
            {urgentOrNeeds.map((item) => (
              <DigestItem key={item.itemId} item={item} showAccount={showAccount} now={now} />
            ))}
          </ul>
        </section>
      ) : null}
      {worth.length > 0 ? (
        <section className="email-digest__group">
          {digest.kind === "summary" ? <h2 className="email-digest__heading">{t("email.section.worthKnowing")}</h2> : null}
          <ul className="email-digest__list">
            {worth.map((item) => (
              <DigestItem key={item.itemId} item={item} showAccount={showAccount} now={now} />
            ))}
          </ul>
        </section>
      ) : null}
      <Skipped key={digest.digestId} items={digest.skipped} now={now} />
    </article>
  );
}

function Earlier({ digests, now }: { digests: EmailDigest[]; now: number }) {
  const { t, tPlural, locale } = useI18n();
  if (digests.length === 0) return null;
  return (
    <section className="email-digest__group">
      <h2 className="email-digest__heading">{t("email.digest.earlier")}</h2>
      <ul className="email-digest__earlier">
        {digests.map((digest) => (
          <li key={digest.digestId}>
            <button
              type="button"
              className="email-digest__earlier-row"
              onClick={() => selectEmailDigest(digest.digestId)}
            >
              <span className="email-digest__earlier-time">{emailTime(locale, digest.createdAt, now)}</span>
              <span className="email-digest__earlier-counts">{counts(digest, tPlural, t)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Email tab's first screen: the digest the chat row stood for (the newest
 * by default), written as a short document with light actions on each email,
 * what was skipped, and every earlier digest of the week.
 */
export function EmailDigestPanel({
  enabled,
  waiting,
  showAccount,
}: {
  enabled: boolean;
  /** Mail sorted since the newest digest, not in one yet. */
  waiting: EmailItem[];
  showAccount: boolean;
}) {
  const { t } = useI18n();
  const now = useNow();
  const view = useBackendView("email.digests", enabled ? {} : "skip");
  const { digestId, openedAt } = useSelectedEmailDigest();
  const topRef = useRef<HTMLDivElement>(null);
  const digests = view.value?.digests ?? [];
  const shown = digests.find((digest) => digest.digestId === digestId) ?? digests[0] ?? null;
  const newest = shown !== null && shown === digests[0];

  useEffect(() => {
    if (openedAt) topRef.current?.scrollIntoView({ block: "start" });
  }, [openedAt]);

  if (!view.value) return <div ref={topRef} aria-busy={view.status !== "error"} />;
  const accounts = showAccount || view.value.multipleAccounts;
  return (
    <div ref={topRef} className="email-digest">
      {shown ? (
        <Digest key={shown.digestId} digest={shown} showAccount={accounts} now={now} />
      ) : (
        <p className="email-digest__empty">{t("email.digest.empty")}</p>
      )}
      {(newest || !shown) && waiting.length > 0 ? (
        <section className="email-digest__group">
          <h2 className="email-digest__heading">{t("email.digest.waiting")}</h2>
          <ul className="email-digest__list">
            {waiting.map((item) => (
              <DigestItem key={item.itemId} item={item} showAccount={accounts} now={now} />
            ))}
          </ul>
        </section>
      ) : null}
      <Earlier digests={digests.filter((digest) => digest !== shown)} now={now} />
    </div>
  );
}
