/**
 * The time zone question on the phone: when it is somewhere whose clock
 * differs from where the schedules run, ask once, with one tap to move them
 * there. The first time the owner has no zone, the phone's becomes it.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Alert } from "react-native";
import {
  deviceTimeZone,
  scheduleZoneNotice,
  zoneLabel,
  type ScheduleZoneNotice,
} from "@stella/contracts/schedule-zone";
import { useT, useTPlural } from "../i18n";
import { getBackendClient, useBackendView } from "./backend";

const requestId = (move: boolean, zone: string) =>
  `phone-zone-${move ? "move" : "keep"}-${zone.replace(/[^A-Za-z0-9._:-]/g, "_")}-${Date.now().toString(36)}`.slice(0, 128);

export const answerScheduleZone = (timeZone: string, move: boolean) =>
  getBackendClient().call("schedules.setZone", {
    requestId: requestId(move, timeZone),
    timeZone,
    move,
  });

export function useScheduleZoneNotice(enabled: boolean): ScheduleZoneNotice | null {
  const args = enabled ? {} : "skip";
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
}

export function useScheduleZoneCopy() {
  const t = useT();
  const tPlural = useTPlural();
  return useCallback(
    (notice: ScheduleZoneNotice) => ({
      title: t("schedule.zone.title", { place: zoneLabel(notice.to) }),
      body: tPlural("schedule.zone.body", notice.count, { place: zoneLabel(notice.from) }),
      move: t("schedule.zone.move"),
      keep: t("schedule.zone.keep"),
    }),
    [t, tPlural],
  );
}

/** Asks once per move, wherever the user is in the app. */
export function useScheduleZonePrompt(enabled: boolean): void {
  const notice = useScheduleZoneNotice(enabled);
  const copy = useScheduleZoneCopy();
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const key = `${notice.from}>${notice.to}`;
    if (asked.current === key) return;
    asked.current = key;
    const text = copy(notice);
    Alert.alert(text.title, text.body, [
      {
        text: text.keep,
        style: "cancel",
        onPress: () => void answerScheduleZone(notice.to, false).catch(() => undefined),
      },
      {
        text: text.move,
        style: "default",
        isPreferred: true,
        onPress: () => void answerScheduleZone(notice.to, true).catch(() => undefined),
      },
    ]);
  }, [notice, copy]);
}
