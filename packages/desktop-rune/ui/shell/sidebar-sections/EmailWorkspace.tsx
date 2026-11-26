import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EmailPageState, EmailRuleKind } from "@stella/contracts/backend/email";
import type { CanvasActionEvent } from "@stella/contracts/canvas-actions";
import { EMAIL_PAGE_CANVAS, EMAIL_PAGE_CHECK_ACTION, gmailThreadUrl, type EmailPageIgnored, type EmailPageItem, type EmailPageSection } from "@stella/contracts/email-page";
import { backendClient } from "@/platform/backend/backend-client";
import { getPlatform } from "@/platform/electron/platform";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useI18n } from "@/shared/i18n";
import { sendCanvasActionToChat } from "@/shell/display/canvas-tab/use-canvas-actions";
import { Icon, Icons, type IconData } from "../../kit";
import { look, mixOklch, useTokens, type Tokens } from "../../theme";
import type { Run } from "../../../host/rune-jsx/props";

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

const TypingContext = createContext<(typing: boolean) => void>(() => {});

type Selection = { kind: "item"; id: string } | { kind: "ignored" } | { kind: "settings" };

const COMPACT_BELOW = 820;
const STACKED_SUMMARY_AT = 560;
const TNUM = "'tnum' 1";
const LH = 1.45;
const SPIN = 0.9;

/** Manrope's ascent (1.066 em) and descent (0.3 em): where a line's baseline sits, for CSS `align-items: baseline`. */
const baseline = (size: number, lh = LH) => size * (lh / 2 + 0.383);
const toBaseline = (size: number, of: number, lh = LH, ofLh = LH) => baseline(of, ofLh) - baseline(size, lh);

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
  items.filter((item) => item.section === section).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.at - a.at);

const quiet = (section: EmailPageSection) => section === "handled" || section === "waiting";

const line = (t: Tokens) => t.c.borderWeak;

function Sep({ size = 12, mt = 0 }: { size?: number; mt?: number }) {
  const t = useTokens();
  return (
    <text {...look(size, 400)} mt={mt} color={t.c.textWeaker} shrink={false} inert>
      ·
    </text>
  );
}

function UrgentDot({ mt, label }: { mt: number; label?: string }) {
  const t = useTokens();
  return <box w={6} h={6} mt={mt} radius={3} shrink={false} fill={t.c.primary} label={label} role={label ? "img" : undefined} />;
}

type EmailBtnVariant = "primary" | "tonal" | "secondary" | "ghost" | "danger" | "plain";

/** `.email-btn` with its `--primary`, `--tonal`, `--secondary`, `--ghost`, `--danger` and `--compact` forms. */
function EmailBtn({ id, variant, compact = false, disabled = false, expanded, icon, iconSize, iconStroke = 1.9, label, ml, sendDisabled = false, onPress }: { id?: string; variant: EmailBtnVariant; compact?: boolean; disabled?: boolean; expanded?: boolean; icon?: IconData; iconSize?: number; iconStroke?: number; label: string; ml?: number; sendDisabled?: boolean; onPress: () => void }) {
  const t = useTokens();
  const ghost = variant === "ghost";
  const small = compact || ghost;
  const weight = variant === "primary" || variant === "tonal" || variant === "danger" ? 600 : 500;
  const muted = sendDisabled && disabled;
  const fill = muted
    ? mixOklch(t.c.foreground, 7.5, "transparent")
    : variant === "primary"
      ? t.c.primary
      : variant === "tonal"
        ? mixOklch(t.c.foreground, 4.5, "transparent")
        : variant === "danger"
          ? mixOklch(t.c.destructive, 10, "transparent")
          : undefined;
  const border = variant === "tonal" || variant === "secondary" ? t.c.border : variant === "danger" ? mixOklch(t.c.destructive, 35, "transparent") : undefined;
  const color = muted
    ? t.c.textWeaker
    : variant === "primary"
      ? t.c.primaryForeground
      : variant === "tonal"
        ? t.c.textStrong
        : variant === "danger"
          ? t.c.destructive
          : ghost
            ? t.c.textWeak
            : t.c.textBase;
  const hover = disabled
    ? undefined
    : variant === "primary"
      ? mixOklch(t.c.foreground, 10, t.c.primary)
      : variant === "tonal"
        ? mixOklch(t.c.foreground, 8, "transparent")
        : variant === "secondary"
          ? mixOklch(t.c.foreground, 4.5, "transparent")
          : ghost
            ? mixOklch(t.c.foreground, 5, "transparent")
            : variant === "danger"
              ? mixOklch(t.c.destructive, 16, "transparent")
              : undefined;
  const hoverColor = disabled || !(variant === "secondary" || ghost) ? undefined : t.c.textStrong;
  const size = small ? 12.5 : 13;
  return (
    <row
      id={id}
      role="button"
      label={label}
      expanded={expanded}
      focusable={!disabled}
      disabled={disabled}
      h={small ? 30 : 34}
      px={compact ? 12 : ghost ? 9 : 14}
      ml={ml}
      gap={6}
      align="center"
      justify="center"
      shrink={false}
      radius={8}
      fill={fill}
      border={border}
      hover={hover}
      hoverGroup
      opacity={disabled && !muted ? 0.45 : 1}
      motion={{ dur: 0.12 }}
      focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 8 }}
      onPress={disabled ? undefined : onPress}
    >
      {icon ? <Icon icon={icon} size={iconSize ?? (compact ? 12 : 13)} strokeWidth={iconStroke} color={color} /> : null}
      <text {...look(size, weight)} color={color} hoverColor={hoverColor} nowrap>
        {label}
      </text>
    </row>
  );
}

const inlineRuns = (text: string, strong: { c: string; w: number }): Run[] =>
  text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((part) => part.length > 0)
    .map((part) => (/^\*\*[^*]+\*\*$/.test(part) ? { t: part.slice(2, -2), w: strong.w, c: strong.c } : { t: part }));

