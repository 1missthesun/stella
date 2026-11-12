import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type {
  EmailHistory,
  EmailLogEntry,
  EmailMatter,
  EmailNoiseSender,
  EmailToday,
  EmailAccess,
} from "@stella/contracts/backend/email";
import { laterChoices, plainText, TODAY_TONES, whenLabel, type LaterChoiceId } from "@stella/contracts/email-brief";
import { useDictation } from "@/features/dictation/hooks/use-dictation";
import { backendClient } from "@/platform/backend/backend-client";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useI18n } from "@/shared/i18n";
import { ChevronDown, Mic, MoreHorizontal } from "@/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { showToast } from "@/ui/toast";
import { BYOK_TOAST_ACTION } from "@/global/billing/byok-action";
import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import { correctEmail, dismissEmail, emailTime, openGmailThread } from "./email-items";

/** The briefing's light markdown: bold and nothing else, rendered inline. */
export function Md({ text }: { text: string }) {
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

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const settle = (matterId: string, status: "open" | "later" | "done", laterUntil?: number) =>
  backendClient.call("email.settle", { matterId, status, ...(laterUntil !== undefined ? { laterUntil } : {}) });

export type TodayActions = {
  /** Hands the item to Stella in the chat (its prepared step, "Handle it", or a reply through the chat). */
  ask: (matter: EmailMatter, action: "reply" | "handle" | "suggest", text: string) => Promise<void>;
  tell: (matter: EmailMatter) => void;
  read: (matter: EmailMatter) => void;
  pick: (matter: EmailMatter | null) => void;
};

// Hold to speak ---------------------------------------------------------------------

/**
 * Listens while mounted (one hold), using the app's own dictation, and hands
 * back what was said once the transcript settles. Mounted only during a hold,
 * so the chat's dictation shortcut is never shared with it.
 */
function HoldListener({ released, onWords }: { released: boolean; onWords: (words: string) => void }) {
  const text = useRef("");
  const started = useRef(false);
  const done = useRef(false);
  const dictation = useDictation({
    setMessage: (next) => {
      text.current = typeof next === "function" ? next(text.current) : next;
    },
  });
  const toggle = useRef(dictation.toggle);
  toggle.current = dictation.toggle;
  useEffect(() => {
    toggle.current();
  }, []);
  useEffect(() => {
    if (released && started.current) toggle.current();
  }, [released]);
  useEffect(() => {
    if (dictation.state !== "idle" && dictation.state !== "error") {
      if (!started.current) {
        started.current = true;
        if (released) toggle.current();
      }
      return;
    }
    if (started.current && !done.current) {
      done.current = true;
      onWords(text.current.trim());
    }
  }, [dictation.state, released, onWords]);
  return null;
}

/** Press-and-hold on a control: a short press is a click; a hold listens until let go. */
function useHold(onClick: () => void, onHold: () => void, onRelease: () => void) {
  const timer = useRef<number | null>(null);
  const holding = useRef(false);
  const end = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
      onClick();
    } else if (holding.current) {
      holding.current = false;
      onRelease();
    }
  };
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        holding.current = true;
        onHold();
      }, 320);
    },
    onPointerUp: end,
    onPointerLeave: () => {
      if (holding.current) end();
      else if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    },
  };
}

// The reply, prepared ---------------------------------------------------------------

