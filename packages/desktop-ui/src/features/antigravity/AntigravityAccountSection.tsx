import { useCallback, useState } from "react";
import { Button } from "@/ui/button";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import { AiPrimaryAccount, AiProviderSection, AiRow } from "@/features/cloud/AiProviderSection";
import { AntigravitySignInPrompt } from "./AntigravitySignInPrompt";
import { useAntigravity } from "./use-antigravity";

const K = "settings.engineAccounts";

/** Google Antigravity on this computer: Gemini on the user's own Google plan, run inside Google's own CLI. */
export function AntigravityAccountSection() {
  const t = useT();
  const antigravity = useAntigravity();
  const { status, signIn, start, signOut } = antigravity;
  const [busy, setBusy] = useState(false);

  const onStart = useCallback(() => {
    void start().then((signedIn) => {
      if (signedIn) showToast({ title: t(`${K}.antigravitySignedIn`) });
    });
  }, [start, t]);

  const onSignOut = useCallback(async () => {
    setBusy(true);
    try {
      await signOut();
      showToast({ title: t(`${K}.signedOut`) });
    } catch (error) {
      showToast({
        title: error instanceof Error && error.message ? error.message : t(`${K}.errorGeneric`),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [signOut, t]);

  if (!status) return null;

  return (
    <AiProviderSection
      id="antigravity"
      titleKey={`${K}.antigravityTitle`}
      notes={
        <AntigravitySignInPrompt antigravity={antigravity} onStart={onStart} />
      }
    >
      {status.signedIn ? (
        <AiRow
          name={t(`${K}.placeSignedIn`, { place: t(`${K}.placeComputer`) })}
          menuLabel={t(`${K}.moreLabel`, { name: t(`${K}.antigravityTitle`) })}
          menu={[{ key: "out", label: t(`${K}.signOutComputer`), onSelect: () => void onSignOut() }]}
          busy={busy}
        />
      ) : (
        <AiPrimaryAccount
          name={<span data-empty>{t(`${K}.notConnected`)}</span>}
          meta={t(status.signInAgain ? `${K}.antigravityAgain` : `${K}.antigravityHint`)}
          trailing={
            <Button
              type="button"
              variant="ghost"
              className="pill-btn"
              disabled={signIn.state === "running"}
              onClick={onStart}
            >
              {t(`${K}.antigravitySignIn`)}
            </Button>
          }
        />
      )}
    </AiProviderSection>
  );
}