/** `.email-richtext`: paragraphs, `-`/`•` lists and `**bold**`. */
function EmailRichText({ text }: { text: string }) {
  const t = useTokens();
  const body = look(13.5, 400, { lh: 1.6 });
  const strong = { c: t.c.textStrong, w: 600 };
  const chunks = text.split(/\n{2,}/);
  return (
    <col mt={14} gap={10}>
      {chunks.map((chunk, chunkIndex) => {
        const lines = chunk.split("\n");
        if (lines.every((entry) => /^\s*[-•]\s+/.test(entry))) {
          return (
            <col key={chunkIndex} gap={4} pl={18}>
              {lines.map((entry, lineIndex) => (
                <row key={lineIndex}>
                  <box w={5} h={5} radius={2.5} fill={t.c.textWeaker} absolute={{ left: -13, top: 9.1 }} inert />
                  <text {...body} grow={1} minW={0} color={t.c.textWeak} spans={inlineRuns(entry.replace(/^\s*[-•]\s+/, ""), strong)} />
                </row>
              ))}
            </col>
          );
        }
        return <text key={chunkIndex} {...body} color={t.c.textWeak} spans={inlineRuns(lines.join("\n"), strong)} />;
      })}
    </col>
  );
}

function TellStellaComposer({ item, value, submitting, canCancel, autoFocus, onChange, onSubmit, onCancel }: { item: EmailPageItem; value: string; submitting: boolean; canCancel: boolean; autoFocus: boolean; onChange: (next: string) => void; onSubmit: () => void; onCancel: () => void }) {
  const typing = useContext(TypingContext);
  const inputId = `email-tell-input-${item.id}`;
  useEffect(() => {
    if (autoFocus) void stella.engine.focus(inputId);
  }, [autoFocus, inputId]);
  const { t } = useI18n();
  const tk = useTokens();
  const [focused, setFocused] = useState(false);
  const empty = value.trim().length === 0;
  const sendKeys = getPlatform() === "darwin" ? "⌘↵" : "Ctrl+↵";
  return (
    <col id={`email-tell-${item.id}`} mt={14} pad={1} radius={10} border={focused ? tk.c.ring : tk.c.border} fill={mixOklch(tk.c.foreground, 1.6, "transparent")} motion={{ dur: 0.12 }} >
      <input
        key={item.id}
        id={inputId}
        multiline
        value={value}
        placeholder={t("email.workspace.tell.placeholder")}
        placeholderColor={tk.c.textWeaker}
        readOnly={submitting}
        label={t("email.workspace.tell.placeholder")}
        {...look(13.5, 400, { lh: 1.5 })}
        color={tk.c.textStrong}
        minH={60}
        maxH={220}
        pt={11}
        px={13}
        pb={6}
        keys={["mod+Enter", "Escape"]}
        onKey={(event) => {
          if (event.key === "Enter" && !empty && !submitting) onSubmit();
          else if (event.key === "Escape" && canCancel) onCancel();
        }}
        onFocus={(within) => {
          setFocused(within);
          typing(within);
        }}
        onInput={onChange}
      />
      <row align="center" justify="between" gap={10} pt={6} pr={8} pb={8} pl={13}>
        <text {...look(11.5, 400)} color={tk.c.textWeaker} nowrap>
          {t("email.workspace.tell.sendHint", { keys: sendKeys })}
        </text>
        <row align="center" gap={6}>
          {canCancel ? <EmailBtn variant="ghost" disabled={submitting} label={t("common.cancel")} onPress={onCancel} /> : null}
          <EmailBtn
            id={`email-tell-send-${item.id}`}
            variant="primary"
            compact
            sendDisabled
            disabled={empty || submitting}
            label={submitting ? t("userAsk.question.sending") : t("email.digest.send")}
            onPress={() => {
              if (!empty && !submitting) onSubmit();
            }}
          />
        </row>
      </row>
    </col>
  );
}

function DraftCard({ item, children }: { item: EmailPageItem; children?: ReactNode }) {
  const { t } = useI18n();
  const tk = useTokens();
  return (
    <col id={`email-draft-${item.id}`} mt={22} pad={1} radius={11} border={line(tk)} fill={mixOklch(tk.c.foreground, 2.2, "transparent")} clip={10}>
      <row align="center" justify="between" gap={10} py={9} px={15} pb={10} borderSides={[0, 0, 1, 0]} border={line(tk)}>
        <row align="center" gap={6} shrink={false}>
          <Icon icon={Icons.stella.Reply} size={13} strokeWidth={1.9} color={tk.c.textWeak} />
          <text {...look(12, 500)} color={tk.c.textWeak} nowrap>
            {t("email.workspace.draft.label")}
          </text>
        </row>
        {item.from ? (
          <text {...look(12, 400)} minW={0} color={tk.c.textWeaker} nowrap truncate>
            {t("email.reply.to", { to: item.from })}
          </text>
        ) : null}
      </row>
      <text {...look(13.5, 400, { lh: 1.62 })} py={15} px={16} color={tk.c.textStrong}>
        {item.draft}
      </text>
      {children ? (
        <row wrap align="center" gap={8} rowGap={8} pt={11} pb={10} px={14} borderSides={[1, 0, 0, 0]} border={line(tk)} fill={mixOklch(tk.c.foreground, 1.4, "transparent")}>
          {children}
        </row>
      ) : null}
    </col>
  );
}

function Pending({ kind }: { kind: PendingKind }) {
  const { t } = useI18n();
  const tk = useTokens();
  return (
    <row role="status" align="center" gap={8} mt={20}>
      <Icon icon={Icons.stella.RefreshCw} size={13} strokeWidth={2} spin={SPIN} color={tk.c.textWeak} />
      <text {...look(13, 500)} color={tk.c.textWeak} nowrap>
        {t(PENDING_LABEL_KEY[kind])}
      </text>
    </row>
  );
}

function StageInner({ id, children }: { id: string; children: ReactNode }) {
  return (
    <col id={id} w="full" maxW={640} selfAlign="center" pt={28} px={40} pb={56}>
      {children}
    </col>
  );
}

