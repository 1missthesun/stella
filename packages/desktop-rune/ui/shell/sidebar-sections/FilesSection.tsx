import { startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT, translateNow } from "@/shared/i18n";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { useUiState } from "@/context/ui-state";
import { flattenActivityTasks, getActivityRowSearchText, groupActivityTasks, summarizeCompactActivity, type TaskItem } from "@/features/chat/lib/event-transforms";
import { displaySearchStore, useDisplaySearchFocusRequest, useDisplaySearchOpen, useDisplaySearchQuery } from "@/features/workspace-display/display-search-store";
import { forgetArtifactFileEntry, useFileEntries, type FileEntry } from "@/features/workspace-display/files-index";
import { importLocalMedia, isSupportedMediaFile } from "@/features/workspace-display/media-files";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { openConversationFocus } from "@/features/chat/services/conversation-focus-store";
import { useActiveSidebarSection } from "@/features/workspace-display/sidebar-sections";
import { useDisplayPanelOpen } from "@/features/workspace-display/tab-store";
import { notifyMediaGenerationError } from "@/global/billing/paid-media-tier-toast";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { cloudDriveEntry } from "@/features/workspace-display/derive-conversation-files";
import { displayTabKindForPayload } from "@/features/workspace-display/payload-kind";
import { removeCanvasHtmlItem } from "@/shell/display/canvas-tab/canvas-items";
import { removeGeneratedMediaItem } from "@/shell/display/payload-to-tab-spec";
import { bucketByRecency } from "@/shared/lib/recency-buckets";
import { fileMenu } from "@/platform/context-menu";
import { contextMenu } from "../../chat/context-menu";
import type { DisplayTabPayload } from "@stella/contracts/desktop/display-payload";
import type { DisplayTabKind } from "@/features/workspace-display/types";
import { DisplayTabIcon } from "../../features/workspace-display/icons";
import { fileFromPath } from "../../chat/attach-paths";
import { EmptyState, Icon, Icons } from "../../kit";
import { fontSize, look, mixOklch, radius, useTokens } from "../../theme";
import { AgentLifecycleStatusIcon, CompactChildState } from "../workspace/activity-rows";

export const WORK_PAGE_SIZE = 50;
export const WORK_PAGE_END_THRESHOLD_PX = 160;
const DRIVE_LIST_LIMIT = 200;
const DRIVE_VIEW_ARGS = { limit: DRIVE_LIST_LIMIT };
const SEARCH_INPUT_ID = "files-list-search-input";

type DriveFile = { path: string; name: string; sizeBytes: number; contentType: string; updatedAt: number };

type WorkEntry =
  | FileEntry
  | { source: "drive"; id: string; kind: DisplayTabKind; title: string; filePath: string; folder: string; createdAt: number; payload: DisplayTabPayload };

type ActivityHierarchy = Extract<ReturnType<typeof groupActivityTasks>[number], { kind: "hierarchy" }>["hierarchy"];

type WorkItem =
  | { kind: "agent"; id: string; timestamp: number; task: TaskItem }
  | { kind: "agentGroup"; id: string; timestamp: number; hierarchy: ActivityHierarchy }
  | { kind: "file"; id: string; timestamp: number; entry: WorkEntry };

const NO_DRIVE_FILES: DriveFile[] = [];

const driveFolderOf = (drivePath: string) => {
  const slash = drivePath.lastIndexOf("/");
  return slash > 0 ? drivePath.slice(0, slash) : "";
};

const driveFileEntries = (files: readonly DriveFile[]): WorkEntry[] =>
  files.map((file) => {
    const conversationEntry = cloudDriveEntry({ path: file.path, name: file.name, sizeBytes: file.sizeBytes, contentType: file.contentType }, file.updatedAt);
    const payload = { ...conversationEntry.payload, cloudDrivePath: file.path } as DisplayTabPayload;
    return { source: "drive", id: `drive-file:${file.path}`, kind: displayTabKindForPayload(payload), title: file.name, filePath: file.path, folder: driveFolderOf(file.path), createdAt: file.updatedAt, payload };
  });

const forgetEntry = (entry: WorkEntry) => {
  switch (entry.source) {
    case "canvas":
      if (entry.filePath) removeCanvasHtmlItem(entry.filePath);
      return;
    case "media":
      removeGeneratedMediaItem(entry.id);
      return;
    case "artifact":
      forgetArtifactFileEntry(entry.id);
  }
};

