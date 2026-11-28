/// <reference path="../../../js/natives.d.ts" />
import { useState } from "react";
import { FEEDBACK_CONTACT_MAX_CHARS, FEEDBACK_MAX_CHARS } from "@stella/contracts/backend/preferences";
import { useCurrentUser } from "@/global/auth/hooks/use-current-user";
import { backendClient } from "@/platform/backend/backend-client";
import { useT } from "@/shared/i18n";
import { rt, useRn } from "../rn";
import type { PhoneInsets } from "../insets";

// packages/mobile's FeedbackSheet: a page sheet over the drawer with the message, a contact
// field when signed out, what goes with it, and Send; it says thanks in place once sent.
// It submits through the desktop's feedback flow (`feedback.submit`).

const F = {
  title: rt(18, 600, -0.4),
  close: rt(16, 600),
  description: rt(14, 400, 0, 20),
  input: rt(15, 400, 0, 21),
  count: rt(12, 400),
  sentWith: rt(12, 400, 0, 17),
  error: rt(13, 400, 0, 18),
  send: rt(15, 600, -0.3),
  sentTitle: rt(17, 600),
} as const;

const SHEET_RAISE = 90;
const SHEET_GAP = 10;
const SHEET_RADIUS = 12;

const appPlatform = (): string => `${__native.env.platform === "ios" ? "iOS" : "Android"} ${__native.env.osVersion}`;

type Status = { kind: "editing" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

export function FeedbackSheet({ open, insets, onClose }: { open: boolean; insets: PhoneInsets; onClose: () => void }) {
  const c = useRn();
  if (!open) return null;
  const top = insets.top + SHEET_GAP;
  return (
    <>
      <box fixed absolute={{ left: 0, top: 0, right: 0 }} h={top + SHEET_RADIUS} raise={SHEET_RAISE} fill="rgba(0,0,0,0.35)" inert enter={{ opacity: 0, dur: 0.3, bounce: 0 }} exit={{ opacity: 0, dur: 0.25, bounce: 0 }} />
      <col
        id="phone-feedback-sheet"
        role="dialog"
        fixed
        absolute={{ left: 0, top, right: 0, bottom: 0 }}
        raise={SHEET_RAISE + 1}
        fill={c.background}
        corners={[SHEET_RADIUS, SHEET_RADIUS, 0, 0]}
        clip={SHEET_RADIUS}
        borderSides={[0.5, 0, 0, 0]}
        border={c.border}
        modal={{}}
        onDismiss={onClose}
        enter={{ y: 900, dur: 0.42, bounce: 0 }}
        exit={{ y: 900, dur: 0.32, bounce: 0 }}
      >
        <FeedbackForm insets={insets} onClose={onClose} />
      </col>
    </>
  );
}

function FeedbackForm({ insets, onClose }: { insets: PhoneInsets; onClose: () => void }) {
  const c = useRn();
  const t = useT();
  const { user, hasConnectedAccount } = useCurrentUser();
  const accountEmail = hasConnectedAccount ? user?.email || null : null;
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [platform] = useState(appPlatform);

  const sentWith = [accountEmail ?? (contact.trim() || null), platform].filter(Boolean).join(" · ");
  const sending = status.kind === "sending";
  const trimmed = text.trim();

  const submit = async () => {
    if (!trimmed || sending) return;
    setStatus({ kind: "sending" });
    try {
      const trimmedContact = accountEmail ? "" : contact.trim();
      await backendClient.call("feedback.submit", { message: trimmed, platform, ...(trimmedContact ? { contact: trimmedContact } : {}) });
      setStatus({ kind: "sent" });
    } catch (e) {
      setStatus({ kind: "failed", message: e instanceof Error && e.message ? e.message : t("chat.tryAgainHint") });
    }
  };

  const field = { fill: c.surface, border: c.border, borderWidth: 0.5, radius: 12, px: 14, py: 12, ...F.input, color: c.text, placeholderColor: c.textMuted, caretColor: c.accent } as const;
  const off = sending || !trimmed;

  return (
    <col grow={1} minH={0} pb={insets.bottom} keyboard={{ pad: [insets.bottom, 0] }}>
      <row align="center" justify="between" px={20} py={14} borderSides={[0, 0, 1, 0]} border={c.border} shrink={false}>
        <text role="heading" {...F.title} color={c.text}>
          {t("shell.sidebar.feedback.title")}
        </text>
        <box id="phone-feedback-close" role="button" focusable px={8} py={4} pressScale={0.97} onPress={onClose}>
          <text {...F.close} color={c.accent}>
            {status.kind === "sent" ? t("mobile.common.done") : t("common.cancel")}
          </text>
        </box>
      </row>
      {status.kind === "sent" ? (
        <col id="phone-feedback-sent" pad={20} pb={40} gap={12}>
          <text {...F.sentTitle} color={c.text}>
            {t("shell.sidebar.feedback.toasts.sentTitle")}
          </text>
          <text {...F.description} color={c.textMuted}>
            {t("shell.sidebar.feedback.toasts.sentDescription")}
          </text>
        </col>
      ) : (
        <col grow={1} minH={0} scrollY pad={20} pb={40} gap={12}>
          <text {...F.description} color={c.textMuted}>
            {accountEmail ? t("shell.sidebar.feedback.description") : t("shell.sidebar.feedback.descriptionSignedOut")}
          </text>
          <input
            id="phone-feedback-input"
            label={t("shell.sidebar.feedback.fieldLabel")}
            placeholder={t("shell.sidebar.feedback.placeholder")}
            value={text}
            onInput={(v) => setText(v.slice(0, FEEDBACK_MAX_CHARS))}
            readOnly={sending}
            multiline
            autoFocus
            minH={160}
            {...field}
          />
          <text {...F.count} color={c.textMuted} selfAlign="end">
            {`${text.length.toLocaleString()} / ${FEEDBACK_MAX_CHARS.toLocaleString()}`}
          </text>
          {accountEmail ? null : (
            <input
              id="phone-feedback-contact"
              label={t("shell.sidebar.feedback.contactLabel")}
              placeholder={t("shell.sidebar.feedback.contactLabel")}
              value={contact}
              onInput={(v) => setContact(v.slice(0, FEEDBACK_CONTACT_MAX_CHARS))}
              readOnly={sending}
              spellcheck={false}
              {...field}
            />
          )}
          <text id="phone-feedback-sent-with" {...F.sentWith} color={c.textMuted}>
            {t("shell.sidebar.feedback.sentWith", { details: sentWith })}
          </text>
          {status.kind === "failed" ? (
            <text {...F.error} color={c.danger}>
              {`${t("shell.sidebar.feedback.toasts.failedTitle")}: ${status.message}`}
            </text>
          ) : null}
          <row
            id="phone-feedback-send"
            role="button"
            label={sending ? t("shell.sidebar.feedback.sending") : t("shell.sidebar.feedback.send")}
            focusable={!off}
            disabled={off}
            mt={4}
            minH={44}
            px={24}
            py={12}
            radius={22}
            fill={c.accent}
            center
            opacity={off ? 0.65 : 1}
            onPress={off ? undefined : () => void submit()}
          >
            <text {...F.send} color={c.accentForeground}>
              {sending ? t("shell.sidebar.feedback.sending") : t("shell.sidebar.feedback.send")}
            </text>
          </row>
        </col>
      )}
    </col>
  );
}