function EmailDetailView({ item, accountsCount, locale, pending, tellOpen, tellDraft, tellSending, onPrimaryAction, onToggleTell, onTellChange, onTellSubmit }: { item: EmailPageItem; accountsCount: number; locale: string; pending: PendingKind | undefined; tellOpen: boolean; tellDraft: string; tellSending: boolean; onPrimaryAction: (item: EmailPageItem) => void; onToggleTell: (itemId: string, open: boolean) => void; onTellChange: (itemId: string, value: string) => void; onTellSubmit: (item: EmailPageItem) => void }) {
  const { t, tPlural } = useI18n();
  const tk = useTokens();
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
  const handled = item.section === "handled";
  const context = look(12.5, 500);

  const actionButtons = (compact: boolean) => (
    <>
      {item.action ? (
        <EmailBtn
          id={`email-action-${item.id}`}
          variant={handled ? "secondary" : "primary"}
          compact={compact}
          icon={handled ? Icons.stella.RotateCcw : undefined}
          iconStroke={2}
          label={item.action}
          onPress={() => onPrimaryAction(item)}
        />
      ) : null}
      {!inlineTell ? (
        <EmailBtn
          id={`email-tell-toggle-${item.id}`}
          variant="secondary"
          compact={compact}
          expanded={tellOpen}
          icon={Icons.stella.MessageSquare}
          label={t("email.workspace.tell.action")}
          onPress={() => onToggleTell(item.id, !tellOpen)}
        />
      ) : null}
    </>
  );

  return (
    <StageInner id={`email-detail-${item.id}`}>
      <row align="center" justify="between" gap={12}>
        <row align="center" gap={7} minW={0}>
          {item.urgent ? (
            <>
              <UrgentDot mt={0} />
              <text {...context} color={tk.c.textStrong} nowrap>
                {t("email.section.urgent")}
              </text>
              <Sep />
            </>
          ) : null}
          <text {...context} color={tk.c.textWeak} nowrap>
            {sectionTitleKey ? t(sectionTitleKey) : ""}
          </text>
        </row>
        {thread ? (
          <row role="button" label={t("email.section.openInGmail")} focusable align="center" gap={5} py={4} px={8} mr={-8} radius={6} hover={mixOklch(tk.c.foreground, 5, "transparent")} hoverGroup motion={{ dur: 0.12 }} focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 6 }} onPress={() => openExternalUrl(gmailThreadUrl(thread))}>
            <text {...context} color={tk.c.textWeak} hoverColor={tk.c.textStrong} nowrap>
              {t("email.section.openInGmail")}
            </text>
            <Icon icon={Icons.stella.ExternalLink} size={12} strokeWidth={1.9} color={tk.c.textWeak} />
          </row>
        ) : null}
      </row>

      <text {...look(21, 600, { lh: 1.28, em: -0.022 })} mt={10} color={tk.c.textStrong} role="heading">
        {item.title}
      </text>

      {metaParts.length > 0 ? (
        <row wrap gap={7} rowGap={0} mt={9}>
          {metaParts.map((part, index) => (
            <row key={part.key} gap={7}>
              {index > 0 ? <Sep mt={toBaseline(12, 13)} /> : null}
              <text {...look(13, part.strong ? 500 : 400)} features={TNUM} color={part.strong ? tk.c.textBase : tk.c.textWeak} nowrap>
                {part.text}
              </text>
            </row>
          ))}
        </row>
      ) : null}

      <box h={1} my={16} fill={line(tk)} />

      <text {...look(14.5, 400, { lh: 1.62 })} color={tk.c.textBase}>
        {item.gist}
      </text>
      {item.detail ? <EmailRichText text={item.detail} /> : null}

      {item.draft ? <DraftCard item={item}>{!pending && (item.action || !inlineTell) ? actionButtons(true) : null}</DraftCard> : null}

      {pending ? (
        <Pending kind={pending} />
      ) : (
        <>
          {!item.draft && (item.action || !inlineTell) ? (
            <row wrap align="center" gap={8} rowGap={8} mt={20}>
              {actionButtons(false)}
            </row>
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
    </StageInner>
  );
}

function Senders({ senders }: { senders: NonNullable<EmailPageIgnored["senders"]> }) {
  const tk = useTokens();
  return (
    <col role="list" mt={22} pt={1} borderSides={[1, 0, 0, 0]} border={line(tk)}>
      {senders.map((sender) => (
        <row key={sender.name} role="listitem" justify="between" gap={12} pt={11} pb={12} borderSides={[0, 0, 1, 0]} border={line(tk)}>
          <text {...look(13.5, 500)} minW={0} color={tk.c.textStrong}>
            {sender.name}
          </text>
          <text {...look(13, 400)} mt={1} features={TNUM} color={tk.c.textWeak} shrink={false}>
            {String(sender.count)}
          </text>
        </row>
      ))}
    </col>
  );
}

function Footnote({ children }: { children: string }) {
  const tk = useTokens();
  return (
    <text {...look(12.5, 400, { lh: 1.5 })} mt={18} color={tk.c.textWeaker}>
      {children}
    </text>
  );
}

function EmailIgnoredView({ ignored }: { ignored: EmailPageIgnored }) {
  const { t, tPlural } = useI18n();
  const tk = useTokens();
  const senders = ignored.senders ?? [];
  return (
    <StageInner id="email-ignored-view">
      <text {...look(12.5, 500)} color={tk.c.textWeak}>
        {t("email.workspace.ignored.eyebrow")}
      </text>
      <text {...look(21, 600, { lh: 1.28, em: -0.022 })} mt={10} color={tk.c.textStrong} role="heading">
        {tPlural("email.workspace.ignored.count", ignored.count)}
      </text>
      {ignored.gist ? (
        <text {...look(13, 400)} mt={9} features={TNUM} color={tk.c.textWeak}>
          {ignored.gist}
        </text>
      ) : null}
      {senders.length > 0 ? <Senders senders={senders} /> : null}
      <Footnote>{t("email.workspace.ignored.hint")}</Footnote>
    </StageInner>
  );
}

function SettingsGroup({ title, first = false, children }: { title: string; first?: boolean; children: ReactNode }) {
  const tk = useTokens();
  return (
    <col mt={first ? 0 : 26}>
      <text {...look(12, 500)} mb={8} color={tk.c.textWeak} role="heading">
        {title}
      </text>
      {children}
    </col>
  );
}

function SettingsList({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return (
    <col role="list" pt={1} borderSides={[1, 0, 0, 0]} border={line(tk)}>
      {children}
    </col>
  );
}

function SettingsRow({ id, children }: { id?: string; children: ReactNode }) {
  const tk = useTokens();
  return (
    <row id={id} role="listitem" align="center" justify="between" gap={16} pt={12} pb={13} borderSides={[0, 0, 1, 0]} border={line(tk)}>
      {children}
    </row>
  );
}

function RowCopy({ main, sub }: { main: string; sub: string }) {
  const tk = useTokens();
  return (
    <col gap={2} minW={0} shrink>
      <text {...look(13.5, 500, { lh: 1.4 })} color={tk.c.textStrong}>
        {main}
      </text>
      <text {...look(12, 400)} color={tk.c.textWeak}>
        {sub}
      </text>
    </col>
  );
}

function RowValue({ children }: { children: string }) {
  const tk = useTokens();
  return (
    <text {...look(12.5, 400)} features={TNUM} color={tk.c.textWeak} shrink={false} nowrap>
      {children}
    </text>
  );
}

function EmailSettingsView({ state, locale, showBack, removingRuleId, turningOff, onBack, onRemoveRule, onTurnOff }: { state: EmailPageState; locale: string; showBack: boolean; removingRuleId: string | null; turningOff: boolean; onBack: () => void; onRemoveRule: (ruleId: string) => void; onTurnOff: () => void }) {
  const { t } = useI18n();
  const tk = useTokens();
  const [confirmOff, setConfirmOff] = useState(false);
  const rules = state.rules ?? [];

  return (
    <col id="email-settings-view">
      <row align="center" justify="between" gap={12} mb={24}>
        <text {...look(18, 600, { em: -0.02 })} color={tk.c.textStrong} role="heading">
          {t("email.workspace.rules.settingsTitle")}
        </text>
        {showBack ? <EmailBtn id="email-settings-back" variant="ghost" icon={Icons.stella.ArrowLeft} iconSize={13} iconStroke={2} label={t("common.back")} onPress={onBack} /> : null}
      </row>

      <SettingsGroup first title={t("email.workspace.rules.yours")}>
        {rules.length > 0 ? (
          <SettingsList>
            {rules.map((rule) => {
              const removing = removingRuleId === rule.ruleId;
              return (
                <SettingsRow key={rule.ruleId}>
                  <RowCopy main={rule.text} sub={RULE_KIND_LABEL_KEY[rule.kind] ? t(RULE_KIND_LABEL_KEY[rule.kind]) : ""} />
                  <EmailBtn variant="ghost" disabled={removing} label={removing ? t("global.schedule.removing") : t("email.section.remove")} onPress={() => onRemoveRule(rule.ruleId)} />
                </SettingsRow>
              );
            })}
          </SettingsList>
        ) : null}
        <Footnote>{t("email.workspace.rules.hint")}</Footnote>
      </SettingsGroup>

      <SettingsGroup title={t("email.workspace.inboxes.title")}>
        <SettingsList>
          {state.accounts.map((account) => (
            <SettingsRow key={account}>
              <row align="center" gap={8} minW={0}>
                <Icon icon={Icons.stella.Mail} size={14} strokeWidth={1.85} color={tk.c.textWeaker} />
                <text {...look(13.5, 500)} color={tk.c.textStrong} nowrap truncate>
                  {account}
                </text>
              </row>
              <RowValue>{t("email.workspace.inboxes.reading")}</RowValue>
            </SettingsRow>
          ))}
          {state.nextReadAt ? (
            <SettingsRow>
              <RowCopy main={t("email.workspace.nextCheck.title")} sub={t("email.workspace.nextCheck.hint")} />
              <RowValue>{formatWhen(state.nextReadAt, locale)}</RowValue>
            </SettingsRow>
          ) : null}
        </SettingsList>
      </SettingsGroup>

      <SettingsGroup title={t("email.workspace.automation")}>
        <SettingsList>
          <SettingsRow>
            <RowCopy main={t("email.workspace.off.title")} sub={t("email.workspace.off.body")} />
            {confirmOff ? (
              <row align="center" gap={6} shrink={false}>
                <EmailBtn variant="ghost" disabled={turningOff} label={t("common.cancel")} onPress={() => setConfirmOff(false)} />
                <EmailBtn id="email-turn-off-confirm" variant="danger" compact disabled={turningOff} label={turningOff ? t("email.workspace.off.working") : t("email.section.turnOff")} onPress={onTurnOff} />
              </row>
            ) : (
              <EmailBtn id="email-turn-off" variant="secondary" compact label={t("email.section.turnOff")} onPress={() => setConfirmOff(true)} />
            )}
          </SettingsRow>
        </SettingsList>
      </SettingsGroup>
    </col>
  );
}

function IgnoredToggle({ ignored, open, onToggle }: { ignored: EmailPageIgnored; open: boolean; onToggle: () => void }) {
  const { tPlural } = useI18n();
  const tk = useTokens();
  return (
    <>
      <row id="email-ignored-toggle" role="button" label={tPlural("email.workspace.ignored.count", ignored.count)} expanded={open} focusable w="full" align="center" justify="between" gap={10} py={6} hoverGroup focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 4 }} onPress={onToggle}>
        <text {...look(13, 500)} color={tk.c.textWeak} hoverColor={tk.c.textStrong}>
          {tPlural("email.workspace.ignored.count", ignored.count)}
        </text>
        <Icon icon={open ? Icons.stella.ChevronDown : Icons.stella.ChevronRight} size={14} strokeWidth={1.9} color={tk.c.textWeak} />
      </row>
      {open ? (
        <>
          {ignored.gist ? (
            <text {...look(12.5, 400)} mt={3} color={tk.c.textWeak}>
              {ignored.gist}
            </text>
          ) : null}
          {ignored.senders?.length ? <Senders senders={ignored.senders} /> : null}
        </>
      ) : null}
    </>
  );
}

function BarButton({ id, icon, label, count, pressed, disabled = false, spinning = false, onPress }: { id: string; icon: IconData; label: string; count?: number; pressed?: boolean; disabled?: boolean; spinning?: boolean; onPress: () => void }) {
  const tk = useTokens();
  const text = look(12.5, 500);
  return (
    <row
      id={id}
      role="button"
      label={label}
      checked={pressed}
      focusable={!disabled}
      disabled={disabled}
      h={28}
      px={10}
      gap={6}
      align="center"
      radius={7}
      fill={pressed ? mixOklch(tk.c.foreground, 7, "transparent") : undefined}
      hover={disabled || pressed ? undefined : mixOklch(tk.c.foreground, 5, "transparent")}
      hoverGroup
      opacity={disabled ? 0.55 : 1}
      motion={{ dur: 0.12 }}
      focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 7 }}
      onPress={disabled ? undefined : onPress}
    >
      <Icon icon={icon} size={13} strokeWidth={1.9} spin={spinning ? SPIN : undefined} color={pressed ? tk.c.textStrong : tk.c.textWeak} />
      <text {...text} color={pressed ? tk.c.textStrong : tk.c.textWeak} hoverColor={disabled ? undefined : tk.c.textStrong} nowrap>
        {label}
      </text>
      {count !== undefined ? (
        <text {...text} features={TNUM} color={tk.c.textWeaker} nowrap>
          {String(count)}
        </text>
      ) : null}
    </row>
  );
}

