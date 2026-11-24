import type { ReactNode } from "react";
import type { DeviceEngine } from "@stella/contracts/execution-context";
import { settingsPlace } from "@/global/settings/settings-place";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";
import { planSignedInAt, type ModelDestination } from "./use-model-destination";
import "./engine-place.css";

const K = "settings.engineAccounts";
const P = "settings.modelPlace";

const openAccounts = () =>
  void import("@/shell/settings-dialog-store").then(({ settingsDialog }) =>
    settingsDialog.openAt("ai"),
  );

/** "On <computer>" beside an engine's name while the chat runs on another computer that can run it. */
export function enginePlaceBadge(
  t: ReturnType<typeof useT>,
  destination: ModelDestination,
  plan: DeviceEngine,
): string | undefined {
  return destination.kind === "device" && planSignedInAt(destination, plan)
    ? t(`${K}.claude.usedOn`, { places: destination.place })
    : undefined;
}

/** An engine's models when the place the chat runs on can run them, or what to do there when it can't. */
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
  const t = useT();
  if (destination.kind === "here" || planSignedInAt(destination, plan) !== false) {
    return <>{children}</>;
  }
  const inCloud = destination.kind === "cloud";
  return (
    <>
      <div className="engine-place-note" role="note">
        <p>
          {inCloud && plan === "antigravity"
            ? t(`${P}.computersOnly`)
            : `${t(`${K}.claude.noteSignedOut`, { place: destination.placeStart })} ${
                inCloud
                  ? ""
                  : t(`${P}.signInThere`, {
                      settings: settingsPlace(t, "settings.tabs.ai"),
                    })
              }`.trim()}
        </p>
        {plan === "antigravity" || (plan === "chatgpt" && !inCloud) ? null : (
          <Button type="button" variant="ghost" className="pill-btn" onClick={openAccounts}>
            {t(`${K}.signIn`)}
          </Button>
        )}
      </div>
      {selected ? children : null}
    </>
  );
}
