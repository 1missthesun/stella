import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogTitle, Press, T, tx, VisuallyHidden } from "../../kit/compat";
import { useAuthDialog } from "./AuthDialog.styles";
import { useCallback, useEffect, useState } from "react";
import { MagicLinkAuthFlow } from "./MagicLinkAuthFlow";
import { authClient } from "@/global/auth/lib/auth-client";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { accountLabel, useAccountHint } from "@/global/auth/hooks/use-account-hint";
import { useAuthBootstrapState } from "@/global/auth/BackendAuthProvider";
import { RememberedAccountSignIn } from "./RememberedAccountSignIn";
import { dropAfterSignIn } from "@/global/auth/sign-in-then";
import { nativeSignIn, type NativeSignInResult } from "./native-sign-in";
import {
  applyAndVerifyAccountSessionToken,
  startBrowserGoogleSignIn,
} from "@/global/auth/services/account-connection";
import { refreshAuthSession } from "@/global/auth/services/auth-session";
import {
  claimSessionToken,
  generateClaimSecret,
  hashClaimSecret,
} from "@/global/auth/lib/claim-secret";
import { openExternalUrl } from "@/platform/electron/open-external";
import { requireBackendUrl } from "@/platform/backend/backend-url";
import { useT } from "@/shared/i18n";
import {
  fetchWithDeadline,
  isTransientRequestError,
  REQUEST_BUDGET_MS,
} from "@stella/contracts/request-deadline";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SocialSignInResult = {
  data?: {
    url?: string;
  } | null;
  error?: {
    message?: string;
    statusText?: string;
  } | null;
};

const SOCIAL_AUTH_POLL_INTERVAL_MS = 2500;
const SOCIAL_AUTH_TIMEOUT_MS = 2 * 60_000;