function RailRow({ item, selected, pending, locale, onSelect }: { item: EmailPageItem; selected: boolean; pending: PendingKind | undefined; locale: string; onSelect: () => void }) {
  const { t, tPlural } = useI18n();
  const tk = useTokens();
  const time = formatWhen(item.mailAt ?? item.at, locale);
  const fromLabel = item.from ? (item.count && item.count > 1 ? `${item.from} · ${item.count}` : item.from) : item.count && item.count > 1 ? tPlural("email.brief.emails", item.count) : "";
  const titleLook = look(13.5, quiet(item.section) ? 500 : 600, { lh: 1.35, em: -0.014 });
  return (
    <col
      id={`email-row-${item.id}`}
      role="option"
      label={item.title}
      selected={selected}
      focusable
      w="full"
      gap={2.5}
      py={9}
      px={11}
      radius={9}
      fill={selected ? mixOklch(tk.c.foreground, 7, "transparent") : undefined}
      hover={selected ? undefined : mixOklch(tk.c.foreground, 3.8, "transparent")}
      motion={{ dur: 0.1 }}
      focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 9 }}
      onPress={onSelect}
    >
      <row gap={7} minW={0}>
        {item.urgent ? <UrgentDot mt={baseline(13.5, 1.35) - 6 - 1.5} label={t("email.section.urgent")} /> : null}
        <text {...titleLook} grow={1} minW={0} maxLines={2} truncate color={quiet(item.section) ? tk.c.textBase : tk.c.textStrong}>
          {item.title}
        </text>
        {time ? (
          <text {...look(11.5, 400)} mt={toBaseline(11.5, 13.5, LH, 1.35)} features={TNUM} color={tk.c.textWeaker} shrink={false} nowrap>
            {time}
          </text>
        ) : null}
      </row>
      <row align="center" justify="between" gap={8} minW={0}>
        <text {...look(12, 500)} minW={0} color={tk.c.textWeak} nowrap truncate>
          {fromLabel}
        </text>
        {pending ? (
          <text {...look(11.5, 500)} color={tk.c.primary} shrink={false} nowrap>
            {t("email.workspace.onIt")}
          </text>
        ) : item.draft ? (
          <row align="center" gap={4} shrink={false}>
            <Icon icon={Icons.stella.Reply} size={11} strokeWidth={1.9} color={tk.c.textWeaker} />
            <text {...look(11.5, 400)} color={tk.c.textWeaker} nowrap>
              {t("email.brief.draft")}
            </text>
          </row>
        ) : null}
      </row>
      <text {...look(12.5, 400, { lh: 1.4 })} mt={1} color={selected ? tk.c.textWeak : tk.c.textWeaker} nowrap truncate>
        {item.gist}
      </text>
    </col>
  );
}

