import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";
import { EnginePlace } from "@/features/execution-placement/EnginePlace";
import type {
  ModelDestination,
  OtherComputer,
} from "@/features/execution-placement/use-model-destination";
import { AntigravitySignInPrompt } from "./AntigravitySignInPrompt";
import { useAntigravity } from "./use-antigravity";
import "./antigravity.css";

const K = "settings.engineAccounts";

/**
 * Antigravity's models in the model picker when the computer the chat runs on
 * can run them; its sign-in when the chat runs here and this computer has none.
 */
export function AntigravityModelSection({
  destination,
  computers,
  selected,
  children,
}: {
  destination: ModelDestination;
  computers: readonly OtherComputer[];
  selected: boolean;
  children: ReactNode;
}) {
  if (destination.kind !== "here") {
    return (
      <EnginePlace destination={destination} plan="antigravity" selected={selected}>
        {children}
      </EnginePlace>
    );
  }
  return <AntigravityHere computers={computers}>{children}</AntigravityHere>;
}

function AntigravityHere({
  computers,
  children,
}: {
  computers: readonly OtherComputer[];
  children: ReactNode;
}) {
  const t = useT();
  const antigravity = useAntigravity();
  const { status, signIn, start } = antigravity;
  if (!status || status.signedIn) return <>{children}</>;
  if (signIn.state !== "idle") {
    return (
      <div className="antigravity-picker-prompt">
        <AntigravitySignInPrompt antigravity={antigravity} onStart={() => void start()} />
      </div>
    );
  }
  const elsewhere = computers.filter((computer) => computer.signedIn.includes("antigravity"));
  return (
    <div className="antigravity-picker-sign-in">
      <p className="antigravity-picker-sign-in__hint">
        {elsewhere.length > 0
          ? t("settings.modelPlace.signedInElsewhere", {
              places: elsewhere.map((computer) => computer.label).join(", "),
            })
          : t(`${K}.antigravityHint`)}
      </p>
      <Button type="button" variant="ghost" className="pill-btn" onClick={() => void start()}>
        {elsewhere.length > 0 ? t(`${K}.signInComputer`) : t(`${K}.antigravitySignIn`)}
      </Button>
    </div>
  );
}
