import { Press, T, tx } from "../kit/compat";
import { useUsage } from "./usage.styles";
import { memo } from "react";
import type { LocalModelUsageRecord } from "@stella/contracts/local-chat";
import { useT } from "@/shared/i18n";
import { executionLabel } from "@/app/usage/usage-data";
import { formatCallTime, formatCost, formatTokens } from "@/app/usage/format";

type UsageCallsTableProps = {
  records: LocalModelUsageRecord[];
  onSelectThread: (conversationId: string, threadId: string) => void;
};

export const UsageCallsTable = memo(function UsageCallsTable({
  records,
  onSelectThread,
}: UsageCallsTableProps) {
  const s = useUsage();
  const t = useT();
  return (
    <col w="full" {...s.usagePanel}>
      <row {...s.usagePanelHeading}>
        <col>
          <T role="heading">{t("app.usage.calls.title")}</T>
          <T w="full">{t("app.usage.calls.description")}</T>
        </col>
      </row>
      <col w="full" {...s.usageTableScroll}>
        <col w="full" {...s.usageTable}>
          <col>
            <col>
              <T {...tx(s.usageTable)}>{t("app.usage.calls.columns.time")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.calls.columns.execution")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.calls.columns.providerModel")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.calls.columns.input")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.calls.columns.cache")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.calls.columns.output")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.calls.columns.reasoning")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.calls.columns.cost")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.calls.columns.stop")}</T>
            </col>
          </col>
          <col>
            {records.slice(0, 500).map((record) => (
              <col key={record.id}>
                <T {...tx(s.usageTable)} title={new Date(record.timestamp).toISOString()}>
                  {formatCallTime(record.timestamp)}
                </T>
                <col>
                  <Press text={tx(s.usageTable)} {...s.usageCallThread} onPress={() =>
                      onSelectThread(record.conversationId, record.threadId)
                    } title={record.threadId}>
                    {executionLabel(record)} · {record.agentType}
                  </Press>
                </col>
                <col>
                  <T {...tx(s.usageTable)}>{record.provider}</T>
                  <T {...tx(s.usageTable)} weight={700}>{record.responseModel || record.model}</T>
                  <T {...tx(s.usageTable)}>{record.api}</T>
                </col>
                <T {...tx(s.usageTable)}>{formatTokens(record.inputTokens)}</T>
                <T {...tx(s.usageTable)}>
                  {formatTokens(record.cacheReadTokens)} /{" "}
                  {formatTokens(record.cacheWriteTokens)}
                </T>
                <T {...tx(s.usageTable)}>{formatTokens(record.outputTokens)}</T>
                <T {...tx(s.usageTable)}>{formatTokens(record.reasoningTokens)}</T>
                <T {...tx(s.usageTable)} title={t("app.usage.calls.costBreakdown", {
                    input: formatCost(record.inputCostUsd),
                    cacheRead: formatCost(record.cacheReadCostUsd),
                    cacheWrite: formatCost(record.cacheWriteCostUsd),
                    output: formatCost(record.outputCostUsd),
                  })}>
                  {formatCost(record.totalCostUsd)}
                </T>
                <T {...tx(s.usageTable)} title={record.errorMessage}>
                  {record.stopReason}
                </T>
              </col>
            ))}
          </col>
        </col>
      </col>
      {records.length > 500 ? (
        <T w="full" {...s.usageTableNote}>
          {t("app.usage.calls.truncatedNote", {
            count: records.length.toLocaleString(),
          })}
        </T>
      ) : null}
    </col>
  );
});
