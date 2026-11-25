import { memo, useEffect, useState } from "react";
import { getCompactActivityStatusText, isActivityTaskWorking, type CompactActivitySummary, type TaskItem } from "@/features/chat/lib/event-transforms";
import { selectLatestAgentAssistantMessage } from "@/features/chat/lib/agent-assistant-summary";
import type { TaskLifecycleStatus } from "@stella/contracts/agent-runtime";
import { useT } from "@/shared/i18n";
import { Icon, Icons, type IconData } from "../../kit";
import { derive, fontSize, look, mixOklch, useTokens, type Tokens } from "../../theme";
import { TextShimmer } from "../../chat/TextShimmer";

export const ROW_TEXT = look(fontSize.base, 400, { lh: 1.35 });
export const META_TEXT = look(fontSize.xs, 400, { lh: 1.4, em: 0.01 });

/** `.chat-workspace-strip__*` colours shared by the activity rows. */
export const stripLook = (t: Tokens) =>
  derive(t, "workspace-strip", (t) => ({
    hover: mixOklch(t.c.foreground, 5, "transparent"),
    cell: mixOklch(t.c.foreground, 14, "transparent"),
    cellDone: mixOklch(t.c.foreground, 30, "transparent"),
    cellStopped: mixOklch(t.c.foreground, 10, "transparent"),
    bar: mixOklch(t.c.foreground, 7, "transparent"),
  }));

const LIFECYCLE_ICON: Record<TaskLifecycleStatus, IconData> = {
  running: Icons.stella.CircleDot,
  completed: Icons.stella.CheckCircle2,
  error: Icons.stella.AlertCircle,
  canceled: Icons.stella.Circle,
};

/** desktop-ui's `AgentLifecycleStatusIcon`. */
export function AgentLifecycleStatusIcon({ status, size, strokeWidth, color, opacity }: { status: TaskLifecycleStatus; size: number; strokeWidth: number; color: string; opacity?: number }) {
  return <Icon icon={LIFECYCLE_ICON[status]} size={size} strokeWidth={strokeWidth} color={color} opacity={opacity} />;
}

/** `.chat-workspace-strip__task-icon` in its row: paused, waiting, or the task's lifecycle. */
export function TaskStatusIcon({ status, waiting, paused }: { status: TaskItem["status"]; waiting?: boolean; paused?: boolean }) {
  const t = useTokens();
  const box = (child: React.ReactNode) => (
    <box w={15} h={Math.round(fontSize.base * 1.4)} center shrink={false} inert>
      {child}
    </box>
  );
  if (paused) return box(<Icon icon={Icons.stella.Pause} size={15} strokeWidth={2} color={t.c.textWeak} />);
  if (waiting) return box(<Icon icon={Icons.stella.Clock} size={15} strokeWidth={2} color={t.c.textBase} />);
  const color = status === "running" ? t.c.textStrong : status === "completed" ? t.c.textBase : status === "error" ? t.c.destructive : t.c.textWeak;
  return box(<AgentLifecycleStatusIcon status={status} size={15} strokeWidth={2} color={color} opacity={status === "canceled" ? 0.7 : undefined} />);
}

/** desktop-ui's `ActivityTaskShimmer`: a top-level task still working shimmers its label. */
export function ActivityTaskLabel({ task, text, isTopLevel, color }: { task: TaskItem; text: string; isTopLevel: boolean; color: string }) {
  if (isTopLevel && isActivityTaskWorking(task)) return <TextShimmer text={text} look={ROW_TEXT} durationMs={2000} color={color} />;
  return (
    <text {...ROW_TEXT} color={color} nowrap truncate minW={0}>
      {text}
    </text>
  );
}

const ELAPSED_STILL_GOING_MS = 2 * 60 * 60 * 1000;

const formatElapsedLabel = (elapsedMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  if (elapsedMs >= ELAPSED_STILL_GOING_MS) return "still going";
  return `${Math.floor(totalMinutes / 60)}h`;
};

const useElapsedRunningLabel = (startedAtMs: number | null) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs == null) return undefined;
    let timer = 0;
    const schedule = () => {
      const elapsed = Date.now() - startedAtMs;
      setNowMs(Date.now());
      if (elapsed >= ELAPSED_STILL_GOING_MS) return;
      timer = window.setTimeout(schedule, elapsed < 60_000 ? 1_000 : 60_000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [startedAtMs]);
  if (startedAtMs == null) return null;
  return formatElapsedLabel(nowMs - startedAtMs);
};

