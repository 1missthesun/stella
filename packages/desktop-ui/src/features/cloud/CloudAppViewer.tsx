import { CloudAppPanel } from "./CloudAppPanel";
import { CloudBoundary } from "./CloudBoundary";
import { useSharedCloudApps } from "./cloud-apps-store";

function AppStatus({
  title,
  detail,
  alert,
}: {
  title: string;
  detail?: string | null;
  alert?: boolean;
}) {
  return (
    <div className="persistent-user-app-status" role={alert ? "alert" : "status"}>
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export function CloudAppViewer({ appId }: { appId: string }) {
  const state = useSharedCloudApps();
  const app = state?.apps.find((candidate) => candidate.appId === appId);
  if (!state || !app) {
    return (
      <div className="persistent-cloud-app-surface">
        {state?.phase === "error" ? (
          <AppStatus title="Apps are unavailable" detail={state.error} alert />
        ) : (
          <AppStatus title="Opening app…" />
        )}
      </div>
    );
  }
  return (
    <div className="persistent-cloud-app-surface">
      <CloudBoundary
        fallback={
          <AppStatus
            title="App unavailable"
            detail="Close this tab and try opening it again."
            alert
          />
        }
      >
        <CloudAppPanel key={state.accountScope} slug={app.slug} />
      </CloudBoundary>
    </div>
  );
}
