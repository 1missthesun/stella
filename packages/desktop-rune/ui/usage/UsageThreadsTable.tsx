import { Press, T, useTextBase } from "../kit/compat";
import { useUsage } from "./usage.styles";
import { memo } from "react";
import { useT } from "@/shared/i18n";
import { executionLabel, type UsageThreadGroup } from "@/app/usage/usage-data";
import { formatCost, formatPercent, formatTokens, shortId, threadLabel } from "@/app/usage/format";
import { UsageCellText, UsagePanel, UsageTable } from "./UsageTable";

type UsageThreadsTableProps = {
  threads: UsageThreadGroup[];
  onSelectThread: (conversationId: string, threadId: string) => void;
};

export const UsageThreadsTable = memo(function UsageThreadsTable({ threads, onSelectThread }: UsageThreadsTableProps) {
  const s = useUsage();
  const t = useT();
  const lh = useTextBase().lh;
  const link = s.usageThreadLink;
  const rowContentH = (link.py as number) * 2 + (link.gap as number) * 2 + ((s.usageThreadLinkKind.size as number) + (s.usageThreadLinkName.size as number) + (s.usageThreadLinkId.size as number)) * lh;
  const measureKey = threads.map((thread) => thread.threadId).join("|");
  return (
    <UsagePanel title={t("app.usage.threads.title")}>
      <UsageTable
        measureKey={measureKey}
        rows={threads.length}
        rowContentH={rowContentH}
        columns={[
          {
            head: t("app.usage.threads.columns.execution"),
            cells: threads.map((thread) => (
              <Press {...link} vertical onPress={() => onSelectThread(thread.conversationId, thread.threadId)}>
                <T {...s.usageThreadLinkKind}>{executionLabel(thread)}</T>
                <T {...s.usageThreadLinkName}>{threadLabel(thread)}</T>
                <T {...s.usageThreadLinkId} title={thread.threadId}>
                  {shortId(thread.threadId)}
                </T>
              </Press>
            )),
          },
          { head: t("app.usage.threads.columns.model"), end: true, cells: threads.map((thread) => <UsageCellText title={thread.models.join(", ")}>{thread.models.join(", ")}</UsageCellText>) },
          { head: t("app.usage.threads.columns.calls"), end: true, cells: threads.map((thread) => <UsageCellText>{thread.calls}</UsageCellText>) },
          { head: t("app.usage.threads.columns.tokens"), end: true, cells: threads.map((thread) => <UsageCellText>{formatTokens(thread.totalTokens)}</UsageCellText>) },
          { head: t("app.usage.threads.columns.cache"), end: true, cells: threads.map((thread) => <UsageCellText>{formatPercent(thread.cacheReadRate)}</UsageCellText>) },
          { head: t("app.usage.threads.columns.cost"), end: true, cells: threads.map((thread) => <UsageCellText>{formatCost(thread.totalCostUsd)}</UsageCellText>) },
        ]}
      />
    </UsagePanel>
  );
});