const taskTimestamp = (task: TaskItem) => task.lastUpdatedAtMs || task.completedAtMs || task.startedAtMs;

const RECENCY_LABELS: Record<string, string> = { today: "Today", yesterday: "Yesterday", thisWeek: "This week", thisMonth: "This month", older: "Older" };

const ROW_TEXT = look(fontSize.base, 400);
const META_TEXT = look(fontSize.xs, 400);

/** `.files-list__item`: a hover-filled row whose meta and trailing button show on hover or focus. */
function ItemRow({ title, label, onPress, onContextMenu, leading, text, meta, metaTitle, trailing, compact, children, nested = false }: { title: string; label: string; onPress: () => void; onContextMenu?: (at: { x: number; y: number }) => void; leading: ReactNode; text: string; meta: string; metaTitle?: string; trailing?: ReactNode; compact?: boolean; children?: ReactNode; nested?: boolean }) {
  const t = useTokens();
  const hover = mixOklch(t.c.foreground, 5, "transparent");
  return (
    <row role="listitem" align={compact ? "stretch" : "center"} gap={2} radius={radius.sm} hover={hover} hoverGroup ml={nested ? 22 : 0} onContextMenu={onContextMenu}>
      <col role="button" label={label} title={title} focusable grow={1} minW={0} gap={compact ? 5 : 0} h={compact ? undefined : 30} py={compact ? 6 : 0} px={6} justify="center" radius={radius.sm} focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: radius.sm }} onPress={onPress}>
        <row align="center" gap={8} minW={0}>
          {leading}
          <text {...ROW_TEXT} grow={1} minW={0} color={t.c.textStrong} nowrap truncate>
            {text}
          </text>
          {meta ? (
            <text {...META_TEXT} shrink={false} color={t.c.textBase} title={metaTitle} hoverOpacity={[0, 1]} motion={{ dur: 0.12 }}>
              {meta}
            </text>
          ) : null}
        </row>
        {children}
      </col>
      {trailing}
    </row>
  );
}

/** `.files-list__remove` / `.files-list__group-open`: a 20 px button shown while its row is hovered. */
function RowAction({ label, icon, iconSize, strokeWidth, onPress }: { label: string; icon: (typeof Icons.stella)[keyof typeof Icons.stella]; iconSize: number; strokeWidth: number; onPress: () => void }) {
  const t = useTokens();
  return (
    <col justify="center" shrink={false} mr={4}>
      <box role="button" label={label} title={label} focusable w={20} h={20} center radius={radius.sm} hoverOpacity={[0, 1]} hover={mixOklch(t.c.foreground, 10, "transparent")} hoverColor={t.c.textStrong} focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: radius.sm }} onPress={onPress}>
        <Icon icon={icon} size={iconSize} strokeWidth={strokeWidth} color={t.c.textWeak} />
      </box>
    </col>
  );
}

function AgentThreadRow({ task, conversationId, nested = false, onPick }: { task: TaskItem; conversationId: string | null; nested?: boolean; onPick?: () => void }) {
  const t = useT();
  const tk = useTokens();
  return (
    <ItemRow
      title={task.description}
      label={task.description}
      nested={nested}
      onPress={() => {
        if (!conversationId) return;
        onPick?.();
        openConversationFocus({ conversationId, root: { kind: "agent", threadId: task.id }, title: task.description.trim() || t("shell.sidebar.taskSource") });
      }}
      leading={<AgentLifecycleStatusIcon status={task.status} size={17} strokeWidth={1.75} color={tk.c.textWeak} />}
      text={task.description}
      meta={task.source === "claude-native" ? "Claude · read-only" : t("shell.sidebar.taskSource")}
    />
  );
}

