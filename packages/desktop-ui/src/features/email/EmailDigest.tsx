import {
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  EmailBrief,
  EmailBriefBlock,
  EmailBriefTone,
  EmailDigest,
  EmailFocusAction,
  EmailFound,
  EmailItem,
  EmailSearchResult,
  EmailTargets,
  EmailThread,
} from "@stella/contracts/backend/email";
import { useNow } from "@/features/app-source/AppSourceCards";
import { ChatRuntimeContext } from "@/context/chat-runtime-context";
import { getComposerAppSelections } from "@/features/chat/composer-context";
import {
  EMAIL_CHIP_REMOVED_EVENT,
  EMAIL_SELECTION_SURFACE as EMAIL_SURFACE,
} from "@/features/workspace-display/file-viewer-store";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useI18n } from "@/shared/i18n";
import { STELLA_SEND_MESSAGE_EVENT } from "@/shared/lib/stella-send-message";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, MoreHorizontal, Paperclip, Search, Settings, X } from "@/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import {
  blockSnapshot,
  briefOf,
  briefingSnapshot,
  foundSnapshot,
  plainText,
  senderOf,
  threadSnapshot,
} from "./email-brief";
import { correctEmail, dismissEmail, emailTime, openGmailThread } from "./email-items";
import { selectEmailDigest, useSelectedEmailDigest } from "./email-digest-store";
import "./email-digest.css";

/**
 * Hands emails to Stella as a plain chat message. A hidden note written just
 * before it names the exact emails, so Stella acts on the right ones and the
 * answer comes back in the chat like any other.
 */
const askStella = async (targets: EmailTargets, action: EmailFocusAction, text: string): Promise<void> => {
  await backendClient.call("email.focus", { ...targets, action }).catch(() => undefined);
  window.dispatchEvent(new CustomEvent(STELLA_SEND_MESSAGE_EVENT, { detail: { text } }));
};

