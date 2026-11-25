import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { useT, useTPlural } from "@/shared/i18n";
import { useUiState } from "@/context/ui-state";
import { useConversationSchedules, type ScheduleEntry } from "@/global/schedule/use-conversation-schedules";
import { formatNextRun } from "@stella/contracts/schedule-format";
import { toolCallMinutes } from "@stella/contracts/long-tool-call";
import { matchesQuery } from "@/features/workspace-display/display-search-store";
import { sectionCollapseStore, useSectionCollapsed } from "@/shell/section-collapse-store";
import { activityExpansionStore, loadActivityExpansion } from "@/shell/activity-expansion-store";
import {
  activityRowKey,
  compareActivityRowsByLifecycleStart,
  deriveTopLevelActivityTasks,
  flattenActivityTasks,
  getActivityRowCompletedAtMs,
  getActivityRowPause,
  getActivityRowSearchText,
  getActivityRowStatus,
  groupActivityTasks,
  getTaskAgentUpdates,
  summarizeCompactActivity,
  updateSeenRunningTaskIds,
  type ActivityRow,
  type TaskItem,
} from "@/features/chat/lib/event-transforms";
import { deriveConversationFiles, type ConversationFileEntry } from "@/features/workspace-display/derive-conversation-files";
import { agentFilesSignature, deriveAgentFilesMap, mergeAgentFileEvents } from "@/features/workspace-display/agent-files";
import { openConversationFocus } from "@/features/chat/services/conversation-focus-store";
import { useOpenConversationFile } from "@/features/cloud/use-cloud-drive-open";
import { usePendingCloudBrowserInteractions } from "@/features/cloud/use-cloud-browser-interactions";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { displayTabKindForPayload } from "@/features/workspace-display/payload-kind";
import { basenameOf } from "@/features/workspace-display/path-to-viewer";
import { ScheduleDetailsDialog } from "@/global/schedule/ScheduleDetailsDialog";
import type { ScheduleToolAffectedRef } from "@stella/contracts/scheduling";
import type { CloudBrowserInteractionSummary } from "@stella/contracts/cloud-browser";
import { useWindowFocus } from "@/shared/hooks/use-window-focus";
import { ACTIVITY_INDICATOR_MENU_MAX_ROWS } from "@stella/contracts/activity-indicator";
import { agentPauseKey, agentPauseLabel, type AgentPause } from "@stella/contracts/agent-pause";
import { DisplayTabIcon } from "../../features/workspace-display/icons";
import { Icon, Icons } from "../../kit";
import { fontSize, look, mixOklch, useTokens } from "../../theme";
import { ActivityTaskLabel, AgentAssistantUpdates, CompactChildState, META_TEXT, ROW_TEXT, TaskStatusIcon, stripLook } from "./activity-rows";

const SECTION_CAPS = {
  strip: { activity: 8, files: 5, schedule: 4 },
  overview: { activity: ACTIVITY_INDICATOR_MENU_MAX_ROWS, files: 6, schedule: 6 },
} as const;
const SEARCH_CAPS = { activity: 40, files: 40, schedule: 30 };
const QUICK_SEARCH_CAPS = { activity: 8, files: 8, schedule: 4 };
const EMPTY_FILES: ReadonlyArray<ConversationFileEntry> = [];
const EMPTY_UPDATES: ReadonlyArray<string> = [];
const AGENT_UPDATE_CAP = 1;
const TERMINAL_ROW_AUTOHIDE_MS = 30 * 60 * 1000;
const FILE_CHIP_PREVIEW = 2;
const ROW_ENTER = { opacity: 0, dur: 0.32 } as const;
const ROW_EXIT = { opacity: 0, dur: 0.14 } as const;

