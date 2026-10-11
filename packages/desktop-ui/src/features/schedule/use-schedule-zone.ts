import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  deviceTimeZone,
  scheduleZoneNotice,
  type ScheduleZoneNotice,
} from "@stella/contracts/schedule-zone";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";

const requestId = (move: boolean, zone: string) =>
  `desk-zone-${move ? "move" : "keep"}-${zone.replace(/[^A-Za-z0-9._:-]/g, "_")}-${Date.now().toString(36)}`.slice(0, 128);

export const answerScheduleZone = (timeZone: string, move: boolean) =>
  backendClient.call("schedules.setZone", { requestId: requestId(move, timeZone), timeZone, move });

/**
 * Whether to ask about moving the schedules to where this computer now is.
 * The first time the owner has no zone, this computer's becomes it without
 * a question.
 */
export const useScheduleZoneNotice = (): ScheduleZoneNotice | null => {
  const { hasConnectedAccount } = useAuthSessionState();
  const args = hasConnectedAccount ? {} : "skip";
  const zone = useBackendView("schedules.zone", args).value;
  const rows = useBackendView("schedules.list", args).value;
  const device = deviceTimeZone();
  const reported = useRef(false);

  useEffect(() => {
    if (!zone || zone.zone || !device || reported.current) return;
    reported.current = true;
    void answerScheduleZone(device, false).catch(() => {
      reported.current = false;
    });
  }, [zone, device]);

  return useMemo(() => scheduleZoneNotice(rows, zone, device), [rows, zone, device]);
};

export const useAnswerScheduleZone = () =>
  useCallback((notice: ScheduleZoneNotice, move: boolean) => answerScheduleZone(notice.to, move), []);
