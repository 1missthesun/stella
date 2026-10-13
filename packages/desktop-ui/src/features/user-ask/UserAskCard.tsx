import { useCallback, useState, type FormEvent } from "react";
import type {
  UserAsk,
  UserAskAnswerFieldValue,
  UserAskField,
  UserAskSecureInputDetail,
} from "@stella/contracts/user-ask";
import { userAskOffersRemember } from "@stella/contracts/user-ask";
import { AlertCircle, Clock, Eye, KeyRound, Lock } from "@/ui/icons";
import { Button } from "@/ui/button";
import { Select } from "@/ui/select";
import { TextField } from "@/ui/text-field";
import { useT } from "@/shared/i18n";
import {
  answerUserAsk,
  declineUserAsk,
  useUserAskRemainingMs,
} from "./user-ask-store";
import { formatRemaining } from "./format-remaining";
import "./user-ask-card.css";

const inputTypeForField = (field: UserAskField): string =>
  field.type === "secret" ? "password" : "text";

function UserAskHeader({
  ask,
  title,
  detail,
}: {
  ask: UserAsk;
  title: string;
  detail?: string;
}) {
  const t = useT();
  const remainingMs = useUserAskRemainingMs(
    ask.blocking ? undefined : ask.deadlineAt,
  );
  const timing = ask.blocking
    ? t("userAsk.blocking")
    : remainingMs === null
      ? null
      : remainingMs === 0
        ? t("userAsk.deadline.closing")
        : t("userAsk.deadline.closes", { time: formatRemaining(remainingMs) });

  return (
    <div className="user-ask__head">
      <span className="user-ask__icon" aria-hidden="true">
        <Lock size={16} />
      </span>
      <div className="user-ask__heading">
        <p className="user-ask__eyebrow">
          {ask.agentLabel ?? t("userAsk.eyebrow.secureInput")}
        </p>
        <h3 className="user-ask__title">{title}</h3>
        {detail ? <p className="user-ask__detail">{detail}</p> : null}
      </div>
      {timing ? (
        <span
          className={`user-ask__timing${ask.blocking ? " user-ask__timing--blocking" : ""}`}
        >
          {ask.blocking ? null : <Clock size={13} aria-hidden="true" />}
          {timing}
        </span>
      ) : null}
    </div>
  );
}

function UserAskFieldRow({
  field,
  value,
  busy,
  relayed,
  onValueChange,
}: {
  field: UserAskField;
  value: string;
  busy: boolean;
  relayed: boolean;
  onValueChange: (next: string) => void;
}) {
  const t = useT();
  const sensitive = field.sensitive;
  const label = field.optional
    ? `${field.label} · ${t("userAsk.secureInput.optional")}`
    : field.label;

  const privacyLabel = t(
    sensitive
      ? "userAsk.secureInput.privateBadge"
      : "userAsk.secureInput.sharedBadge",
  );

  return (
    <div className="user-ask__field" data-field-type={field.type}>
      <div className="user-ask__field-head">
        <span className="user-ask__field-label">{label}</span>
        <span
          className={`user-ask__badge${sensitive ? " user-ask__badge--private" : ""}`}
          title={t(
            sensitive
              ? relayed
                ? "userAsk.secureInput.relayedPrivateNote"
                : "userAsk.secureInput.privateNote"
              : "userAsk.secureInput.sharedNote",
          )}
        >
          {sensitive ? (
            <Lock size={11} aria-hidden="true" />
          ) : (
            <Eye size={11} aria-hidden="true" />
          )}
          {privacyLabel}
        </span>
      </div>
      {field.type === "choice" ? (
        <Select
          aria-label={label}
          value={value}
          placeholder={t("userAsk.secureInput.choosePlaceholder")}
          disabled={busy}
          className="user-ask__field-select"
          options={(field.choices ?? []).map((choice) => ({
            value: choice.id,
            label: choice.label,
          }))}
          onValueChange={onValueChange}
        />
      ) : (
        <TextField
          label={label}
          hideLabel
          aria-label={label}
          description={field.hint}
          type={inputTypeForField(field)}
          inputMode={field.type === "code" ? "numeric" : undefined}
          autoComplete={field.type === "secret" ? "off" : undefined}
          spellCheck={false}
          maxLength={field.type === "code" ? 12 : undefined}
          className={field.type === "code" ? "user-ask__field-code" : undefined}
          placeholder={field.placeholder}
          value={value}
          disabled={busy}
          onChange={(event) => onValueChange(event.target.value)}
        />
      )}
    </div>
  );
}