const wait = (ms: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

type Translate = ReturnType<typeof useT>;

const startDesktopSocialAuth = async (t: Translate) => {
  const backendUrl = requireBackendUrl();
  const claimSecret = generateClaimSecret();
  const response = await fetchWithDeadline(
    fetch,
    `${backendUrl}/api/auth/desktop-social/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        claimHash: await hashClaimSecret(claimSecret),
      }),
    },
    { label: "sign-in", timeoutMs: REQUEST_BUDGET_MS.call },
  );
  const data = (await response.json().catch(() => null)) as {
    requestId?: string;
    callbackURL?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.requestId || !data.callbackURL) {
    throw new Error(data?.error || t("global.auth.googleStartFailed"));
  }
  return {
    backendUrl,
    requestId: data.requestId,
    callbackURL: data.callbackURL,
    claimSecret,
  };
};

const pollDesktopSocialAuth = async (
  backendUrl: string,
  requestId: string,
  claimSecret: string,
  t: Translate,
) => {
  const deadline = performance.now() + SOCIAL_AUTH_TIMEOUT_MS;
  while (performance.now() < deadline) {
    await wait(SOCIAL_AUTH_POLL_INTERVAL_MS);
    const response = await fetchWithDeadline(
      fetch,
      `${backendUrl}/api/auth/link/status?requestId=${encodeURIComponent(requestId)}`,
      {},
      { label: "sign-in status", timeoutMs: REQUEST_BUDGET_MS.lookup },
    ).catch((error: unknown) => {
      if (isTransientRequestError(error)) return null;
      throw error;
    });
    if (!response?.ok) {
      continue;
    }
    const data = (await response.json().catch(() => null)) as {
      status?: string;
    } | null;
    if (data?.status === "completed") {
      const token = await claimSessionToken(
        backendUrl,
        requestId,
        claimSecret,
      );
      if (!token) {
        throw new Error(t("global.auth.googleNoSession"));
      }
      await applyAndVerifyAccountSessionToken(token);
      return;
    }
    if (data?.status === "expired") {
      throw new Error(t("global.auth.googleExpired"));
    }
  }
  throw new Error(t("global.auth.googleTimedOut"));
};

export const AuthDialog = ({ open, onOpenChange }: AuthDialogProps) => {
  const s = useAuthDialog();
  const t = useT();
  const { hasConnectedAccount } = useAuthSessionState();
  const bootstrapStatus = useAuthBootstrapState().status;
  const signedIn = hasConnectedAccount && bootstrapStatus === "ready";
  useEffect(() => {
    if (signedIn && open) onOpenChange(false);
  }, [signedIn, open, onOpenChange]);
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) dropAfterSignIn();
      onOpenChange(next);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent fit {...s.authDialogContent}>
        <VisuallyHidden asChild>
          <DialogTitle>{t("global.auth.welcomeTitle")}</DialogTitle>
        </VisuallyHidden>
        <VisuallyHidden asChild>
          <DialogDescription>
            {t("global.auth.welcomeDescription")}
          </DialogDescription>
        </VisuallyHidden>
        <DialogCloseButton {...s.authDialogClose} />
        <DialogBody {...s.authDialogBody}>
          <SignInChoices onDismiss={() => handleOpenChange(false)} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};

function SignInChoices({ onDismiss }: { onDismiss: () => void }) {
  const hint = useAccountHint();
  const [showMethods, setShowMethods] = useState(false);
  if (hint === undefined) return null;
  const account = accountLabel(hint);
  if (hint?.signedOut && account && !showMethods) {
    return (
      <RememberedAccountSignIn hint={hint} account={account} onSignIn={() => setShowMethods(true)} onDismiss={onDismiss} />
    );
  }
  return <AuthMethods loginHint={hint?.signedOut ? hint.email : null} />;
}

export function AuthMethods({ loginHint }: { loginHint?: string | null } = {}) {
  const s = useAuthDialog();
  const t = useT();
  const { user } = useAuthSessionState();
  const bootstrapStatus = useAuthBootstrapState().status;
  const accountHint =
    loginHint ??
    (bootstrapStatus === "reauth_required" ? (user?.email ?? null) : null);
  return (
    <>
      <col {...s.authDialogHero}>
        <T {...tx(s.authDialogHero)} w="full" {...s.authDialogHeadline}>{t("global.auth.welcomeTitle")}</T>
        <T {...tx(s.authDialogHero)} w="full" {...s.authDialogSub}>{t("global.auth.welcomeSub")}</T>
      </col>
      {nativeSignIn?.apple ? <AppleAuthButton signIn={nativeSignIn.apple} /> : null}
      <GoogleAuthButton loginHint={accountHint} />
      <PasskeyAuthButton />
      <row {...s.authDialogMethodDivider}>
        <box {...s.authDialogMethodDividerLine} />
        <T {...tx(s.authDialogMethodDivider)}>{t("global.auth.orUseEmail")}</T>
        <box {...s.authDialogMethodDividerLine} />
      </row>
      <MagicLinkAuthFlow hideEmailLabel inputVariant="normal" emailPlaceholder={t("global.auth.emailPlaceholder")} autoFocus buttonClassName="pill-btn pill-btn--primary pill-btn--lg auth-dialog-cta" buttonVariant="primary" buttonSize="large" submitLabel={t("common.continue")} sendingLabel={t("global.auth.sending")} resendLabel={t("global.auth.resendEmail")} sentMessage={t("global.auth.magicLinkSentDesktop")} openInboxClassName="pill-btn pill-btn--primary pill-btn--lg auth-dialog-open-inbox" styles={{ form: s.authDialogForm, button: s.authDialogCta, extras: s.authDialogExtras, extrasOpen: s.authDialogExtrasOpen, extrasInner: s.authDialogExtrasInner, sent: s.authDialogSent, openInbox: s.authDialogOpenInbox, error: s.authDialogError }} />
    </>
  );
}

function GoogleAuthButton({ loginHint }: { loginHint?: string | null }) {
  const s = useAuthDialog();
  const t = useT();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
    setError(null);
    setIsSigningIn(true);

    try {
      if (nativeSignIn) {
        const result = await nativeSignIn.google(loginHint);
        if ("error" in result) setError(result.error);
        return;
      }
      if (!window.electronAPI) {
        let result: SocialSignInResult | undefined;
        try {
          result = (await startBrowserGoogleSignIn()) as
            | SocialSignInResult
            | undefined;
        } catch {
          setError(t("global.auth.googleStartFailed"));
          return;
        }
        if (result?.error) {
          setError(
            result.error.message ||
              result.error.statusText ||
              t("global.auth.googleStartFailed"),
          );
        }
        return;
      }

      const { backendUrl, requestId, callbackURL, claimSecret } =
        await startDesktopSocialAuth(t);
      const result = (await authClient.signIn.social({
        provider: "google",
        callbackURL,
        disableRedirect: true,
        ...(loginHint ? { loginHint } : {}),
      })) as SocialSignInResult | undefined;
      const url = result?.data?.url;

      if (result?.error || !url) {
        setError(
          result?.error?.message ||
            result?.error?.statusText ||
            t("global.auth.googleStartFailed"),
        );
        return;
      }

      openExternalUrl(url);
      await pollDesktopSocialAuth(backendUrl, requestId, claimSecret, t);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("global.auth.googleStartFailed"),
      );
    } finally {
      setIsSigningIn(false);
    }
  }, [loginHint, t]);

  return (
    <col {...s.authDialogGoogleWrap}>
      <Press {...s.authDialogGoogle} onPress={handleSignIn} disabled={isSigningIn} {...((isSigningIn) ? s.authDialogGoogleDisabled : null)}>
        <GoogleIcon />
        {isSigningIn
          ? t("global.auth.googleWaiting")
          : t("global.auth.googleContinue")}
      </Press>
      {error ? <T w="full" {...s.authDialogError}>{error}</T> : null}
    </col>
  );
}

/** Sign in with Apple, where the platform has it (the phone); App Review wants it beside Google. */
function AppleAuthButton({ signIn }: { signIn: () => Promise<NativeSignInResult> }) {
  const s = useAuthDialog();
  const t = useT();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
    setError(null);
    setIsSigningIn(true);
    try {
      const result = await signIn();
      if ("error" in result) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mobile.login.appleCompleteFailed"));
    } finally {
      setIsSigningIn(false);
    }
  }, [signIn, t]);

  return (
    <col {...s.authDialogGoogleWrap}>
      <Press id="auth-apple" {...s.authDialogGoogle} {...s.authDialogApple} onPress={handleSignIn} disabled={isSigningIn} {...(isSigningIn ? s.authDialogGoogleDisabled : null)}>
        <icon svg={APPLE_LOGO} name="auth/apple" view={18} size={18} color={s.authDialogApple.color} inert />
        {isSigningIn ? t("mobile.login.openingApple") : t("mobile.login.continueWithApple")}
      </Press>
      {error ? <T w="full" {...s.authDialogError}>{error}</T> : null}
    </col>
  );
}

const APPLE_LOGO = '<path fill="currentColor" d="M14.38 9.55c-.02-2.08 1.7-3.09 1.78-3.14-.97-1.42-2.48-1.61-3.01-1.63-1.27-.13-2.5.75-3.14.75-.65 0-1.64-.73-2.7-.71-1.38.02-2.67.82-3.38 2.08-1.46 2.53-.37 6.25 1.03 8.3.7 1 1.52 2.12 2.6 2.08 1.05-.04 1.44-.67 2.7-.67s1.62.67 2.72.65c1.13-.02 1.85-1.01 2.52-2.03.8-1.15 1.13-2.28 1.14-2.34-.03-.01-2.24-.86-2.26-3.34ZM12.32 3.43c.56-.7.94-1.65.84-2.61-.82.04-1.85.57-2.43 1.25-.52.61-.99 1.6-.87 2.52.93.07 1.88-.47 2.46-1.16Z"/>';

/** Passkeys bind to the auth domain, so this only offers itself in the web shell (not the phone app, which signs in natively). */
function PasskeyAuthButton() {
  const s = useAuthDialog();
  const t = useT();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
    setError(null);
    setIsSigningIn(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result.error) {
        setError(result.error.message || t("global.auth.passkeyFailed"));
        return;
      }
      await refreshAuthSession();
    } catch {
      setError(t("global.auth.passkeyFailed"));
    } finally {
      setIsSigningIn(false);
    }
  }, [t]);

  if (window.electronAPI || nativeSignIn) return null;

  return (
    <col {...s.authDialogGoogleWrap}>
      <Press {...s.authDialogGoogle} onPress={handleSignIn} disabled={isSigningIn} {...((isSigningIn) ? s.authDialogGoogleDisabled : null)}>
        {t("global.auth.passkeyContinue")}
      </Press>
      {error ? <T w="full" {...s.authDialogError}>{error}</T> : null}
    </col>
  );
}

const GOOGLE_G = '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.89 2.69-6.62Z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.95-2.18l-2.91-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.97 10.71A5.41 5.41 0 0 1 3.69 9c0-.59.1-1.16.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33Z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.42 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/>';

function GoogleIcon() {
  return <icon svg={GOOGLE_G} name="auth/google-g" view={18} size={18} inert />;
}
