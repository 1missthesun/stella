import { Button, T } from "../../kit/compat";
import { useAntigravity as useAntigravitySheet } from "./antigravity.styles";
import { usePill } from "../shared/pill.styles";
import type { ReactNode } from "react";
import { useT } from "@/shared/i18n";
import { EnginePlace } from "../execution-placement/EnginePlace";
import type {
  ModelDestination,
  OtherComputer,
} from "@/features/execution-placement/use-model-destination";
import { AntigravitySignInPrompt } from "./AntigravitySignInPrompt";
import { useAntigravity } from "@/features/antigravity/use-antigravity";

const K = "settings.engineAccounts";

export function AntigravityModelSection({
  destination,
  computers,
  selected,
  children,
}: {
  destination: ModelDestination;
  computers: readonly OtherComputer[];
  selected: boolean;
  children: (models: readonly string[] | undefined) => ReactNode;
}) {
  if (destination.kind !== "here") {
    return (
      <EnginePlace destination={destination} plan="antigravity" selected={selected}>
        {children(destination.antigravityModels)}
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
  children: (models: readonly string[] | undefined) => ReactNode;
}) {
  const s = useAntigravitySheet();
  const t = useT();
  const antigravity = useAntigravity();
  const { status, signIn, start } = antigravity;
  if (!status || status.signedIn) return <>{children(status?.models)}</>;
  if (signIn.state !== "idle") {
    return (
      <col w="full" {...s.antigravityPickerPrompt}>
        <AntigravitySignInPrompt antigravity={antigravity} onStart={() => void start()} />
      </col>
    );
  }
  const elsewhere = computers.filter((computer) => computer.signedIn.includes("antigravity"));
  return (
    <row {...s.antigravityPickerSignIn}>
      <T {...s.antigravityPickerSignInHint}>
        {elsewhere.length > 0
          ? t("settings.modelPlace.signedInElsewhere", {
              places: elsewhere.map((computer) => computer.label).join(", "),
            })
          : t(`${K}.antigravityHint`)}
      </T>
      <Button variant="ghost" className="pill-btn" onClick={() => void start()}>
        {elsewhere.length > 0 ? t(`${K}.signInComputer`) : t(`${K}.antigravitySignIn`)}
      </Button>
    </row>
  );
}
