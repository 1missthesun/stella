import { useEffect } from "react";
import { deviceTimeZone } from "@stella/contracts/schedule-zone";
import { backendClient } from "@/platform/backend/backend-client";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";

const RECHECK_MS = 15 * 60_000;

/**
 * Tells the account where this computer is, whenever that changes. The
 * phone decides the user's zone; this computer's report counts only while
 * no phone has reported recently.
 */
export const useReportTimeZone = (): void => {
  const { hasConnectedAccount } = useAuthSessionState();

  useEffect(() => {
    if (!hasConnectedAccount) return;
    let reported: string | null = null;
    const report = () => {
      const timeZone = deviceTimeZone();
      if (!timeZone || timeZone === reported) return;
      reported = timeZone;
      void backendClient.call("schedules.reportZone", { timeZone, source: "computer" }).catch(() => {
        reported = null;
      });
    };
    report();
    const timer = window.setInterval(report, RECHECK_MS);
    window.addEventListener("focus", report);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", report);
    };
  }, [hasConnectedAccount]);
};

export function ScheduleZoneReporter() {
  useReportTimeZone();
  return null;
}