function WorkspaceSection({ title, sectionId, hideHeader = false, children }: { title: string; sectionId: string; hideHeader?: boolean; children?: ReactNode }) {
  const t = useTokens();
  const l = stripLook(t);
  const collapsed = useSectionCollapsed(sectionId);
  const sectionCollapsed = hideHeader ? false : collapsed;
  return (
    <col shrink={false} pt={10} px={12} pb={12} layout={0.18}>
      {!hideHeader ? (
        <row minH={18} mb={6} align="center">
          <box role="button" label={title} expanded={!sectionCollapsed} grow={1} minW={0} py={3} px={6} mx={-6} radius={6} hoverFill={l.hover} motion={{ dur: 0.12 }} onPress={() => sectionCollapseStore.toggle(sectionId)}>
            <text {...look(fontSize.base, 500, { em: 0 })} color={t.c.textStrong}>
              {title}
            </text>
          </box>
        </row>
      ) : null}
      {sectionCollapsed ? null : (
        <col gap={6} enter={{ opacity: 0, dur: 0.18 }} exit={{ opacity: 0, dur: 0.12 }}>
          {children}
        </col>
      )}
    </col>
  );
}

const taskSourceLabel = (task: TaskItem): string | undefined => (task.source === "claude-native" ? "Claude · read-only" : undefined);

function FileRow({ file, onOpen }: { file: ConversationFileEntry; onOpen: (file: ConversationFileEntry) => void }) {
  const t = useTokens();
  const l = stripLook(t);
  return (
    <row role="button" label={basenameOf(file.path)} title={file.path} align="center" gap={8} minW={0} py={4} px={6} mx={-6} radius={6} hoverFill={l.hover} focusFill={l.hover} motion={{ dur: 0.12 }} onPress={() => onOpen(file)} hoverGroup>
      <DisplayTabIcon kind={displayTabKindForPayload(file.payload)} size={15} />
      <text {...ROW_TEXT} features="'tnum' 1" color={t.c.textBase} hoverColor={t.c.textStrong} grow={1} minW={0} nowrap truncate>
        {basenameOf(file.path)}
      </text>
    </row>
  );
}

