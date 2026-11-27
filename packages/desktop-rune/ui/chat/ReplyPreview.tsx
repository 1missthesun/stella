import { memo, useCallback, useState } from "react";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import type { TaskLifecycleStatus } from "@stella/contracts/agent-runtime";
import { useT } from "@/shared/i18n";
import { openConversationFocus } from "@/features/chat/services/conversation-focus-store";
import { useThreadActivityRecords } from "@/features/chat/hooks/use-thread-activity-records";
import { useAgentCard } from "@/features/cloud/use-agent-title";
import type { AgentCompletionSection } from "@/features/chat/lib/agent-completion";
import { Icon, Icons, type IconData } from "../kit";
import { APP_TRACKING } from "../kit/compat";
import { derive, mix, radius, useTokens } from "../theme";

const MAX_STACKED_PREVIEWS = 3;
const SMALL = { size: 12, lineHeight: 16.2, tracking: APP_TRACKING };

const STATUS_ICONS: Record<TaskLifecycleStatus, IconData> = {
  running: Icons.stella.CircleDot,
  completed: Icons.stella.CheckCircle2,
  error: Icons.stella.AlertCircle,
  canceled: Icons.stella.Circle,
};

/** desktop-ui's `AgentLifecycleStatusIcon`. */
export function AgentLifecycleStatusIcon({ status, size = 14, color }: { status: TaskLifecycleStatus; size?: number; color?: string }) {
  return <Icon icon={STATUS_ICONS[status]} size={size} color={color} />;
}

type PreviewEntry = { kind: "ref"; ref: ReplyRef } | { kind: "completion"; section: AgentCompletionSection };

const bubbleLook = (t: ReturnType<typeof useTokens>) =>
  derive(t, "reply-preview", (k) => ({ fill: k.c.surfaceInset, border: k.c.border, hoverBorder: k.c.borderStrong, underline: mix(k.c.foreground, 40, "transparent") }));

/** desktop-ui's `ReplyPreview`: the quoted message or agent cards a reply answers, hooked to it by a curved connector. */
export const ReplyPreview = memo(function ReplyPreview({ refs, completions = [], conversationId }: { refs: readonly ReplyRef[]; completions?: readonly AgentCompletionSection[]; conversationId: string }) {
  const t = useT();
  const tokens = useTokens();
  const [expanded, setExpanded] = useState(false);
  const completedThreadIds = new Set(completions.map((section) => section.agentId));
  const entries: PreviewEntry[] = [
    ...completions.map((section): PreviewEntry => ({ kind: "completion", section })),
    ...refs.filter((ref) => ref.kind !== "agent" || !completedThreadIds.has(ref.threadId)).map((ref): PreviewEntry => ({ kind: "ref", ref })),
  ];
  const overflow = entries.length - MAX_STACKED_PREVIEWS;
  const visible = !expanded && overflow > 0 ? entries.slice(0, MAX_STACKED_PREVIEWS) : entries;
  const agentThreadIds = entries
    .map((entry) => (entry.kind === "completion" ? entry.section.agentId : entry.ref.kind === "agent" ? entry.ref.threadId : null))
    .filter((id): id is string => id !== null);
  const activity = useThreadActivityRecords(conversationId, agentThreadIds);
  if (entries.length === 0) return null;
  return (
    <col align="start" gap={4} w="fit" maxW="85%" ml={14} pb={10}>
      {visible.map((entry) => {
        if (entry.kind === "completion") {
          const { section } = entry;
          return (
            <AgentReplyPreview
              key={`c:${section.completionEventId ?? section.agentId}`}
              reference={{ kind: "agent", threadId: section.agentId, title: section.title }}
              conversationId={conversationId}
              status={activity.get(section.agentId)?.status}
              liveTitle={activity.get(section.agentId)?.description ?? section.title}
            />
          );
        }
        const { ref } = entry;
        return ref.kind === "message" ? (
          <MessageReplyPreview key={`m:${ref.id}`} reference={ref} conversationId={conversationId} />
        ) : (
          <AgentReplyPreview key={`a:${ref.threadId}`} reference={ref} conversationId={conversationId} status={activity.get(ref.threadId)?.status} liveTitle={activity.get(ref.threadId)?.description} />
        );
      })}
      {!expanded && overflow > 0 ? (
        <box py={7} px={10} radius={radius.full} role="button" focusable hoverGroup cursor="pointer" onPress={() => setExpanded(true)}>
          <text size={11} lineHeight={14.85} color={tokens.c.mutedForeground} hoverColor={tokens.c.foreground}>
            {t("app.chat.replyPreview.more", { count: overflow })}
          </text>
        </box>
      ) : null}
      <box absolute={{ left: -9, bottom: -2 }} w={14} h={18} borderSides={[0, 0, 1.5, 1.5]} border={tokens.c.borderStrong} corners={[0, 0, 0, 10]} opacity={0.85} inert />
    </col>
  );
});

