import { useCallback, useState, type ReactNode } from "react";
import type { UserAsk, UserAskAnswerFieldValue, UserAskField, UserAskSecureInputDetail } from "@stella/contracts/user-ask";
import { USER_ASK_MAX_NOTE, userAskFieldInputKind, userAskOffersRemember } from "@stella/contracts/user-ask";
import { userAskSecureRecord } from "@stella/contracts/user-ask-deck";
import { useT } from "@/shared/i18n";
import { settingsPlace } from "@/global/settings/settings-place";
import { answerUserAsk, declineUserAsk, recordUserAskAnswer, useUserAskRemainingMs } from "@/features/user-ask/user-ask-store";
import { formatRemaining } from "@/features/user-ask/format-remaining";
import { APP_TRACKING, Button, Form, NativeCheckbox, Select, T, TextField } from "../../kit/compat";
import { Icon, Icons } from "../../kit";
import { derive, fontSize, mix, mixOklch, useTokens } from "../../theme";
import { panelSurface } from "../surfaces";

const NARROW_W = 600;
const ACTION_TEXT = { size: fontSize.md, weight: 500, lineHeight: 24, tracking: 0 };

export const useUserAskLook = () => {
  const t = useTokens();
  return derive(t, "user-ask", (k) => ({
    iconFill: mixOklch(k.c.foreground, 6, "transparent"),
    optionHover: mixOklch(k.c.foreground, 5, "transparent"),
    divider: mixOklch(k.c.foreground, 9, "transparent"),
    navHover: mixOklch(k.c.foreground, 7, "transparent"),
    skipHover: mixOklch(k.c.foreground, 6, "transparent"),
    submitHover: mix(k.c.foreground, 10, k.c.interactive),
    declineFill: mix(k.c.foreground, 7, "transparent"),
    declineHover: mix(k.c.foreground, 11, "transparent"),
    declinePress: mix(k.c.foreground, 15, "transparent"),
  }));
};

/** `.user-ask`: the panel-surface card centred over the composer at min(50rem, 100% − 96px). */
export function UserAskFrame({ label, gap = 12, onLayoutNarrow, keys, onKey, children }: { label?: string; gap?: number; onLayoutNarrow?: (narrow: boolean) => void; keys?: string[]; onKey?: (k: { key: string; chord: string }) => void; children: ReactNode }) {
  const t = useTokens();
  const surface = panelSurface(t);
  const [narrow, setNarrow] = useState(false);
  return (
    <row
      w="full"
      justify="center"
      px={narrow ? 8 : 48}
      mb={10}
      onLayout={(r) => {
        const next = r.w < NARROW_W;
        if (next !== narrow) {
          setNarrow(next);
          onLayoutNarrow?.(next);
        }
      }}
    >
      <col
        role="group"
        label={label}
        w="full"
        maxW={800}
        gap={gap}
        pt={narrow ? 16 + 1 : 18 + 1}
        pb={narrow ? 10 + 1 : 12 + 1}
        px={narrow ? 14 + 1 : 18 + 1}
        radius={22}
        gradient={surface.gradient}
        border={surface.border}
        shadows={[...t.shadow.sm, ...surface.shadows]}
        focusable={Boolean(keys)}
        keys={keys}
        onKey={onKey}
        enter={{ opacity: 0, y: 6, dur: 0.2, bounce: 0 }}
      >
        {children}
      </col>
    </row>
  );
}

export function UserAskError({ children, size = fontSize.base }: { children: ReactNode; size?: number }) {
  const t = useTokens();
  return (
    <row role="alert" align="center" gap={6}>
      <Icon icon={Icons.stella.AlertCircle} size={size} color={t.c.danger} />
      <text size={fontSize.base} lineHeight={fontSize.base * 1.45} tracking={APP_TRACKING} color={t.c.danger}>
        {children}
      </text>
    </row>
  );
}

export function UserAskTiming({ ask, label }: { ask: UserAsk; label?: (remaining: string, ms: number) => string }) {
  const t = useT();
  const tokens = useTokens();
  const remainingMs = useUserAskRemainingMs(ask.blocking ? undefined : ask.deadlineAt);
  if (remainingMs === null) return null;
  const time = formatRemaining(remainingMs);
  return (
    <row role="timer" label={t("userAsk.deadline.remaining", { time })} align="center" gap={5} shrink={false}>
      <Icon icon={Icons.stella.Clock} size={13} color={tokens.c.textWeak} />
      <text size={fontSize.base} color={tokens.c.textWeak} nowrap features="'tnum' 1">
        {label ? label(time, remainingMs) : time}
      </text>
    </row>
  );
}