const TaskRow = memo(function TaskRow({
  task,
  expanded,
  onToggle,
  onSelect,
  files,
  onOpenFile,
  metaText,
  childContent,
  compactChildren,
  compactFailurePriority = false,
  isTopLevel,
}: {
  task: TaskItem;
  expanded: boolean;
  onToggle: (taskId: string, nextExpanded: boolean) => void;
  onSelect: (task: TaskItem) => void;
  files: ReadonlyArray<ConversationFileEntry>;
  onOpenFile: (entry: ConversationFileEntry) => void;
  metaText?: string;
  childContent?: ReactNode;
  compactChildren?: readonly ActivityRow[];
  compactFailurePriority?: boolean;
  isTopLevel: boolean;
}) {
  const tPlural = useTPlural();
  const t = useTokens();
  const l = stripLook(t);
  const windowFocused = useWindowFocus();
  const [hovered, setHovered] = useState(false);
  const label = task.description.trim();
  const sourceLabel = taskSourceLabel(task);
  const hasSubagents = Boolean(compactChildren);
  const paused = task.status === "running" && Boolean(task.paused);
  const waiting = !paused && Boolean(task.waitingFor);
  const agentUpdates = !hasSubagents && task.status === "running" ? getTaskAgentUpdates(task) : EMPTY_UPDATES;
  const [filesExpanded, setFilesExpanded] = useState(false);
  const hasAgentUpdates = agentUpdates.length > 0;
  const parentDetail = compactChildren
    ? task.status === "running"
      ? task.statusText?.trim() && task.statusText.trim() !== task.description.trim()
        ? task.statusText.trim()
        : undefined
      : task.outputPreview?.trim() || undefined
    : undefined;
  const hasFiles = files.length > 0;
  const previewFiles = files.slice(0, FILE_CHIP_PREVIEW);
  const extraFiles = files.slice(FILE_CHIP_PREVIEW);
  const compactTasks = useMemo(() => (compactChildren ? flattenActivityTasks(compactChildren) : undefined), [compactChildren]);
  const compactSummary = useMemo(() => (compactTasks ? summarizeCompactActivity(compactTasks) : undefined), [compactTasks]);
  const compactMotionActive = windowFocused && task.status === "running" && (compactSummary?.runningCount ?? 0) > 0;
  const hasDetail = Boolean(childContent) || Boolean(parentDetail) || hasAgentUpdates || hasFiles;
  const detailOpen = expanded && hasDetail;
  const showCaret = hasDetail && (hovered || expanded);
  const title =
    paused && task.paused ? `${label} — ${agentPauseLabel(task.paused)}` : waiting && task.statusText ? `${label} — ${task.statusText}` : task.longCall && metaText ? `${label} — ${metaText}` : label;
  const dimCompact = task.status === "completed" || task.status === "canceled";
  const head = (
    <>
      <TaskStatusIcon status={task.status} waiting={waiting} paused={paused} />
      <ActivityTaskLabel task={task} text={label} isTopLevel={isTopLevel} color={hovered ? t.c.textStrong : t.c.textBase} />
      {sourceLabel ? (
        <text {...look(fontSize.xs, 500, { em: 0 })} color={t.c.textWeak} shrink={false} nowrap>
          {sourceLabel}
        </text>
      ) : null}
    </>
  );
  return (
    <col minW={0} title={title} enter={ROW_ENTER} exit={ROW_EXIT}>
      <row align="center" gap={2} minW={0} onHover={setHovered}>
        <box
          role="button"
          label={task.source === "claude-native" ? "View Claude conversation" : "View activity"}
          grow={1}
          minW={0}
          py={5}
          pl={6}
          pr={showCaret ? 32 : 6}
          mx={-6}
          radius={6}
          fill={hovered ? l.hover : undefined}
          motion={{ dur: 0.12 }}
          focusRing={{ width: 0, color: "transparent" }}
          focusFill={l.hover}
          onPress={() => onSelect(task)}
        >
          {compactSummary ? (
            <col gap={5} minW={0}>
              <row align="center" gap={8} minW={0}>
                {head}
              </row>
              <CompactChildState
                summary={compactSummary}
                prioritizeFailure={compactFailurePriority && !expanded}
                startedAtMs={task.startedAtMs}
                running={task.status === "running"}
                pulse={compactMotionActive}
                dim={dimCompact}
              />
            </col>
          ) : (
            <row align="center" gap={8} minW={0}>
              {head}
              {metaText ? (
                <text {...META_TEXT} color={t.c.textWeak} shrink maxW="45%" nowrap truncate>
                  {metaText}
                </text>
              ) : null}
            </row>
          )}
        </box>
        {hasDetail ? (
          <box
            role="button"
            label={`${label || "Activity"} — ${expanded ? "collapse" : "expand"}`}
            expanded={expanded}
            absolute={{ right: 2 }}
            selfAlign="center"
            w={26}
            h={26}
            radius={6}
            center
            opacity={showCaret ? 1 : 0}
            inert={!showCaret}
            hoverFill={l.hover}
            motion={{ dur: 0.12 }}
            onPress={() => onToggle(task.id, !expanded)}
          >
            <box rotate={expanded ? 90 : 0} motion={{ dur: 0.12 }}>
              <Icon icon={Icons.stella.ChevronRight} size={14} strokeWidth={2} color={t.c.textWeak} />
            </box>
          </box>
        ) : null}
      </row>
      {detailOpen ? (
        <col gap={4} mt={4} pl={23} enter={{ opacity: 0, dur: 0.2 }} exit={{ opacity: 0, dur: 0.12 }}>
          {parentDetail ? (
            <text {...META_TEXT} color={t.c.textWeak} maxLines={2} truncate>
              {parentDetail}
            </text>
          ) : null}
          {hasAgentUpdates || hasFiles ? (
            <col gap={4} minW={0}>
              {hasAgentUpdates ? <AgentAssistantUpdates messages={agentUpdates} max={AGENT_UPDATE_CAP} /> : null}
              {hasFiles ? (
                <col gap={2} pt={4}>
                  {previewFiles.map((file) => (
                    <FileRow key={file.path} file={file} onOpen={onOpenFile} />
                  ))}
                </col>
              ) : null}
              {extraFiles.length > 0 ? (
                <row role="button" expanded={filesExpanded} py={4} px={6} mx={-6} radius={6} hoverFill={l.hover} motion={{ dur: 0.12 }} onPress={() => setFilesExpanded((value) => !value)} hoverGroup>
                  <text {...look(fontSize.xs, 500, { lh: 1.35 })} color={t.c.textWeak} hoverColor={t.c.textStrong} nowrap truncate>
                    {tPlural("shell.workspace.moreFiles", extraFiles.length)}
                  </text>
                </row>
              ) : null}
              {extraFiles.length > 0 && filesExpanded ? (
                <col gap={2} pt={4} mt={-4} enter={{ opacity: 0, dur: 0.2 }}>
                  {extraFiles.map((file) => (
                    <FileRow key={file.path} file={file} onOpen={onOpenFile} />
                  ))}
                </col>
              ) : null}
            </col>
          ) : null}
          {childContent ? <col ml={-23}>{childContent}</col> : null}
        </col>
      ) : null}
    </col>
  );
});