function CompactItem({ item, last, accountsCount, locale, pending, open, tellOpen, tellDraft, tellSending, onPrimaryAction, onToggleOpen, onToggleTell, onTellChange, onTellSubmit }: { item: EmailPageItem; last: boolean; accountsCount: number; locale: string; pending: PendingKind | undefined; open: boolean; tellOpen: boolean; tellDraft: string; tellSending: boolean; onPrimaryAction: () => void; onToggleOpen: () => void; onToggleTell: (open: boolean) => void; onTellChange: (value: string) => void; onTellSubmit: () => void }) {
  const { t, tPlural } = useI18n();
  const tk = useTokens();
  const hasMore = Boolean(item.detail || item.draft);
  const thread = item.threads?.[0];
  const time = formatWhen(item.mailAt ?? item.at, locale);
  const meta: string[] = [];
  if (item.from) meta.push(item.from);
  if (item.count && item.count > 1) meta.push(tPlural("email.brief.emails", item.count));
  if (accountsCount > 1 && thread?.account) meta.push(thread.account);
  const emphasizeAction = Boolean(item.urgent || (open && item.draft));
  const handled = item.section === "handled";

  return (
    <col id={`email-item-${item.id}`} role="article" pt={15} pb={last ? 15 : 16} borderSides={last ? undefined : [0, 0, 1, 0]} border={last ? undefined : line(tk)}>
      <row gap={7}>
        {item.urgent ? <UrgentDot mt={baseline(15, 1.35) - 7.5} label={t("email.section.urgent")} /> : null}
        <text {...look(15, quiet(item.section) ? 500 : 600, { lh: 1.35, em: -0.015 })} grow={1} minW={0} color={quiet(item.section) ? tk.c.textBase : tk.c.textStrong} role="heading">
          {item.title}
        </text>
        {time ? (
          <text {...look(12, 400)} mt={toBaseline(12, 15, LH, 1.35)} features={TNUM} color={tk.c.textWeaker} shrink={false} nowrap>
            {time}
          </text>
        ) : null}
      </row>
      {meta.length > 0 ? (
        <text {...look(12.5, 400)} mt={3} color={tk.c.textWeak}>
          {meta.join(" · ")}
        </text>
      ) : null}
      <text {...look(13.5, 400, { lh: 1.55 })} mt={7} color={quiet(item.section) ? tk.c.textWeak : tk.c.textBase}>
        {item.gist}
      </text>

      {hasMore && open ? (
        <>
          {item.detail ? <EmailRichText text={item.detail} /> : null}
          {item.draft ? <DraftCard item={item} /> : null}
        </>
      ) : null}

      {pending ? (
        <Pending kind={pending} />
      ) : (
        <>
          <row wrap align="center" gap={6} rowGap={6} mt={12}>
            {item.action ? (
              <EmailBtn
                id={`email-action-${item.id}`}
                variant={handled ? "secondary" : emphasizeAction ? "primary" : "tonal"}
                compact
                icon={handled ? Icons.stella.RotateCcw : undefined}
                iconStroke={2}
                label={item.action}
                onPress={onPrimaryAction}
              />
            ) : null}
            {hasMore ? <EmailBtn id={`email-more-${item.id}`} variant="ghost" expanded={open} label={open ? t("email.brief.hide") : item.draft ? t("email.workspace.draft.read") : t("email.workspace.details")} onPress={onToggleOpen} /> : null}
            <EmailBtn id={`email-tell-toggle-${item.id}`} variant="ghost" expanded={tellOpen} label={t("email.workspace.tell.action")} onPress={() => onToggleTell(!tellOpen)} />
            {thread ? <box grow={1} /> : null}
            {thread ? (
              <row role="button" label="Gmail" focusable h={30} px={9} gap={6} align="center" radius={8} hover={mixOklch(tk.c.foreground, 5, "transparent")} hoverGroup motion={{ dur: 0.12 }} focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 8 }} onPress={() => openExternalUrl(gmailThreadUrl(thread))}>
                <text {...look(12.5, 500)} color={tk.c.textWeak} hoverColor={tk.c.textStrong} nowrap>
                  Gmail
                </text>
                <Icon icon={Icons.stella.ExternalLink} size={11} strokeWidth={1.9} color={tk.c.textWeak} />
              </row>
            ) : null}
          </row>
          {tellOpen ? <TellStellaComposer item={item} value={tellDraft} submitting={tellSending} canCancel autoFocus onChange={onTellChange} onSubmit={onTellSubmit} onCancel={() => onToggleTell(false)} /> : null}
        </>
      )}
    </col>
  );
}