function UserAskSecureInputBody({
  detail,
  relayed,
  busy,
  onAnswerFields,
  onDecline,
}: {
  detail: UserAskSecureInputDetail;
  relayed: boolean;
  busy: boolean;
  onAnswerFields: (
    fields: readonly UserAskAnswerFieldValue[],
    remember: boolean | undefined,
  ) => void;
  onDecline: (reason: string) => void;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const offersRemember = userAskOffersRemember(detail);
  const [remember, setRemember] = useState(true);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const blank = detail.fields.find(
      (field) => !field.optional && !(values[field.id] ?? "").trim(),
    );
    if (blank) {
      setMissing(t("userAsk.secureInput.required", { label: blank.label }));
      return;
    }
    setMissing(null);
    onAnswerFields(
      detail.fields
        .map((field) => ({ field, value: (values[field.id] ?? "").trim() }))
        .filter((entry) => entry.value.length > 0)
        .map(
          (entry): UserAskAnswerFieldValue => ({
            fieldId: entry.field.id,
            kind: "plain",
            value: entry.value,
          }),
        ),
      offersRemember ? remember : undefined,
    );
  };

  return (
    <form className="user-ask__body" onSubmit={submit}>
      {detail.save?.replacing ? (
        <p className="user-ask__replacing" role="note">
          <KeyRound size={12} aria-hidden="true" />
          {t("userAsk.secureInput.replacing", { label: detail.save.label })}
        </p>
      ) : null}
      <div
        className="user-ask__fields"
        data-count={detail.fields.length > 1 ? "many" : "one"}
      >
        {detail.fields.map((field) => (
          <UserAskFieldRow
            key={field.id}
            field={field}
            busy={busy}
            relayed={relayed}
            value={values[field.id] ?? ""}
            onValueChange={(next) =>
              setValues((current) => ({ ...current, [field.id]: next }))
            }
          />
        ))}
      </div>
      {missing ? (
        <p className="user-ask__error" role="alert">
          <AlertCircle size={12} aria-hidden="true" />
          {missing}
        </p>
      ) : null}
      {declining ? (
        <div className="user-ask__decline">
          <TextField
            label={t("userAsk.secureInput.declineReason")}
            hideLabel
            aria-label={t("userAsk.secureInput.declineReason")}
            placeholder={t("userAsk.secureInput.declineReasonPlaceholder")}
            value={reason}
            maxLength={200}
            disabled={busy}
            autoFocus
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onDecline(reason.trim());
              }
            }}
          />
        </div>
      ) : null}
      <div className="user-ask__actions">
        {offersRemember && !declining ? (
          <label
            className="user-ask__remember"
            title={
              remember
                ? t("userAsk.secureInput.rememberOn", {
                    label: detail.save?.label ?? "",
                  })
                : t("userAsk.secureInput.rememberOff")
            }
          >
            <input
              type="checkbox"
              checked={remember}
              disabled={busy}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span className="user-ask__remember-label">
              {t(
                relayed
                  ? "userAsk.secureInput.rememberRelayed"
                  : "userAsk.secureInput.remember",
              )}
            </span>
          </label>
        ) : null}
        <div className="user-ask__buttons">
          {declining ? (
            <>
              <Button
                type="button"
                variant="ghost"
                className="pill-btn"
                disabled={busy}
                onClick={() => setDeclining(false)}
              >
                {t("userAsk.secureInput.declineBack")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="pill-btn pill-btn--danger"
                disabled={busy}
                onClick={() => onDecline(reason.trim())}
              >
                {t("userAsk.secureInput.declineConfirm")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                className="pill-btn"
                disabled={busy}
                onClick={() => setDeclining(true)}
              >
                {t("userAsk.secureInput.decline")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="pill-btn pill-btn--primary"
                disabled={busy}
              >
                {busy
                  ? t("userAsk.secureInput.submitting")
                  : t("userAsk.secureInput.submit")}
              </Button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}

export function UserAskSecureInputCard({
  ask,
  detail,
}: {
  ask: UserAsk;
  detail: UserAskSecureInputDetail;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (
      fields: readonly UserAskAnswerFieldValue[],
      remember: boolean | undefined,
    ) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const ok = await answerUserAsk({
        askId: ask.askId,
        revision: ask.revision,
        kind: "fields",
        fields,
        ...(remember === undefined ? {} : { remember }),
      });
      if (!ok) {
        setError(t("userAsk.errors.answer"));
        setBusy(false);
      }
    },
    [ask.askId, ask.revision, busy, t],
  );

  const decline = useCallback(
    async (reason: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      if (!(await declineUserAsk(ask.askId, reason))) {
        setError(t("userAsk.errors.decline"));
        setBusy(false);
      }
    },
    [ask.askId, busy, t],
  );

  return (
    <section
      className="user-ask"
      data-ask-id={ask.askId}
      data-ask-kind="secure_input"
      aria-live="polite"
    >
      <UserAskHeader ask={ask} title={detail.purpose} detail={detail.detail} />
      <UserAskSecureInputBody
        detail={detail}
        relayed={ask.relayed === true}
        busy={busy}
        onAnswerFields={(fields, remember) => void send(fields, remember)}
        onDecline={(reason) => void decline(reason)}
      />
      {error ? (
        <p className="user-ask__error" role="alert">
          <AlertCircle size={13} aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </section>
  );
}
