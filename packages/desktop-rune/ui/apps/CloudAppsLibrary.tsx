import { AppWindowMac, LoaderCircle, Press, T, tx } from "../kit/compat";
import { useAppsSection } from "../global/shared/apps-section.styles";
import { usePrimitives } from "../global/shared/primitives.styles";
import { contextMenu } from "@/platform/context-menu";
import { translateNow } from "@/shared/i18n";
import { openCloudAppPanel } from "@/features/cloud/open-cloud-app-panel";
import type { CloudAppsState } from "@/features/cloud/use-cloud-apps";
import { useTopInset } from "../shell/top-inset";

export function CloudAppsLibrary({ state }: { state: CloudAppsState }) {
  const s = useAppsSection();
  const sPrimitives = usePrimitives();
  const inset = useTopInset();
  if (state.phase === "disabled") return null;
  if (state.phase === "loading") {
    return (
      <row {...s.cloudAppsLibraryStatus} mt={inset} role="status">
        <LoaderCircle {...sPrimitives.stellaLoaderCircle} size={15} strokeWidth={2} color={sPrimitives.stellaLoaderCircle.color} />
        <T {...tx(s.cloudAppsLibraryStatus)}>Loading apps…</T>
      </row>
    );
  }
  if (state.phase === "error") {
    return (
      <T w="full" {...s.cloudAppsLibraryStatus} mt={inset} role="alert">
        {state.error}
      </T>
    );
  }
  if (state.apps.length === 0) return null;

  return (
    <col w="full" {...s.cloudAppsLibrary} pt={(s.cloudAppsLibrary.pt ?? 0) + inset}>
      <row {...s.cloudAppsLibraryHeading}>
        <T {...tx(s.cloudAppsLibraryHeading)} id="cloud-apps-title">Apps</T>
        <T {...tx(s.cloudAppsLibraryHeading)}>{state.apps.length}</T>
      </row>
      <col {...s.appsSectionGrid} {...s.cloudAppsLibraryGrid}>
        {state.apps.map((app) => (
          <row {...s.appsSectionCard} key={app.appId} onContextMenu={contextMenu(() => [
              [
                {
                  label: translateNow("contextMenu.open"),
                  run: () => openCloudAppPanel(app),
                },
              ],
            ]) as unknown as (at: { x: number; y: number }) => void}>
            <Press text={tx(s.appsSectionCard)} {...s.appsSectionCardOpen} onPress={() => openCloudAppPanel(app)}>
              <AppWindowMac {...s.appsSectionCardIcon} size={16} strokeWidth={1.7} color={s.appsSectionCardIcon.color} />
              <T {...tx(s.appsSectionCard, s.appsSectionCardOpen)} {...s.appsSectionCardLabel}>{app.title}</T>
            </Press>
          </row>
        ))}
      </col>
    </col>
  );
}