type FieldInput = { type: string; maxLength?: number };

const inputPropsForField = (field: UserAskField): FieldInput => {
  const masked = field.type === "secret" ? "password" : "text";
  switch (userAskFieldInputKind(field)) {
    case "one_time_code":
      return { type: "text", maxLength: 12 };
    case "card_number":
      return { type: masked, maxLength: 23 };
    case "card_expiry":
      return { type: "text", maxLength: 7 };
    case "card_cvc":
      return { type: masked, maxLength: 4 };
    case "postal_code":
      return { type: masked, maxLength: 12 };
    default:
      return { type: masked };
  }
};

function UserAskHeader({ ask, title, detail, narrow }: { ask: UserAsk; title: string; detail?: string; narrow: boolean }) {
  const t = useT();
  const tokens = useTokens();
  const look = useUserAskLook();
  const remainingMs = useUserAskRemainingMs(ask.blocking ? undefined : ask.deadlineAt);
  const timing = ask.blocking
    ? t("userAsk.blocking")
    : remainingMs === null
      ? null
      : remainingMs === 0
        ? t("userAsk.deadline.closing")
        : t("userAsk.deadline.closes", { time: formatRemaining(remainingMs) });
  const timingEl =
    timing && !(narrow && ask.blocking) ? (
      <row align="center" gap={5} shrink={false} w={narrow ? "full" : undefined}>
        {ask.blocking ? null : <Icon icon={Icons.stella.Clock} size={13} color={tokens.c.textWeak} />}
        <text size={fontSize.base} color={ask.blocking ? tokens.c.textStrong : tokens.c.textWeak} nowrap features="'tnum' 1">
          {timing}
        </text>
      </row>
    ) : null;
  return (
    <row w="full" align="start" wrap gap={12} rowGap={6}>
      <box w={32} h={32} radius={10} fill={look.iconFill} center shrink={false}>
        <Icon icon={Icons.stella.Lock} size={16} color={tokens.c.textStrong} />
      </box>
      <col grow={1} minW={0}>
        <text size={fontSize.base} weight={500} lineHeight={fontSize.base * 1.45} tracking={APP_TRACKING} color={tokens.c.textWeak}>
          {ask.agentLabel ?? t("userAsk.eyebrow.secureInput")}
        </text>
        <text mt={2} size={fontSize.xl} weight={600} lineHeight={fontSize.xl * 1.35} tracking={-0.17} color={tokens.c.textStrong} role="heading">
          {title}
        </text>
        {detail ? (
          <text mt={6} size={fontSize.md} lineHeight={fontSize.md * 1.5} tracking={APP_TRACKING} color={tokens.c.textWeak}>
            {detail}
          </text>
        ) : null}
      </col>
      {timingEl}
    </row>
  );
}

function PrivacyBadge({ sensitive, relayed }: { sensitive: boolean; relayed: boolean }) {
  const t = useT();
  const tokens = useTokens();
  const color = sensitive ? tokens.c.textBase : tokens.c.textWeak;
  return (
    <row
      align="center"
      gap={4}
      shrink={false}
      title={t(sensitive ? (relayed ? "userAsk.secureInput.relayedPrivateNote" : "userAsk.secureInput.privateNote") : "userAsk.secureInput.sharedNote")}
    >
      <Icon icon={sensitive ? Icons.stella.Lock : Icons.stella.Eye} size={11} color={color} />
      <text size={fontSize.sm} lineHeight={fontSize.sm * 1.45} tracking={APP_TRACKING} color={color} nowrap>
        {t(sensitive ? "userAsk.secureInput.privateBadge" : "userAsk.secureInput.sharedBadge")}
      </text>
    </row>
  );
}

