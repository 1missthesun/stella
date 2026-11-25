import { Button, T } from "../../kit/compat";
import { useEnginePlace } from "./engine-place.styles";
import { usePill } from "../shared/pill.styles";
import type { ReactNode } from "react";
import type { DeviceEngine } from "@stella/contracts/execution-context";
import { settingsPlace } from "@/global/settings/settings-place";
import { useT } from "@/shared/i18n";
import { planSignedInAt, type ModelDestination } from "@/features/execution-placement/use-model-destination";

const K = "settings.engineAccounts";
const P = "settings.modelPlace";

const openAccounts = () =>
  void import("@/shell/settings-dialog-store").then(({ settingsDialog }) =>
    settingsDialog.openAt("ai"),
  );

export function enginePlaceBadge(
  t: ReturnType<typeof useT>,
  destination: ModelDestination,
  plan: DeviceEngine,
): string | undefined {
  return destination.kind === "device" && planSignedInAt(destination, plan)
    ? t(`${K}.claude.usedOn`, { places: destination.place })
    : undefined;
}

export function EnginePlace({
  destination,
  plan,
  selected,
  children,
}: {
  destination: ModelDestination;
  plan: DeviceEngine;
  selected: boolean;
  children: ReactNode;
}) {
  const s = useEnginePlace();
  const t = useT();
  if (destination.kind === "here" || planSignedInAt(destination, plan) !== false) {
    return <>{children}</>;
  }
  const inCloud = destination.kind === "cloud";
  return (
    <>
      <row {...s.enginePlaceNote} role="note">
        <T>
          {inCloud && plan === "antigravity"
            ? t(`${P}.computersOnly`)
            : `${t(`${K}.claude.noteSignedOut`, { place: destination.placeStart })} ${
                inCloud
                  ? ""
                  : t(`${P}.signInThere`, {
                      settings: settingsPlace(t, "settings.tabs.ai"),
                    })
              }`.trim()}
        </T>
        {plan === "antigravity" || (plan === "chatgpt" && !inCloud) ? null : (
          <Button variant="ghost" className="pill-btn" onClick={openAccounts}>
            {t(`${K}.signIn`)}
          </Button>
        )}
      </row>
      {selected ? children : null}
    </>
  );
}
