"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowRight, MailCheck, X } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { clearCachedToken } from "@/lib/auth-token";
import { reportGoogleAdsSignup } from "@/components/google-ads-tag";
import { useMagicLinkAuth } from "@/lib/use-magic-link-auth";
import { isBackendConfigured } from "@/lib/backend-url";
import formStyles from "@/app/sign-in/sign-in.module.css";
import { SocialSignInButtons } from "./social-sign-in-buttons";
import {
  openSignInDialog,
  SIGN_IN_DIALOG_EVENT,
} from "./sign-in-dialog-events";
import styles from "./sign-in-dialog.module.css";
import { StellaMark } from "@/components/stella-mark";

const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{8,2048}$/;

export { openSignInDialog } from "./sign-in-dialog-events";

export function SignInDialogProvider({
  children,
  initiallyOpen = false,
}: {
  children?: ReactNode;
  initiallyOpen?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);
  useOAuthReturnToken(close);
  useCloseWhenSignedIn(isOpen, close);

  const open = useCallback(() => {
    if (!isBackendConfigured()) {
      window.location.href = "/sign-in";
      return;
    }
    setIsOpen(true);
  }, []);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (isOpen && !node.open) {
      node.showModal();
    } else if (!isOpen && node.open) {
      node.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const handler = () => open();
    window.addEventListener(SIGN_IN_DIALOG_EVENT, handler);
    return () => window.removeEventListener(SIGN_IN_DIALOG_EVENT, handler);
  }, [open]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const onClose = () => setIsOpen(false);
    const onCancel = (event: Event) => {
      event.preventDefault();
      setIsOpen(false);
    };
    node.addEventListener("close", onClose);
    node.addEventListener("cancel", onCancel);
    return () => {
      node.removeEventListener("close", onClose);
      node.removeEventListener("cancel", onCancel);
    };
  }, []);

  return (
    <>
      {children}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-label="Sign in to Stella"
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            setIsOpen(false);
          }
        }}
      >
        <div className={styles.shell}>
          <button
            type="button"
            className={styles.close}
            aria-label="Close sign-in"
            onClick={close}
          >
            <X size={16} aria-hidden="true" />
          </button>
          {isOpen ? <DialogBody onClose={close} /> : null}
        </div>
      </dialog>
    </>
  );
}

let returnTokenVerification: Promise<boolean> | null = null;

function verifyReturnToken(token: string): Promise<boolean> {
  returnTokenVerification ??= (async () => {
    try {
      await authClient.$fetch("/one-time-token/verify", {
        method: "POST",
        body: { token },
        throw: true,
      });
      clearCachedToken();
      const store = (
        authClient as unknown as {
          $store?: { notify: (signal: string) => void };
        }
      ).$store;
      store?.notify("$sessionSignal");
      reportGoogleAdsSignup();
      return true;
    } catch {
      return false;
    }
  })();
  return returnTokenVerification;
}

function useOAuthReturnToken(onSignedIn: () => void) {
  useEffect(() => {
    if (!isBackendConfigured()) return;
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#\??/, ""));
    const token = fragment.get("ott") ?? url.searchParams.get("ott");
    if (!token || !AUTH_TOKEN_PATTERN.test(token)) return;

    fragment.delete("ott");
    url.searchParams.delete("ott");
    const remainingFragment = fragment.toString();
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${remainingFragment ? `#${remainingFragment}` : ""}`,
    );

    void verifyReturnToken(token).then((signedIn) => {
      if (signedIn) onSignedIn();
      else openSignInDialog();
    });
  }, [onSignedIn]);
}

function useCloseWhenSignedIn(isOpen: boolean, close: () => void) {
  const session = authClient.useSession();
  const user = (
    session.data as { user?: { isAnonymous?: boolean | null } } | null
  )?.user;
  const signedIn = Boolean(user) && user?.isAnonymous !== true;

  useEffect(() => {
    if (isOpen && signedIn) close();
  }, [isOpen, signedIn, close]);
}

function DialogBody({ onClose }: { onClose: () => void }) {
  const { email, setEmail, status, error, handleMagicLinkSubmit, reset } =
    useMagicLinkAuth();

  const sending = status === "sending";
  const sent = status === "sent";

  return (
    <>
      <Link className={styles.brand} href="/" onClick={onClose}>
        <span className={styles.brandLogo}>
          <StellaMark size={28} />
        </span>
        <span className={styles.brandText}>Stella</span>
      </Link>

      {sent ? (
        <SentBody email={email} onReset={reset} />
      ) : (
        <>
          <h2 className={formStyles.title}>Sign in to Stella</h2>
          <p className={formStyles.subtitle}>
            Use Apple, Google, or enter your email and we&apos;ll send you a
            one-time sign-in link. No password needed.
          </p>

          <SocialSignInButtons />

          <div className={formStyles.methodDivider}>
            <span>or use email</span>
          </div>

          <form className={formStyles.form} onSubmit={handleMagicLinkSubmit}>
            <label className={formStyles.field}>
              <span className={formStyles.label}>Email</span>
              <input
                className={formStyles.input}
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={sending}
                required
                autoFocus
              />
            </label>

            {error ? <p className={formStyles.errorBanner}>{error}</p> : null}

            <button
              className={formStyles.button}
              type="submit"
              disabled={sending || !email.trim()}
            >
              {sending ? (
                <>
                  <span className={formStyles.spinner} aria-hidden="true" />
                  Sending link…
                </>
              ) : (
                <>
                  Email me a sign-in link
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <p className={formStyles.footnote}>
            By continuing you agree to our{" "}
            <Link href="/terms" onClick={onClose}>
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" onClick={onClose}>
              Privacy Policy
            </Link>
            .
          </p>
        </>
      )}
    </>
  );
}

function SentBody({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    <>
      <h2 className={formStyles.title}>Check your inbox</h2>
      <div className={formStyles.statusCard}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <MailCheck size={18} aria-hidden="true" />
          <p className={formStyles.statusBody}>
            We sent a sign-in link to{" "}
            <span className={formStyles.statusEmail}>{email}</span>.
          </p>
        </div>
        <p className={formStyles.statusFootnote}>
          Click the link in the email to finish signing in.
        </p>
      </div>
      <div className={formStyles.actions}>
        <button
          type="button"
          className={formStyles.linkButton}
          onClick={onReset}
        >
          Use a different email
        </button>
      </div>
    </>
  );
}