function MessageReplyPreview({ reference, conversationId }: { reference: Extract<ReplyRef, { kind: "message" }>; conversationId: string }) {
  const t = useT();
  const tokens = useTokens();
  const look = bubbleLook(tokens);
  const open = useCallback(() => {
    openConversationFocus({ conversationId, root: { kind: "message", id: reference.id }, title: reference.preview });
  }, [conversationId, reference.id, reference.preview]);
  return (
    <col
      role="button"
      focusable
      cursor="pointer"
      title={t("app.chat.replyPreview.openMessage")}
      gap={2}
      minW={0}
      maxW="full"
      py={6 + 1}
      px={12 + 1}
      radius={radius["2xl"]}
      fill={look.fill}
      border={look.border}
      hoverBorder={look.hoverBorder}
      motion={{ dur: 0.12, bounce: 0 }}
      onPress={open}
    >
      <text size={11} weight={600} lineHeight={14.85} tracking={0.11} color={tokens.c.mutedForeground} opacity={0.85}>
        {reference.role === "user" ? t("app.chat.replyPreview.replyingToYou") : t("app.chat.replyPreview.replyingToStella")}
      </text>
      <text {...SMALL} color={tokens.c.foreground} opacity={0.8} maxLines={2} truncate="end">
        {reference.preview || t("app.chat.replyPreview.emptyMessage")}
      </text>
    </col>
  );
}

function AgentReplyPreview({ reference, conversationId, status, liveTitle }: { reference: Extract<ReplyRef, { kind: "agent" }>; conversationId: string; status?: TaskLifecycleStatus; liveTitle?: string }) {
  const t = useT();
  const tokens = useTokens();
  const look = bubbleLook(tokens);
  const card = useAgentCard(conversationId, reference.threadId, [liveTitle, reference.title], status);
  const title = card.title || t("app.chat.focus.agentFallback");
  const shownStatus = card.status ?? "completed";
  const open = useCallback(() => {
    openConversationFocus({ conversationId, root: { kind: "agent", threadId: reference.threadId }, title });
  }, [conversationId, reference.threadId, title]);
  const statusLabel =
    shownStatus === "running"
      ? t("app.chat.replyPreview.statusRunning")
      : shownStatus === "error"
        ? t("app.chat.replyPreview.statusFailed")
        : shownStatus === "canceled"
          ? t("app.chat.replyPreview.statusStopped")
          : t("app.chat.replyPreview.statusDone");
  return (
    <row minW={0} maxW="full" pr={4} radius={radius["2xl"]} clip={radius["2xl"]} fill={look.fill} border={look.border} hoverBorder={look.hoverBorder} motion={{ dur: 0.12, bounce: 0 }}>
      <row role="button" focusable cursor="pointer" title={t("app.chat.replyPreview.openTask")} grow={1} shrink minW={0} align="center" gap={8} pt={7 + 1} pb={7 + 1} pr={8} pl={12 + 1} hoverGroup onPress={open}>
        <box w={14} h={14} center shrink={false} role="img" label={statusLabel} title={statusLabel}>
          <AgentLifecycleStatusIcon status={shownStatus} color={tokens.c.mutedForeground} />
        </box>
        <text {...SMALL} weight={500} color={tokens.c.foreground} nowrap truncate grow={1} shrink minW={0}>
          {title}
        </text>
      </row>
    </row>
  );
}
