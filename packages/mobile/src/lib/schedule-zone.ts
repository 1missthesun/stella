/**
 * Tells the account where the phone is. The phone travels with the user, so
 * its zone is the user's: repeating schedules follow it, and Stella reads
 * the time in it. Reported on launch and whenever the app comes back.
 */

import { useEffect } from "react";
import { AppState } from "react-native";
import { deviceTimeZone } from "@stella/contracts/schedule-zone";
import { getBackendClient } from "./backend";

export function useReportTimeZone(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let reported: string | null = null;
    let lastAt = 0;
    const report = () => {
      const timeZone = deviceTimeZone();
      if (!timeZone) return;
      const now = Date.now();
      if (timeZone === reported && now - lastAt < 6 * 60 * 60_000) return;
      reported = timeZone;
      lastAt = now;
      void getBackendClient()
        .call("schedules.reportZone", { timeZone, source: "phone" })
        .catch(() => {
          reported = null;
        });
    };
    report();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") report();
    });
    return () => subscription.remove();
  }, [enabled]);
}