const TasksList = memo(function TasksList({
  rows,
  isTaskExpanded,
  isCompactTaskExpanded,
  onToggleTask,
  onSelectTask,
  agentFiles,
  onOpenFile,
  nested = false,
}: {
  rows: ReadonlyArray<ActivityRow>;
  isTaskExpanded: (task: TaskItem) => boolean;
  isCompactTaskExpanded: (task: TaskItem) => boolean;
  onToggleTask: (taskId: string, nextExpanded: boolean) => void;
  onSelectTask: (task: TaskItem) => void;
  agentFiles: ReadonlyMap<string, ConversationFileEntry[]>;
  onOpenFile: (entry: ConversationFileEntry) => void;
  nested?: boolean;
}) {
  const t = useT();
  return (
    <col role="list" gap={2} mt={nested ? 6 : 0} pl={nested ? 23 : 0} layout={0.32}>
      {rows.map((row) =>
        row.kind === "task" ? (
          <TaskRow
            key={activityRowKey(row)}
            task={row.task}
            expanded={isTaskExpanded(row.task)}
            onToggle={onToggleTask}
            onSelect={onSelectTask}
            files={agentFiles.get(row.task.id) ?? EMPTY_FILES}
            onOpenFile={onOpenFile}
            isTopLevel={!nested}
            metaText={
              row.task.waitingFor && !getActivityRowPause(row)
                ? t("app.chat.activityPill.statusWaiting")
                : row.task.longCall && !getActivityRowPause(row)
                  ? t("app.chat.activityPill.longCall", { minutes: toolCallMinutes(row.task.longCall) })
                  : undefined
            }
          />
        ) : (
          <TaskRow
            key={activityRowKey(row)}
            task={row.hierarchy.status === row.hierarchy.owner.status ? row.hierarchy.owner : { ...row.hierarchy.owner, status: row.hierarchy.status }}
            expanded={isCompactTaskExpanded(row.hierarchy.owner)}
            onToggle={onToggleTask}
            onSelect={onSelectTask}
            files={agentFiles.get(row.hierarchy.owner.id) ?? EMPTY_FILES}
            onOpenFile={onOpenFile}
            isTopLevel={!nested}
            compactChildren={row.hierarchy.children}
            compactFailurePriority={row.hierarchy.owner.status === "running"}
            childContent={
              <TasksList
                rows={row.hierarchy.children}
                isTaskExpanded={isTaskExpanded}
                isCompactTaskExpanded={isCompactTaskExpanded}
                onToggleTask={onToggleTask}
                onSelectTask={onSelectTask}
                agentFiles={agentFiles}
                onOpenFile={onOpenFile}
                nested
              />
            }
          />
        ),
      )}
    </col>
  );
});