function ReplyEditor({
  matter,
  body,
  onBody,
  onClose,
  voice,
}: {
  matter: EmailMatter;
  body: string;
  onBody: (body: string) => void;
  onClose: (sent?: "sent" | "saved") => void;
  voice: { listening: boolean; writing: boolean; hold: ReturnType<typeof useHold> };
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus();
  }, []);
  const send = (mode: "send" | "draft") => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    void backendClient
      .call("email.sendReply", { matterId: matter.matterId, body, mode })
      .then(() => onClose(mode === "send" ? "sent" : "saved"))
      .catch((caught: unknown) => setError(errorText(caught, t("email.failed"))))
      .finally(() => setBusy(false));
  };
  return (
    <div className="email-today__reply" data-testid="email-reply-editor">
      <p className="email-today__reply-to">{t("email.reply.to", { to: matter.from })}</p>
      <textarea
        ref={area}
        className="email-today__reply-text"
        value={voice.writing ? t("email.reply.writing") : body}
        disabled={voice.writing || busy}
        onChange={(event) => onBody(event.target.value)}
        rows={Math.min(14, Math.max(4, body.split("\n").length + 1))}
        data-testid="email-reply-body"
      />
      <div className="email-today__reply-row">
        <button
          type="button"
          className="email-brief__control email-brief__control--primary"
          disabled={busy || voice.writing || !body.trim()}
          onClick={() => send("send")}
          data-testid="email-reply-send"
        >
          {t("email.reply.send")}
        </button>
        <button type="button" className="email-today__quiet" disabled={busy || voice.writing || !body.trim()} onClick={() => send("draft")}>
          {t("email.reply.saveDraft")}
        </button>
        <button type="button" className="email-today__quiet" disabled={busy} onClick={() => onClose()}>
          {t("email.reply.cancel")}
        </button>
        <button
          type="button"
          className="email-today__mic"
          data-listening={voice.listening || undefined}
          aria-label={t("email.reply.hold")}
          title={t("email.reply.hold")}
          {...voice.hold}
        >
          <Mic size={15} strokeWidth={1.9} />
          <span>{voice.listening ? t("email.reply.listening") : t("email.reply.holdShort")}</span>
        </button>
      </div>
      <p className="email-today__reply-note">{error ?? t("email.reply.never")}</p>
    </div>
  );
}

// One item -------------------------------------------------------------------------

