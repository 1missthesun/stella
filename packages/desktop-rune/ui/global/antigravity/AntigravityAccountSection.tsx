import { Button, showToast } from "../../kit/compat";
import { useCallback, useState } from "react";
import { useT } from "@/shared/i18n";
import { AiEmptyName, AiPrimaryAccount, AiProviderSection, AiRow } from "../cloud/AiProviderSection";
import { useOtherComputers } from "@/features/execution-placement/use-model-destination";
import { AntigravitySignInPrompt } from "./AntigravitySignInPrompt";
import { useAntigravity } from "@/features/antigravity/use-antigravity";

const K = "settings.engineAccounts";

export function AntigravityAccountSection({ engineInUse = false }: { engineInUse?: boolean }) {
  const t = useT();
  const antigravity = useAntigravity();
  const { status, signIn, start, signOut } = antigravity;
  const { computers } = useOtherComputers();
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
  const elsewhere = computers.filter((computer) => computer.signedIn.includes("antigravity"));

  return (
    <AiProviderSection id="antigravity" titleKey={`${K}.antigravityTitle`} notes={
        <AntigravitySignInPrompt antigravity={antigravity} onStart={onStart} />
      }>
      {status.signedIn ? (
        <AiRow name={t(`${K}.placeSignedIn`, { place: t(`${K}.placeComputer`) })} {...(engineInUse ? { inUseLabel: t(`${K}.inUse`) } : {})} menuLabel={t(`${K}.moreLabel`, { name: t(`${K}.antigravityTitle`) })} menu={[{ key: "out", label: t(`${K}.signOutComputer`), onSelect: () => void onSignOut() }]} busy={busy} />
      ) : (
        <AiPrimaryAccount name={
            <AiEmptyName>
              {elsewhere.length > 0
                ? t(`${K}.placeSignedOut`, { place: t(`${K}.placeComputer`) })
                : t(`${K}.notConnected`)}
            </AiEmptyName>
          } meta={t(`${K}.antigravityHint`)} trailing={
            <Button
              type="button"
              variant="ghost"
              className="pill-btn"
              disabled={signIn.state === "running"}
              onClick={onStart}
            >
              {elsewhere.length > 0 ? t(`${K}.signInComputer`) : t(`${K}.antigravitySignIn`)}
            </Button>
          } />
      )}
      {elsewhere.map((computer, index) => (
        <AiRow key={computer.deviceId} name={t(`${K}.placeSignedIn`, { place: computer.label })} meta={t("settings.modelPlace.usedThere")} {...(engineInUse && !status.signedIn && index === 0 ? { inUseLabel: t(`${K}.inUse`) } : {})} />
      ))}
    </AiProviderSection>
  );
}
