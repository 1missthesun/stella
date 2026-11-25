import { mixOklch, sheet } from "../../theme";

export const useScheduleDetailsDialog = sheet((c) => ({
  scheduleDetailsDialog: { minH: 0 },
  scheduleDetailsDialog_dialogHeader: { pb: 6 },
  scheduleDetailsDialog_dialogDescription: { pb: 4, px: 24 },
  scheduleDetailsDialog_dialogBody: { pt: 12, pb: 20, px: 18 },
  scheduleDetailsDialogRows: { pad: 0, gap: 10 },
  scheduleDetailsDialogEmpty: { size: 13, color: c.textWeak },
  scheduleDetailsDialogRow: { py: 15, px: 17, gap: 12, border: mixOklch(c.border, 55, "transparent"), radius: 10, fill: mixOklch(c.foreground, 2.5, "transparent") },
  scheduleDetailsDialogRowEnabledFalse: { opacity: 0.65 },
  scheduleDetailsDialogRowMain: { gap: 3, shrink: true, minW: 0 },
  scheduleDetailsDialogRowName: { size: 14, weight: 500, color: c.textStrong, lh: 1.35, truncate: true, maxLines: 2 },
  scheduleDetailsDialogRowMeta: { align: "center", gap: 6, size: 12, color: c.textWeak },
  scheduleDetailsDialogRowMetaSep: { opacity: 0.6 },
  scheduleDetailsDialogRowActions: { align: "center", gap: 6, wrap: true },
  scheduleDetailsDialogRowError: { size: 12, color: c.destructive },
}));
