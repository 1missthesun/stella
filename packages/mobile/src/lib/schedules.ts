import { useCallback, useMemo } from "react";
import type { ScheduleKind, ScheduleRow } from "@stella/contracts/backend/schedules";
import { getBackendClient, useBackendView } from "./backend";
import {
  formatNextRun,
  parseStoredSchedule,
  summarizeSchedule,
} from "./schedule-format";

export type MobileSchedule = {
  kind: "cron" | "heartbeat";
  scheduleKind?: ScheduleKind;
  id: string;
  title: string;
  conversationId: string;
  enabled: boolean;
  nextRunAtMs: number;
  scheduleJson?: string;
  zone?: string;
  intervalMs?: number;
  targetDeviceId?: string;
  lastStatus?: string;
  lastError?: string;
  /** Due while its computer was away; runs once the computer is back. */
  waitingSinceMs?: number;
  running: boolean;
};

export type CloudScheduleRow = Pick<
  ScheduleRow,
  | "scheduleId"
  | "conversationId"
  | "targetDeviceId"
  | "prompt"
  | "schedule"
  | "zone"
  | "nextRunAt"
  | "status"
  | "description"
  | "lastError"
  | "waitingSince"
> &
  Partial<Pick<ScheduleRow, "kind">>;

export type MobileScheduleAction = "pause" | "resume" | "remove";

export const toMobileSchedule = (row: CloudScheduleRow): MobileSchedule => ({
  kind: "cron",
  ...(row.kind ? { scheduleKind: row.kind } : {}),
  id: row.scheduleId,
  title: row.description || row.prompt,
  conversationId: row.conversationId ?? "",
  enabled: row.status === "active",
  nextRunAtMs: row.nextRunAt,
  scheduleJson: row.schedule,
  ...(row.zone ? { zone: row.zone } : {}),
  ...(row.targetDeviceId ? { targetDeviceId: row.targetDeviceId } : {}),
  ...(row.lastError ? { lastError: row.lastError } : {}),
  ...(row.waitingSince !== undefined ? { waitingSinceMs: row.waitingSince } : {}),
  running: false,
});

export function useMobileSchedules(
  enabled: boolean,
): MobileSchedule[] | undefined {
  const rows = useBackendView("schedules.list", enabled ? {} : "skip").value;
  return useMemo(() => rows?.map(toMobileSchedule), [rows]);
}

const requestId = (action: string, id: string) =>
  `phone-${action}-${id}-${Date.now().toString(36)}`.slice(0, 128);

export function useScheduleAction() {
  return useCallback(
    async (action: MobileScheduleAction, schedule: MobileSchedule) => {
      const client = getBackendClient();
      if (action === "remove") {
        await client.call("schedules.remove", {
          requestId: requestId("remove", schedule.id),
          scheduleId: schedule.id,
        });
        return;
      }
      await client.call("schedules.update", {
        requestId: requestId(action, schedule.id),
        scheduleId: schedule.id,
        status: action === "resume" ? "active" : "paused",
      });
    },
    [],
  );
}

export type ScheduleRowBadge =
  | { kind: "paused" }
  | { kind: "next"; label: string };

export const scheduleRowBadge = (
  schedule: Pick<MobileSchedule, "enabled" | "nextRunAtMs">,
  nowMs: number,
): ScheduleRowBadge =>
  schedule.enabled
    ? { kind: "next", label: formatNextRun(schedule.nextRunAtMs, nowMs) }
    : { kind: "paused" };

export const scheduleCadence = (
  schedule: Pick<MobileSchedule, "scheduleJson" | "intervalMs"> &
    Partial<Pick<MobileSchedule, "nextRunAtMs" | "zone">>,
): string =>
  summarizeSchedule(
    schedule.scheduleJson ? parseStoredSchedule(schedule.scheduleJson) : null,
    schedule.intervalMs,
    schedule.nextRunAtMs,
    schedule.zone,
  );
