import { memo } from "react";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import type { AgentCompletionSection } from "@/features/chat/lib/agent-completion";
import { useThreadActivityRecords } from "@/features/chat/hooks/use-thread-activity-records";
import { useAgentCard } from "@/features/cloud/use-agent-title";
import { TaskReportMore } from "./TaskReportMore";

type AgentRef = Extract<ReplyRef, { kind: "agent" }>;

export const ReplyReportLinks = memo(function ReplyReportLinks({
  refs,
  completions = [],
  conversationId,
}: {
  refs: readonly ReplyRef[];
  completions?: readonly AgentCompletionSection[];
  conversationId: string;
}) {
  const completedIds = new Set(completions.map((section) => section.agentId));
  const cited = refs.filter(
    (ref): ref is AgentRef =>
      ref.kind === "agent" && !completedIds.has(ref.threadId),
  );
  const activity = useThreadActivityRecords(
    conversationId,
    [...completedIds, ...cited.map((ref) => ref.threadId)],
  );
  const [primary, ...others] = cited;
  const primaryLocal = primary ? activity.get(primary.threadId) : undefined;
  const primaryCard = useAgentCard(
    conversationId,
    primary?.threadId ?? "",
    [primaryLocal?.description, primary?.title],
    primaryLocal?.status,
  );
  const latestCompletions = [
    ...new Map(completions.map((section) => [section.agentId, section])).values(),
  ];
  const reports: { reference: AgentRef; status: NonNullable<typeof primaryCard.status>; result?: string }[] = [
    ...latestCompletions.map((section) => ({
      reference: {
        kind: "agent",
        threadId: section.agentId,
        title: section.title,
      } as AgentRef,
      status: activity.get(section.agentId)?.status ?? "completed",
      result: section.result,
    })),
    ...(primary && primaryCard.status && primaryCard.status !== "running"
      ? [{
          reference: { ...primary, title: primaryCard.title ?? primary.title },
          status: primaryCard.status,
        }]
      : []),
    ...others.flatMap((reference) => {
      const status = activity.get(reference.threadId)?.status;
      return status && status !== "running" ? [{ reference, status }] : [];
    }),
  ];
  if (reports.length === 0) return null;
  return (
    <div className="reply-report-links">
      <TaskReportMore
        reports={reports.map(({ reference, status, result }) => ({
          reference,
          status,
          liveTitle: activity.get(reference.threadId)?.description ?? reference.title,
          journalReport: result,
        }))}
        conversationId={conversationId}
      />
    </div>
  );
});
