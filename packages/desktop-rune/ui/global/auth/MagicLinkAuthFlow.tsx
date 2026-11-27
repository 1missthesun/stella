import { Button, Form, T, TextField, type ButtonProps, type DomEvent } from "../../kit/compat";
import type { Style } from "../../theme";
import type { FormEvent, ReactNode } from "react";
import { useT } from "@/shared/i18n";
import { useMagicLinkAuth } from "@/global/auth/useMagicLinkAuth";
import {
  detectEmailProvider,
  openEmailProvider,
} from "@/global/auth/lib/email-providers";

type MagicLinkAuthFlowProps = {
  className?: string;
  intro?: ReactNode;
  emailLabel?: string;
  hideEmailLabel?: boolean;
  emailPlaceholder?: string;
  inputVariant?: "normal" | "ghost";
  submitLabel?: string;
  sendingLabel?: string;
  buttonClassName?: string;
  buttonVariant?: ButtonProps["variant"];
  buttonSize?: ButtonProps["size"];
  autoFocus?: boolean;
  sentMessage?: ReactNode;
  openInboxClassName?: string;
  openInboxLabel?: (providerName: string) => string;
  resendCooldownLabel?: (secondsLeft: number) => string;
  resendLabel?: string;
  skipClassName?: string;
  skipLabel?: string;
  onSkip?: () => void;
  /** The caller's rules for each part (desktop-ui's `*ClassName` props). */
  styles?: Partial<Record<"root" | "form" | "inputWrapper" | "input" | "button" | "extras" | "extrasOpen" | "extrasInner" | "sent" | "openInbox" | "error" | "skip", Style>>;
};

export function MagicLinkAuthFlow({
  intro,
  emailLabel: emailLabelProp,
  hideEmailLabel = false,
  emailPlaceholder: emailPlaceholderProp,
  inputVariant = "normal",
  submitLabel: submitLabelProp,
  sendingLabel: sendingLabelProp,
  buttonClassName,
  buttonVariant = "primary",
  buttonSize = "normal",
  autoFocus = false,
  sentMessage: sentMessageProp,
  openInboxClassName,
  openInboxLabel: openInboxLabelProp,
  resendCooldownLabel: resendCooldownLabelProp,
  resendLabel: resendLabelProp,
  skipClassName,
  skipLabel: skipLabelProp,
  onSkip,
  styles = {},
}: MagicLinkAuthFlowProps) {
  const t = useT();
  const emailLabel = emailLabelProp ?? t("global.auth.emailLabel");
  const emailPlaceholder =
    emailPlaceholderProp ?? t("global.auth.emailPlaceholder");
  const submitLabel = submitLabelProp ?? t("global.auth.sendSignInEmail");
  const sendingLabel = sendingLabelProp ?? t("global.auth.sending");
  const sentMessage = sentMessageProp ?? t("global.auth.checkInbox");
  const openInboxLabel =
    openInboxLabelProp ??
    ((provider: string) => t("global.auth.openInbox", { provider }));
  const resendCooldownLabel =
    resendCooldownLabelProp ??
    ((secondsLeft: number) =>
      t("global.auth.resendIn", { seconds: secondsLeft }));
  const resendLabel = resendLabelProp ?? t("global.auth.resendEmail");
  const skipLabel = skipLabelProp ?? t("global.auth.skipForNow");
  const {
    email,
    setEmail,
    status,
    sentToEmail,
    error,
    handleMagicLinkSubmit,
    resend,
    resendCooldownSeconds,
    isResending,
  } = useMagicLinkAuth();

  const normalized = email.trim().toLowerCase();
  const matchesSent = sentToEmail !== null && normalized === sentToEmail;
  const showExtras = matchesSent && (status === "sent" || status === "verifying");
  const provider = showExtras ? detectEmailProvider(normalized) : null;

  const inFlight = status === "sending" || isResending;
  const resendDisabled = matchesSent && (resendCooldownSeconds > 0 || isResending);
  const submitDisabled =
    !normalized || inFlight || status === "verifying" || resendDisabled;

  const submitText =
    status === "sending"
      ? sendingLabel
      : status === "verifying"
        ? t("global.auth.signingIn")
        : isResending
          ? sendingLabel
          : matchesSent
            ? resendCooldownSeconds > 0
              ? resendCooldownLabel(resendCooldownSeconds)
              : resendLabel
            : submitLabel;

  const onSubmit = (event: DomEvent) => {
    event.preventDefault();
    if (submitDisabled) return;
    if (matchesSent) {
      void resend();
    } else {
      void handleMagicLinkSubmit(event as unknown as FormEvent);
    }
  };

  return (
    <col w="full" {...styles.root}>
      {intro}
      <Form w="full" {...styles.form} onSubmit={onSubmit}>
        <TextField
          label={emailLabel}
          {...(hideEmailLabel ? { hideLabel: true } : {})}
          type="email"
          placeholder={emailPlaceholder}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          autoFocus={autoFocus}
          variant={inputVariant}
          wrapperStyle={styles.inputWrapper}
          inputStyle={styles.input}
        />
        <Button {...(styles.button as Omit<Style, "size">)} type="submit" variant={buttonVariant} size={buttonSize} className={buttonClassName} disabled={submitDisabled}>
          {submitText}
        </Button>
      </Form>

      <col w="full" h={showExtras ? undefined : 0} clip={0} layout={0.28} {...styles.extras} {...(showExtras ? styles.extrasOpen : null)} inert={!showExtras}>
        <col w="full" {...styles.extrasInner}>
          {sentMessage ? (
            <T w="full" {...styles.sent}>{sentMessage}</T>
          ) : null}
          {provider ? (
            <Button {...(styles.openInbox as Omit<Style, "size">)} type="button" variant="primary" className={openInboxClassName} onClick={() => openEmailProvider(provider)}>
              {openInboxLabel(provider.name)}
            </Button>
          ) : null}
        </col>
      </col>

      {error ? <T w="full" {...styles.error}>{error}</T> : null}

      {onSkip ? (
        <Button {...(styles.skip as Omit<Style, "size">)} type="button" variant="ghost" className={skipClassName} onClick={onSkip}>
          {skipLabel}
        </Button>
      ) : null}
    </col>
  );
}