/** The briefing's light markdown: bold and nothing else, rendered inline. */
function Md({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/gu);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

// Composer context -------------------------------------------------------------

/** Email views on screen now; with none, an email chip left in the composer is stale. */
let emailChipOwners = 0;

/**
 * Always mounted: drops an email chip the composer restored (or kept) while no
 * Email view is on screen, such as after a reload on the Chat tab.
 */
export function useStaleEmailChipCleanup(): void {
  const chat = useContext(ChatRuntimeContext);
  const setChatContext = chat?.composer.setChatContext;
  const stale =
    emailChipOwners === 0 &&
    getComposerAppSelections(chat?.composer.chatContext ?? null).some((entry) => entry.surface === EMAIL_SURFACE);
  useEffect(() => {
    if (!stale || !setChatContext) return;
    const timer = window.setTimeout(() => {
      if (emailChipOwners > 0) return;
      setChatContext((prev) => {
        const others = getComposerAppSelections(prev).filter((entry) => entry.surface !== EMAIL_SURFACE);
        return { ...(prev ?? { window: null }), appSelection: others[others.length - 1] ?? null, appSelections: others };
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [stale, setChatContext]);
}

type Chip = { key: string; label: string; snapshot: string };

/**
 * While Email is open, what's on screen (the briefing, or the point, email or
 * thread picked) rides along with the next message as a removable chip, so
 * "tell them Thursday works" needs no more words. Once removed, it stays off
 * until something else is picked.
 */
function useEmailChip(active: boolean, chip: Chip | null, pickedAt: number) {
  const chat = useContext(ChatRuntimeContext);
  useEffect(() => {
    if (!active) return;
    emailChipOwners += 1;
    return () => {
      emailChipOwners -= 1;
    };
  }, [active]);
  const setChatContext = chat?.composer.setChatContext;
  const removed = useRef<string | null>(null);
  const key = chip?.key ?? null;

  useEffect(() => {
    removed.current = null;
  }, [pickedAt]);

  // Only the chip's own ✕ turns it off; a send that clears the composer brings it back.
  useEffect(() => {
    const onRemoved = (event: Event) => {
      const path = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (path) removed.current = path;
    };
    window.addEventListener(EMAIL_CHIP_REMOVED_EVENT, onRemoved);
    return () => window.removeEventListener(EMAIL_CHIP_REMOVED_EVENT, onRemoved);
  }, []);

  const present =
    getComposerAppSelections(chat?.composer.chatContext ?? null).find((entry) => entry.surface === EMAIL_SURFACE)?.anchor
      ?.path ?? null;

  useEffect(() => {
    if (!setChatContext) return;
    const want = active && chip && removed.current !== chip.key ? chip : null;
    setChatContext((prev) => {
      const all = getComposerAppSelections(prev);
      const others = all.filter((entry) => entry.surface !== EMAIL_SURFACE);
      const current = all.find((entry) => entry.surface === EMAIL_SURFACE);
      if (!want) {
        if (!current) return prev;
        return { ...(prev ?? { window: null }), appSelection: others[others.length - 1] ?? null, appSelections: others };
      }
      if (current?.anchor?.path === want.key && current.snapshot === want.snapshot && current.label === want.label) return prev;
      const selection = {
        label: want.label,
        snapshot: want.snapshot,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        surface: EMAIL_SURFACE,
        anchor: { kind: EMAIL_SURFACE, path: want.key },
      };
      return { ...(prev ?? { window: null }), appSelection: selection, appSelections: [...others, selection] };
    });
    // `present` too: a restored or just-sent composer drops the chip, and it comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, chip?.label, chip?.snapshot, setChatContext, pickedAt, present]);

  useEffect(
    () => () =>
      setChatContext?.((prev) => {
        const all = getComposerAppSelections(prev);
        if (!all.some((entry) => entry.surface === EMAIL_SURFACE)) return prev;
        const others = all.filter((entry) => entry.surface !== EMAIL_SURFACE);
        return { ...(prev ?? { window: null }), appSelection: others[others.length - 1] ?? null, appSelections: others };
      }),
    [setChatContext],
  );

  return () => chat?.composer.requestFocus?.();
}

// One point ------------------------------------------------------------------

type BlockActions = {
  suggestion?: { label: string; ask: string };
  runSuggestion?: (text: string) => Promise<void>;
  reply: () => Promise<void>;
  handle: () => Promise<void>;
  read: () => void;
  archive?: (archived: boolean) => Promise<void>;
  archived?: boolean;
  tell: () => void;
  notImportant?: () => Promise<unknown>;
  move?: { label: string; run: () => Promise<unknown> };
  gmail: () => void;
};

function Block({
  tone,
  title,
  points,
  foot,
  selected,
  quiet,
  actions,
  onSelect,
  testId,
}: {
  tone: EmailBriefTone;
  title: string;
  points: string[];
  foot: string;
  selected: boolean;
  quiet?: boolean;
  actions: BlockActions;
  onSelect: () => void;
  testId: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [archived, setArchived] = useState<boolean | null>(null);
  const isArchived = archived ?? Boolean(actions.archived);

  const run = (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNotice(null);
    void work()
      .then(() => {
        if (done) setNotice(done);
      })
      .catch((error: unknown) => setNotice(error instanceof Error && error.message ? error.message : t("email.failed")))
      .finally(() => setBusy(false));
  };

  const suggestion = actions.suggestion;
  const sent = t("email.digest.sent");
  return (
    <li
      className="email-brief__block"
      data-tone={tone}
      data-selected={selected || undefined}
      data-quiet={quiet || isArchived || undefined}
      data-busy={busy || undefined}
      data-testid={testId}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, [role='menu']")) return;
        onSelect();
      }}
    >
      <div className="email-brief__block-main">
        <p className="email-brief__block-title">
          <Md text={title} />
        </p>
        {points.length > 0 ? (
          <ul className="email-brief__points">
            {points.map((point, index) => (
              <li key={index}>
                <Md text={point} />
              </li>
            ))}
          </ul>
        ) : null}
        <p className="email-brief__foot">{foot}</p>
        {notice ? (
          <p className="email-brief__notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {suggestion ? (
            <button type="button" className="email-brief__control email-brief__control--primary" disabled={busy} data-testid="email-block-control">
              <span>{suggestion.label}</span>
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="email-brief__control"
              disabled={busy}
              aria-label={t("email.brief.more")}
              data-testid="email-block-control"
            >
              <MoreHorizontal size={16} strokeWidth={1.9} />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="email-brief__menu">
          {suggestion ? (
            <>
              <DropdownMenuItem
                className="email-brief__menu-suggestion"
                onSelect={() => run(() => actions.runSuggestion?.(suggestion.ask) ?? Promise.resolve(), sent)}
              >
                <span className="email-brief__menu-ask">{suggestion.ask}</span>
                <span className="email-brief__menu-hint">{t("email.brief.suggestHint")}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onSelect={() => run(actions.reply, sent)}>{t("email.digest.reply")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(actions.handle, sent)}>{t("email.digest.handle")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={actions.tell}>{t("email.digest.tell")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={actions.read}>{t("email.brief.read")}</DropdownMenuItem>
          {actions.archive ? (
            <DropdownMenuItem
              onSelect={() =>
                run(async () => {
                  await actions.archive!(!isArchived);
                  setArchived(!isArchived);
                })
              }
            >
              {isArchived ? t("email.digest.unarchive") : t("email.digest.archive")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={actions.gmail}>{t("email.brief.openGmail")}</DropdownMenuItem>
          {actions.move || actions.notImportant ? <DropdownMenuSeparator /> : null}
          {actions.move ? (
            <DropdownMenuItem onSelect={() => run(actions.move!.run, t("email.brief.noted"))}>{actions.move.label}</DropdownMenuItem>
          ) : null}
          {actions.notImportant ? (
            <DropdownMenuItem onSelect={() => run(actions.notImportant!, t("email.card.wontShow"))}>
              {t("email.notImportant")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

// The briefing ---------------------------------------------------------------

type Picked = { kind: "block"; key: string } | null;

function Briefing({
  digest,
  waiting,
  showAccount,
  now,
  picked,
  onPick,
  onRead,
  onTell,
}: {
  digest: EmailDigest;
  waiting: EmailItem[];
  showAccount: boolean;
  now: number;
  picked: Picked;
  onPick: (key: string | null) => void;
  onRead: (item: EmailItem) => void;
  onTell: (key: string) => void;
}) {
  const { t, tPlural, locale } = useI18n();
  const brief = useBrief(digest);
  const byId = useMemo(() => new Map([...digest.items, ...waiting].map((item) => [item.itemId, item])), [digest.items, waiting]);
  const waitingBlocks: EmailBriefBlock[] = waiting.map((item) => ({
    itemIds: [item.itemId],
    title: `**${senderOf(item.from)}** · ${item.subject}`,
    points: item.line ? [item.line] : [],
  }));

  const actionsFor = (block: EmailBriefBlock, items: EmailItem[]): BlockActions => {
    const newest = [...items].sort((a, b) => b.receivedAt - a.receivedAt)[0]!;
    const ids = { itemIds: items.map((item) => item.itemId) };
    const from = senderOf(newest.from);
    const sorted = items.every((item) => item.bucket === "worth_knowing") ? "worth_knowing" : "needs_you";
    return {
      ...(block.suggestion ? { suggestion: block.suggestion } : {}),
      runSuggestion: (text) => askStella(ids, "suggest", text),
      reply: () => askStella(ids, "reply", t("email.digest.askReply", { from, subject: newest.subject })),
      handle: () => askStella(ids, "handle", t("email.digest.askHandle", { from, subject: newest.subject })),
      read: () => onRead(newest),
      archive: async (archived) => {
        await backendClient.call("email.archive", { ...ids, archived });
      },
      archived: items.every((item) => item.archived),
      tell: () => onTell(blockKey(block)),
      gmail: () => openGmailThread(newest.threadId, newest.account),
      move: {
        label: sorted === "needs_you" ? t("email.section.moveToWorthKnowing") : t("email.section.moveToNeedsYou"),
        run: () => Promise.all(items.map((item) => correctEmail(item.itemId, sorted === "needs_you" ? "worth_knowing" : "needs_you"))),
      },
      notImportant: () => Promise.all(items.map((item) => dismissEmail(item.itemId))),
    };
  };

  const renderBlock = (block: EmailBriefBlock, tone: EmailBriefTone) => {
    const items = block.itemIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    if (items.length === 0) return null;
    const newest = Math.max(...items.map((item) => item.receivedAt));
    const key = blockKey(block);
    const foot = [
      items.length > 1 ? tPlural("email.brief.emails", items.length) : null,
      emailTime(locale, newest, now),
      showAccount ? items[0]!.account : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <Block
        key={key}
        tone={tone}
        title={block.title}
        points={block.points}
        foot={foot}
        selected={picked?.key === key}
        quiet={items.every((item) => item.state === "dismissed")}
        actions={actionsFor(block, items)}
        onSelect={() => onPick(picked?.key === key ? null : key)}
        testId="email-brief-block"
      />
    );
  };

  return (
    <article className="email-brief__doc" data-testid="email-digest">
      <p className="email-brief__lead">
        <Md text={brief.lead} />
      </p>
      {digest.ruleText ? <p className="email-brief__rule">“{digest.ruleText}”</p> : null}
      {brief.sections.map((section, index) => (
        <section key={`${section.heading}-${index}`} className="email-brief__section" data-tone={section.tone}>
          <h2 className="email-brief__heading">{section.heading}</h2>
          <ul className="email-brief__blocks">{section.blocks.map((block) => renderBlock(block, section.tone))}</ul>
        </section>
      ))}
      {waitingBlocks.length > 0 ? (
        <section className="email-brief__section" data-tone="fyi">
          <h2 className="email-brief__heading">{t("email.brief.waiting")}</h2>
          <ul className="email-brief__blocks">{waitingBlocks.map((block) => renderBlock(block, "fyi"))}</ul>
        </section>
      ) : null}
      <Skipped key={digest.digestId} items={digest.skipped} line={brief.skipped} now={now} />
    </article>
  );
}

const blockKey = (block: EmailBriefBlock): string => block.itemIds.join("+");

function useBrief(digest: EmailDigest): EmailBrief {
  const { t, tPlural } = useI18n();
  const need = digest.items.filter((item) => item.bucket === "urgent" || item.bucket === "needs_you").length;
  const worth = digest.items.length - need;
  const lead = [need > 0 ? tPlural("email.card.needYou", need) : null, worth > 0 ? tPlural("email.card.worthKnowing", worth) : null]
    .filter(Boolean)
    .join(" · ");
  return briefOf(digest, {
    needsYou: t("email.section.needsYou"),
    worthKnowing: t("email.section.worthKnowing"),
    urgent: t("email.section.urgent"),
    lead,
  });
}

function Skipped({ items, line, now }: { items: EmailItem[]; line?: string; now: number }) {
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
    <section className="email-brief__skipped">
      <button type="button" className="email-brief__skipped-line" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="email-brief__skipped-text">
          <strong>{tPlural("email.digest.skipped", items.length)}</strong>
          {line ? <span>{line.replace(/^\s*\d+\s*(emails?)?\s*[:·-]?\s*/iu, "")}</span> : null}
        </span>
        <span className="email-brief__skipped-toggle">{open ? t("email.brief.hide") : t("email.brief.show")}</span>
      </button>
      {open ? (
        <>
          <p className="email-brief__hint">{t("email.digest.skippedHint")}</p>
          <ul className="email-brief__skipped-list">
            {items.map((item) => {
              const done = mattered.has(item.itemId) || (item.corrected && item.bucket !== "noise");
              return (
                <li key={item.itemId} className="email-brief__skipped-row" data-testid="email-skipped-item">
                  <span className="email-brief__skipped-mail">
                    <span className="email-brief__skipped-from">{senderOf(item.from)}</span>
                    <span className="email-brief__skipped-subject">{item.subject}</span>
                  </span>
                  <span className="email-brief__time">{emailTime(locale, item.receivedAt, now)}</span>
                  {done ? (
                    <span className="email-brief__matter-done">{t("email.digest.matteredDone")}</span>
                  ) : (
                    <button type="button" className="email-brief__matter" onClick={() => matter(item)}>
                      {t("email.digest.mattered")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {failed ? <p className="email-brief__notice">{t("email.failed")}</p> : null}
        </>
      ) : null}
    </section>
  );
}

// Search -------------------------------------------------------------------------

function SearchResults({
  query,
  state,
  now,
  picked,
  onPick,
  onRead,
  onTell,
  onClose,
}: {
  query: string;
  state: { status: "loading" } | { status: "error"; message: string } | { status: "done"; result: EmailSearchResult };
  now: number;
  picked: string | null;
  onPick: (mail: EmailFound | null) => void;
  onRead: (mail: EmailFound) => void;
  onTell: (mail: EmailFound) => void;
  onClose: () => void;
}) {
  const { t, tPlural, locale } = useI18n();
  return (
    <article className="email-brief__doc" data-testid="email-search-results">
      <button type="button" className="email-brief__back" onClick={onClose}>
        <ArrowLeft size={15} strokeWidth={1.9} aria-hidden="true" />
        {t("email.brief.backToBrief")}
      </button>
      {state.status === "loading" ? <p className="email-brief__lead email-brief__lead--quiet">{t("email.brief.searching")}</p> : null}
      {state.status === "error" ? <p className="email-brief__notice">{state.message}</p> : null}
      {state.status === "done" ? (
        <>
          <p className="email-brief__lead">
            {state.result.results.length > 0 ? tPlural("email.brief.found", state.result.results.length) : t("email.brief.nothingFound")}
          </p>
          <p className="email-brief__rule">{t("email.brief.searched", { query: state.result.gmailQuery || query })}</p>
          <ul className="email-brief__blocks">
            {state.result.results.map((mail) => {
              const key = `${mail.account}:${mail.messageId}`;
              const found = { found: [mail] };
              return (
                <Block
                  key={key}
                  tone="fyi"
                  title={`**${mail.from}** · ${mail.subject}`}
                  points={mail.snippet ? [mail.snippet] : []}
                  foot={[emailTime(locale, mail.receivedAt, now), mail.account].join(" · ")}
                  selected={picked === key}
                  actions={{
                    reply: () => askStella(found, "reply", t("email.digest.askReply", { from: mail.from, subject: mail.subject })),
                    handle: () => askStella(found, "handle", t("email.digest.askHandle", { from: mail.from, subject: mail.subject })),
                    read: () => onRead(mail),
                    archive: async (archived) => {
                      await backendClient.call("email.archive", { ...found, archived });
                    },
                    archived: !mail.inInbox,
                    tell: () => onTell(mail),
                    gmail: () => openGmailThread(mail.threadId, mail.account),
                  }}
                  onSelect={() => onPick(picked === key ? null : mail)}
                  testId="email-search-result"
                />
              );
            })}
          </ul>
        </>
      ) : null}
    </article>
  );
}

// Reading in place --------------------------------------------------------------

type ReadTarget = { itemId: string } | { account: string; threadId: string };

function Reader({
  target,
  now,
  onLoaded,
  onClose,
}: {
  target: ReadTarget;
  now: number;
  onLoaded: (thread: EmailThread) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "done"; thread: EmailThread }>({
    status: "loading",
  });
  const key = "itemId" in target ? target.itemId : `${target.account}:${target.threadId}`;
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    void backendClient
      .call("email.thread", target)
      .then((thread) => {
        if (!live) return;
        setState({ status: "done", thread });
        onLoaded(thread);
      })
      .catch((error: unknown) => {
        if (live) setState({ status: "error", message: error instanceof Error && error.message ? error.message : t("email.failed") });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <article className="email-brief__doc email-reader" data-testid="email-reader">
      <div className="email-reader__bar">
        <button type="button" className="email-brief__back" onClick={onClose}>
          <ArrowLeft size={15} strokeWidth={1.9} aria-hidden="true" />
          {t("email.brief.back")}
        </button>
        {state.status === "done" ? (
          <button
            type="button"
            className="email-brief__back"
            onClick={() => openGmailThread(state.thread.threadId, state.thread.account)}
          >
            {t("email.brief.openGmail")}
            <ExternalLink size={13} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {state.status === "loading" ? <p className="email-brief__lead email-brief__lead--quiet">{t("email.brief.opening")}</p> : null}
      {state.status === "error" ? <p className="email-brief__notice">{state.message}</p> : null}
      {state.status === "done" ? (
        <>
          <h1 className="email-reader__subject">{state.thread.subject}</h1>
          {state.thread.messages.map((message) => (
            <section key={message.messageId} className="email-reader__message">
              <header className="email-reader__head">
                <span className="email-reader__from" title={message.fromAddress}>
                  {message.from}
                  {message.draft ? <span className="email-reader__draft">{t("email.brief.draft")}</span> : null}
                </span>
                <span className="email-brief__time">{emailTime(locale, message.receivedAt, now)}</span>
              </header>
              <p className="email-reader__to">{t("email.brief.to", { to: message.to })}</p>
              <div className="email-reader__text">{message.text}</div>
              {message.attachments.length > 0 ? (
                <p className="email-reader__attachments">
                  <Paperclip size={13} strokeWidth={1.9} aria-hidden="true" />
                  {message.attachments.join(", ")}
                </p>
              ) : null}
            </section>
          ))}
        </>
      ) : null}
    </article>
  );
}

// The panel ------------------------------------------------------------------------

const dayLabel = (
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string,
  at: number,
  now: number,
): string => {
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(at);
  const day = new Date(at);
  const today = new Date(now);
  if (day.toDateString() === today.toDateString()) return t("email.brief.today", { time });
  const yesterday = new Date(now - 86_400_000);
  if (day.toDateString() === yesterday.toDateString()) return t("email.brief.yesterday", { time });
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);
};

const asksForYou = (digest: EmailDigest) =>
  digest.items.some((item) => item.bucket === "urgent" || item.bucket === "needs_you") ||
  Boolean(digest.brief?.sections.some((section) => section.tone !== "fyi"));

/**
 * The Email tab: one briefing at a time, written like a good answer (a lead,
 * then short sections of points with one control each), a strip across every
 * briefing of the week, search across the mailbox, and emails read in place.
 * Whatever is on screen rides along with the next chat message.
 */
export function EmailDigestPanel({
  active,
  enabled,
  waiting,
  showAccount,
  settings,
}: {
  active: boolean;
  enabled: boolean;
  /** Mail sorted since the newest briefing, not in one yet. */
  waiting: EmailItem[];
  showAccount: boolean;
  settings: ReactNode;
}) {
  const { t, tPlural, locale } = useI18n();
  const now = useNow();
  const view = useBackendView("email.digests", enabled ? {} : "skip");
  const { digestId, openedAt } = useSelectedEmailDigest();
  const topRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Picked>(null);
  const [pickedAt, setPickedAt] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<
    null | { query: string; state: { status: "loading" } | { status: "error"; message: string } | { status: "done"; result: EmailSearchResult } }
  >(null);
  const [foundPick, setFoundPick] = useState<EmailFound | null>(null);
  const [reading, setReading] = useState<ReadTarget | null>(null);
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const digests = view.value?.digests ?? [];
  const index = Math.max(0, digests.findIndex((digest) => digest.digestId === digestId));
  const shown = digests[index] ?? null;
  const newest = index === 0;
  const accounts = showAccount || Boolean(view.value?.multipleAccounts);
  const brief = useBrief(shown ?? { digestId: "", kind: "summary", createdAt: 0, items: [], skipped: [] });

  const pick = (key: string | null) => {
    setPicked(key ? { kind: "block", key } : null);
    setPickedAt(Date.now());
  };

  useEffect(() => {
    setPicked(null);
    setReading(null);
    setSearch(null);
    setShowSettings(false);
    if (openedAt) topRef.current?.scrollIntoView({ block: "start" });
  }, [openedAt]);

  useEffect(() => {
    stripRef.current?.querySelector("[data-on]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [shown?.digestId, digests.length]);

  const when = shown ? dayLabel(t, locale, shown.createdAt, now) : "";

  const chip = useMemo((): Chip | null => {
    if (reading && thread) return { key: `thread:${thread.threadId}`, label: t("email.brief.chip", { title: thread.subject }), snapshot: threadSnapshot(thread) };
    if (search) {
      if (!foundPick) return null;
      return {
        key: `found:${foundPick.messageId}`,
        label: t("email.brief.chip", { title: `${foundPick.from} · ${foundPick.subject}` }),
        snapshot: foundSnapshot(foundPick),
      };
    }
    if (!shown) return null;
    const block = picked ? brief.sections.flatMap((section) => section.blocks).find((entry) => blockKey(entry) === picked.key) : undefined;
    if (block) return { key: `block:${picked!.key}`, label: t("email.brief.chip", { title: plainText(block.title) }), snapshot: blockSnapshot(shown, block) };
    return {
      key: `brief:${shown.digestId}`,
      label: t("email.brief.chip", { title: t("email.brief.chipBriefing", { time: emailTime(locale, shown.createdAt, now) }) }),
      snapshot: briefingSnapshot(shown, brief, when),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading, thread, search, foundPick, shown, picked, brief, when, locale]);

  const focusComposer = useEmailChip(active && !showSettings, chip, pickedAt);

  const go = (step: number) => {
    const next = digests[index + step];
    if (!next) return;
    selectEmailDigest(next.digestId);
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const words = query.trim();
    if (!words) return;
    setReading(null);
    setFoundPick(null);
    setShowSettings(false);
    setSearch({ query: words, state: { status: "loading" } });
    void backendClient
      .call("email.search", { query: words })
      .then((result) => setSearch((current) => (current?.query === words ? { query: words, state: { status: "done", result } } : current)))
      .catch((error: unknown) =>
        setSearch((current) =>
          current?.query === words
            ? { query: words, state: { status: "error", message: error instanceof Error && error.message ? error.message : t("email.failed") } }
            : current,
        ),
      );
  };

  if (!view.value) return <div ref={topRef} aria-busy={view.status !== "error"} />;

  const ordered = [...digests].reverse();
  const subtitle = shown
    ? shown.sinceAt
      ? tPlural("email.brief.newSince", shown.items.length, { time: emailTime(locale, shown.sinceAt, now) })
      : tPlural("email.row.new", shown.items.length)
    : "";

  let body: ReactNode;
  if (showSettings) body = <div className="email-brief__settings">{settings}</div>;
  else if (reading)
    body = (
      <Reader
        target={reading}
        now={now}
        onLoaded={setThread}
        onClose={() => {
          setReading(null);
          setThread(null);
        }}
      />
    );
  else if (search)
    body = (
      <SearchResults
        query={search.query}
        state={search.state}
        now={now}
        picked={foundPick ? `${foundPick.account}:${foundPick.messageId}` : null}
        onPick={(mail) => {
          setFoundPick(mail);
          setPickedAt(Date.now());
        }}
        onRead={(mail) => setReading({ account: mail.account, threadId: mail.threadId })}
        onTell={(mail) => {
          setFoundPick(mail);
          setPickedAt(Date.now());
          focusComposer();
        }}
        onClose={() => {
          setSearch(null);
          setFoundPick(null);
          setQuery("");
        }}
      />
    );
  else if (shown)
    body = (
      <Briefing
        key={shown.digestId}
        digest={shown}
        waiting={newest ? waiting : []}
        showAccount={accounts}
        now={now}
        picked={picked}
        onPick={pick}
        onRead={(item) => setReading({ itemId: item.itemId })}
        onTell={(key) => {
          pick(key);
          focusComposer();
        }}
      />
    );
  else body = <p className="email-brief__lead email-brief__lead--quiet">{t("email.brief.empty")}</p>;

  return (
    <div ref={topRef} className="email-brief">
      <header className="email-brief__bar">
        <div className="email-brief__nav">
          <button
            type="button"
            className="email-brief__icon-btn"
            aria-label={t("email.brief.earlier")}
            disabled={index >= digests.length - 1 || Boolean(search) || Boolean(reading)}
            onClick={() => go(1)}
            data-testid="email-brief-earlier"
          >
            <ChevronLeft size={16} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="email-brief__icon-btn"
            aria-label={t("email.brief.later")}
            disabled={index === 0 || Boolean(search) || Boolean(reading)}
            onClick={() => go(-1)}
            data-testid="email-brief-later"
          >
            <ChevronRight size={16} strokeWidth={1.9} />
          </button>
        </div>
        <div className="email-brief__when">
          <span className="email-brief__when-title">{shown ? when : t("email.title")}</span>
          {subtitle ? <span className="email-brief__when-sub">{subtitle}</span> : null}
        </div>
        <form className="email-brief__search" onSubmit={submitSearch} role="search">
          <Search size={15} strokeWidth={1.9} aria-hidden="true" />
          <input
            className="email-brief__search-input"
            value={query}
            placeholder={t("email.brief.search")}
            aria-label={t("email.brief.search")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                setSearch(null);
              }
            }}
            data-testid="email-search"
          />
          {query ? (
            <button
              type="button"
              className="email-brief__search-clear"
              aria-label={t("email.brief.backToBrief")}
              onClick={() => {
                setQuery("");
                setSearch(null);
                setFoundPick(null);
              }}
            >
              <X size={13} strokeWidth={2} />
            </button>
          ) : null}
        </form>
        <button
          type="button"
          className="email-brief__icon-btn"
          aria-label={t("email.digest.settings")}
          aria-pressed={showSettings}
          onClick={() => setShowSettings((value) => !value)}
          data-testid="email-settings"
        >
          <Settings size={16} strokeWidth={1.9} />
        </button>
      </header>
      {ordered.length > 1 ? (
        <div ref={stripRef} className="email-brief__strip" role="tablist" aria-label={t("email.brief.all")}>
          {ordered.map((digest) => {
            const on = digest === shown && !search && !reading && !showSettings;
            return (
              <button
                key={digest.digestId}
                type="button"
                role="tab"
                aria-selected={on}
                data-on={digest === shown || undefined}
                className="email-brief__stop"
                onClick={() => {
                  setSearch(null);
                  setReading(null);
                  setShowSettings(false);
                  selectEmailDigest(digest.digestId);
                }}
              >
                {asksForYou(digest) ? <span className="email-brief__dot" aria-hidden="true" /> : null}
                <span>{emailTime(locale, digest.createdAt, now)}</span>
                <span className="email-brief__stop-count">{digest.items.length}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {body}
    </div>
  );
}