/** desktop-ui's `CloudBrowserNeedsYouList`: sign-ins a cloud browser waits on, each opening its takeover. */
function CloudBrowserNeedsYouList({ interactions, onNavigate }: { interactions: readonly CloudBrowserInteractionSummary[]; onNavigate?: () => void }) {
  const t = useT();
  const tk = useTokens();
  const accent = (pct: number) => mixOklch(tk.c.accent, pct, "transparent");
  return (
    <col role="list" label={t("cloudBrowser.needsYou.title")} gap={5}>
      {interactions.map((interaction) => {
        const origin = interaction.displayOrigin;
        return (
          <row
            key={interaction.interactionId}
            role="button"
            label={origin}
            align="center"
            gap={9}
            minW={0}
            py={7}
            px={8}
            radius={10}
            border={mixOklch(tk.c.accent, 12, tk.c.borderWeak)}
            hoverBorder={mixOklch(tk.c.accent, 24, tk.c.borderWeak)}
            fill={accent(5)}
            hoverFill={accent(9)}
            focusFill={accent(9)}
            onPress={() => {
              sidebarSections.openLocation("takeover", interaction.interactionId);
              onNavigate?.();
            }}
          >
            <box w={26} h={26} radius={8} center fill={accent(10)} shrink={false}>
              <Icon icon={Icons.stella.Lock} size={14} color={tk.c.textBase} />
            </box>
            <col grow={1} minW={0}>
              <text {...look(fontSize.sm, 500)} color={tk.c.textStrong} nowrap truncate>
                {origin}
              </text>
              <text {...look(fontSize.xs, 400)} color={tk.c.textWeak} nowrap truncate>
                {interaction.kind === "device_code" ? t("cloudBrowser.needsYou.deviceCode", { origin }) : t("cloudBrowser.needsYou.signIn", { origin })}
              </text>
            </col>
            <text {...look(fontSize.xs, 500)} color={tk.c.textWeak} shrink={false}>
              {t("cloudBrowser.needsYou.open")}
            </text>
          </row>
        );
      })}
    </col>
  );
}

const scheduleEntryToAffectedRef = (entry: ScheduleEntry, conversationId: string): ScheduleToolAffectedRef => ({
  kind: entry.kind,
  id: entry.id,
  conversationId,
  name: entry.name,
  enabled: entry.enabled,
  nextRunAtMs: entry.nextRunAtMs,
});