function AgentGroupRow({ hierarchy, conversationId, expanded, onToggle, onPick }: { hierarchy: ActivityHierarchy; conversationId: string | null; expanded: boolean; onToggle: () => void; onPick?: () => void }) {
  const tk = useTokens();
  const owner = hierarchy.owner;
  const descendants = useMemo(() => flattenActivityTasks(hierarchy.children), [hierarchy.children]);
  const summary = useMemo(() => summarizeCompactActivity(descendants), [descendants]);
  const label = owner.description.trim() || owner.agentType || "Agent";
  return (
    <>
      <ItemRow
        title={label}
        label={label}
        compact
        onPress={onToggle}
        leading={
          <>
            <box shrink={false} rotate={expanded ? 90 : 0} motion={{ dur: 0.12 }}>
              <Icon icon={Icons.stella.ChevronRight} size={14} strokeWidth={2} color={tk.c.textBase} />
            </box>
            <AgentLifecycleStatusIcon status={owner.status} size={17} strokeWidth={1.75} color={tk.c.textWeak} />
          </>
        }
        text={label}
        meta=""
        trailing={
          <RowAction
            label="Focus on this task"
            icon={Icons.stella.Eye}
            iconSize={13}
            strokeWidth={2}
            onPress={() => {
              if (!conversationId) return;
              onPick?.();
              openConversationFocus({ conversationId, root: { kind: "agent", threadId: owner.id }, title: label });
            }}
          />
        }
      >
        <CompactChildState summary={summary} prioritizeFailure={owner.status === "running" && !expanded} startedAtMs={owner.startedAtMs} running={owner.status === "running"} indent={22} />
      </ItemRow>
      {expanded ? descendants.map((child) => <AgentThreadRow key={`agent:${child.id}`} task={child} conversationId={conversationId} nested onPick={onPick} />) : null}
    </>
  );
}

function FileItemRow({ entry, onPick }: { entry: WorkEntry; onPick?: () => void }) {
  const tk = useTokens();
  const open = () => {
    onPick?.();
    openDisplayPayloadTab(entry.payload);
  };
  const drive = entry.source === "drive";
  const folder = drive ? entry.folder : "";
  return (
    <ItemRow
      title={entry.filePath ?? entry.title}
      label={entry.title}
      onPress={open}
      onContextMenu={contextMenu(async () => {
        const own = drive || !entry.filePath ? [[{ label: translateNow("contextMenu.open"), run: open }]] : await fileMenu(entry.filePath, { open, image: entry.kind === "image" })();
        return drive ? own : [...own, [{ label: translateNow("contextMenu.removeFromList"), run: () => forgetEntry(entry) }]];
      })}
      leading={<DisplayTabIcon kind={entry.kind} size={17} color={tk.c.textWeak} />}
      text={entry.title}
      meta={drive ? (folder ? `Drive · ${folder.split("/").pop()}` : "Drive") : "File"}
      metaTitle={drive ? `Stella Drive${folder ? ` / ${folder}` : ""}` : undefined}
      trailing={drive ? null : <RowAction label={`Remove ${entry.title}`} icon={Icons.stella.X} iconSize={12} strokeWidth={2.2} onPress={() => forgetEntry(entry)} />}
    />
  );
}

/** desktop-ui's `DropOverlay` (`--sidebar`): the dashed drop target over the list. */
function DropOverlay({ visible }: { visible: boolean }) {
  const t = useT();
  const tk = useTokens();
  if (!visible) return null;
  return (
    <col absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} raise={50} inert center border={mixOklch(tk.c.primary, 60, "transparent")} borderWidth={2} borderDash={6} corners={[0, 0, 0, 32]} fill={mixOklch(tk.c.primary, 6, "transparent")} enter={{ opacity: 0, dur: 0.15 }} exit={{ opacity: 0, dur: 0.15 }}>
      <col align="center" gap={6} opacity={0.85}>
        <Icon icon={Icons.stella.Download} size={28} strokeWidth={1.5} color={tk.c.primary} />
        <text {...look(fontSize.base, 600, { em: -0.01 })} color={tk.c.primary}>
          {t("app.chat.dropOverlay.label")}
        </text>
      </col>
    </col>
  );
}

