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
