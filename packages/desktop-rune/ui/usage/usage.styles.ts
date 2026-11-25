import { mix, font, sheet } from "../theme";

/** desktop-ui's usage.css container queries, by the screen's inline size. */
export type UsageLayout = { narrow: boolean; wide: boolean; widest: boolean };

export const usageLayout = (width: number): UsageLayout => ({
  narrow: width > 0 && width <= 400,
  wide: width >= 720,
  widest: width >= 1000,
});

export const useUsage = sheet((c, t) => {
  const pillButton = { minH: 34, px: 13, gap: 7, align: "center", justify: "center", border: c.border, radius: 999, fill: c.surfaceInset, color: c.foreground, size: 12, weight: 500, motion: { dur: 0.12 }, hover: c.surfaceRaisedHover, hoverBorder: c.borderStrong } as const;
  const pill = { py: 2, px: 7, radius: 999, fill: mix(c.foreground, 8, "transparent"), color: c.textWeak, size: 10, weight: 600, em: 0.04, textCase: "upper" } as const;
  const card = { border: c.border, fill: mix(c.card, 92, "transparent"), shadows: t.shadow.sm } as const;
  return {
    usageScreen: { w: "full", pt: 8, pb: 28, px: 2, align: "stretch" },
    usageScreenText: { family: "sans", em: -0.01, color: c.foreground },
    usageHeader: { w: "full", mb: 16, gap: 14, align: "start", justify: "between" },
    usageHeaderNarrow: { align: "stretch" },
    usageHeaderText: { mt: 2, grow: 1, shrink: true, minW: 0, color: c.textWeak, size: 12, lh: 1.55 },
    usageRefresh: pillButton,
    usageRefreshNarrow: { selfAlign: "start" },
    usageFilters: { w: "full", mb: 18, gap: 8, rowGap: 8 },
    usageFilterTrigger: { h: 36, fill: c.surfaceInset },
    usageSelection: { w: "full", mb: 18, pt: 13, pb: 13, px: 15, gap: 10, align: "start", border: c.border, radius: 12, fill: mix(c.accent, 8, c.card) },
    usageSelectionWide: { align: "center", justify: "between", gap: 16 },
    usageSelectionInfo: { shrink: true, minW: 0, maxW: "full", gap: 8, rowGap: 8, align: "center", wrap: true },
    usageSelectionInfoWide: { wrap: false },
    usagePill: pill,
    usageSelectionName: { shrink: true, minW: 0, truncate: true, nowrap: true, weight: 700 },
    usageSelectionId: { w: "full", truncate: true, nowrap: true, color: c.textWeak, size: 11, mono: true },
    usageSelectionIdWide: { w: undefined, grow: 1, shrink: true, minW: 0 },
    usageSelectionButton: pillButton,
    usageWarning: { w: "full", mb: 18, pt: 13, pb: 13, px: 15, border: c.border, radius: 12, fill: c.surfaceInset, color: c.textWeak, size: 12 },
    usageState: { w: "full", minH: 320, gap: 10, align: "center", justify: "center" },
    usageStateText: { color: c.textWeak, textAlign: "center" },
    usageStateTitle: { color: c.foreground, size: 15, weight: 700, textAlign: "center" },
    usageStateButton: pillButton,
    usageSummary: { w: "full", gap: 10, rowGap: 10 },
    usageSummaryCard: { ...card, pt: 15, pb: 15, px: 17, minH: 96, radius: 12, justify: "between", align: "start" },
    usageSummaryCardWide: { minH: 112 },
    usageSummaryLabel: { color: c.textWeak, size: 11, weight: 600, em: 0.04, textCase: "upper" },
    usageSummaryValue: { mt: 10, family: font.display, size: 20, weight: 700, lh: 1, em: -0.035 },
    usageSummaryNote: { mt: 8, color: c.textWeaker, size: 11 },
    usagePanel: { ...card, w: "full", mt: 10, pad: 1, clip: 12, radius: 12, align: "stretch" },
    usagePanelHeading: { w: "full", pt: 16, pb: 12, px: 18, gap: 16, align: "start", justify: "between" },
    usagePanelTitle: { family: font.display, size: 13, weight: 650, em: -0.025 },
    usagePanelDescription: { mt: 4, color: c.textWeak, size: 11, lh: 1.45 },
    usageChart: { w: "full", pb: 8, px: 8 },
    usageChartTick: { family: "sans", size: 10, color: c.textWeak },
    usageChartTooltip: { pt: 10, pb: 10, px: 12, gap: 3, border: c.border, radius: 10, fill: c.card, shadows: t.shadow.lg },
    usageChartTooltipText: { color: c.textWeak, size: 11 },
    usageChartTooltipTitle: { mb: 2, color: c.foreground, size: 11, weight: 700 },
    usageTableScroll: { w: "full", pt: 1, scrollX: true, border: c.borderWeak, borderSides: [1, 0, 0, 0] },
    usageTableLine: { border: c.borderWeak, borderSides: [0, 0, 1, 0] },
    usageTableRowHover: { hover: mix(c.foreground, 3, "transparent") },
    usageTableHead: { px: 12, justify: "center", color: c.textWeak, size: 10, weight: 600, em: 0.035, textCase: "upper", nowrap: true },
    usageTableCell: { px: 12, justify: "center", size: 11, nowrap: true, features: "'tnum' 1" },
    usageThreadLink: { pad: 2, gap: 3, minW: 190, maxW: 320, align: "start", radius: 4 },
    usageThreadLinkName: { maxW: "full", truncate: true, nowrap: true, color: c.foreground, size: 11, weight: 600 },
    usageThreadLinkId: { color: c.textWeaker, size: 11 / 1.2 },
    usageCallThread: { py: 3, px: 5, radius: 5, color: c.foreground, size: 11 },
    usageCallProvider: { mb: 2, maxW: 260, truncate: true, nowrap: true, color: c.textWeak, size: 10 },
    usageCallModel: { maxW: 260, truncate: true, nowrap: true, size: 11, weight: 700 },
    usageCallApi: { mt: 2, maxW: 260, truncate: true, nowrap: true, color: c.textWeaker, size: 9 },
    usageCallStopFailed: { color: c.destructive },
    usageTableNote: { w: "full", pt: 11, pb: 10, px: 14, border: c.borderWeak, borderSides: [1, 0, 0, 0], color: c.textWeak, size: 11 },
  };
});
