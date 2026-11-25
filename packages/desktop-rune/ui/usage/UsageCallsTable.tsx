import { Press, T, tx, useTextBase } from "../kit/compat";
import { useUsage } from "./usage.styles";
import { memo } from "react";
import type { LocalModelUsageRecord } from "@stella/contracts/local-chat";
import { useT } from "@/shared/i18n";
import { executionLabel } from "@/app/usage/usage-data";
import { formatCallTime, formatCost, formatTokens } from "@/app/usage/format";
import { UsageCellText, UsagePanel, UsageTable } from "./UsageTable";

const VISIBLE_CALLS = 500;

type UsageCallsTableProps = {
  records: LocalModelUsageRecord[];
  onSelectThread: (conversationId: string, threadId: string) => void;
};

export const UsageCallsTable = memo(function UsageCallsTable({ records, onSelectThread }: UsageCallsTableProps) {
  const s = useUsage();
  const t = useT();
  const lh = useTextBase().lh;
  const visible = records.slice(0, VISIBLE_CALLS);
  const size = (style: { size?: unknown }) => style.size as number;
  const rowContentH =
    size(s.usageCallProvider) * lh + (s.usageCallProvider.mb as number) + size(s.usageCallModel) * lh + (s.usageCallApi.mt as number) + size(s.usageCallApi) * lh;
  const failed = (record: LocalModelUsageRecord) => record.stopReason === "error" || record.stopReason === "aborted";
  const tokens = (head: string, value: (record: LocalModelUsageRecord) => number) => ({
    head,
    end: true,
    cells: visible.map((record) => <UsageCellText>{formatTokens(value(record))}</UsageCellText>),
  });
  return (
    <UsagePanel title={t("app.usage.calls.title")} description={t("app.usage.calls.description")}>
      <UsageTable
        measureKey={visible.map((record) => record.id).join("|")}
        rows={visible.length}
        rowContentH={rowContentH}
        columns={[
          {
            head: t("app.usage.calls.columns.time"),
            cells: visible.map((record) => <UsageCellText title={new Date(record.timestamp).toISOString()}>{formatCallTime(record.timestamp)}</UsageCellText>),
          },
          {
            head: t("app.usage.calls.columns.execution"),
            cells: visible.map((record) => (
              <Press {...s.usageCallThread} text={tx(s.usageTableCell, s.usageCallThread)} title={record.threadId} onPress={() => onSelectThread(record.conversationId, record.threadId)}>
                {`${executionLabel(record)} · ${record.agentType}`}
              </Press>
            )),
          },
          {
            head: t("app.usage.calls.columns.providerModel"),
            cells: visible.map((record) => (
              <col align="start">
                <T {...s.usageCallProvider}>{record.provider}</T>
                <T {...s.usageCallModel}>{record.responseModel || record.model}</T>
                <T {...s.usageCallApi}>{record.api}</T>
              </col>
            )),
          },
          tokens(t("app.usage.calls.columns.input"), (record) => record.inputTokens),
          {
            head: t("app.usage.calls.columns.cache"),
            end: true,
            cells: visible.map((record) => <UsageCellText>{`${formatTokens(record.cacheReadTokens)} / ${formatTokens(record.cacheWriteTokens)}`}</UsageCellText>),
          },
          tokens(t("app.usage.calls.columns.output"), (record) => record.outputTokens),
          tokens(t("app.usage.calls.columns.reasoning"), (record) => record.reasoningTokens),
          {
            head: t("app.usage.calls.columns.cost"),
            end: true,
            cells: visible.map((record) => (
              <UsageCellText
                title={t("app.usage.calls.costBreakdown", {
                  input: formatCost(record.inputCostUsd),
                  cacheRead: formatCost(record.cacheReadCostUsd),
                  cacheWrite: formatCost(record.cacheWriteCostUsd),
                  output: formatCost(record.outputCostUsd),
                })}
              >
                {formatCost(record.totalCostUsd)}
              </UsageCellText>
            )),
          },
          {
            head: t("app.usage.calls.columns.stop"),
            end: true,
            cells: visible.map((record) => (
              <UsageCellText title={record.errorMessage} {...(failed(record) ? s.usageCallStopFailed : null)}>
                {record.stopReason}
              </UsageCellText>
            )),
          },
        ]}
      />
      {records.length > VISIBLE_CALLS ? (
        <row {...s.usageTableNote}>
          <T {...tx(s.usageTableNote)}>{t("app.usage.calls.truncatedNote", { count: records.length.toLocaleString() })}</T>
        </row>
      ) : null}
    </UsagePanel>
  );
});