function UserAskFieldRow({ field, value, busy, relayed, onValueChange }: { field: UserAskField; value: string; busy: boolean; relayed: boolean; onValueChange: (next: string) => void }) {
  const t = useT();
  const tokens = useTokens();
  const label = field.optional ? `${field.label} · ${t("userAsk.secureInput.optional")}` : field.label;
  const input = inputPropsForField(field);
  return (
    <col gap={5} minW={0} grow={1}>
      <row w="full" wrap align="start" justify="between" gap={8} rowGap={2} minW={0}>
        <text mt={1.2} size={fontSize.sm} weight={500} lineHeight={fontSize.sm * 1.45} tracking={APP_TRACKING} color={tokens.c.textBase} truncate nowrap shrink={false} maxW="full">
          {label}
        </text>
        <PrivacyBadge sensitive={field.sensitive} relayed={relayed} />
      </row>
      {field.type === "choice" ? (
        <Select
          aria-label={label}
          value={value}
          placeholder={t("userAsk.secureInput.choosePlaceholder")}
          disabled={busy}
          w="full"
          options={(field.choices ?? []).map((choice) => ({ value: choice.id, label: choice.label }))}
          onValueChange={onValueChange}
        />
      ) : (
        <box w="full" maxW={field.type === "code" ? 176 : undefined}>
          <TextField
            label={label}
            hideLabel
            aria-label={label}
            description={field.hint}
            type={input.type}
            maxLength={input.maxLength}
            spellCheck={false}
            placeholder={field.placeholder}
            value={value}
            disabled={busy}
            inputStyle={field.type === "code" ? { family: "mono", em: 0.14 } : undefined}
            onChange={(event) => onValueChange(event.target.value)}
          />
        </box>
      )}
    </col>
  );
}

/** `.user-ask__other-input` in its `.user-ask__note` row, or as the deck's "something else" field. */
export function AskTextArea({ value, placeholder, disabled, maxLength, size = fontSize.lg, py = 8.5, onChange, onEnter, onFocus }: { value: string; placeholder: string; disabled: boolean; maxLength?: number; size?: number; py?: number; onChange: (next: string) => void; onEnter: () => void; onFocus?: (focused: boolean) => void }) {
  const tokens = useTokens();
  return (
    <input
      multiline
      minLines={1}
      maxH={160}
      grow={1}
      minW={0}
      py={py}
      value={value}
      placeholder={placeholder}
      placeholderColor={tokens.c.textWeak}
      label={placeholder}
      readOnly={disabled}
      size={size}
      lineHeight={size * 1.4}
      family="sans"
      tracking={-0.01 * size}
      color={tokens.c.textStrong}
      caretColor={tokens.c.textStrong}
      onInput={(next) => onChange(maxLength ? next.slice(0, maxLength) : next)}
      onSubmit={() => onEnter()}
      onFocus={onFocus ? (focused) => onFocus(focused) : undefined}
    />
  );
}

