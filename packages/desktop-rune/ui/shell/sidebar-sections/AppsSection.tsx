import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CloudAppsSync } from "@/features/cloud/CloudAppsSync";
import { useCloudApps, type CloudAppsState } from "@/features/cloud/use-cloud-apps";
import { useT } from "@/shared/i18n";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { dispatchComposeText } from "@/shared/lib/stella-orb-chat";
import { CloudAppsLibrary } from "../../apps/CloudAppsLibrary";
import { EmptyState, Icon, Icons } from "../../kit";
import { Press, T, tx } from "../../kit/compat";
import { useAppsSection } from "../../global/shared/apps-section.styles";

const SESSION_STALL_MS = 15_000;
const LOADING_REVEAL_MS = 400;

/** desktop-ui's `AppsSection`: the Cloud Apps library, or why it is empty. */
export function AppsSection() {
  const s = useAppsSection();
  const cloudApps = useCloudApps();
  return (
    <col id="apps-section" {...s.appsSectionBody}>
      <col {...s.appsSectionLibrary}>
        <AppsLibraryBody state={cloudApps} />
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

function AppsLibraryBody({ state }: { state: CloudAppsState }) {
  const t = useT();
  const s = useAppsSection();
  const starting = state.phase === "disabled" && state.signedIn && !state.sessionFailed;
  const stalled = useDelayed(starting, SESSION_STALL_MS);
  const loading = state.signedIn && state.apps.length === 0 && !(state.sessionFailed || state.phase === "error" || stalled) && state.phase !== "ready";
  const showLoading = useDelayed(loading, LOADING_REVEAL_MS);

  if (!state.signedIn) return <EmptyState motif="apps" title={t("app.apps.signedOutTitle")} body={t("app.apps.signedOutBody")} action={{ label: t("common.signIn"), icon: Icons.stella.LogIn, onClick: SIGN_IN_TOAST_ACTION.onClick }} />;
  if (state.apps.length > 0) {
    return (
      <>
        <CloudAppsLibrary state={{ ...state, phase: "ready" } as CloudAppsState} />
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
  if (state.sessionFailed || state.phase === "error" || stalled) {
    return <EmptyState motif="apps" title={t("app.apps.loadErrorTitle")} body={t("app.apps.loadErrorBody")} action={{ label: t("app.apps.retry"), icon: Icons.stella.RefreshCw, onClick: state.retry }} />;
  }
  if (state.phase === "ready") return <AppsEmpty />;
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
