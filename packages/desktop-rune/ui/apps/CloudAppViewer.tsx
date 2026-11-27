import { T, tx } from "../kit/compat";
import { useAppsSection } from "../global/shared/apps-section.styles";
import { CloudAppPanel } from "./CloudAppPanel";
import { CloudBoundary } from "@/features/cloud/CloudBoundary";
import { useSharedCloudApps } from "@/features/cloud/cloud-apps-store";

function AppStatus({
  title,
  detail,
  alert,
}: {
  title: string;
  detail?: string | null;
  alert?: boolean;
}) {
  const s = useAppsSection();
  return (
    <col {...s.persistentUserAppStatus} role={alert ? "alert" : "status"}>
      <T {...tx(s.persistentUserAppStatus)} weight={700}>{title}</T>
      {detail ? <T {...tx(s.persistentUserAppStatus)}>{detail}</T> : null}
    </col>
  );
}

export function CloudAppViewer({ appId }: { appId: string }) {
  const s = useAppsSection();
  const state = useSharedCloudApps();
  const app = state?.apps.find((candidate) => candidate.appId === appId);
  if (!state || !app) {
    return (
      <col {...s.persistentCloudAppSurface}>
        {state?.phase === "error" ? (
          <AppStatus title="Apps are unavailable" detail={state.error} alert />
        ) : (
          <AppStatus title="Opening app…" />
        )}
      </col>
    );
  }
  return (
    <col {...s.persistentCloudAppSurface}>
      <CloudBoundary fallback={
          <AppStatus
            title="App unavailable"
            detail="Close this tab and try opening it again."
            alert
          />
        }>
        <CloudAppPanel key={state.accountScope} slug={app.slug} />
      </CloudBoundary>
    </col>
  );
}
