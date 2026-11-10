import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CloudAppsLibrary } from "@/features/cloud/CloudAppsLibrary";
import { PersistentCloudAppsHost } from "@/features/cloud/PersistentCloudAppsHost";
import { isCloudAppLocation } from "@/features/cloud/open-cloud-app-panel";
import { useCloudApps } from "@/features/cloud/use-cloud-apps";
import { useSidebarSectionLocation } from "@/features/workspace-display/sidebar-sections";
import { useT } from "@/shared/i18n";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { dispatchComposeText } from "@/shared/lib/stella-orb-chat";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import { Lightbulb, LoaderCircle, LogIn, RefreshCw, Wand2 } from "@/ui/icons";
import "./apps-section.css";

const SESSION_STALL_MS = 15_000;

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
            <AppsLibraryBody state={cloudApps} />
          </div>
        )}
        <PersistentCloudAppsHost state={cloudApps} />
      </div>
    </>
  );
}

function AppsLibraryBody({ state }) {
  const t = useT();
  const starting = state.phase === "disabled" && state.signedIn && !state.sessionFailed;
  const stalled = useStalled(starting);

  if (!state.signedIn) return <AppsSignedOut />;
  if (state.apps.length > 0) {
    return (
      <>
        <CloudAppsLibrary state={{ ...state, phase: "ready" }} />
        {state.phase === "error" ? (
          <div className="apps-section__refresh-error" role="alert">
            <span>{t("app.apps.refreshError")}</span>
            <button type="button" className="apps-section__retry" onClick={state.retry}>
              {t("app.apps.retry")}
            </button>
          </div>
        ) : null}
      </>
    );
  }
  if (state.sessionFailed || state.phase === "error" || stalled) {
    return (
      <EmptyState
        motif="apps"
        title={t("app.apps.loadErrorTitle")}
        body={t("app.apps.loadErrorBody")}
        action={{ label: t("app.apps.retry"), icon: RefreshCw, onClick: state.retry }}
      />
    );
  }
  if (state.phase === "ready") return <AppsEmpty />;
  return (
    <div className="apps-section__loading" role="status">
      <LoaderCircle className="stella-loader-circle" size={15} strokeWidth={2} aria-hidden="true" />
      <span>{t("app.apps.loading")}</span>
    </div>
  );
}

function useStalled(waiting) {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (!waiting) return;
    const timer = window.setTimeout(() => setStalled(true), SESSION_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);
  return waiting && stalled;
}

function AppsSignedOut() {
  const t = useT();
  return (
    <EmptyState
      motif="apps"
      title={t("app.apps.signedOutTitle")}
      body={t("app.apps.signedOutBody")}
      action={{ label: t("common.signIn"), icon: LogIn, onClick: SIGN_IN_TOAST_ACTION.onClick }}
    />
  );
}

function AppsEmpty() {
  const navigate = useNavigate();
  const t = useT();
  const compose = useCallback(
    (text) => {
      void navigate({ to: "/chat" }).then(() => {
        requestAnimationFrame(() => {
          dispatchComposeText({ text });
        });
      });
    },
    [navigate],
  );
  return (
    <EmptyState
      motif="apps"
      title={t("app.apps.emptyTitle")}
      body={t("app.apps.emptyBody")}
      action={{
        label: t("app.apps.exampleHabits"),
        icon: Wand2,
        onClick: () => compose(t("app.apps.exampleHabitsPrompt")),
      }}
      secondaryAction={{
        label: t("app.apps.exampleIdeas"),
        icon: Lightbulb,
        onClick: () => compose(t("app.apps.exampleIdeasPrompt")),
      }}
    />
  );
}
