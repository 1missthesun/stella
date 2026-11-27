import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CloudAppsSync } from "@/features/cloud/CloudAppsSync";
import { useCloudApps, type CloudAppsState } from "@/features/cloud/use-cloud-apps";
import { useT } from "@/shared/i18n";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { dispatchComposeText } from "@/shared/lib/stella-orb-chat";
import type { IndexedView } from "@stella/contracts/backend/view-index";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { CloudAppsLibrary } from "../../apps/CloudAppsLibrary";
import { ViewsLibrary } from "../../apps/ViewsLibrary";
import { EmptyState, Icon, Icons } from "../../kit";
import { Press, T, tx } from "../../kit/compat";
import { useAppsSection } from "../../global/shared/apps-section.styles";

const LOADING_REVEAL_MS = 400;

/** The Apps list: the account's Stella Views, then its Cloud Apps while it has any, or why it is empty. */
export function AppsSection() {
  const s = useAppsSection();
  const cloudApps = useCloudApps();
  const views = useBackendView("viewIndex.list", cloudApps.signedIn ? {} : "skip", { keepPreviousValue: true });
  return (
    <col id="apps-section" {...s.appsSectionBody}>
      <col {...s.appsSectionLibrary} scrollY>
        <AppsLibraryBody state={cloudApps} views={views.value} viewsFailed={views.status === "error"} />
      </col>
      <CloudAppsSync state={cloudApps} />
    </col>
  );
}

function useDelayed(active: boolean, ms: number) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    setElapsed(false);
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && elapsed;
}

function AppsLibraryBody({ state, views, viewsFailed }: { state: CloudAppsState; views: readonly IndexedView[] | undefined; viewsFailed: boolean }) {
  const t = useT();
  const s = useAppsSection();
  const hasViews = (views?.length ?? 0) > 0;
  // Views lead: the list shows as soon as they are in; Cloud Apps join below when an account still has them.
  const loading = state.signedIn && !hasViews && state.apps.length === 0 && ((views === undefined && !viewsFailed) || state.phase === "loading");
  const showLoading = useDelayed(loading, LOADING_REVEAL_MS);

  if (!state.signedIn) return <EmptyState motif="apps" title={t("app.apps.signedOutTitle")} body={t("app.apps.signedOutBody")} action={{ label: t("common.signIn"), icon: Icons.stella.LogIn, onClick: SIGN_IN_TOAST_ACTION.onClick }} />;
  if (hasViews || state.apps.length > 0) {
    const both = hasViews && state.apps.length > 0;
    return (
      <>
        {views ? <ViewsLibrary views={views} {...(both ? { heading: t("app.apps.viewsHeading") } : {})} /> : null}
        {state.apps.length > 0 ? <CloudAppsLibrary state={{ ...state, phase: "ready" } as CloudAppsState} heading={t("app.apps.cloudAppsHeading")} /> : null}
        {state.phase === "error" ? (
          <row {...s.appsSectionRefreshError} role="alert">
            <T {...tx(s.appsSectionRefreshError)}>{t("app.apps.refreshError")}</T>
            <Press text={tx(s.appsSectionRefreshError, s.appsSectionRetry)} {...s.appsSectionRetry} onPress={state.retry}>
              {t("app.apps.retry")}
            </Press>
          </row>
        ) : null}
      </>
    );
  }
  if (!loading && viewsFailed) {
    return <EmptyState motif="apps" title={t("app.apps.loadErrorTitle")} body={t("app.apps.loadErrorBody")} action={{ label: t("app.apps.retry"), icon: Icons.stella.RefreshCw, onClick: state.retry }} />;
  }
  if (!loading) return <AppsEmpty />;
  return (
    <row {...s.appsSectionLoading} role="status" opacity={showLoading ? 1 : 0} motion={{ dur: 0.2 }}>
      <Icon icon={Icons.stella.LoaderCircle} size={15} strokeWidth={2} color={s.appsSectionLoading.color} spin={1.1} />
      <T {...tx(s.appsSectionLoading)}>{t("app.apps.loading")}</T>
    </row>
  );
}

function AppsEmpty() {
  const navigate = useNavigate();
  const t = useT();
  const compose = useCallback(
    (text: string) => {
      void navigate({ to: "/chat" }).then(() => {
        requestAnimationFrame(() => dispatchComposeText({ text }));
      });
    },
    [navigate],
  );
  return (
    <EmptyState
      motif="apps"
      title={t("app.apps.emptyTitle")}
      body={t("app.apps.emptyBody")}
      action={{ label: t("app.apps.exampleHabits"), icon: Icons.stella.Wand2, onClick: () => compose(t("app.apps.exampleHabitsPrompt")) }}
      secondaryAction={{ label: t("app.apps.exampleIdeas"), icon: Icons.stella.Lightbulb, onClick: () => compose(t("app.apps.exampleIdeasPrompt")) }}
    />
  );
}
