import { T } from "../kit/compat";
import { useUsage, type UsageLayout } from "./usage.styles";
import { memo } from "react";
import type { UsageSummary } from "@/app/usage/usage-data";
import { useT } from "@/shared/i18n";
import { formatCost, formatPercent, formatTokens } from "@/app/usage/format";

export const UsageSummaryCards = memo(function UsageSummaryCards({ layout, summary }: { layout: UsageLayout; summary: UsageSummary }) {
  const s = useUsage();
  const t = useT();
  const cols = layout.narrow ? 1 : layout.wide ? 4 : 2;
  const cards = [
    { label: t("app.usage.summary.estimatedCost"), value: formatCost(summary.totalCostUsd), note: t("app.usage.summary.providerCalls", { count: summary.calls }) },
    { label: t("app.usage.summary.totalTokens"), value: formatTokens(summary.totalTokens), note: t("app.usage.summary.uncachedInput", { value: formatTokens(summary.inputTokens) }) },
    {
      label: t("app.usage.summary.cacheRead"),
      value: formatPercent(summary.cacheReadRate),
      note: t("app.usage.summary.cacheDetail", { read: formatTokens(summary.cacheReadTokens), written: formatTokens(summary.cacheWriteTokens) }),
    },
    { label: t("app.usage.summary.output"), value: formatTokens(summary.outputTokens), note: t("app.usage.summary.reasoningTokens", { value: formatTokens(summary.reasoningTokens) }) },
  ];
  return (
    <box {...s.usageSummary} columns={cols} label={t("app.usage.summary.label")}>
      {cards.map((card) => (
        <col key={card.label} {...s.usageSummaryItem}>
          <T {...s.usageSummaryLabel}>{card.label}</T>
          <T {...s.usageSummaryValue}>{card.value}</T>
          <T {...s.usageSummaryNote}>{card.note}</T>
        </col>
      ))}
    </box>
  );
});