const compactTaskState = (task: TaskItem) => {
  switch (task.status) {
    case "running":
      return "running";
    case "completed":
      return "done";
    case "error":
      return "failed";
    case "canceled":
      return "stopped";
    default:
      return task.status;
  }
};

const compactTaskTooltip = (task: TaskItem) => {
  const label = task.description.trim() || "Task";
  const detail = (selectLatestAgentAssistantMessage(task.assistantMessages) ?? "").replace(/\s+/g, " ");
  const clipped = detail.length > 120 ? `${detail.slice(0, 117)}…` : detail;
  return `${label} · ${compactTaskState(task)}${clipped ? ` — ${clipped}` : ""}`;
};

const PULSE = { kind: "opacity", period: 1.8, low: 0.55, high: 1 } as const;

/** desktop-ui's `CompactChildState`: the helpers as cells (or a bar when many), then their tally. */
export const CompactChildState = memo(function CompactChildState({
  summary,
  prioritizeFailure,
  startedAtMs,
  running = false,
  pulse = false,
  dim = false,
}: {
  summary: CompactActivitySummary;
  prioritizeFailure: boolean;
  startedAtMs?: number;
  running?: boolean;
  pulse?: boolean;
  dim?: boolean;
}) {
  const t = useTokens();
  const l = stripLook(t);
  const statusText = getCompactActivityStatusText(summary, prioritizeFailure);
  const elapsedLabel = useElapsedRunningLabel(running && typeof startedAtMs === "number" ? startedAtMs : null);
  const failure = prioritizeFailure && summary.errorCount > 0;
  const segment = (count: number, fill: string, live = false) =>
    count > 0 ? <box grow={count} w={0} minW={1} h="full" fill={fill} loop={live && pulse ? PULSE : undefined} /> : null;
  return (
    <>
      {summary.usesProgressBar ? (
        <row align="center" gap={8} minW={0} maxW={168} ml={23} pt={2} opacity={dim ? 0.6 : 1} motion={{ dur: 0.4 }} inert>
          <row grow={1} minW={0} gap={1} h={3} radius={999} clip={999} fill={l.bar}>
            {segment(summary.completedCount, l.cellDone)}
            {segment(summary.runningCount, t.c.foreground, true)}
            {segment(summary.errorCount, t.c.destructive)}
            {segment(summary.canceledCount, l.cellStopped)}
          </row>
          <text {...look(fontSize.xs, 400, { lh: 1 })} color={t.c.textWeak} shrink={false} nowrap>
            {`${summary.completedCount}/${summary.totalCount}`}
          </text>
        </row>
      ) : (
        <row wrap gap={4} maxW={124} ml={23} pt={1} opacity={dim ? 0.6 : 1} motion={{ dur: 0.4 }}>
          {summary.tasks.map((task, index) => (
            <box
              key={task.id}
              w={4}
              h={4}
              radius={2}
              shrink={false}
              title={compactTaskTooltip(task)}
              fill={task.status === "completed" ? l.cellDone : task.status === "running" ? t.c.foreground : task.status === "error" ? t.c.destructive : task.status === "canceled" ? l.cellStopped : l.cell}
              motion={{ dur: 0.25 }}
              enter={{ opacity: 0, dur: 0.24 + index * 0.014 }}
              loop={task.status === "running" && pulse ? PULSE : undefined}
            />
          ))}
        </row>
      )}
      <text {...META_TEXT} color={failure ? t.c.destructive : t.c.textWeak} ml={23} minW={0} nowrap truncate>
        {`${statusText}${elapsedLabel ? ` · ${elapsedLabel}` : ""}`}
      </text>
    </>
  );
});

/** desktop-ui's `AgentAssistantUpdates`: the newest progress line a running agent reported. */
export function AgentAssistantUpdates({ messages, max }: { messages: readonly string[]; max?: number }) {
  const t = useT();
  const tk = useTokens();
  const newestFirst = [...messages].reverse();
  const visible = typeof max === "number" ? newestFirst.slice(0, max) : newestFirst;
  if (visible.length === 0) return null;
  return (
    <col role="list" label={t("shell.agentProgress.recentTaskUpdates")} gap={2} maxH={104} scrollY pr={2}>
      {visible.map((message, index) => (
        <text
          key={`${messages.length - index}:${message}`}
          {...META_TEXT}
          color={index === 0 ? tk.c.textBase : tk.c.textWeak}
          nowrap
          truncate
          minW={0}
          enter={index === 0 ? { opacity: 0, y: -3, dur: 0.24 } : undefined}
          exit={{ opacity: 0, y: 3, dur: 0.26 }}
        >
          {message}
        </text>
      ))}
    </col>
  );
}
