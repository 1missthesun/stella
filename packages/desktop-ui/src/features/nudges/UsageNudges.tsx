import { useEffect, useState } from "react";
import { ANONYMOUS_COUNTS_ENABLED } from "@stella/contracts/telemetry/anonymous-counts";
import { useOnboardingState } from "@/global/onboarding/use-onboarding-state";
import {
  dismissPostOnboardingHint,
  seedPostOnboardingHints,
} from "@/global/onboarding/post-onboarding-hints";
import { platformCapabilities } from "@/platform/capabilities";
import { showComposerNotice } from "@/features/chat/composer-notice-store";
import { notify } from "@/features/notifications/notification-store";
import { useT } from "@/shared/i18n";
import {
  FOUND_VIA_NOTICE_ID,
  finishNudge,
  noteOpenedToday,
  nudgeDue,
  startUsageNudges,
  useUsageNudges,
} from "./usage-nudges-store";

const PHONE_APP_NOTIFICATION_ID = "phone-app-nudge";

const finishPhoneApp = () => {
  finishNudge("phoneApp");
  dismissPostOnboardingHint("connect");
};

const openPhoneDialog = () => {
  void import("@/router").then(({ router }) => {
    void router.navigate({
      to: ".",
      search: (prev) => ({ ...prev, dialog: "connect" }),
    });
  });
};

/** Null until known, so the found-via question keeps its turn ahead of the phone app. */
const useCountsOn = (): boolean | null => {
  const [on, setOn] = useState<boolean | null>(ANONYMOUS_COUNTS_ENABLED ? null : false);
  useEffect(() => {
    if (!ANONYMOUS_COUNTS_ENABLED) return;
    let live = true;
    const getStatus = window.electronAPI?.system?.getAnonymousCounts;
    if (!getStatus) {
      setOn(false);
      return;
    }
    void getStatus()
      .then((status) => {
        if (live) setOn(status.available && status.enabled);
      })
      .catch(() => {
        if (live) setOn(false);
      });
    return () => {
      live = false;
    };
  }, []);
  return on;
};

/**
 * Two one-time nudges once someone has used Stella a little: "How did you
 * find Stella?" above the composer after a few replies, and the phone app in
 * the bell on a second day (or after a few more replies). One per app run.
 */
export function UsageNudges() {
  const t = useT();
  const { completed, hydrated } = useOnboardingState();
  const state = useUsageNudges();
  const countsOn = useCountsOn();
  const [shownThisRun, setShownThisRun] = useState<"foundVia" | "phoneApp" | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    startUsageNudges(completed);
    noteOpenedToday();
  }, [completed, hydrated]);

  const foundViaDue = completed && countsOn === true && nudgeDue(state, "foundVia");
  const phoneDue =
    completed &&
    countsOn !== null &&
    !foundViaDue &&
    platformCapabilities.phoneAccess &&
    nudgeDue(state, "phoneApp");

  useEffect(() => {
    if (!foundViaDue || (shownThisRun && shownThisRun !== "foundVia")) return;
    setShownThisRun("foundVia");
    showComposerNotice({
      id: FOUND_VIA_NOTICE_ID,
      conversationId: null,
      kind: "provider",
      title: t("nudges.foundVia.title"),
      foundVia: true,
    });
  }, [foundViaDue, shownThisRun, t]);

  useEffect(() => {
    if (!phoneDue || (shownThisRun && shownThisRun !== "phoneApp")) return;
    setShownThisRun("phoneApp");
    seedPostOnboardingHints();
    notify({
      id: PHONE_APP_NOTIFICATION_ID,
      kind: "info",
      title: t("nudges.phoneApp.title"),
      detail: t("nudges.phoneApp.detail"),
      actions: [
        {
          label: t("global.integrations.getApp.title"),
          primary: true,
          run: () => {
            finishPhoneApp();
            openPhoneDialog();
          },
        },
      ],
      onDismiss: finishPhoneApp,
    });
  }, [phoneDue, shownThisRun, t]);

  return null;
}