/** desktop-ui's `WorkspaceSections`: what needs you, running and recent activity, matching files, and what's scheduled next. */
export const WorkspaceSections = memo(function WorkspaceSections({
  query = "",
  variant = "strip",
  searchMode = "complete",
  renderEmpty,
  onNavigate,
}: {
  query?: string;
  variant?: "strip" | "overview";
  searchMode?: "complete" | "quick";
  renderEmpty?: () => ReactNode;
  onNavigate?: () => void;
} = {}) {
  const t = useT();
  const tk = useTokens();
  const chat = useChatRuntime();
  const { state } = useUiState();

  const conversationId = state.conversationId;
  const activity = chat.conversation.activity;
  const allTasks = chat.conversation.tasks;
  const filesFeed = chat.conversation.files;
  const pendingBrowserInteractions = usePendingCloudBrowserInteractions();
  const { hasOlder: activityHasOlder, isLoadingOlder: activityIsLoadingOlder, loadOlder: loadOlderActivity } = activity;
  const { hasOlder: filesHaveOlder, isLoadingOlder: filesAreLoadingOlder, loadOlder: loadOlderFiles } = filesFeed;
  const schedules = useConversationSchedules(conversationId);

  const normalizedQuery = query.trim().toLowerCase();
  const searching = normalizedQuery.length > 0;
  const quickSearch = searching && searchMode === "quick";
  const visibleBrowserInteractions = useMemo(
    () => pendingBrowserInteractions.filter((interaction) => !searching || `${interaction.displayTitle ?? ""} ${interaction.displayOrigin}`.toLowerCase().includes(normalizedQuery)),
    [normalizedQuery, pendingBrowserInteractions, searching],
  );
  const caps = searching ? (quickSearch ? QUICK_SEARCH_CAPS : SEARCH_CAPS) : SECTION_CAPS[variant];

  useEffect(() => {
    if (!searching || quickSearch) return;
    if (activityHasOlder && !activityIsLoadingOlder) loadOlderActivity();
  }, [searching, quickSearch, activityHasOlder, activityIsLoadingOlder, loadOlderActivity]);

  useEffect(() => {
    if (!searching || quickSearch) return;
    if (filesHaveOlder && !filesAreLoadingOlder) loadOlderFiles();
  }, [searching, quickSearch, filesHaveOlder, filesAreLoadingOlder, loadOlderFiles]);

  const [openScheduleEntry, setOpenScheduleEntry] = useState<ScheduleEntry | null>(null);
  const [storedExpansion, setStoredExpansion] = useState(() => loadActivityExpansion(conversationId));
  let expansion = storedExpansion;
  if (storedExpansion.conversationId !== conversationId) {
    expansion = loadActivityExpansion(conversationId);
    setStoredExpansion(expansion);
  }
  const { seenTaskIds, overrides: expandOverrides } = expansion;
  const isTaskExpanded = useCallback(
    (task: TaskItem): boolean => expandOverrides.get(task.id) ?? (!task.paused && (task.status === "running" || seenTaskIds.has(task.id))),
    [expandOverrides, seenTaskIds],
  );
  const isCompactTaskExpanded = useCallback((task: TaskItem): boolean => expandOverrides.get(task.id) ?? false, [expandOverrides]);
  const toggleTask = useCallback((taskId: string, nextExpanded: boolean) => {
    setStoredExpansion((prev) => {
      const overrides = new Map(prev.overrides);
      overrides.set(taskId, nextExpanded);
      return { ...prev, overrides };
    });
  }, []);

  const tasksLoaded = chat.conversation.tasksLoaded;
  useEffect(() => {
    if (!tasksLoaded) return;
    setStoredExpansion((prev) => {
      if (prev.conversationId !== conversationId) return prev;
      const seen = updateSeenRunningTaskIds(prev.seenTaskIds, allTasks);
      return seen === prev.seenTaskIds ? prev : { ...prev, seenTaskIds: seen };
    });
  }, [allTasks, conversationId, tasksLoaded]);

  useEffect(() => {
    if (!expansion.conversationId || !tasksLoaded) return;
    activityExpansionStore.save(expansion.conversationId, {
      seenTaskIds: [...expansion.seenTaskIds],
      taskOverrides: Object.fromEntries(expansion.overrides),
    });
  }, [expansion, tasksLoaded]);

  const groupedRows = useMemo(() => groupActivityTasks(deriveTopLevelActivityTasks(allTasks)), [allTasks]);

  const matchingActivityKeys = useMemo(() => {
    if (!searching) return null;
    const keys = new Set<string>();
    for (const row of groupedRows) if (getActivityRowSearchText(row).toLowerCase().includes(normalizedQuery)) keys.add(activityRowKey(row));
    return keys;
  }, [groupedRows, normalizedQuery, searching]);

  const activityRows = useMemo(() => (matchingActivityKeys ? groupedRows.filter((row) => matchingActivityKeys.has(activityRowKey(row))) : groupedRows), [groupedRows, matchingActivityKeys]);

  const runningRows = useMemo(() => {
    const ordered = [...groupedRows].filter((row) => getActivityRowStatus(row) === "running").sort(compareActivityRowsByLifecycleStart);
    return matchingActivityKeys ? ordered.filter((row) => matchingActivityKeys.has(activityRowKey(row))) : ordered;
  }, [groupedRows, matchingActivityKeys]);

  const pausedGroups = useMemo(() => {
    const groups = new Map<string, { pause: AgentPause; rows: ActivityRow[] }>();
    for (const row of runningRows) {
      const pause = getActivityRowPause(row);
      if (!pause) continue;
      const key = agentPauseKey(pause);
      const group = groups.get(key);
      if (group) group.rows.push(row);
      else groups.set(key, { pause, rows: [row] });
    }
    return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
  }, [runningRows]);

  const doneRows = useMemo(
    () =>
      [...activityRows]
        .filter((row) => getActivityRowStatus(row) !== "running")
        .sort((a, b) => getActivityRowCompletedAtMs(b) - getActivityRowCompletedAtMs(a) || activityRowKey(a).localeCompare(activityRowKey(b))),
    [activityRows],
  );

  const agentFileEvents = useMemo(() => mergeAgentFileEvents(activity.activities, filesFeed.files), [activity.activities, filesFeed.files]);
  const agentFilesCacheRef = useRef<{ signature: string; result: Map<string, ConversationFileEntry[]> } | null>(null);
  const agentFiles = useMemo(() => {
    const signature = agentFilesSignature(agentFileEvents);
    const cached = agentFilesCacheRef.current;
    if (cached && cached.signature === signature) return cached.result;
    const result = deriveAgentFilesMap(agentFileEvents);
    agentFilesCacheRef.current = { signature, result };
    return result;
  }, [agentFileEvents]);

  const searchableFiles = useMemo(() => deriveConversationFiles(agentFileEvents).map((entry) => ({ entry, searchText: entry.path.toLowerCase() })), [agentFileEvents]);
  const filteredFiles = useMemo(() => {
    if (!searching) return EMPTY_FILES;
    return searchableFiles.filter(({ searchText }) => searchText.includes(normalizedQuery)).map(({ entry }) => entry);
  }, [normalizedQuery, searchableFiles, searching]);

  const filteredSchedules = useMemo(() => (query ? schedules.filter((entry) => matchesQuery(entry.name, query)) : schedules), [schedules, query]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (searching) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [searching]);

  const visibleDoneRows = useMemo(
    () => (searching ? doneRows.slice(0, Math.max(0, caps.activity - runningRows.length)) : doneRows.filter((row) => nowMs - getActivityRowCompletedAtMs(row) <= TERMINAL_ROW_AUTOHIDE_MS)),
    [doneRows, caps.activity, runningRows.length, searching, nowMs],
  );
  const visibleActivity = useMemo(() => {
    let room = quickSearch ? caps.activity : Number.POSITIVE_INFINITY;
    const take = (rows: readonly ActivityRow[]): ActivityRow[] => {
      const taken = rows.slice(0, Math.max(0, room));
      room -= taken.length;
      return taken;
    };
    const active = take(runningRows.filter((row) => !getActivityRowPause(row)));
    const paused = pausedGroups.map((group) => ({ ...group, rows: take(group.rows) })).filter((group) => group.rows.length > 0);
    const done = take(visibleDoneRows);
    return { active, paused, done };
  }, [caps.activity, pausedGroups, quickSearch, runningRows, visibleDoneRows]);
  const visibleFiles = useMemo(() => filteredFiles.slice(0, caps.files), [caps.files, filteredFiles]);
  const upNext = useMemo(() => filteredSchedules.slice(0, caps.schedule), [filteredSchedules, caps.schedule]);

  const hasActivity = visibleActivity.active.length > 0 || visibleActivity.paused.length > 0 || visibleActivity.done.length > 0;
  const hasNeedsYou = visibleBrowserInteractions.length > 0;
  const hasFiles = searching && visibleFiles.length > 0;
  const hasSchedule = upNext.length > 0;
  const dialogAffected = useMemo<ScheduleToolAffectedRef[]>(() => {
    if (!openScheduleEntry || !conversationId) return [];
    return [scheduleEntryToAffectedRef(openScheduleEntry, conversationId)];
  }, [conversationId, openScheduleEntry]);

  const openConversationFile = useOpenConversationFile(onNavigate);
  const handleOpenFile = useCallback((entry: ConversationFileEntry) => void openConversationFile(entry), [openConversationFile]);

  const handleSelectTask = useCallback(
    (task: TaskItem) => {
      if (!conversationId) return;
      openConversationFocus({ conversationId, root: { kind: "agent", threadId: task.id }, title: task.description.trim() || task.agentType || undefined });
      onNavigate?.();
    },
    [conversationId, onNavigate],
  );

  if (!hasNeedsYou && !hasActivity && !hasFiles && !hasSchedule) return renderEmpty ? <>{renderEmpty()}</> : null;

  const list = (rows: readonly ActivityRow[]) => (
    <TasksList rows={rows} isTaskExpanded={isTaskExpanded} isCompactTaskExpanded={isCompactTaskExpanded} onToggleTask={toggleTask} onSelectTask={handleSelectTask} agentFiles={agentFiles} onOpenFile={handleOpenFile} />
  );

  return (
    <>
      <col id="workspace-sections" maxH="100%" minH={0} scrollY>
        {hasNeedsYou ? (
          <WorkspaceSection title={t("cloudBrowser.needsYou.title")} sectionId="needs-you">
            <CloudBrowserNeedsYouList interactions={visibleBrowserInteractions} onNavigate={onNavigate} />
          </WorkspaceSection>
        ) : null}
        {hasActivity ? (
          <WorkspaceSection title="Activity" sectionId="activity" hideHeader>
            {visibleActivity.active.length > 0 ? list(visibleActivity.active) : null}
            {visibleActivity.paused.map((group, index) => (
              <col key={group.key} mt={index > 0 || visibleActivity.active.length > 0 ? 12 : 0}>
                <text {...look(fontSize.xs, 500, { lh: 1.35 })} color={tk.c.textWeak} mb={2} nowrap truncate>
                  {agentPauseLabel(group.pause)}
                </text>
                {list(group.rows)}
              </col>
            ))}
            {visibleActivity.done.length > 0 ? (
              <col mt={visibleActivity.paused.length > 0 ? 12 : visibleActivity.active.length > 0 ? 2 : 0}>{list(visibleActivity.done)}</col>
            ) : null}
          </WorkspaceSection>
        ) : null}
        {hasFiles ? (
          <WorkspaceSection title="Files" sectionId="files">
            <col gap={2}>
              {visibleFiles.map((file) => (
                <FileRow key={file.path} file={file} onOpen={handleOpenFile} />
              ))}
            </col>
          </WorkspaceSection>
        ) : null}
        {hasSchedule ? (
          <WorkspaceSection title="Schedule" sectionId="schedule">
            <col gap={2}>
              {upNext.map((entry) => (
                <row key={`${entry.kind}:${entry.id}`} role="button" label={entry.name.trim()} align="center" gap={8} minW={0} py={4} px={6} mx={-6} radius={6} hoverFill={stripLook(tk).hover} motion={{ dur: 0.12 }} onPress={() => setOpenScheduleEntry(entry)} hoverGroup>
                  <text {...ROW_TEXT} color={tk.c.textBase} hoverColor={tk.c.textStrong} grow={1} minW={0} nowrap truncate>
                    {entry.name.trim()}
                  </text>
                  <text {...look(fontSize.xs, 500, { em: 0 })} color={tk.c.textWeak} shrink={false} nowrap>
                    {formatNextRun(entry.nextRunAtMs, nowMs)}
                  </text>
                </row>
              ))}
            </col>
          </WorkspaceSection>
        ) : null}
      </col>
      <ScheduleDetailsDialog
        open={openScheduleEntry !== null}
        onOpenChange={(next) => {
          if (!next) setOpenScheduleEntry(null);
        }}
        affected={dialogAffected}
      />
    </>
  );
});