function LaterMenu({ matter, now, onLater }: { matter: EmailMatter; now: number; onLater: (at: number) => void }) {
  const { t, locale } = useI18n();
  const [picking, setPicking] = useState(false);
  const choices = laterChoices(now, matter.laterSuggestion);
  const words: Record<LaterChoiceId, string> = {
    suggested: matter.laterSuggestion.why,
    tonight: t("email.today.laterTonight"),
    tomorrow: t("email.today.laterTomorrow"),
    weekend: t("email.today.laterWeekend"),
    nextWeek: t("email.today.laterNextWeek"),
  };
  if (picking) {
    const start = new Date(choices[0]?.at ?? now + 86_400_000);
    const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    return (
      <form
        className="email-today__pick"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("at");
          const at = typeof value === "string" ? new Date(value).getTime() : NaN;
          if (Number.isFinite(at) && at > Date.now()) onLater(at);
          setPicking(false);
        }}
      >
        <input name="at" type="datetime-local" defaultValue={local} className="email-today__pick-input" aria-label={t("email.today.laterSet")} />
        <button type="submit" className="email-today__quiet">
          {t("email.today.laterSet")}
        </button>
      </form>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="email-today__quiet" data-testid="email-later">
          {t("email.today.later")}
          <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="email-brief__menu">
        {choices.map((choice) => (
          <DropdownMenuItem key={choice.id} className="email-today__later-item" onSelect={() => onLater(choice.at)}>
            <span>{choice.id === "suggested" && words.suggested ? t("email.today.laterSuggested", { when: whenLabel(locale, choice.at, now), why: words.suggested }) : words[choice.id] || whenLabel(locale, choice.at, now)}</span>
            {choice.id === "suggested" ? null : <span className="email-brief__menu-hint">{whenLabel(locale, choice.at, now)}</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setPicking(true);
          }}
        >
          {t("email.today.laterPick")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Item({
  matter,
  now,
  showAccount,
  selected,
  actions,
  onGone,
  voice,
}: {
  matter: EmailMatter;
  now: number;
  showAccount: boolean;
  selected: boolean;
  actions: TodayActions;
  onGone: (matter: EmailMatter, how: "done" | "later", at?: number) => void;
  voice: VoiceControl;
}) {
  const { t, tPlural, locale } = useI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prepared = matter.prepared;
  const editing = voice.editing?.matterId === matter.matterId;
  const listening = voice.listeningFor === matter.matterId;
  const writing = voice.writingFor === matter.matterId;

  const run = (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNotice(null);
    void work()
      .then(() => {
        if (done) setNotice(done);
      })
      .catch((error: unknown) => setNotice(errorText(error, t("email.failed"))))
      .finally(() => setBusy(false));
  };

  const openReply = () => voice.edit(matter, prepared?.kind === "reply" ? prepared.body : "");
  const primary = () => {
    if (!prepared) return;
    if (prepared.kind === "reply") openReply();
    else run(() => actions.ask(matter, "suggest", prepared.ask), t("email.digest.sent"));
  };
  const hold = useHold(primary, () => voice.startHold(matter), voice.releaseHold);
  const micHold = useHold(openReply, () => voice.startHold(matter), voice.releaseHold);

  const meta = [
    matter.from,
    matter.itemIds.length > 1 ? tPlural("email.brief.emails", matter.itemIds.length) : matter.subject,
    emailTime(locale, matter.receivedAt, now),
    showAccount ? matter.account : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const sorted = matter.tone === "fyi" ? "worth_knowing" : "needs_you";

  return (
    <li
      className="email-today__item"
      data-selected={selected || undefined}
      data-busy={busy || undefined}
      data-testid="email-today-item"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, textarea, input, form, [role='menu']")) return;
        actions.pick(selected ? null : matter);
      }}
    >
      <p className="email-today__headline">{matter.headline}</p>
      <p className="email-today__meta">
        {matter.returnedAt ? <span className="email-today__back">{t("email.today.back")} · </span> : null}
        {meta}
      </p>
      {matter.points.length > 0 ? (
        <ul className="email-brief__points">
          {matter.points.map((point, index) => (
            <li key={index}>
              <Md text={point} />
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? (
        <ReplyEditor
          matter={matter}
          body={voice.editing!.body}
          onBody={(body) => voice.edit(matter, body)}
          onClose={(how) => {
            voice.close();
            if (how) showToast({ description: how === "sent" ? t("email.reply.sent") : t("email.reply.saved"), duration: 4000 });
          }}
          voice={{ listening, writing, hold: micHold }}
        />
      ) : (
        <div className="email-today__controls">
          {prepared ? (
            <button
              type="button"
              className="email-brief__control email-brief__control--primary"
              disabled={busy}
              title={prepared.kind === "reply" ? t("email.reply.hold") : undefined}
              data-listening={listening || undefined}
              data-testid="email-today-primary"
              {...hold}
            >
              {listening ? <Mic size={14} strokeWidth={2} aria-hidden="true" /> : null}
              <span>{listening ? t("email.reply.listening") : writing ? t("email.reply.writing") : prepared.label}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="email-today__quiet"
            disabled={busy}
            onClick={() => onGone(matter, "done")}
            data-testid="email-done"
          >
            {t("email.today.done")}
          </button>
          <LaterMenu matter={matter} now={now} onLater={(at) => onGone(matter, "later", at)} />
          <button
            type="button"
            className="email-today__mic"
            data-listening={listening || undefined}
            aria-label={t("email.reply.hold")}
            title={t("email.reply.hold")}
            data-testid="email-today-mic"
            {...micHold}
          >
            <Mic size={15} strokeWidth={1.9} />
            {!prepared && listening ? <span>{t("email.reply.listening")}</span> : null}
            {!prepared && writing ? <span>{t("email.reply.writing")}</span> : null}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="email-brief__control" disabled={busy} aria-label={t("email.brief.more")} data-testid="email-today-more">
                <MoreHorizontal size={16} strokeWidth={1.9} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="email-brief__menu">
              <DropdownMenuItem onSelect={openReply}>{t("email.digest.reply")}</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => run(() => actions.ask(matter, "handle", t("email.digest.askHandle", { from: matter.from, subject: matter.subject })), t("email.digest.sent"))}
              >
                {t("email.digest.handle")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.tell(matter)}>{t("email.digest.tell")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.read(matter)}>{t("email.brief.read")}</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  run(async () => {
                    await backendClient.call("email.archive", { itemIds: matter.itemIds, archived: true });
                  })
                }
              >
                {t("email.digest.archive")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openGmailThread(matter.threadId, matter.account)}>{t("email.brief.openGmail")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    () => Promise.all(matter.itemIds.map((id) => correctEmail(id, sorted === "needs_you" ? "worth_knowing" : "needs_you"))),
                    t("email.brief.noted"),
                  )
                }
              >
                {sorted === "needs_you" ? t("email.section.moveToWorthKnowing") : t("email.section.moveToNeedsYou")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(() => Promise.all(matter.itemIds.map((id) => dismissEmail(id))))}>
                {t("email.notImportant")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {notice ? (
        <p className="email-brief__notice" role="status">
          {notice}
        </p>
      ) : null}
    </li>
  );
}

// Voice and the open editor, one at a time across the list --------------------------

type VoiceControl = {
  editing: { matterId: string; body: string } | null;
  listeningFor: string | null;
  writingFor: string | null;
  edit: (matter: EmailMatter, body: string) => void;
  close: () => void;
  startHold: (matter: EmailMatter) => void;
  releaseHold: () => void;
};

function useVoice(): { control: VoiceControl; listener: ReactNode } {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ matterId: string; body: string } | null>(null);
  const [hold, setHold] = useState<{ matter: EmailMatter; released: boolean; key: number } | null>(null);
  const [writingFor, setWritingFor] = useState<string | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const onWords = (matter: EmailMatter) => (words: string) => {
    setHold(null);
    if (!words) return;
    const draft = editingRef.current?.matterId === matter.matterId ? editingRef.current.body : undefined;
    setWritingFor(matter.matterId);
    setEditing({ matterId: matter.matterId, body: draft ?? "" });
    void backendClient
      .call("email.voiceReply", { matterId: matter.matterId, words, ...(draft ? { draft } : {}) })
      .then(({ body }) => setEditing({ matterId: matter.matterId, body }))
      .catch((error: unknown) => showToast({ description: errorText(error, t("email.failed")), variant: "error" }))
      .finally(() => setWritingFor(null));
  };

  return {
    control: {
      editing,
      listeningFor: hold && !hold.released ? hold.matter.matterId : null,
      writingFor,
      edit: (matter, body) => setEditing({ matterId: matter.matterId, body }),
      close: () => setEditing(null),
      startHold: (matter) => setHold({ matter, released: false, key: Date.now() }),
      releaseHold: () => setHold((current) => (current ? { ...current, released: true } : current)),
    },
    listener: hold ? <HoldListener key={hold.key} released={hold.released} onWords={onWords(hold.matter)} /> : null,
  };
}

// Left out, by sender --------------------------------------------------------------

function LeftOut({ senders, now }: { senders: EmailNoiseSender[]; now: number }) {
  const { t, tPlural, locale } = useI18n();
  const [state, setState] = useState<Record<string, "busy" | "unsubscribed" | "cleared" | "page" | string>>({});
  if (senders.length === 0) return null;
  const run = (address: string, work: () => Promise<"unsubscribed" | "cleared" | "page">) => {
    setState((current) => ({ ...current, [address]: "busy" }));
    void work()
      .then((done) => setState((current) => ({ ...current, [address]: done })))
      .catch((error: unknown) => setState((current) => ({ ...current, [address]: errorText(error, t("email.failed")) })));
  };
  const shown = senders.filter((sender) => state[sender.address] !== "cleared");
  return (
    <section className="email-today__leftout" data-testid="email-left-out">
      <h2 className="email-brief__heading">{t("email.cleanup.title")}</h2>
      <p className="email-brief__hint">{t("email.cleanup.hint")}</p>
      <ul className="email-today__senders">
        {shown.map((sender) => {
          const status = state[sender.address];
          const unsubscribed = sender.unsubscribed || status === "unsubscribed";
          return (
            <li key={sender.address} className="email-today__sender" data-testid="email-left-out-sender">
              <span className="email-today__sender-main">
                <span className="email-today__sender-name" title={sender.address}>
                  {sender.name}
                </span>
                <span className="email-today__sender-sub">
                  {tPlural("email.brief.emails", sender.count)} · {sender.latestSubject} · {emailTime(locale, sender.latestAt, now)}
                </span>
                {status && !["busy", "unsubscribed", "cleared", "page"].includes(status) ? (
                  <span className="email-today__sender-sub">{status}</span>
                ) : status === "page" ? (
                  <span className="email-today__sender-sub">{t("email.cleanup.openedPage")}</span>
                ) : null}
              </span>
              {sender.unsubscribe ? (
                unsubscribed ? (
                  <span className="email-today__sender-done">{t("email.cleanup.unsubscribed")}</span>
                ) : (
                  <button
                    type="button"
                    className="email-today__quiet"
                    disabled={status === "busy"}
                    onClick={() =>
                      run(sender.address, async () => {
                        const result = await backendClient.call("email.unsubscribe", { address: sender.address });
                        if (result.done) return "unsubscribed";
                        if (result.url) openExternalUrl(result.url);
                        return "page";
                      })
                    }
                  >
                    {t("email.cleanup.unsubscribe")}
                  </button>
                )
              ) : null}
              <button
                type="button"
                className="email-today__quiet"
                disabled={status === "busy"}
                onClick={() =>
                  run(sender.address, async () => {
                    await backendClient.call("email.clearSender", { address: sender.address });
                    return "cleared";
                  })
                }
                data-testid="email-clear-sender"
              >
                {t("email.cleanup.clearAll")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Put off and settled ----------------------------------------------------------------

function Folded({
  label,
  matters,
  now,
  testId,
}: {
  label: string;
  matters: EmailMatter[];
  now: number;
  testId: string;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  if (matters.length === 0) return null;
  return (
    <section className="email-today__folded" data-testid={testId}>
      <button type="button" className="email-brief__skipped-line" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="email-brief__skipped-text">
          <strong>{label}</strong>
        </span>
        <span className="email-brief__skipped-toggle">{open ? t("email.brief.hide") : t("email.brief.show")}</span>
      </button>
      {open ? (
        <ul className="email-brief__skipped-list">
          {matters.map((matter) => (
            <li key={matter.matterId} className="email-brief__skipped-row">
              <span className="email-brief__skipped-mail">
                <span className="email-brief__skipped-from">{matter.headline}</span>
                <span className="email-brief__skipped-subject">{statusWords(t, locale, matter, now)}</span>
              </span>
              <button type="button" className="email-brief__matter" onClick={() => void settle(matter.matterId, "open")}>
                {t("email.today.reopen")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type T = (key: string, params?: Record<string, string | number>) => string;

const statusWords = (t: T, locale: string, matter: EmailMatter, now: number): string => {
  if (matter.status === "later" && matter.laterUntil) return t("email.status.later", { when: whenLabel(locale, matter.laterUntil, now) });
  if (matter.status === "open") return t("email.status.open");
  switch (matter.settledHow) {
    case "replied":
      return t("email.status.replied");
    case "drafted":
      return t("email.status.drafted");
    case "handled":
      return t("email.status.handled");
    case "archived":
      return t("email.status.archived");
    case "replied_in_gmail":
      return t("email.status.repliedInGmail");
    case "archived_in_gmail":
      return t("email.status.archivedInGmail");
    default:
      return t("email.status.done");
  }
};

// Today ------------------------------------------------------------------------------

/**
 * One living list: what is open now, urgent first, each item headlined by its
 * outcome with the step already prepared. Done and Later take it away; new
 * mail joins; what was put off comes back on its own.
 */
/**
 * What stops or limits email, said plainly with what unlocks more: sorting paused because the
 * allowance or the day's limit is used up, the owner's own key refused, or Free's sorting-only taste.
 */
export function AccessNotice({ access }: { access: EmailAccess | undefined }) {
  const { t, locale } = useI18n();
  if (!access) return null;
  const onStella = access.payer === "stella";
  const addKey = (
    <button type="button" className="email-brief__control email-brief__control--primary" onClick={BYOK_TOAST_ACTION.onClick}>
      {t("email.access.addKey")}
    </button>
  );
  const plans =
    onStella && access.plan === "free" ? (
      <button type="button" className="email-today__quiet" onClick={() => planUsageDialog.openPlans()}>
        {t("email.access.plans")}
      </button>
    ) : null;
  if (access.ownKeyRefused) {
    return (
      <section className="email-today__notice" role="status">
        <h2 className="email-today__notice-title">{t("email.access.refusedTitle")}</h2>
        <p className="email-today__notice-body">{t("email.access.refusedBody", { reason: access.ownKeyRefused })}</p>
        <div className="email-today__notice-actions">{addKey}</div>
      </section>
    );
  }
  if (access.paused) {
    const date = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(access.paused.until);
    const title =
      access.paused.why === "day" ? t("email.access.pausedDayTitle") : t("email.access.pausedMonthTitle", { date });
    const body = !onStella
      ? t("email.access.pausedOwnBody")
      : access.paused.why === "day"
        ? t(access.plan === "free" ? "email.access.pausedDayFreeBody" : "email.access.pausedDayBody")
        : t(access.plan === "free" ? "email.access.pausedFreeBody" : "email.access.pausedPaidBody");
    return (
      <section className="email-today__notice" role="status">
        <h2 className="email-today__notice-title">{title}</h2>
        <p className="email-today__notice-body">{body}</p>
        {onStella ? (
          <div className="email-today__notice-actions">
            {addKey}
            {plans}
          </div>
        ) : null}
      </section>
    );
  }
  if (onStella && !access.writes) {
    return (
      <section className="email-today__notice email-today__notice--quiet">
        <p className="email-today__notice-body">{t("email.access.freeSortingOnly")}</p>
        <div className="email-today__notice-actions">
          <button type="button" className="email-today__quiet" onClick={BYOK_TOAST_ACTION.onClick}>
            {t("email.access.addKey")}
          </button>
          {plans}
        </div>
      </section>
    );
  }
  return null;
}

export function TodayView({
  today,
  now,
  showAccount,
  picked,
  actions,
}: {
  today: EmailToday;
  now: number;
  showAccount: boolean;
  picked: string | null;
  actions: TodayActions;
}) {
  const { t, tPlural, locale } = useI18n();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const { control, listener } = useVoice();
  const open = today.open.filter((matter) => !gone.has(matter.matterId));

  // An item settled elsewhere and reopened comes back.
  useEffect(() => {
    setGone((current) => {
      const live = new Set(today.open.map((matter) => matter.matterId));
      const next = new Set([...current].filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [today.open]);

  const onGone = (matter: EmailMatter, how: "done" | "later", at?: number) => {
    setGone((current) => new Set([...current, matter.matterId]));
    if (picked === matter.matterId) actions.pick(null);
    const undo = () => {
      setGone((current) => new Set([...current].filter((id) => id !== matter.matterId)));
      void settle(matter.matterId, "open");
    };
    void settle(matter.matterId, how, at)
      .then(() =>
        showToast({
          description:
            how === "done"
              ? t("email.today.toastDone", { headline: matter.headline })
              : t("email.today.toastLater", { when: whenLabel(locale, at ?? matter.laterSuggestion.at, now), headline: matter.headline }),
          action: { label: t("email.today.undo"), onClick: undo },
          duration: 6000,
        }),
      )
      .catch((error: unknown) => {
        setGone((current) => new Set([...current].filter((id) => id !== matter.matterId)));
        showToast({ description: errorText(error, t("email.failed")), variant: "error" });
      });
  };

  return (
    <article className="email-brief__doc email-today" data-testid="email-today">
      {listener}
      <AccessNotice access={today.access} />
      {open.length > 0 && today.lead ? (
        <p className="email-brief__lead">
          <Md text={today.lead} />
        </p>
      ) : null}
      {open.length === 0 ? <p className="email-brief__lead email-brief__lead--quiet">{t("email.today.allClear")}</p> : null}
      {TODAY_TONES.map((tone) => {
        const matters = open.filter((matter) => matter.tone === tone);
        if (matters.length === 0) return null;
        return (
          <section key={tone} className="email-brief__section" data-tone={tone}>
            <h2 className="email-brief__heading">
              {tone === "urgent" ? <span className="email-brief__dot" aria-hidden="true" /> : null}
              {tone === "urgent" ? t("email.section.urgent") : tone === "needs_you" ? t("email.section.needsYou") : t("email.section.worthKnowing")}
            </h2>
            <ul className="email-today__items">
              {matters.map((matter) => (
                <Item
                  key={matter.matterId}
                  matter={matter}
                  now={now}
                  showAccount={showAccount}
                  selected={picked === matter.matterId}
                  actions={actions}
                  onGone={onGone}
                  voice={control}
                />
              ))}
            </ul>
          </section>
        );
      })}
      <div className="email-today__after">
        <Folded label={tPlural("email.today.inLater", today.later.length)} matters={today.later} now={now} testId="email-in-later" />
        <Folded label={tPlural("email.today.doneToday", today.doneToday.length)} matters={today.doneToday} now={now} testId="email-done-today" />
      </div>
      <LeftOut senders={today.noise} now={now} />
    </article>
  );
}

// History and the log ---------------------------------------------------------------

const logLine = (t: T, tPlural: (key: string, count: number, params?: Record<string, string | number>) => string, locale: string, entry: EmailLogEntry, now: number): string => {
  const subject = entry.subject ?? "";
  const who = entry.who ?? "";
  switch (entry.kind) {
    case "briefed":
      return tPlural("email.log.briefed", entry.count ?? 0);
    case "urgent":
      return t("email.log.urgent", { subject });
    case "rule":
      return t("email.log.rule", { subject });
    case "sent":
      return t("email.log.sent", { who });
    case "drafted":
      return t("email.log.drafted", { who });
    case "done":
      return t("email.log.done", { subject });
    case "later":
      return t("email.log.later", { subject, when: entry.until ? whenLabel(locale, entry.until, now) : "" });
    case "returned":
      return t("email.log.returned", { subject });
    case "reopened":
      return t("email.log.reopened", { subject });
    case "handled":
      return t("email.log.handled", { subject });
    case "archived":
      return t("email.log.archived", { subject });
    case "unsubscribed":
      return t("email.log.unsubscribed", { who });
    case "cleared":
      return tPlural("email.log.cleared", entry.count ?? 0, { who });
    case "replied_in_gmail":
      return t("email.log.repliedInGmail", { subject });
    case "archived_in_gmail":
      return t("email.log.archivedInGmail", { subject });
  }
};

const dayTitle = (t: T, locale: string, day: string, now: number): string => {
  const [year, month, date] = day.split("-").map(Number);
  const at = new Date(year!, month! - 1, date!, 12).getTime();
  const today = new Date(now).toDateString();
  if (new Date(at).toDateString() === today) return t("email.history.today");
  if (new Date(at).toDateString() === new Date(now - 86_400_000).toDateString()) return t("email.history.yesterday");
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(at);
};

export function HistoryView({ history, now, onRead }: { history: EmailHistory | undefined; now: number; onRead: (matter: EmailMatter) => void }) {
  const { t, tPlural, locale } = useI18n();
  if (!history) return <div aria-busy="true" />;
  const time = (at: number) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(at);
  return (
    <article className="email-brief__doc email-history" data-testid="email-history">
      <p className="email-brief__hint email-history__hint">{t("email.log.hint")}</p>
      {history.days.length === 0 ? <p className="email-brief__lead email-brief__lead--quiet">{t("email.history.empty")}</p> : null}
      {history.days.map((day) => (
        <section key={day.day} className="email-history__day">
          <h2 className="email-history__title">{dayTitle(t, locale, day.day, now)}</h2>
          <p className="email-brief__foot">{tPlural("email.log.read", day.read, { leftOut: day.leftOut })}</p>
          {day.arrived.length > 0 ? (
            <>
              <h3 className="email-brief__heading email-history__sub">{t("email.history.cameIn")}</h3>
              <ul className="email-history__rows">
                {day.arrived.map((matter) => (
                  <li key={matter.matterId} className="email-history__row">
                    <span className="email-brief__time">{time(matter.arrivedAt)}</span>
                    <button type="button" className="email-history__what" onClick={() => onRead(matter)}>
                      {matter.headline}
                    </button>
                    <span className="email-history__status">{statusWords(t, locale, matter, now)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {day.log.length > 0 ? (
            <>
              <h3 className="email-brief__heading email-history__sub">{t("email.log.title")}</h3>
              <ul className="email-history__rows">
                {day.log.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="email-history__row">
                    <span className="email-brief__time">{time(entry.at)}</span>
                    <span className="email-history__what email-history__what--plain">{logLine(t, tPlural, locale, entry, now)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ))}
    </article>
  );
}

/** What Stella reads with the next message while an item is picked. */
export const matterSnapshot = (matter: EmailMatter): string =>
  [
    `The user picked this item on their email Today list in Stella's Email tab: ${matter.headline}. ${matter.wants}`,
    ...(matter.points.length ? [matter.points.map(plainText).join(" ")] : []),
    `The email: from ${matter.from} <${matter.fromAddress}>, subject "${matter.subject}" (account ${matter.account}, message_id ${matter.messageId}, thread_id ${matter.threadId}).`,
    ...(matter.prepared?.kind === "reply" ? [`Stella prepared this reply (not sent): ${matter.prepared.body}`] : []),
    "When the user's message is about this, act on this email with the email tool (read, reply, draft) using its account and message_id. Save replies as Gmail drafts unless they clearly say to send.",
  ].join("\n");

/** What Stella reads with the next message while the Today list is on screen. */
export const todaySnapshot = (today: EmailToday): string =>
  [
    "The user has their email Today list open in Stella's Email tab. Open now:",
    ...today.open.map(
      (matter) =>
        `- [${matter.tone}] ${matter.headline}: ${matter.wants} (from ${matter.from} <${matter.fromAddress}>, account ${matter.account}, message_id ${matter.messageId})`,
    ),
    "When the user's message is about these, act on them with the email tool (read, reply, draft) using their account and message_id. Save replies as Gmail drafts unless they clearly say to send.",
  ].join("\n");
