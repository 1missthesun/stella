import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { CloudAppsLibrary } from "@/features/cloud/CloudAppsLibrary";
import { PersistentCloudAppsHost } from "@/features/cloud/PersistentCloudAppsHost";
import { isCloudAppLocation } from "@/features/cloud/open-cloud-app-panel";
import { useCloudApps } from "@/features/cloud/use-cloud-apps";
import { useSidebarSectionLocation } from "@/features/workspace-display/sidebar-sections";
import { useT } from "@/shared/i18n";
import { dispatchComposeText } from "@/shared/lib/stella-orb-chat";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import { Wand2 } from "@/ui/icons";
import "./apps-section.css";
export function AppsSection() {
  const cloudApps = useCloudApps();
  const openCloudApp = isCloudAppLocation(useSidebarSectionLocation("apps"));
  return (
    <>
      {/* Back-to-library nav lives in the top bar now (browser-tab model),
          so there is no in-body section header here. */}
      <div className="apps-section__body">
        {openCloudApp ? null : (
          <div className="apps-section__library">
            <CloudAppsLibrary state={cloudApps} />
            {cloudApps.phase === "ready" && cloudApps.apps.length === 0 ? (
              <AppsEmpty />
            ) : null}
          </div>
        )}
        <PersistentCloudAppsHost state={cloudApps} />
      </div>
    </>
  );
}
function AppsEmpty() {
  const navigate = useNavigate();
  const t = useT();
  const requestApp = useCallback(() => {
    void navigate({ to: "/chat" }).then(() => {
      requestAnimationFrame(() => {
        dispatchComposeText({ text: t("app.apps.createAppPrompt") });
      });
    });
  }, [navigate, t]);
  return (
    <EmptyState
      motif="apps"
      title="No apps yet"
      body="Apps Stella builds for you live here."
      action={{ label: "Build an app", icon: Wand2, onClick: requestApp }}
    />
  );
}
