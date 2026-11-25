import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EmailPageState, EmailRuleKind } from "@stella/contracts/backend/email";
import type { CanvasActionEvent } from "@stella/contracts/canvas-actions";
import {
  EMAIL_PAGE_CANVAS,
  EMAIL_PAGE_CHECK_ACTION,
  gmailThreadUrl,
  type EmailPageIgnored,
  type EmailPageItem,
  type EmailPageSection,
} from "@stella/contracts/email-page";
import { markEmailSeen } from "@/features/email/email-unseen";
import { useEmailFeature } from "@/features/email/email-feature";
import { useDisplayPanelOpen } from "@/features/workspace-display/tab-store";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { getPlatform } from "@/platform/electron/platform";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useI18n } from "@/shared/i18n";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { sendCanvasActionToChat } from "@/shell/display/canvas-tab/use-canvas-actions";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  LogIn,
  Mail,
  MessageSquare,
  RefreshCw,
  Reply,
  RotateCcw,
  SlidersHorizontal,
} from "@/ui/icons";
import "./email-section.css";

const SECTION_ORDER: readonly { key: EmailPageSection; titleKey: string }[] = [
  { key: "needs_you", titleKey: "email.section.needsYou" },
  { key: "waiting", titleKey: "email.workspace.sections.waiting" },
  { key: "handled", titleKey: "email.workspace.sections.handled" },
];

const RULE_KIND_LABEL_KEY: Record<EmailRuleKind, string> = {
  wake: "email.workspace.rules.wake",
  act: "email.workspace.rules.act",
  ignore: "email.workspace.rules.ignore",
};

type PendingKind = "working" | "sent";

const PENDING_LABEL_KEY: Record<PendingKind, string> = {
  working: "email.workspace.working",
  sent: "email.workspace.tell.sent",
};

type Selection =
  | { kind: "item"; id: string }
  | { kind: "ignored" }
  | { kind: "settings" };

const formatWhen = (at: number | undefined, locale: string): string => {
  if (!at) return "";
  const date = new Date(at);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  try {
    return sameDay
      ? date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
      : date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
};

const sortItems = (items: readonly EmailPageItem[], section: EmailPageSection): EmailPageItem[] =>
  items
    .filter((item) => item.section === section)
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.at - a.at);

function InlineRichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^\*\*[^*]+\*\*$/.test(part) ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function EmailRichText({ text }: { text: string }) {
  const chunks = text.split(/\n{2,}/);
  return (
    <div className="email-richtext">
      {chunks.map((chunk, chunkIndex) => {
        const lines = chunk.split("\n");
        if (lines.every((entry) => /^\s*[-•]\s+/.test(entry))) {
          return (
            <ul key={chunkIndex}>
              {lines.map((entry, lineIndex) => (
                <li key={lineIndex}>
                  <InlineRichText text={entry.replace(/^\s*[-•]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={chunkIndex}>
            {lines.map((entry, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                <InlineRichText text={entry} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function TellStellaComposer({
  item,
  value,
  submitting,
  canCancel,
  autoFocus,
  onChange,
  onSubmit,
  onCancel,
}: {
  item: EmailPageItem;
  value: string;
  submitting: boolean;
  canCancel: boolean;
  autoFocus: boolean;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (autoFocus) areaRef.current?.focus();
  }, [autoFocus, item.id]);
  const empty = value.trim().length === 0;
  const sendKeys = getPlatform() === "darwin" ? "⌘↵" : "Ctrl+↵";
  return (
    <form
      className="email-tell"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty && !submitting) onSubmit();
      }}
    >
      <textarea
        ref={areaRef}
        className="email-tell__input"
        value={value}
        placeholder={t("email.workspace.tell.placeholder")}
        disabled={submitting}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !empty && !submitting) {
            event.preventDefault();
            onSubmit();
          } else if (event.key === "Escape" && canCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="email-tell__bar">
        <span className="email-tell__hint">{t("email.workspace.tell.sendHint", { keys: sendKeys })}</span>
        <div className="email-tell__actions">
          {canCancel ? (
            <button
              type="button"
              className="email-btn email-btn--ghost"
              disabled={submitting}
              onClick={onCancel}
            >
              {t("common.cancel")}
            </button>
          ) : null}
          <button
            type="submit"
            className="email-btn email-btn--primary email-btn--compact email-tell__send"
            disabled={empty || submitting}
          >
            {submitting ? t("userAsk.question.sending") : t("email.digest.send")}
          </button>
        </div>
      </div>
    </form>
  );
}

function EmailDetailView({
  item,
  accountsCount,
  locale,
  pending,
  tellOpen,
  tellDraft,
  tellSending,
  onPrimaryAction,
  onToggleTell,
  onTellChange,
  onTellSubmit,
}: {
  item: EmailPageItem;
  accountsCount: number;
  locale: string;
  pending: PendingKind | undefined;
  tellOpen: boolean;
  tellDraft: string;
  tellSending: boolean;
  onPrimaryAction: (item: EmailPageItem) => void;
  onToggleTell: (itemId: string, open: boolean) => void;
  onTellChange: (itemId: string, value: string) => void;
  onTellSubmit: (item: EmailPageItem) => void;
}) {
  const { t, tPlural } = useI18n();
  const thread = item.threads?.[0];
  const sectionTitleKey = SECTION_ORDER.find((entry) => entry.key === item.section)?.titleKey;
  const time = formatWhen(item.mailAt ?? item.at, locale);
  const inlineTell = !item.action && item.section === "needs_you";
  const showTellBox = (inlineTell || tellOpen) && !pending;
  const metaParts: { key: string; text: string; strong?: boolean }[] = [];
  if (item.from) metaParts.push({ key: "from", text: item.from, strong: true });
  if (accountsCount > 1 && thread?.account) metaParts.push({ key: "account", text: thread.account });
  if (item.count && item.count > 1) metaParts.push({ key: "count", text: tPlural("email.brief.emails", item.count) });
  if (time) metaParts.push({ key: "time", text: time });

  return (
    <article className="email-stage__inner" data-testid={`email-detail-${item.id}`}>
      <div className="email-detail__eyebrow">
        <span className="email-detail__context">
          {item.urgent ? (
            <>
              <span className="email-urgent-dot" aria-hidden="true" />
              <span className="email-detail__urgent-label">{t("email.section.urgent")}</span>
              <span className="email-bar__sep" aria-hidden="true">·</span>
            </>
          ) : null}
          <span>{sectionTitleKey ? t(sectionTitleKey) : ""}</span>
        </span>
        {thread ? (
          <button
            type="button"
            className="email-detail__gmail"
            onClick={() => openExternalUrl(gmailThreadUrl(thread))}
          >
            <span>{t("email.section.openInGmail")}</span>
            <ExternalLink size={12} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <h2 className="email-detail__title">{item.title}</h2>

      {metaParts.length > 0 ? (
        <div className="email-detail__meta">
          {metaParts.map((part, index) => (
            <Fragment key={part.key}>
              {index > 0 ? (
                <span className="email-bar__sep" aria-hidden="true">·</span>
              ) : null}
              <span className={part.strong ? "email-detail__from" : undefined}>{part.text}</span>
            </Fragment>
          ))}
        </div>
      ) : null}

      <hr className="email-detail__divider" />

      <p className="email-detail__gist">{item.gist}</p>
      {item.detail ? <EmailRichText text={item.detail} /> : null}

      {item.draft ? (
        <div className="email-draft">
          <div className="email-draft__head">
            <span className="email-draft__label">
              <Reply size={13} strokeWidth={1.9} aria-hidden="true" />
              <span>{t("email.workspace.draft.label")}</span>
            </span>
            {item.from ? (
              <span className="email-draft__to">{t("email.reply.to", { to: item.from })}</span>
            ) : null}
          </div>
          <div className="email-draft__body">{item.draft}</div>
          {!pending && (item.action || !inlineTell) ? (
            <div className="email-draft__foot">
              {item.action ? (
                <button
                  type="button"
                  className={
                    item.section === "handled"
                      ? "email-btn email-btn--secondary email-btn--compact"
                      : "email-btn email-btn--primary email-btn--compact"
                  }
                  onClick={() => onPrimaryAction(item)}
                >
                  {item.section === "handled" ? (
                    <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
                  ) : null}
                  <span>{item.action}</span>
                </button>
              ) : null}
              {!inlineTell ? (
                <button
                  type="button"
                  className="email-btn email-btn--secondary email-btn--compact"
                  aria-expanded={tellOpen}
                  onClick={() => onToggleTell(item.id, !tellOpen)}
                >
                  <MessageSquare size={12} strokeWidth={1.9} aria-hidden="true" />
                  <span>{t("email.workspace.tell.action")}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <div className="email-pending" role="status">
          <RefreshCw size={13} strokeWidth={2} className="email-spin" aria-hidden="true" />
          <span>{t(PENDING_LABEL_KEY[pending])}</span>
        </div>
      ) : (
        <>
          {!item.draft && (item.action || !inlineTell) ? (
            <div className="email-actions">
              {item.action ? (
                <button
                  type="button"
                  className={
                    item.section === "handled"
                      ? "email-btn email-btn--secondary"
                      : "email-btn email-btn--primary"
                  }
                  onClick={() => onPrimaryAction(item)}
                >
                  {item.section === "handled" ? (
                    <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
                  ) : null}
                  <span>{item.action}</span>
                </button>
              ) : null}
              {!inlineTell ? (
                <button
                  type="button"
                  className="email-btn email-btn--secondary"
                  aria-expanded={tellOpen}
                  onClick={() => onToggleTell(item.id, !tellOpen)}
                >
                  <MessageSquare size={13} strokeWidth={1.9} aria-hidden="true" />
                  <span>{t("email.workspace.tell.action")}</span>
                </button>
              ) : null}
            </div>
          ) : null}

          {showTellBox ? (
            <TellStellaComposer
              item={item}
              value={tellDraft}
              submitting={tellSending}
              canCancel={!inlineTell}
              autoFocus={!inlineTell}
              onChange={(next) => onTellChange(item.id, next)}
              onSubmit={() => onTellSubmit(item)}
              onCancel={() => onToggleTell(item.id, false)}
            />
          ) : null}
        </>
      )}
    </article>
  );
}

function EmailIgnoredView({ ignored }: { ignored: EmailPageIgnored }) {
  const { t, tPlural } = useI18n();
  const senders = ignored.senders ?? [];
  return (
    <div className="email-stage__inner" data-testid="email-ignored-view">
      <div className="email-detail__eyebrow">
        <span className="email-detail__context">{t("email.workspace.ignored.eyebrow")}</span>
      </div>
      <h2 className="email-detail__title">
        {tPlural("email.workspace.ignored.count", ignored.count)}
      </h2>
      {ignored.gist ? <p className="email-detail__meta">{ignored.gist}</p> : null}
      {senders.length > 0 ? (
        <ul className="email-senders">
          {senders.map((sender) => (
            <li key={sender.name} className="email-senders__row">
              <span className="email-senders__name">{sender.name}</span>
              <span className="email-senders__count">{sender.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="email-footnote">
        {t("email.workspace.ignored.hint")}
      </p>
    </div>
  );
}

function EmailSettingsView({
  state,
  locale,
  showBack,
  removingRuleId,
  turningOff,
  onBack,
  onRemoveRule,
  onTurnOff,
}: {
  state: EmailPageState;
  locale: string;
  showBack: boolean;
  removingRuleId: string | null;
  turningOff: boolean;
  onBack: () => void;
  onRemoveRule: (ruleId: string) => void;
  onTurnOff: () => void;
}) {
  const { t } = useI18n();
  const [confirmOff, setConfirmOff] = useState(false);
  const rules = state.rules ?? [];

  return (
    <div className="email-stage__inner" data-testid="email-settings-view">
      <div className="email-settings__head">
        <h2 className="email-settings__title">{t("email.workspace.rules.settingsTitle")}</h2>
        {showBack ? (
          <button type="button" className="email-btn email-btn--ghost" onClick={onBack}>
            <ArrowLeft size={13} strokeWidth={2} aria-hidden="true" />
            <span>{t("common.back")}</span>
          </button>
        ) : null}
      </div>

      <section className="email-settings__group">
        <h3 className="email-settings__group-title">{t("email.workspace.rules.yours")}</h3>
        {rules.length > 0 ? (
          <ul className="email-settings__list">
            {rules.map((rule) => {
              const removing = removingRuleId === rule.ruleId;
              return (
                <li key={rule.ruleId} className="email-settings__row">
                  <div className="email-settings__row-copy">
                    <span className="email-settings__row-main">{rule.text}</span>
                    <span className="email-settings__row-sub">
                      {RULE_KIND_LABEL_KEY[rule.kind] ? t(RULE_KIND_LABEL_KEY[rule.kind]) : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="email-btn email-btn--ghost"
                    disabled={removing}
                    onClick={() => onRemoveRule(rule.ruleId)}
                  >
                    {removing ? t("global.schedule.removing") : t("email.section.remove")}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="email-footnote">
          {t("email.workspace.rules.hint")}
        </p>
      </section>

      <section className="email-settings__group">
        <h3 className="email-settings__group-title">{t("email.workspace.inboxes.title")}</h3>
        <ul className="email-settings__list">
          {state.accounts.map((account) => (
            <li key={account} className="email-settings__row">
              <span className="email-settings__account">
                <Mail size={14} strokeWidth={1.85} className="email-settings__account-icon" aria-hidden="true" />
                <span>{account}</span>
              </span>
              <span className="email-settings__row-value">{t("email.workspace.inboxes.reading")}</span>
            </li>
          ))}
          {state.nextReadAt ? (
            <li className="email-settings__row">
              <div className="email-settings__row-copy">
                <span className="email-settings__row-main">{t("email.workspace.nextCheck.title")}</span>
                <span className="email-settings__row-sub">
                  {t("email.workspace.nextCheck.hint")}
                </span>
              </div>
              <span className="email-settings__row-value">{formatWhen(state.nextReadAt, locale)}</span>
            </li>
          ) : null}
        </ul>
      </section>

      <section className="email-settings__group">
        <h3 className="email-settings__group-title">{t("email.workspace.automation")}</h3>
        <ul className="email-settings__list">
          <li className="email-settings__row">
            <div className="email-settings__row-copy">
              <span className="email-settings__row-main">{t("email.workspace.off.title")}</span>
              <span className="email-settings__row-sub">
                {t("email.workspace.off.body")}
              </span>
            </div>
            {confirmOff ? (
              <div className="email-settings__confirm">
                <button
                  type="button"
                  className="email-btn email-btn--ghost"
                  disabled={turningOff}
                  onClick={() => setConfirmOff(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="email-btn email-btn--danger email-btn--compact"
                  disabled={turningOff}
                  onClick={onTurnOff}
                >
                  {turningOff ? t("email.workspace.off.working") : t("email.section.turnOff")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="email-btn email-btn--secondary email-btn--compact"
                onClick={() => setConfirmOff(true)}
              >
                {t("email.section.turnOff")}
              </button>
            )}
          </li>
        </ul>
      </section>
    </div>
  );
}

function EmailWorkspace({ state }: { state: EmailPageState }) {
  const { locale, t, tPlural } = useI18n();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [expandedCompact, setExpandedCompact] = useState<Record<string, boolean>>({});
  const [tellingOpen, setTellingOpen] = useState<Record<string, boolean>>({});
  const [tellDrafts, setTellDrafts] = useState<Record<string, string>>({});
  const [tellSending, setTellSending] = useState<Record<string, boolean>>({});
  const [pendingById, setPendingById] = useState<Record<string, PendingKind>>({});
  const [checking, setChecking] = useState(false);
  const [compactIgnoredOpen, setCompactIgnoredOpen] = useState(false);
  const [removingRuleId, setRemovingRuleId] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const lastReadAtRef = useRef<number | undefined>(state.page.readAt);
  const lastItemAtRef = useRef<Map<string, number>>(new Map());

  const grouped = useMemo(
    () =>
      SECTION_ORDER.map((section) => ({
        ...section,
        items: sortItems(state.page.items, section.key),
      })),
    [state.page.items],
  );

  const flatItems = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);
  const needsYouCount = grouped[0]?.items.length ?? 0;
  const hasIgnored = state.page.ignored.count > 0;

  useEffect(() => {
    if (state.page.readAt !== lastReadAtRef.current) {
      lastReadAtRef.current = state.page.readAt;
      setChecking(false);
    }
  }, [state.page.readAt]);

  useEffect(() => {
    const prev = lastItemAtRef.current;
    const next = new Map(state.page.items.map((item) => [item.id, item.at] as const));
    if (prev.size > 0) {
      setPendingById((current) => {
        let changed = false;
        const updated = { ...current };
        for (const id of Object.keys(current)) {
          const nextAt = next.get(id);
          if (nextAt === undefined || prev.get(id) !== nextAt) {
            delete updated[id];
            changed = true;
          }
        }
        return changed ? updated : current;
      });
    }
    lastItemAtRef.current = next;
  }, [state.page.items]);

  const activeSelection = useMemo<Selection | null>(() => {
    if (selection?.kind === "settings") return selection;
    if (selection?.kind === "ignored") return hasIgnored ? selection : null;
    if (selection?.kind === "item" && flatItems.some((item) => item.id === selection.id)) {
      return selection;
    }
    if (flatItems.length > 0) return { kind: "item", id: flatItems[0]!.id };
    if (hasIgnored) return { kind: "ignored" };
    return null;
  }, [selection, flatItems, hasIgnored]);

  const selectedItem =
    activeSelection?.kind === "item"
      ? flatItems.find((item) => item.id === activeSelection.id) ?? null
      : null;

  const sendAction = useCallback(async (event: CanvasActionEvent): Promise<boolean> => {
    return sendCanvasActionToChat(event);
  }, []);

  const handleCheckNow = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    const sent = await sendAction({
      canvas: EMAIL_PAGE_CANVAS,
      title: t("email.title"),
      id: EMAIL_PAGE_CHECK_ACTION,
      label: t("email.workspace.request.check"),
    });
    if (!sent) {
      setChecking(false);
      return;
    }
    window.setTimeout(() => setChecking(false), 12_000);
  }, [checking, sendAction, t]);

  const handlePrimaryAction = useCallback(
    async (item: EmailPageItem) => {
      if (!item.action || pendingById[item.id]) return;
      const prefix = item.section === "handled" ? "undo" : "do";
      setPendingById((prev) => ({ ...prev, [item.id]: "working" }));
      const sent = await sendAction({
        canvas: EMAIL_PAGE_CANVAS,
        title: t("email.title"),
        id: `${prefix}:${item.id}`,
        label: `${item.action}: ${item.title}`,
      });
      if (!sent) {
        setPendingById((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      }
    },
    [pendingById, sendAction, t],
  );

  const handleTellSubmit = useCallback(
    async (item: EmailPageItem) => {
      const text = (tellDrafts[item.id] ?? "").trim();
      if (!text || tellSending[item.id]) return;
      setTellSending((prev) => ({ ...prev, [item.id]: true }));
      const sent = await sendAction({
        canvas: EMAIL_PAGE_CANVAS,
        title: t("email.title"),
        id: `tell:${item.id}`,
        label: t("email.workspace.request.about", { title: item.title }),
        fields: { text },
      });
      setTellSending((prev) => ({ ...prev, [item.id]: false }));
      if (sent) {
        setTellDrafts((prev) => ({ ...prev, [item.id]: "" }));
        setTellingOpen((prev) => ({ ...prev, [item.id]: false }));
        setPendingById((prev) => ({ ...prev, [item.id]: "sent" }));
      }
    },
    [sendAction, t, tellDrafts, tellSending],
  );

  const handleRemoveRule = useCallback(async (ruleId: string) => {
    setRemovingRuleId(ruleId);
    try {
      await backendClient.call("email.tool", { action: "rules", op: "remove", rule: ruleId });
    } finally {
      setRemovingRuleId((current) => (current === ruleId ? null : current));
    }
  }, []);

  const handleTurnOff = useCallback(async () => {
    setTurningOff(true);
    try {
      await backendClient.call("email.setEnabled", { enabled: false });
    } finally {
      setTurningOff(false);
    }
  }, []);

  const handleKeyNav = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (flatItems.length === 0) return;
      event.preventDefault();
      const index =
        activeSelection?.kind === "item"
          ? flatItems.findIndex((item) => item.id === activeSelection.id)
          : -1;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        index < 0 ? 0 : Math.max(0, Math.min(flatItems.length - 1, index + delta));
      const nextItem = flatItems[nextIndex];
      if (nextItem) setSelection({ kind: "item", id: nextItem.id });
    },
    [activeSelection, flatItems],
  );

  const toggleSettings = useCallback(() => {
    setSelection((current) => {
      if (current?.kind === "settings") {
        return flatItems[0] ? { kind: "item", id: flatItems[0].id } : null;
      }
      return { kind: "settings" };
    });
  }, [flatItems]);

  const settingsOpen = activeSelection?.kind === "settings";
  const summaryLabel =
    needsYouCount > 0
      ? tPlural("email.card.needYou", needsYouCount)
      : state.page.readAt
        ? t("email.workspace.summary.caughtUp")
        : t("email.workspace.summary.waitingFirstRead");
  const readLabel = state.page.readAt
    ? t("email.workspace.summary.readAt", { time: formatWhen(state.page.readAt, locale) })
    : t("email.workspace.summary.notRead");
  const rulesCount = state.rules.length;

  return (
    <div
      className="email-workspace"
      data-testid="email-section"
      onKeyDown={handleKeyNav}
    >
      <header className="email-bar">
        <div className="email-bar__summary">
          <span className="email-bar__count">{summaryLabel}</span>
          <span className="email-bar__sep email-bar__sep--primary" aria-hidden="true">·</span>
          <span className="email-bar__sub">
            <span className="email-bar__meta">{readLabel}</span>
            {state.unread > 0 ? (
              <>
                <span className="email-bar__sep" aria-hidden="true">·</span>
                <span className="email-bar__meta">
                  {tPlural("email.workspace.summary.newSince", state.unread)}
                </span>
              </>
            ) : null}
            {state.accounts.length > 1 ? (
              <>
                <span className="email-bar__sep" aria-hidden="true">·</span>
                <span className="email-bar__meta">
                  {tPlural("email.workspace.inboxes.count", state.accounts.length)}
                </span>
              </>
            ) : null}
          </span>
        </div>
        <div className="email-bar__actions">
          <button
            type="button"
            className="email-bar__btn"
            disabled={checking}
            onClick={() => void handleCheckNow()}
          >
            <RefreshCw size={13} strokeWidth={1.9} className={checking ? "email-spin" : undefined} aria-hidden="true" />
            <span>{checking ? t("email.section.checking") : t("email.section.checkNow")}</span>
          </button>
          <button
            type="button"
            className="email-bar__btn"
            aria-pressed={settingsOpen}
            onClick={toggleSettings}
          >
            <SlidersHorizontal size={13} strokeWidth={1.9} aria-hidden="true" />
            <span>{t("email.workspace.rules.title")}</span>
            {rulesCount > 0 ? <span className="email-bar__btn-count">{rulesCount}</span> : null}
          </button>
        </div>
      </header>

      {flatItems.length === 0 && !settingsOpen ? (
        <div className="email-empty">
          <div className="email-empty__inner">
            <div className="email-empty__icon" aria-hidden="true">
              {state.page.readAt ? (
                <CheckCircle2 size={18} strokeWidth={1.75} />
              ) : (
                <Mail size={18} strokeWidth={1.75} />
              )}
            </div>
            <h2 className="email-empty__title">
              {state.page.readAt
                ? t("email.workspace.empty.caughtUpTitle")
                : t("email.workspace.empty.firstReadTitle")}
            </h2>
            <p className="email-empty__body">
              {state.page.readAt
                ? state.nextReadAt
                  ? t("email.workspace.empty.caughtUpNext", { time: formatWhen(state.nextReadAt, locale) })
                  : t("email.workspace.empty.caughtUpUrgent")
                : t("email.workspace.empty.firstReadBody")}
            </p>
            <div className="email-empty__actions">
              <button
                type="button"
                className="email-btn email-btn--secondary"
                disabled={checking}
                onClick={() => void handleCheckNow()}
              >
                <RefreshCw size={13} strokeWidth={1.9} className={checking ? "email-spin" : undefined} aria-hidden="true" />
                <span>{checking ? t("email.section.checking") : t("email.section.checkNow")}</span>
              </button>
            </div>
            {hasIgnored ? (
              <div className="email-empty__ignored">
                <button
                  type="button"
                  className="email-compact__ignored-toggle"
                  aria-expanded={compactIgnoredOpen}
                  onClick={() => setCompactIgnoredOpen((open) => !open)}
                >
                  <span>
                    {tPlural("email.workspace.ignored.count", state.page.ignored.count)}
                  </span>
                  {compactIgnoredOpen ? (
                    <ChevronDown size={14} strokeWidth={1.9} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={14} strokeWidth={1.9} aria-hidden="true" />
                  )}
                </button>
                {compactIgnoredOpen ? (
                  <>
                    {state.page.ignored.gist ? (
                      <p className="email-compact__meta">{state.page.ignored.gist}</p>
                    ) : null}
                    {state.page.ignored.senders?.length ? (
                      <ul className="email-senders">
                        {state.page.ignored.senders.map((sender) => (
                          <li key={sender.name} className="email-senders__row">
                            <span className="email-senders__name">{sender.name}</span>
                            <span className="email-senders__count">{sender.count}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="email-split">
            <aside className="email-rail" aria-label={t("email.workspace.a11y.list")}>
              <div className="email-rail__scroll" role="listbox" aria-label={t("email.workspace.a11y.items")}>
                {grouped.map((group) => {
                  if (group.items.length === 0 && group.key !== "needs_you") return null;
                  return (
                    <section key={group.key} className="email-rail__section">
                      <h3 className="email-rail__heading">
                        <span>{t(group.titleKey)}</span>
                        {group.items.length > 0 ? (
                          <span className="email-rail__heading-count">{group.items.length}</span>
                        ) : null}
                      </h3>
                      {group.items.length === 0 ? (
                        <p className="email-rail__empty-note">{t("email.workspace.empty.caughtUpTitle")}</p>
                      ) : (
                        <ul className="email-rail__list">
                          {group.items.map((item) => {
                            const selected =
                              activeSelection?.kind === "item" && activeSelection.id === item.id;
                            const pending = pendingById[item.id];
                            const time = formatWhen(item.mailAt ?? item.at, locale);
                            const fromLabel = item.from
                              ? item.count && item.count > 1
                                ? `${item.from} · ${item.count}`
                                : item.from
                              : item.count && item.count > 1
                                ? tPlural("email.brief.emails", item.count)
                                : "";
                            return (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  className="email-rail__row"
                                  data-section={item.section}
                                  data-selected={selected ? "true" : undefined}
                                  data-testid={`email-row-${item.id}`}
                                  onClick={() => setSelection({ kind: "item", id: item.id })}
                                >
                                  <div className="email-rail__row-top">
                                    {item.urgent ? (
                                      <span className="email-urgent-dot" aria-label={t("email.section.urgent")} />
                                    ) : null}
                                    <span className="email-rail__title">{item.title}</span>
                                    {time ? <span className="email-rail__time">{time}</span> : null}
                                  </div>
                                  <div className="email-rail__meta">
                                    <span className="email-rail__from">{fromLabel}</span>
                                    {pending ? (
                                      <span className="email-rail__cue email-rail__cue--pending">
                                        {t("email.workspace.onIt")}
                                      </span>
                                    ) : item.draft ? (
                                      <span className="email-rail__cue">
                                        <Reply size={11} strokeWidth={1.9} aria-hidden="true" />
                                        <span>{t("email.brief.draft")}</span>
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="email-rail__gist">{item.gist}</p>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  );
                })}

              </div>

              {hasIgnored || state.nextReadAt ? (
                <div className="email-rail__foot">
                  {hasIgnored ? (
                    <button
                      type="button"
                      className="email-rail__foot-ignored"
                      data-selected={activeSelection?.kind === "ignored" ? "true" : undefined}
                      data-testid="email-ignored-trigger"
                      onClick={() => setSelection({ kind: "ignored" })}
                    >
                      <span>
                        {t("email.workspace.ignored.short", { count: state.page.ignored.count })}
                      </span>
                      <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ) : null}
                  {state.nextReadAt ? (
                    <span className="email-rail__foot-next">
                      <Clock size={11.5} strokeWidth={1.85} aria-hidden="true" />
                      <span>
                        {t("email.workspace.nextCheck.short", {
                          time: formatWhen(state.nextReadAt, locale),
                        })}
                      </span>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </aside>

            <main className="email-stage">
              {settingsOpen ? (
                <EmailSettingsView
                  state={state}
                  locale={locale}
                  showBack={flatItems.length > 0}
                  removingRuleId={removingRuleId}
                  turningOff={turningOff}
                  onBack={toggleSettings}
                  onRemoveRule={(ruleId) => void handleRemoveRule(ruleId)}
                  onTurnOff={() => void handleTurnOff()}
                />
              ) : activeSelection?.kind === "ignored" ? (
                <EmailIgnoredView ignored={state.page.ignored} />
              ) : selectedItem ? (
                <EmailDetailView
                  item={selectedItem}
                  accountsCount={state.accounts.length}
                  locale={locale}
                  pending={pendingById[selectedItem.id]}
                  tellOpen={Boolean(tellingOpen[selectedItem.id])}
                  tellDraft={tellDrafts[selectedItem.id] ?? ""}
                  tellSending={Boolean(tellSending[selectedItem.id])}
                  onPrimaryAction={(item) => void handlePrimaryAction(item)}
                  onToggleTell={(id, open) =>
                    setTellingOpen((prev) => ({ ...prev, [id]: open }))
                  }
                  onTellChange={(id, value) =>
                    setTellDrafts((prev) => ({ ...prev, [id]: value }))
                  }
                  onTellSubmit={(item) => void handleTellSubmit(item)}
                />
              ) : null}
            </main>
          </div>

          <div className="email-compact">
            {settingsOpen ? (
              <div className="email-compact__inner">
                <EmailSettingsView
                  state={state}
                  locale={locale}
                  showBack
                  removingRuleId={removingRuleId}
                  turningOff={turningOff}
                  onBack={toggleSettings}
                  onRemoveRule={(ruleId) => void handleRemoveRule(ruleId)}
                  onTurnOff={() => void handleTurnOff()}
                />
              </div>
            ) : (
              <div className="email-compact__inner">
                {grouped.map((group) => {
                  if (group.items.length === 0 && group.key !== "needs_you") return null;
                  return (
                    <section key={group.key} className="email-compact__section">
                      <h3 className="email-compact__heading">
                        <span>{t(group.titleKey)}</span>
                        {group.items.length > 0 ? (
                          <span className="email-compact__heading-count">
                            {group.items.length}
                          </span>
                        ) : null}
                      </h3>
                      {group.items.length === 0 ? (
                        <p className="email-compact__meta">{t("email.workspace.empty.caughtUpTitle")}</p>
                      ) : (
                        group.items.map((item) => {
                          const hasMore = Boolean(item.detail || item.draft);
                          const open = Boolean(expandedCompact[item.id]);
                          const pending = pendingById[item.id];
                          const thread = item.threads?.[0];
                          const time = formatWhen(item.mailAt ?? item.at, locale);
                          const meta: string[] = [];
                          if (item.from) meta.push(item.from);
                          if (item.count && item.count > 1) meta.push(tPlural("email.brief.emails", item.count));
                          if (state.accounts.length > 1 && thread?.account) meta.push(thread.account);
                          const emphasizeAction = Boolean(item.urgent || (open && item.draft));

                          return (
                            <article
                              key={item.id}
                              className="email-compact__item"
                              data-section={item.section}
                            >
                              <div className="email-compact__item-head">
                                {item.urgent ? (
                                  <span className="email-urgent-dot" aria-label={t("email.section.urgent")} />
                                ) : null}
                                <h4 className="email-compact__title">{item.title}</h4>
                                {time ? <span className="email-compact__time">{time}</span> : null}
                              </div>
                              {meta.length > 0 ? (
                                <p className="email-compact__meta">{meta.join(" · ")}</p>
                              ) : null}
                              <p className="email-compact__gist">{item.gist}</p>

                              {hasMore && open ? (
                                <>
                                  {item.detail ? <EmailRichText text={item.detail} /> : null}
                                  {item.draft ? (
                                    <div className="email-draft">
                                      <div className="email-draft__head">
                                        <span className="email-draft__label">
                                          <Reply size={13} strokeWidth={1.9} aria-hidden="true" />
                                          <span>{t("email.workspace.draft.label")}</span>
                                        </span>
                                        {item.from ? (
                                          <span className="email-draft__to">
                                            {t("email.reply.to", { to: item.from })}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="email-draft__body">{item.draft}</div>
                                    </div>
                                  ) : null}
                                </>
                              ) : null}

                              {pending ? (
                                <div className="email-pending" role="status">
                                  <RefreshCw
                                    size={13}
                                    strokeWidth={2}
                                    className="email-spin"
                                    aria-hidden="true"
                                  />
                                  <span>{t(PENDING_LABEL_KEY[pending])}</span>
                                </div>
                              ) : (
                                <>
                                  <div className="email-compact__actions">
                                    {item.action ? (
                                      <button
                                        type="button"
                                        className={
                                          item.section === "handled"
                                            ? "email-btn email-btn--secondary email-btn--compact"
                                            : emphasizeAction
                                              ? "email-btn email-btn--primary email-btn--compact"
                                              : "email-btn email-btn--tonal email-btn--compact"
                                        }
                                        onClick={() => void handlePrimaryAction(item)}
                                      >
                                        {item.section === "handled" ? (
                                          <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
                                        ) : null}
                                        <span>{item.action}</span>
                                      </button>
                                    ) : null}
                                    {hasMore ? (
                                      <button
                                        type="button"
                                        className="email-btn email-btn--ghost"
                                        aria-expanded={open}
                                        onClick={() =>
                                          setExpandedCompact((prev) => ({
                                            ...prev,
                                            [item.id]: !open,
                                          }))
                                        }
                                      >
                                        <span>
                                          {open
                                            ? t("email.brief.hide")
                                            : item.draft
                                              ? t("email.workspace.draft.read")
                                              : t("email.workspace.details")}
                                        </span>
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="email-btn email-btn--ghost"
                                      aria-expanded={Boolean(tellingOpen[item.id])}
                                      onClick={() =>
                                        setTellingOpen((prev) => ({
                                          ...prev,
                                          [item.id]: !prev[item.id],
                                        }))
                                      }
                                    >
                                      <span>{t("email.workspace.tell.action")}</span>
                                    </button>
                                    {thread ? (
                                      <button
                                        type="button"
                                        className="email-btn email-btn--ghost email-compact__gmail"
                                        onClick={() => openExternalUrl(gmailThreadUrl(thread))}
                                      >
                                        <span>Gmail</span>
                                        <ExternalLink size={11} strokeWidth={1.9} aria-hidden="true" />
                                      </button>
                                    ) : null}
                                  </div>

                                  {tellingOpen[item.id] ? (
                                    <TellStellaComposer
                                      item={item}
                                      value={tellDrafts[item.id] ?? ""}
                                      submitting={Boolean(tellSending[item.id])}
                                      canCancel
                                      autoFocus
                                      onChange={(next) =>
                                        setTellDrafts((prev) => ({ ...prev, [item.id]: next }))
                                      }
                                      onSubmit={() => void handleTellSubmit(item)}
                                      onCancel={() =>
                                        setTellingOpen((prev) => ({ ...prev, [item.id]: false }))
                                      }
                                    />
                                  ) : null}
                                </>
                              )}
                            </article>
                          );
                        })
                      )}
                    </section>
                  );
                })}

                {hasIgnored ? (
                  <div className="email-compact__ignored">
                    <button
                      type="button"
                      className="email-compact__ignored-toggle"
                      aria-expanded={compactIgnoredOpen}
                      onClick={() => setCompactIgnoredOpen((open) => !open)}
                    >
                      <span>
                        {tPlural("email.workspace.ignored.count", state.page.ignored.count)}
                      </span>
                      {compactIgnoredOpen ? (
                        <ChevronDown size={14} strokeWidth={1.9} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={14} strokeWidth={1.9} aria-hidden="true" />
                      )}
                    </button>
                    {compactIgnoredOpen ? (
                      <>
                        {state.page.ignored.gist ? (
                          <p className="email-compact__meta">{state.page.ignored.gist}</p>
                        ) : null}
                        {state.page.ignored.senders?.length ? (
                          <ul className="email-senders">
                            {state.page.ignored.senders.map((sender) => (
                              <li key={sender.name} className="email-senders__row">
                                <span className="email-senders__name">{sender.name}</span>
                                <span className="email-senders__count">{sender.count}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}

                {state.nextReadAt ? (
                  <p className="email-compact__foot">
                    {t("email.workspace.nextCheck.at", { time: formatWhen(state.nextReadAt, locale) })}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function EmailSection({ active }: { active: boolean }) {
  return useEmailFeature() ? <EmailSectionBody active={active} /> : null;
}

function EmailSectionBody({ active: selected }: { active: boolean }) {
  const panelOpen = useDisplayPanelOpen();
  const active = selected && panelOpen;
  const { t } = useI18n();
  const [seen, setSeen] = useState(active);
  const [connecting, setConnecting] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [turnOnFailed, setTurnOnFailed] = useState(false);
  const [turningOn, setTurningOn] = useState(false);
  const { hasConnectedAccount } = useAuthSessionState();
  const feed = useBackendView("email.page", seen && hasConnectedAccount ? {} : "skip");

  useEffect(() => {
    if (active) setSeen(true);
  }, [active]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectFailed(false);
    try {
      const { url } = await backendClient.call("integrations.connectLink", { id: "gmail" });
      openExternalUrl(url);
    } catch {
      setConnectFailed(true);
      setConnecting(false);
    }
  }, []);

  const turnOn = useCallback(async () => {
    setTurningOn(true);
    setTurnOnFailed(false);
    try {
      await backendClient.call("email.setEnabled", { enabled: true });
    } catch {
      setTurnOnFailed(true);
    } finally {
      setTurningOn(false);
    }
  }, []);

  const value = feed.value;
  const hasAccounts = (value?.gmailConnected.length ?? 0) > 0;

  useEffect(() => {
    if (active && value) markEmailSeen();
  }, [active, value]);

  useEffect(() => {
    if (hasAccounts) setConnecting(false);
  }, [hasAccounts]);

  if (!hasConnectedAccount) {
    return (
      <EmptyState
        motif="mail"
        title={t("email.section.connectTitle")}
        body={t("email.section.connectBody")}
        detail={t("global.localMode.needsAccount")}
        action={{ label: t("common.signIn"), icon: LogIn, onClick: SIGN_IN_TOAST_ACTION.onClick }}
      />
    );
  }

  if (!value) {
    if (feed.status === "error" && feed.error.code !== "UNAUTHENTICATED") {
      return (
        <EmptyState
          motif="mail"
          title={t("email.section.loadErrorTitle")}
          body={t("email.section.loadErrorBody")}
        />
      );
    }
    return <div className="email-workspace email-workspace--loading" aria-busy="true" />;
  }

  if (!hasAccounts) {
    const reconnect = value.needsReconnect;
    return (
      <EmptyState
        motif="mail"
        title={reconnect ? t("email.section.reconnectTitle") : t("email.section.connectTitle")}
        body={reconnect ? t("email.section.reconnectBody") : t("email.section.connectBody")}
        detail={connectFailed ? t("email.section.connectError") : undefined}
        action={{
          label: connecting
            ? t("email.section.connecting")
            : reconnect
              ? t("email.section.reconnect")
              : t("email.section.connect"),
          icon: Mail,
          onClick: () => void connect(),
        }}
      />
    );
  }

  if (!value.enabled) {
    return (
      <EmptyState
        motif="mail"
        title={t("email.section.offTitle")}
        body={t("email.section.offBody")}
        detail={turnOnFailed ? t("email.failed") : undefined}
        action={{
          label: turningOn ? t("email.section.turningOn") : t("email.section.turnOn"),
          onClick: () => {
            if (!turningOn) void turnOn();
          },
        }}
      />
    );
  }

  return <EmailWorkspace state={value} />;
}
