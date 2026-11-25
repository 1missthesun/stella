import { Press, T, tx } from "../kit/compat";
import { useUsage } from "./usage.styles";
import { memo } from "react";
import { useT } from "@/shared/i18n";
import { executionLabel, type UsageThreadGroup } from "@/app/usage/usage-data";
import {
  formatCost,
  formatPercent,
  formatTokens,
  shortId,
  threadLabel,
} from "@/app/usage/format";

type UsageThreadsTableProps = {
  threads: UsageThreadGroup[];
  onSelectThread: (conversationId: string, threadId: string) => void;
};

export const UsageThreadsTable = memo(function UsageThreadsTable({
  threads,
  onSelectThread,
}: UsageThreadsTableProps) {
  const s = useUsage();
  const t = useT();
  return (
    <col w="full" {...s.usagePanel}>
      <row {...s.usagePanelHeading}>
        <col>
          <T role="heading">{t("app.usage.threads.title")}</T>
          <T w="full">{t("app.usage.threads.description")}</T>
        </col>
      </row>
      <col w="full" {...s.usageTableScroll}>
        <col w="full" {...s.usageTable}>
          <col>
            <col>
              <T {...tx(s.usageTable)}>{t("app.usage.threads.columns.execution")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.threads.columns.model")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.threads.columns.calls")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.threads.columns.tokens")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.threads.columns.cache")}</T>
              <T {...tx(s.usageTable)}>{t("app.usage.threads.columns.cost")}</T>
            </col>
          </col>
          <col>
            {threads.map((thread) => (
              <col key={thread.threadId}>
                <col>
                  <Press text={tx(s.usageTable)} {...s.usageThreadLink} onPress={() =>
                      onSelectThread(thread.conversationId, thread.threadId)
                    }>
                    <T {...tx(s.usageTable, s.usageThreadLink)}>{executionLabel(thread)}</T>
                    <T {...tx(s.usageTable, s.usageThreadLink)} weight={700}>{threadLabel(thread)}</T>
                    <T {...tx(s.usageTable, s.usageThreadLink)} title={thread.threadId}>
                      {shortId(thread.threadId)}
                    </T>
                  </Press>
                </col>
                <T {...tx(s.usageTable)} title={thread.models.join(", ")}>
                  {thread.models.join(", ")}
                </T>
                <T {...tx(s.usageTable)}>{thread.calls}</T>
                <T {...tx(s.usageTable)}>{formatTokens(thread.totalTokens)}</T>
                <T {...tx(s.usageTable)}>{formatPercent(thread.cacheReadRate)}</T>
                <T {...tx(s.usageTable)}>{formatCost(thread.totalCostUsd)}</T>
              </col>
            ))}
          </col>
        </col>
      </col>
    </col>
  );
});