function UserAskSecureInputBody({
  detail,
  relayed,
  busy,
  narrow,
  onAnswerFields,
  onDecline,
}: {
  detail: UserAskSecureInputDetail;
  relayed: boolean;
  busy: boolean;
  narrow: boolean;
  onAnswerFields: (fields: readonly UserAskAnswerFieldValue[], remember: boolean | undefined, note: string) => void;
  onDecline: (note: string) => void;
}) {
  const t = useT();
  const tokens = useTokens();
  const look = useUserAskLook();
  const [values, setValues] = useState<Record<string, string>>({});
  const offersRemember = userAskOffersRemember(detail);
  const [remember, setRemember] = useState(true);
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState<string | null>(null);
  const [noteFocused, setNoteFocused] = useState(false);
  const [noteHovered, setNoteHovered] = useState(false);

  const submit = () => {
    if (busy) return;
    const blank = detail.fields.find((field) => !field.optional && !(values[field.id] ?? "").trim());
    if (blank) {
      setMissing(t("userAsk.secureInput.required", { label: blank.label }));
      return;
    }
    setMissing(null);
    onAnswerFields(
      detail.fields
        .map((field) => ({ field, value: (values[field.id] ?? "").trim() }))
        .filter((entry) => entry.value.length > 0)
        .map((entry): UserAskAnswerFieldValue => ({ fieldId: entry.field.id, kind: "plain", value: entry.value })),
      offersRemember ? remember : undefined,
      note.trim(),
    );
  };

  const saveNote = detail.save?.replacing
    ? t("userAsk.secureInput.replacing", { label: detail.save.label })
    : detail.save?.usingSaved
      ? t("userAsk.secureInput.usingSaved", { label: detail.save.label })
      : null;

  return (
    <Form onSubmit={submit}>
      <col w="full" gap={10} pl={narrow ? 0 : 44}>
        {saveNote ? (
          <row role="note" align="center" gap={6}>
            <Icon icon={Icons.stella.KeyRound} size={12} color={tokens.c.textBase} />
            <text size={fontSize.sm} lineHeight={fontSize.sm * 1.45} color={tokens.c.textBase}>
              {saveNote}
            </text>
          </row>
        ) : null}
        <row w="full" wrap gap={12} rowGap={10}>
          {detail.fields.map((field) => (
            <UserAskFieldRow
              key={field.id}
              field={field}
              busy={busy}
              relayed={relayed}
              value={values[field.id] ?? ""}
              onValueChange={(next) => setValues((current) => ({ ...current, [field.id]: next }))}
            />
          ))}
        </row>
        {missing ? <UserAskError size={12}>{missing}</UserAskError> : null}
        <row w="full" minH={36} mt={-2} px={12} radius={12} fill={noteFocused || noteHovered ? tokens.c.selectFill : undefined} onHover={setNoteHovered} motion={{ dur: 0.12, bounce: 0 }}>
          <AskTextArea value={note} placeholder={t("userAsk.secureInput.note")} disabled={busy} maxLength={USER_ASK_MAX_NOTE} size={fontSize.base} py={8} onChange={setNote} onEnter={submit} onFocus={setNoteFocused} />
        </row>
        <row w="full" align="center" justify="end" gap={6} wrap>
          {offersRemember ? (
            <row grow={1} minW={0} shrink>
            <row
              align="center"
              gap={7}
              minW={0}
              shrink
              cursor="pointer"
              title={
                remember
                  ? t("userAsk.secureInput.rememberOn", { label: detail.save?.label ?? "", place: settingsPlace(t, "settings.secureValues.title") })
                  : t("userAsk.secureInput.rememberOff")
              }
              onPress={busy ? undefined : () => setRemember((on) => !on)}
            >
              <NativeCheckbox w={14} h={14} checked={remember} disabled={busy} accent={tokens.c.textStrong} onChange={setRemember} label={t(relayed ? "userAsk.secureInput.rememberRelayed" : "userAsk.secureInput.remember")} />
              <text size={fontSize.sm} lineHeight={fontSize.sm * 1.45} tracking={APP_TRACKING} color={tokens.c.textBase} truncate nowrap minW={0}>
                {t(relayed ? "userAsk.secureInput.rememberRelayed" : "userAsk.secureInput.remember")}
              </text>
            </row>
            </row>
          ) : null}
          <row align="center" gap={6} shrink={false}>
            <Button
              type="button"
              variant="ghost"
              className="pill-btn user-ask__decline-btn"
              disabled={busy}
              minH={32}
              h={32}
              px={16 + 1}
              border="transparent"
              fill={look.declineFill}
              hover={look.declineHover}
              press={look.declinePress}
              color={tokens.c.textBase}
              onClick={() => onDecline(note.trim())}
            >
              <T {...ACTION_TEXT} nowrap>
                {t("userAsk.secureInput.decline")}
              </T>
            </Button>
            <Button type="submit" variant="primary" className="pill-btn pill-btn--primary" disabled={busy} minH={32} h={32} px={16 + 1}>
              <T {...ACTION_TEXT} nowrap>
                {busy ? t("userAsk.secureInput.submitting") : t("userAsk.secureInput.submit")}
              </T>
            </Button>
          </row>
        </row>
      </col>
    </Form>
  );
}

export function UserAskSecureInputCard({ ask, detail }: { ask: UserAsk; detail: UserAskSecureInputDetail }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);

  const send = useCallback(
    async (fields: readonly UserAskAnswerFieldValue[], remember: boolean | undefined, note: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const ok = await answerUserAsk({ askId: ask.askId, revision: ask.revision, kind: "fields", fields, ...(remember === undefined ? {} : { remember }), ...(note ? { note } : {}) });
      if (!ok) {
        setError(t("userAsk.errors.answer"));
        setBusy(false);
        return;
      }
      recordUserAskAnswer(ask.conversationId, userAskSecureRecord(ask, "provided", note));
    },
    [ask, busy, t],
  );

  const decline = useCallback(
    async (note: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      if (!(await declineUserAsk(ask.askId, note))) {
        setError(t("userAsk.errors.decline"));
        setBusy(false);
        return;
      }
      recordUserAskAnswer(ask.conversationId, userAskSecureRecord(ask, "declined", note));
    },
    [ask, busy, t],
  );

  return (
    <UserAskFrame label={detail.purpose} onLayoutNarrow={setNarrow}>
      <UserAskHeader ask={ask} title={detail.purpose} detail={detail.detail} narrow={narrow} />
      <UserAskSecureInputBody detail={detail} relayed={ask.relayed === true} busy={busy} narrow={narrow} onAnswerFields={(fields, remember, note) => void send(fields, remember, note)} onDecline={(note) => void decline(note)} />
      {error ? <UserAskError>{error}</UserAskError> : null}
    </UserAskFrame>
  );
}

