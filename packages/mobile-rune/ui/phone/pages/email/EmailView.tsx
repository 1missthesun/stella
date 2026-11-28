import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EmailPageState } from "@stella/contracts/backend/email";
import { canvasActionMessage, type CanvasActionEvent } from "@stella/contracts/canvas-actions";
import { EMAIL_PAGE_CANVAS, EMAIL_PAGE_CHECK_ACTION, type EmailPageItem, type EmailPageSection } from "@stella/contracts/email-page";
import { useLocale, useT, useTPlural } from "@/shared/i18n";
import { STELLA_SEND_MESSAGE_EVENT, type StellaSendMessageDetail } from "@/shared/lib/stella-send-message";
import { Icon } from "../../../../../desktop-rune/ui/kit";
import { glyph } from "../../icons";
import { GUTTER } from "../../rn";
import { EmailItem, type EmailItemHandlers, type PendingKind } from "./EmailItem";
import { EmailSettings } from "./EmailSettings";
import { Btn, formatWhen, HAIR, T, tapLight, useEmailColors } from "./kit";

const SECTION_ORDER: readonly { key: EmailPageSection; titleKey: string }[] = [
  { key: "needs_you", titleKey: "email.section.needsYou" },
  { key: "waiting", titleKey: "email.workspace.sections.waiting" },
  { key: "handled", titleKey: "email.workspace.sections.handled" },
];

/** MainDetailSurface's top padding plus EmailPage's scrollContent paddingTop. */
const TOP = 4 + 6;

const sortItems = (items: readonly EmailPageItem[], section: EmailPageSection): EmailPageItem[] =>
  items.filter((item) => item.section === section).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.at - a.at);

/** packages/mobile's sendToChat: the action as a message in the chat, true once the chat took it. */
const sendToChat = (event: CanvasActionEvent): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const done = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      resolve(accepted);
    };
    window.dispatchEvent(new CustomEvent<StellaSendMessageDetail>(STELLA_SEND_MESSAGE_EVENT, { detail: { text: canvasActionMessage(event), onResult: done } }));
    setTimeout(() => done(false), 15_000);
  });

const without = <V,>(record: Record<string, V>, id: string): Record<string, V> => {
  if (!(id in record)) return record;
  const next = { ...record };
  delete next[id];
  return next;
};