/** desktop-ui's `EmailWorkspace`: the summary bar, then the rail and stage (or, under 820pt, the compact list). */
export function EmailWorkspace({ state }: { state: EmailPageState }) {
  const { locale, t, tPlural } = useI18n();
  const tk = useTokens();
  const [width, setWidth] = useState(0);
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

  const grouped = useMemo(() => SECTION_ORDER.map((section) => ({ ...section, items: sortItems(state.page.items, section.key) })), [state.page.items]);
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
    if (selection?.kind === "item" && flatItems.some((item) => item.id === selection.id)) return selection;
    if (flatItems.length > 0) return { kind: "item", id: flatItems[0]!.id };
    if (hasIgnored) return { kind: "ignored" };
    return null;
  }, [selection, flatItems, hasIgnored]);

  const selectedItem = activeSelection?.kind === "item" ? (flatItems.find((item) => item.id === activeSelection.id) ?? null) : null;

  const sendAction = useCallback(async (event: CanvasActionEvent): Promise<boolean> => sendCanvasActionToChat(event), []);

  const handleCheckNow = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    const sent = await sendAction({ canvas: EMAIL_PAGE_CANVAS, title: t("email.title"), id: EMAIL_PAGE_CHECK_ACTION, label: t("email.workspace.request.check") });
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
      const sent = await sendAction({ canvas: EMAIL_PAGE_CANVAS, title: t("email.title"), id: `${prefix}:${item.id}`, label: `${item.action}: ${item.title}` });
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
      const sent = await sendAction({ canvas: EMAIL_PAGE_CANVAS, title: t("email.title"), id: `tell:${item.id}`, label: t("email.workspace.request.about", { title: item.title }), fields: { text } });
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

  const [typing, setTyping] = useState(false);
  const handleKeyNav = useCallback(
    (key: string) => {
      if (flatItems.length === 0) return;
      const index = activeSelection?.kind === "item" ? flatItems.findIndex((item) => item.id === activeSelection.id) : -1;
      const delta = key === "ArrowDown" ? 1 : -1;
      const nextIndex = index < 0 ? 0 : Math.max(0, Math.min(flatItems.length - 1, index + delta));
      const nextItem = flatItems[nextIndex];
      if (nextItem) setSelection({ kind: "item", id: nextItem.id });
    },
    [activeSelection, flatItems],
  );

  const toggleSettings = useCallback(() => {
    setSelection((current) => {
      if (current?.kind === "settings") return flatItems[0] ? { kind: "item", id: flatItems[0].id } : null;
      return { kind: "settings" };
    });
  }, [flatItems]);

  const settingsOpen = activeSelection?.kind === "settings";
  const summaryLabel = needsYouCount > 0 ? tPlural("email.card.needYou", needsYouCount) : state.page.readAt ? t("email.workspace.summary.caughtUp") : t("email.workspace.summary.waitingFirstRead");
  const readLabel = state.page.readAt ? t("email.workspace.summary.readAt", { time: formatWhen(state.page.readAt, locale) }) : t("email.workspace.summary.notRead");
  const rulesCount = state.rules.length;
  const measured = width > 0;
  const compact = measured && width < COMPACT_BELOW;
  const stacked = measured && width <= STACKED_SUMMARY_AT;
  const railW = Math.min(408, Math.max(320, width * 0.37));

  const metaText = look(12.5, 400);
  const metaMt = toBaseline(12.5, 13.5);
  const sepMt = toBaseline(12, 13.5);
  const subLine = (
    <row wrap gap={7} rowGap={0} minW={0} mt={stacked ? 0 : metaMt}>
      <text {...metaText} features={TNUM} color={tk.c.textWeak} nowrap>
        {readLabel}
      </text>
      {state.unread > 0 ? (
        <>
          <Sep mt={toBaseline(12, 12.5)} />
          <text {...metaText} features={TNUM} color={tk.c.textWeak} nowrap>
            {tPlural("email.workspace.summary.newSince", state.unread)}
          </text>
        </>
      ) : null}
      {state.accounts.length > 1 ? (
        <>
          <Sep mt={toBaseline(12, 12.5)} />
          <text {...metaText} features={TNUM} color={tk.c.textWeak} nowrap>
            {tPlural("email.workspace.inboxes.count", state.accounts.length)}
          </text>
        </>
      ) : null}
    </row>
  );

  const checkButton = (id: string) => <BarButton id={id} icon={Icons.stella.RefreshCw} spinning={checking} disabled={checking} label={checking ? t("email.section.checking") : t("email.section.checkNow")} onPress={() => void handleCheckNow()} />;

  const settings = (showBack: boolean) => (
    <EmailSettingsView state={state} locale={locale} showBack={showBack} removingRuleId={removingRuleId} turningOff={turningOff} onBack={toggleSettings} onRemoveRule={(ruleId) => void handleRemoveRule(ruleId)} onTurnOff={() => void handleTurnOff()} />
  );

  return (
    <TypingContext.Provider value={setTyping}>
    <col
      id="email-section"
      grow={1}
      minH={0}
      minW={0}
      keys={typing ? undefined : ["ArrowDown", "ArrowUp"]}
      onKey={(event) => handleKeyNav(event.key)}
      onLayout={(rect) => setWidth(rect.w)}
    >
      <row id="email-bar" align="center" justify="between" gap={12} shrink={false} minH={46} px={compact ? 16 : 20} pt={compact ? 8 : 0} pb={compact ? 9 : 1} borderSides={[0, 0, 1, 0]} border={line(tk)}>
        {stacked ? (
          <col gap={1} minW={0}>
            <text {...look(13.5, 600, { em: -0.015 })} features={TNUM} color={tk.c.textStrong}>
              {summaryLabel}
            </text>
            {subLine}
          </col>
        ) : (
          <row wrap gap={8} rowGap={0} minW={0}>
            <text {...look(13.5, 600, { em: -0.015 })} features={TNUM} color={tk.c.textStrong} nowrap>
              {summaryLabel}
            </text>
            <Sep mt={sepMt} />
            {subLine}
          </row>
        )}
        <row align="center" gap={4} shrink={false}>
          {checkButton("email-check-now")}
          <BarButton id="email-rules" icon={Icons.stella.SlidersHorizontal} pressed={settingsOpen} label={t("email.workspace.rules.title")} count={rulesCount > 0 ? rulesCount : undefined} onPress={toggleSettings} />
        </row>
      </row>

      {!measured ? null : flatItems.length === 0 && !settingsOpen ? (
        <col id="email-empty" grow={1} align="center" justify="center" pt={40} px={24} pb={64}>
          <col align="center" maxW={420} w="full">
            <box w={40} h={40} mb={14} center radius={11} border={line(tk)} fill={mixOklch(tk.c.foreground, 2.5, "transparent")}>
              <Icon icon={state.page.readAt ? Icons.stella.CheckCircle2 : Icons.stella.Mail} size={18} strokeWidth={1.75} color={tk.c.textWeak} />
            </box>
            <text {...look(17, 600, { em: -0.018 })} color={tk.c.textStrong} textAlign="center" role="heading">
              {state.page.readAt ? t("email.workspace.empty.caughtUpTitle") : t("email.workspace.empty.firstReadTitle")}
            </text>
            <text {...look(13.5, 400, { lh: 1.55 })} mt={6} color={tk.c.textWeak} textAlign="center" balance>
              {state.page.readAt ? (state.nextReadAt ? t("email.workspace.empty.caughtUpNext", { time: formatWhen(state.nextReadAt, locale) }) : t("email.workspace.empty.caughtUpUrgent")) : t("email.workspace.empty.firstReadBody")}
            </text>
            <row mt={18}>
              <EmailBtn id="email-empty-check" variant="secondary" icon={Icons.stella.RefreshCw} disabled={checking} label={checking ? t("email.section.checking") : t("email.section.checkNow")} onPress={() => void handleCheckNow()} />
            </row>
            {hasIgnored ? (
              <col w="full" mt={32} pt={17} borderSides={[1, 0, 0, 0]} border={line(tk)}>
                <IgnoredToggle ignored={state.page.ignored} open={compactIgnoredOpen} onToggle={() => setCompactIgnoredOpen((open) => !open)} />
              </col>
            ) : null}
          </col>
        </col>
      ) : compact ? (
        <col id="email-compact" grow={1} minH={0} scrollY>
          <col w="full" maxW={640} selfAlign="center" pt={16} px={20} pb={48}>
            {settingsOpen ? (
              settings(true)
            ) : (
              <>
                {grouped.map((group, groupIndex) => {
                  if (group.items.length === 0 && group.key !== "needs_you") return null;
                  return (
                    <col key={group.key} mt={groupIndex === 0 ? 2 : 26}>
                      <row gap={7} mb={4}>
                        <text {...look(12, 500)} color={tk.c.textWeak} role="heading">
                          {t(group.titleKey)}
                        </text>
                        {group.items.length > 0 ? (
                          <text {...look(12, 500)} features={TNUM} color={tk.c.textWeaker}>
                            {String(group.items.length)}
                          </text>
                        ) : null}
                      </row>
                      {group.items.length === 0 ? (
                        <text {...look(12.5, 400)} mt={3} color={tk.c.textWeak}>
                          {t("email.workspace.empty.caughtUpTitle")}
                        </text>
                      ) : (
                        group.items.map((item, index) => (
                          <CompactItem
                            key={item.id}
                            item={item}
                            last={index === group.items.length - 1}
                            accountsCount={state.accounts.length}
                            locale={locale}
                            pending={pendingById[item.id]}
                            open={Boolean(expandedCompact[item.id])}
                            tellOpen={Boolean(tellingOpen[item.id])}
                            tellDraft={tellDrafts[item.id] ?? ""}
                            tellSending={Boolean(tellSending[item.id])}
                            onPrimaryAction={() => void handlePrimaryAction(item)}
                            onToggleOpen={() => setExpandedCompact((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                            onToggleTell={(open) => setTellingOpen((prev) => ({ ...prev, [item.id]: open }))}
                            onTellChange={(value) => setTellDrafts((prev) => ({ ...prev, [item.id]: value }))}
                            onTellSubmit={() => void handleTellSubmit(item)}
                          />
                        ))
                      )}
                    </col>
                  );
                })}
                {hasIgnored ? (
                  <col mt={26} pt={15} borderSides={[1, 0, 0, 0]} border={line(tk)}>
                    <IgnoredToggle ignored={state.page.ignored} open={compactIgnoredOpen} onToggle={() => setCompactIgnoredOpen((open) => !open)} />
                  </col>
                ) : null}
                {state.nextReadAt ? (
                  <text {...look(12, 400)} mt={24} pt={15} borderSides={[1, 0, 0, 0]} border={line(tk)} color={tk.c.textWeaker}>
                    {t("email.workspace.nextCheck.at", { time: formatWhen(state.nextReadAt, locale) })}
                  </text>
                ) : null}
              </>
            )}
          </col>
        </col>
      ) : (
        <row id="email-split" grow={1} minH={0} minW={0}>
          <col id="email-rail" role="group" label={t("email.workspace.a11y.list")} w={railW} shrink={false} minH={0} pr={1} borderSides={[0, 1, 0, 0]} border={line(tk)}>
            <col id="email-rail-scroll" role="listbox" label={t("email.workspace.a11y.items")} grow={1} minH={0} scrollY pt={8} px={10} pb={16}>
              {grouped.map((group, groupIndex) => {
                if (group.items.length === 0 && group.key !== "needs_you") return null;
                return (
                  <col key={group.key} mt={groupIndex === 0 ? 2 : 14}>
                    <row justify="between" gap={8} pt={4} px={10} pb={6}>
                      <text {...look(11.5, 500, { em: 0.005 })} color={tk.c.textWeak} role="heading">
                        {t(group.titleKey)}
                      </text>
                      {group.items.length > 0 ? (
                        <text {...look(11.5, 500, { em: 0.005 })} features={TNUM} color={tk.c.textWeaker}>
                          {String(group.items.length)}
                        </text>
                      ) : null}
                    </row>
                    {group.items.length === 0 ? (
                      <text {...look(12.5, 400)} pt={6} px={10} pb={10} color={tk.c.textWeaker}>
                        {t("email.workspace.empty.caughtUpTitle")}
                      </text>
                    ) : (
                      <col gap={2}>
                        {group.items.map((item) => (
                          <RailRow key={item.id} item={item} selected={activeSelection?.kind === "item" && activeSelection.id === item.id} pending={pendingById[item.id]} locale={locale} onSelect={() => setSelection({ kind: "item", id: item.id })} />
                        ))}
                      </col>
                    )}
                  </col>
                );
              })}
            </col>

            {hasIgnored || state.nextReadAt ? (
              <row id="email-rail-foot" align="center" justify={hasIgnored ? "between" : "end"} gap={8} shrink={false} minH={40} pt={7} pb={6} px={10} borderSides={[1, 0, 0, 0]} border={line(tk)}>
                {hasIgnored ? (
                  <row
                    id="email-ignored-trigger"
                    role="button"
                    label={t("email.workspace.ignored.short", { count: state.page.ignored.count })}
                    focusable
                    h={26}
                    px={8}
                    gap={4}
                    align="center"
                    radius={7}
                    fill={activeSelection?.kind === "ignored" ? mixOklch(tk.c.foreground, 7.5, "transparent") : undefined}
                    hover={activeSelection?.kind === "ignored" ? undefined : mixOklch(tk.c.foreground, 5, "transparent")}
                    hoverGroup
                    motion={{ dur: 0.12 }}
                    focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 7 }}
                    onPress={() => setSelection({ kind: "ignored" })}
                  >
                    <text {...look(12, 500)} features={TNUM} color={activeSelection?.kind === "ignored" ? tk.c.textStrong : tk.c.textWeak} hoverColor={tk.c.textStrong} nowrap>
                      {t("email.workspace.ignored.short", { count: state.page.ignored.count })}
                    </text>
                    <Icon icon={Icons.stella.ChevronRight} size={12} strokeWidth={2} color={activeSelection?.kind === "ignored" ? tk.c.textStrong : tk.c.textWeak} />
                  </row>
                ) : null}
                {state.nextReadAt ? (
                  <row align="center" gap={5} px={6} shrink={false}>
                    <Icon icon={Icons.stella.Clock} size={11.5} strokeWidth={1.85} color={tk.c.textWeaker} />
                    <text {...look(11.5, 400)} features={TNUM} color={tk.c.textWeaker} nowrap>
                      {t("email.workspace.nextCheck.short", { time: formatWhen(state.nextReadAt, locale) })}
                    </text>
                  </row>
                ) : null}
              </row>
            ) : null}
          </col>

          <col id="email-stage" grow={1} minW={0} minH={0} scrollY>
            {settingsOpen ? (
              <StageInner id="email-settings-stage">{settings(flatItems.length > 0)}</StageInner>
            ) : activeSelection?.kind === "ignored" ? (
              <EmailIgnoredView ignored={state.page.ignored} />
            ) : selectedItem ? (
              <EmailDetailView
                key={selectedItem.id}
                item={selectedItem}
                accountsCount={state.accounts.length}
                locale={locale}
                pending={pendingById[selectedItem.id]}
                tellOpen={Boolean(tellingOpen[selectedItem.id])}
                tellDraft={tellDrafts[selectedItem.id] ?? ""}
                tellSending={Boolean(tellSending[selectedItem.id])}
                onPrimaryAction={(item) => void handlePrimaryAction(item)}
                onToggleTell={(id, open) => setTellingOpen((prev) => ({ ...prev, [id]: open }))}
                onTellChange={(id, value) => setTellDrafts((prev) => ({ ...prev, [id]: value }))}
                onTellSubmit={(item) => void handleTellSubmit(item)}
              />
            ) : null}
          </col>
        </row>
      )}
    </col>
    </TypingContext.Provider>
  );
}