/** desktop-ui's `WorkList`: the conversation's files (and, while searching, its agents) by recency, with search on Home. */
export function WorkList({ section = "files", idleContent = null, embedded = false, onPick }: { section?: "home" | "files" | string; idleContent?: ReactNode; embedded?: boolean; onPick?: () => void }) {
  const tk = useTokens();
  const showSearch = section === "home";
  const chat = useChatRuntime();
  const activity = chat.conversation.activity;
  const { accountScope, isCloudConversationReady } = useCloudConversationSession();
  const { state } = useUiState();
  const localEntries = useFileEntries();
  const driveFiles = (useBackendValue("drive.files", isCloudConversationReady ? DRIVE_VIEW_ARGS : "skip") as DriveFile[] | undefined) ?? NO_DRIVE_FILES;
  const entries = useMemo<readonly WorkEntry[]>(() => {
    if (driveFiles.length === 0) return localEntries;
    const drive = driveFileEntries(driveFiles);
    const inDrive = new Set(drive.map((entry) => entry.filePath));
    return [...localEntries.filter((entry) => !(entry.payload?.cloudDrivePath && inDrive.has(entry.payload.cloudDrivePath))), ...drive];
  }, [driveFiles, localEntries]);
  const panelOpen = useDisplayPanelOpen();
  const activeSection = useActiveSidebarSection();
  const searchOpen = useDisplaySearchOpen();
  const storedQuery = useDisplaySearchQuery();
  const focusRequest = useDisplaySearchFocusRequest();
  const [inputValue, setInputValue] = useState(storedQuery);
  const deferredQuery = useDeferredValue(inputValue.trim().toLowerCase());
  const [draggingMedia, setDraggingMedia] = useState(false);
  const [visibleItemCount, setVisibleItemCount] = useState(WORK_PAGE_SIZE);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const renderedAccountScopeRef = useRef(accountScope);

  useLayoutEffect(() => {
    if (renderedAccountScopeRef.current === accountScope) return;
    renderedAccountScopeRef.current = accountScope;
    displaySearchStore.close();
    setInputValue("");
    setVisibleItemCount(WORK_PAGE_SIZE);
    setExpandedGroupIds(new Set());
  }, [accountScope]);

  const toggleGroup = useCallback((id: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    setExpandedGroupIds(new Set());
  }, [state.conversationId]);

  useEffect(() => {
    if (!showSearch) return;
    if (!searchOpen) {
      setInputValue("");
      return;
    }
    const timer = setTimeout(() => displaySearchStore.setQuery(inputValue), 120);
    return () => clearTimeout(timer);
  }, [inputValue, searchOpen, showSearch]);

  useEffect(() => {
    if (!showSearch || !searchOpen) return;
    void stella.engine.focus(SEARCH_INPUT_ID);
  }, [focusRequest, searchOpen, showSearch]);

  useEffect(() => {
    if (embedded || !showSearch) return;
    if (searchOpen && (!panelOpen || activeSection !== "home")) displaySearchStore.close();
  }, [activeSection, embedded, panelOpen, searchOpen, showSearch]);

  const query = showSearch && searchOpen ? deferredQuery : "";

  useEffect(() => {
    if (!query || !activity.hasOlder || activity.isLoadingOlder) return;
    activity.loadOlder();
  }, [activity.hasOlder, activity.isLoadingOlder, activity.loadOlder, query]);

  const searchingOlderActivity = Boolean(query && (activity.hasOlder || activity.isLoadingOlder));

  const items = useMemo<WorkItem[]>(() => {
    const agents: WorkItem[] = query
      ? groupActivityTasks(chat.conversation.tasks)
          .filter((row) => getActivityRowSearchText(row).toLowerCase().includes(query))
          .map((row) =>
            row.kind === "task"
              ? { kind: "agent", id: `agent:${row.task.id}`, timestamp: taskTimestamp(row.task), task: row.task }
              : { kind: "agentGroup", id: `agent:${row.hierarchy.owner.id}`, timestamp: taskTimestamp(row.hierarchy.owner), hierarchy: row.hierarchy },
          )
      : [];
    const files: WorkItem[] = entries
      .filter((entry) => !query || `${entry.title} ${entry.filePath ?? ""}`.toLowerCase().includes(query))
      .map((entry) => ({ kind: "file", id: `file:${entry.id}`, timestamp: entry.createdAt, entry }));
    return [...agents, ...files].sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
  }, [chat.conversation.tasks, entries, query]);

  const visibleItems = useMemo(() => items.slice(0, visibleItemCount), [items, visibleItemCount]);
  const hasOlderItems = visibleItemCount < items.length;
  const bucketNowMs = Math.floor(Date.now() / 60000) * 60000;
  const itemGroups = useMemo(() => bucketByRecency(visibleItems, (item) => item.timestamp, bucketNowMs), [bucketNowMs, visibleItems]);

  useEffect(() => {
    setVisibleItemCount(WORK_PAGE_SIZE);
  }, [deferredQuery, searchOpen, state.conversationId]);

  const revealOlderItems = useCallback(() => {
    startTransition(() => setVisibleItemCount((current) => Math.min(items.length, current + WORK_PAGE_SIZE)));
  }, [items.length]);

  const onScroll = useCallback(
    (pos: { y: number; maxY: number }) => {
      if (hasOlderItems && pos.maxY - pos.y <= WORK_PAGE_END_THRESHOLD_PX) revealOlderItems();
    },
    [hasOlderItems, revealOlderItems],
  );

  const importDroppedFiles = useCallback(async (paths: string[]) => {
    const files = paths.map(fileFromPath);
    const supported = files.filter(isSupportedMediaFile);
    if (supported.length === 0) {
      notifyMediaGenerationError(new Error("Drop an image, video, or audio file."));
      return;
    }
    try {
      for (const file of supported) await importLocalMedia(file);
      if (supported.length < files.length) notifyMediaGenerationError(new Error("Some files were skipped because they are not media."));
    } catch (error) {
      notifyMediaGenerationError(error);
    }
  }, []);

  const embeddedSearch = embedded && showSearch;

  return (
    <col
      id={embedded ? "new-tab-files-list" : `files-list-${section}`}
      grow={1}
      minH={0}
      onDropHover={setDraggingMedia}
      onDropFiles={(paths) => {
        setDraggingMedia(false);
        if (paths.length > 0) void importDroppedFiles(paths);
      }}
    >
      <DropOverlay visible={draggingMedia} />
      {showSearch ? (
        <row id="files-list-search" align="center" gap={8} shrink={false} minH={embeddedSearch ? 44 : 32} mx={embeddedSearch ? 0 : 12} mt={embeddedSearch ? 0 : 8} mb={embeddedSearch ? 0 : 2} px={embeddedSearch ? 14 : 4} border={embeddedSearch ? tk.c.borderWeak : undefined} borderSides={embeddedSearch ? [0, 0, 1, 0] : undefined}>
          <Icon icon={Icons.stella.Search} size={15} strokeWidth={1.75} color={tk.c.textWeak} />
          <input
            id={SEARCH_INPUT_ID}
            grow={1}
            minW={0}
            h={28}
            value={inputValue}
            placeholder="Search anything"
            placeholderColor={tk.c.textBase}
            label="Search anything"
            {...look(embeddedSearch ? fontSize.sm : fontSize.base, 400)}
            color={tk.c.textStrong}
            keys={["Escape"]}
            onFocus={(focused) => {
              if (focused && !searchOpen) displaySearchStore.open();
            }}
            onInput={setInputValue}
            onKey={(event) => {
              if (event.key === "Escape") displaySearchStore.close();
            }}
          />
        </row>
      ) : null}

      {!query && idleContent ? (
        idleContent
      ) : items.length === 0 ? (
        query ? (
          <EmptyState motif="search" title={searchingOlderActivity ? "Searching…" : "No matches"} body={searchingOlderActivity ? "Looking through older activity." : "Try a different word."} />
        ) : (
          <EmptyState motif="files" title="No files yet" body="Files from Stella show up here." />
        )
      ) : (
        <col id={`files-list-scroll-${section}`} grow={1} minH={0} maxH={embedded ? 380 : undefined} scrollY pt={embedded ? 4 : 8} px={embedded ? 4 : 10} pb={embedded ? 4 : 14} onScroll={onScroll}>
          <col role="list" gap={10}>
            {itemGroups.map((group) => (
              <col key={group.id} gap={1}>
                <text role="heading" {...look(fontSize.xs, 500, { em: 0.04 })} textCase="upper" px={6} py={4} color={tk.c.textWeak}>
                  {RECENCY_LABELS[group.id] ?? group.id}
                </text>
                <col role="list" gap={1}>
                  {group.items.map((item) =>
                    item.kind === "agentGroup" ? (
                      <AgentGroupRow key={item.id} hierarchy={item.hierarchy} conversationId={state.conversationId} expanded={query ? true : expandedGroupIds.has(item.id)} onToggle={() => toggleGroup(item.id)} onPick={onPick} />
                    ) : item.kind === "agent" ? (
                      <AgentThreadRow key={item.id} task={item.task} conversationId={state.conversationId} onPick={onPick} />
                    ) : (
                      <FileItemRow key={item.id} entry={item.entry} onPick={onPick} />
                    ),
                  )}
                </col>
              </col>
            ))}
          </col>
        </col>
      )}
    </col>
  );
}

/** desktop-ui's `.work-section`: the Files section body. */
export function FilesSection() {
  return (
    <col id="work-section" grow={1} minH={0} minW={0} clip={0}>
      <col id="work-section-body" grow={1} minH={0} minW={0} w="full" maxW={880} px={20} selfAlign="center" clip={0}>
        <WorkList section="files" />
      </col>
    </col>
  );
}