/** packages/mobile's NativeEmailView. */
export function EmailView({ state, bottom }: { state: EmailPageState; bottom: number }) {
  const c = useEmailColors();
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tellingOpen, setTellingOpen] = useState<Record<string, boolean>>({});
  const [tellDrafts, setTellDrafts] = useState<Record<string, string>>({});
  const [tellSending, setTellSending] = useState<Record<string, boolean>>({});
  const [pendingById, setPendingById] = useState<Record<string, PendingKind>>({});
  const [checking, setChecking] = useState(false);
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const lastReadAtRef = useRef<number | undefined>(state.page.readAt);
  const lastItemAtRef = useRef<Map<string, number>>(new Map());
  const latest = useRef({ pendingById, tellDrafts, tellSending });
  latest.current = { pendingById, tellDrafts, tellSending };

  const grouped = useMemo(() => SECTION_ORDER.map((section) => ({ ...section, items: sortItems(state.page.items, section.key) })), [state.page.items]);
  const totalItems = state.page.items.length;
  const needsYouCount = grouped[0]?.items.length ?? 0;

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

  const sendAction = sendToChat;

  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
  }, []);
  const handleCheckNow = useCallback(async () => {
    if (checking) return;
    tapLight();
    setChecking(true);
    const sent = await sendAction({ canvas: EMAIL_PAGE_CANVAS, title: t("email.title"), id: EMAIL_PAGE_CHECK_ACTION, label: t("email.workspace.request.check") });
    if (!sent) {
      setChecking(false);
      return;
    }
    checkTimer.current = setTimeout(() => setChecking(false), 12_000);
  }, [checking, sendAction, t]);

  const handlers = useMemo<EmailItemHandlers>(
    () => ({
      toggleOpen: (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] })),
      toggleTell: (id) => setTellingOpen((prev) => ({ ...prev, [id]: !prev[id] })),
      closeTell: (id) => setTellingOpen((prev) => ({ ...prev, [id]: false })),
      setDraft: (id, text) => setTellDrafts((prev) => ({ ...prev, [id]: text })),
      primary: async (item) => {
        if (!item.action || latest.current.pendingById[item.id]) return;
        tapLight();
        const prefix = item.section === "handled" ? "undo" : "do";
        setPendingById((prev) => ({ ...prev, [item.id]: "working" }));
        const sent = await sendAction({ canvas: EMAIL_PAGE_CANVAS, title: t("email.title"), id: `${prefix}:${item.id}`, label: `${item.action}: ${item.title}` });
        if (!sent) setPendingById((prev) => without(prev, item.id));
      },
      submitTell: async (item) => {
        const text = (latest.current.tellDrafts[item.id] ?? "").trim();
        if (!text || latest.current.tellSending[item.id]) return;
        tapLight();
        setTellSending((prev) => ({ ...prev, [item.id]: true }));
        const sent = await sendAction({ canvas: EMAIL_PAGE_CANVAS, title: t("email.title"), id: `tell:${item.id}`, label: t("email.workspace.request.about", { title: item.title }), fields: { text } });
        setTellSending((prev) => ({ ...prev, [item.id]: false }));
        if (sent) {
          setTellDrafts((prev) => ({ ...prev, [item.id]: "" }));
          setTellingOpen((prev) => ({ ...prev, [item.id]: false }));
          setPendingById((prev) => ({ ...prev, [item.id]: "sent" }));
        }
      },
    }),
    [sendAction, t],
  );

  if (settingsOpen) {
    return (
      <EmailSettings
        state={state}
        bottom={bottom}
        onBack={() => {
          tapLight();
          setSettingsOpen(false);
        }}
      />
    );
  }

  const summaryLabel = needsYouCount > 0 ? tPlural("email.card.needYou", needsYouCount) : state.page.readAt ? t("email.workspace.summary.caughtUp") : t("email.workspace.summary.waitingFirstRead");
  const metaParts = [state.page.readAt ? t("email.workspace.summary.readAt", { time: formatWhen(state.page.readAt, locale) }) : t("email.workspace.summary.notRead")];
  if (state.unread > 0) metaParts.push(tPlural("email.workspace.summary.newSince", state.unread));
  if (state.accounts.length > 1) metaParts.push(tPlural("email.workspace.inboxes.count", state.accounts.length));
  const checkLabel = t("email.workspace.request.check");
  const ignored = state.page.ignored;

  return (
    <col id="phone-email" grow={1} minH={0} scrollY px={GUTTER} pt={TOP} pb={bottom + 36}>
      <row align="center" justify="between" gap={12} pb={14} borderSides={[0, 0, HAIR, 0]} border={c.borderWeak}>
        <col grow={1} minW={0} gap={2}>
          <text role="heading" {...T.topCount} color={c.textStrong}>
            {summaryLabel}
          </text>
          <text {...T.topMeta} color={c.textMuted} maxLines={1}>
            {metaParts.join(" · ")}
          </text>
        </col>
        <row align="center" gap={6} shrink={false}>
          <Btn
            id="phone-email-check"
            variant="header"
            label={checkLabel}
            text={checking ? t("email.section.checking") : t("email.workspace.check")}
            icon="arrow-clockwise"
            iconSize={14}
            iconColor={c.textMuted}
            disabled={checking}
            dim={checking}
            onPress={() => void handleCheckNow()}
          />
          <Btn
            id="phone-email-settings-open"
            variant="header"
            label={t("email.workspace.rules.settingsTitle")}
            icon="gear"
            iconSize={14}
            iconColor={c.textMuted}
            onPress={() => {
              tapLight();
              setSettingsOpen(true);
            }}
          >
            {state.rules.length > 0 ? (
              <text {...T.headerBtnCount} color={c.textMuted}>
                {String(state.rules.length)}
              </text>
            ) : null}
          </Btn>
        </row>
      </row>

      {totalItems === 0 ? (
        <col align="center" py={44} px={16}>
          <box w={44} h={44} radius={12} border={c.borderWeak} borderWidth={HAIR} fill={c.subtleFill} center mb={14}>
            <Icon icon={glyph(state.page.readAt ? "checkmark-circle" : "mail")} size={20} color={c.textMuted} />
          </box>
          <text role="heading" {...T.emptyTitle} color={c.textStrong} textAlign="center">
            {state.page.readAt ? t("email.workspace.empty.caughtUpTitle") : t("email.workspace.empty.firstReadTitle")}
          </text>
          <text {...T.emptyBody} mt={6} color={c.textMuted} textAlign="center" maxW={300}>
            {state.page.readAt ? (state.nextReadAt ? t("email.workspace.empty.caughtUpNext", { time: formatWhen(state.nextReadAt, locale) }) : t("email.workspace.empty.caughtUpUrgent")) : t("email.workspace.empty.firstReadBody")}
          </text>
          <col mt={18}>
            <Btn
              variant="secondary"
              label={checkLabel}
              text={checking ? t("email.section.checking") : t("email.section.checkNow")}
              icon="arrow-clockwise"
              iconSize={13}
              disabled={checking}
              onPress={() => void handleCheckNow()}
            />
          </col>
        </col>
      ) : (
        grouped.map((group) => {
          if (group.items.length === 0 && group.key !== "needs_you") return null;
          return (
            <col key={group.key} role="list" label={t(group.titleKey)} mt={22}>
              <row align="center" gap={7} mb={4}>
                <text role="heading" {...T.sectionHeading} color={c.textMuted}>
                  {t(group.titleKey)}
                </text>
                {group.items.length > 0 ? (
                  <text {...T.sectionCount} color={c.textWeaker}>
                    {String(group.items.length)}
                  </text>
                ) : null}
              </row>
              {group.items.length === 0 ? (
                <text {...T.quietLine} py={10} color={c.textWeaker}>
                  {t("email.workspace.empty.caughtUpTitle")}
                </text>
              ) : (
                group.items.map((item, idx) => (
                  <EmailItem
                    key={item.id}
                    item={item}
                    last={idx === group.items.length - 1}
                    open={Boolean(expanded[item.id])}
                    pending={pendingById[item.id]}
                    telling={Boolean(tellingOpen[item.id])}
                    draftText={tellDrafts[item.id] ?? ""}
                    sending={Boolean(tellSending[item.id])}
                    showAccount={state.accounts.length > 1}
                    on={handlers}
                  />
                ))
              )}
            </col>
          );
        })
      )}

      {ignored.count > 0 ? (
        <col mt={26} pt={14} borderSides={[HAIR, 0, 0, 0]} border={c.borderWeak}>
          <row
            role="button"
            label={tPlural("email.workspace.ignored.count", ignored.count)}
            expanded={ignoredOpen}
            focusable
            align="center"
            justify="between"
            py={6}
            pressScale={0.985}
            onPress={() => {
              tapLight();
              setIgnoredOpen((open) => !open);
            }}
          >
            <text {...T.ignoredLabel} color={c.textMuted}>
              {tPlural("email.workspace.ignored.count", ignored.count)}
            </text>
            <Icon icon={glyph(ignoredOpen ? "chevron-down" : "chevron-right")} size={15} color={c.textWeaker} />
          </row>
          {ignoredOpen ? (
            <col mt={6}>
              {ignored.gist ? (
                <text {...T.itemMeta} mt={3} color={c.textMuted}>
                  {ignored.gist}
                </text>
              ) : null}
              {ignored.senders?.length ? (
                <col role="list" mt={10} borderSides={[HAIR, 0, 0, 0]} border={c.borderWeak}>
                  {ignored.senders.map((sender) => (
                    <row key={sender.name} role="listitem" align="end" justify="between" gap={12} py={10} borderSides={[0, 0, HAIR, 0]} border={c.borderWeak}>
                      <text {...T.senderName} color={c.textStrong} shrink minW={0}>
                        {sender.name}
                      </text>
                      <text {...T.senderCount} color={c.textMuted} shrink={false}>
                        {String(sender.count)}
                      </text>
                    </row>
                  ))}
                </col>
              ) : null}
            </col>
          ) : null}
        </col>
      ) : null}

      {state.nextReadAt ? (
        <row align="center" gap={6} mt={22} pt={14} borderSides={[HAIR, 0, 0, 0]} border={c.borderWeak}>
          <Icon icon={glyph("clock")} size={12} color={c.textWeaker} />
          <text {...T.footerMetaText} color={c.textWeaker}>
            {t("email.workspace.nextCheck.at", { time: formatWhen(state.nextReadAt, locale) })}
          </text>
        </row>
      ) : null}
    </col>
  );
}
