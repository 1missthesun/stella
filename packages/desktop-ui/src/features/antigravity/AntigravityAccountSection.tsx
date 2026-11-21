import { useCallback, useState } from "react";
import { Button } from "@/ui/button";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import { useLlmCredentials } from "@/global/settings/hooks/use-llm-credentials";
import { AiNote, AiPrimaryAccount, AiProviderSection, AiRow } from "@/features/cloud/AiProviderSection";

const K = "settings.engineAccounts";
const PROVIDER = "antigravity";

/** Google Antigravity on this computer: Gemini models on the user's own Google plan. */
export function AntigravityAccountSection() {
  const t = useT();
  const credentials = useLlmCredentials();
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const { loginOAuth, cancelOAuth, logoutOAuth } = credentials;

  const supported = credentials.oauthProviders.some((entry) => entry.provider === PROVIDER);
  const signedIn = credentials.oauthCredentials.find(
    (entry) => entry.provider === PROVIDER && entry.status === "active",
  );

  const errorTitle = useCallback(
    (error: unknown) => (error instanceof Error && error.message ? error.message : t(`${K}.errorGeneric`)),
    [t],
  );

  const signIn = useCallback(async () => {
    setSigningIn(true);
    try {
      await loginOAuth(PROVIDER, { announceConnection: false });
      showToast({ title: t(`${K}.antigravitySignedIn`) });
    } catch (error) {
      if (!/cancel/iu.test(error instanceof Error ? error.message : "")) {
        showToast({ title: errorTitle(error), variant: "error" });
      }
    } finally {
      setSigningIn(false);
    }
  }, [errorTitle, loginOAuth, t]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await logoutOAuth(PROVIDER);
      showToast({ title: t(`${K}.signedOut`) });
    } catch (error) {
      showToast({ title: errorTitle(error), variant: "error" });
    } finally {
      setBusy(false);
    }
  }, [errorTitle, logoutOAuth, t]);

  if (!supported) return null;

  const plan = signedIn?.plan === "Free" ? t(`${K}.antigravityPlanFree`) : signedIn?.plan;
  const signInButton = (
    <Button
      type="button"
      variant="ghost"
      className="pill-btn"
      disabled={signingIn || busy}
      onClick={() => void signIn()}
    >
      {t(`${K}.antigravitySignIn`)}
    </Button>
  );

  return (
    <AiProviderSection
      id="antigravity"
      titleKey={`${K}.antigravityTitle`}
      notes={
        <>
          {signingIn ? (
            <AiNote
              action={
                <button type="button" className="pill-btn" onClick={() => void cancelOAuth(PROVIDER)}>
                  {t("common.cancel")}
                </button>
              }
            >
              <span aria-live="polite">{t(`${K}.antigravityBrowserWaiting`)}</span>
            </AiNote>
          ) : null}
          {signedIn?.plan === "Free" || signedIn?.plan === "Google AI Plus" ? <AiNote>{t(`${K}.antigravityFreeNote`)}</AiNote> : null}
          <p className="ai-provider__hint">{t(`${K}.antigravityRisk`)}</p>
        </>
      }
    >
      {signedIn ? (
        <AiRow
          name={signedIn.account ?? signedIn.label}
          meta={[plan, t(`${K}.whereComputer`)].filter(Boolean).join(" · ")}
          menuLabel={t(`${K}.moreLabel`, { name: signedIn.account ?? signedIn.label })}
          menu={[
            { key: "switch", label: t(`${K}.antigravitySwitch`), onSelect: () => void signIn() },
            { key: "out", label: t(`${K}.signOutComputer`), onSelect: () => void signOut() },
          ]}
          busy={busy || signingIn}
        />
      ) : (
        <AiPrimaryAccount
          name={<span data-empty>{t(`${K}.notConnected`)}</span>}
          meta={t(`${K}.antigravityHint`)}
          trailing={signInButton}
        />
      )}
    </AiProviderSection>
  );
}
