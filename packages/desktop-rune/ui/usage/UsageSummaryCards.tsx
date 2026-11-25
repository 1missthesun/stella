import { T } from "../kit/compat";
import { useUsage } from "./usage.styles";
import { memo } from "react";
import type { UsageSummary } from "@/app/usage/usage-data";
import { useT } from "@/shared/i18n";
import { formatCost, formatPercent, formatTokens } from "@/app/usage/format";

export const UsageSummaryCards = memo(function UsageSummaryCards({
  summary,
}: {
  summary: UsageSummary;
}) {
  const s = useUsage();
  const t = useT();
  return (
    <box {...s.usageSummary} label={t("app.usage.summary.label")}>
      <col>
        <T>{t("app.usage.summary.estimatedCost")}</T>
        <T weight={700}>{formatCost(summary.totalCostUsd)}</T>
        <T>
          {t("app.usage.summary.providerCalls", { count: summary.calls })}
        </T>
      </col>
      <col>
        <T>{t("app.usage.summary.totalTokens")}</T>
        <T weight={700}>{formatTokens(summary.totalTokens)}</T>
        <T>
          {t("app.usage.summary.uncachedInput", {
            value: formatTokens(summary.inputTokens),
          })}
        </T>
      </col>
      <col>
        <T>{t("app.usage.summary.cacheRead")}</T>
        <T weight={700}>{formatPercent(summary.cacheReadRate)}</T>
        <T>
          {t("app.usage.summary.cacheDetail", {
            read: formatTokens(summary.cacheReadTokens),
            written: formatTokens(summary.cacheWriteTokens),
          })}
        </T>
      </col>
      <col>
        <T>{t("app.usage.summary.output")}</T>
        <T weight={700}>{formatTokens(summary.outputTokens)}</T>
        <T>
          {t("app.usage.summary.reasoningTokens", {
            value: formatTokens(summary.reasoningTokens),
          })}
        </T>
      </col>
    </box>
  );
});
