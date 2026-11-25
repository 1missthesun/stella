import { Button, Dialog, DialogCloseButton, DialogContent, DialogHeader, DialogTitle, T, TextField, showToast } from "../../kit/compat";
import { useAccountDialogs } from "./account-dialogs.styles";
import { usePill } from "../shared/pill.styles";
import { useCallback, useEffect, useState } from "react";
import {
  FEEDBACK_CONTACT_MAX_CHARS,
  FEEDBACK_MAX_CHARS,
} from "@stella/contracts/backend/preferences";
import { useCurrentUser } from "@/global/auth/hooks/use-current-user";
import { backendClient } from "@/platform/backend/backend-client";
import { useT } from "@/shared/i18n";
import {
  readFeedbackClientInfo,
  type FeedbackClientInfo,
} from "@/shell/sidebar/feedback-client-info";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
}

export const FEEDBACK_MAX_LENGTH = FEEDBACK_MAX_CHARS;

interface FeedbackFormProps {
  onCancel: () => void;
  onSubmitted?: () => void;
}

const FeedbackForm = ({ onCancel, onSubmitted }: FeedbackFormProps) => {
  const s = useAccountDialogs();
  const t = useT();
  const { user, hasConnectedAccount } = useCurrentUser();
  const accountEmail = hasConnectedAccount ? user?.email : undefined;
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [clientInfo, setClientInfo] = useState<FeedbackClientInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let live = true;
    void readFeedbackClientInfo().then((info) => {
      if (live) setClientInfo(info);
    });
    return () => {
      live = false;
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const info = clientInfo ?? (await readFeedbackClientInfo());
      const trimmedContact = accountEmail ? "" : contact.trim();
      await backendClient.call("feedback.submit", {
        message: trimmed,
        platform: info.platform,
        ...(info.appVersion ? { appVersion: info.appVersion } : {}),
        ...(trimmedContact ? { contact: trimmedContact } : {}),
      });
      onCancel();
      onSubmitted?.();
      showToast({
        title: t("shell.sidebar.feedback.toasts.sentTitle"),
        description: t("shell.sidebar.feedback.toasts.sentDescription"),
      });
    } catch (error) {
      const description =
        error instanceof Error ? error.message : t("chat.tryAgainHint");
      showToast({
        title: t("shell.sidebar.feedback.toasts.failedTitle"),
        description,
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }, [text, contact, accountEmail, clientInfo, submitting, onCancel, onSubmitted, t]);

  const sentWith = [
    accountEmail ?? (contact.trim() || null),
    clientInfo?.appVersion ? `Stella ${clientInfo.appVersion}` : null,
    clientInfo?.platform ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <T w="full" {...s.sidebarFeedbackDescription}>
        {accountEmail
          ? t("shell.sidebar.feedback.description")
          : t("shell.sidebar.feedback.descriptionSignedOut")}
      </T>
      <col w="full" {...s.sidebarFeedbackBody}>
        <TextField multiline hideLabel label={t("shell.sidebar.feedback.fieldLabel")} placeholder={t("shell.sidebar.feedback.placeholder")} rows={5} maxLength={FEEDBACK_MAX_LENGTH} value={text} onChange={(event) => setText(event.target.value)} autoFocus disabled={submitting} />
        <T w="full" {...s.sidebarFeedbackCharacterCount}>
          {text.length.toLocaleString()} /{" "}
          {FEEDBACK_MAX_LENGTH.toLocaleString()}
        </T>
        {accountEmail ? null : (
          <col w="full" {...s.sidebarFeedbackContact}>
            <TextField type="email" autoComplete="email" label={t("shell.sidebar.feedback.contactLabel")} placeholder={t("shell.sidebar.feedback.contactPlaceholder")} maxLength={FEEDBACK_CONTACT_MAX_CHARS} value={contact} onChange={(event) => setContact(event.target.value)} disabled={submitting} />
          </col>
        )}
        {sentWith ? (
          <T w="full" {...s.sidebarFeedbackSentWith}>
            {t("shell.sidebar.feedback.sentWith", { details: sentWith })}
          </T>
        ) : null}
      </col>
      <row {...s.sidebarConfirmActions}>
        <Button variant="ghost" size="large" className="pill-btn pill-btn--lg" onClick={onCancel} disabled={submitting}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" size="large" className="pill-btn pill-btn--primary pill-btn--lg" onClick={() => {
            void handleSubmit();
          }} disabled={submitting || text.trim().length === 0}>
          {submitting
            ? t("shell.sidebar.feedback.sending")
            : t("shell.sidebar.feedback.send")}
        </Button>
      </row>
    </>
  );
};

export const FeedbackDialog = ({
  open,
  onOpenChange,
  onSubmitted,
}: FeedbackDialogProps) => {
  const s = useAccountDialogs();
  const t = useT();
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fit {...s.sidebarFeedbackDialog}>
        <DialogHeader {...s.sidebarFeedbackDialog_dialogHeader}>
          <DialogTitle {...s.sidebarFeedbackDialog_dialogTitle}>{t("shell.sidebar.feedback.title")}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <FeedbackForm onCancel={handleClose} onSubmitted={onSubmitted} />
      </DialogContent>
    </Dialog>
  );
};
