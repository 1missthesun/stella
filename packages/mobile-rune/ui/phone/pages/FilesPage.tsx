import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { translateNow, useT } from "@/shared/i18n";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { forgetArtifactFileEntry, useFileEntries } from "@/features/workspace-display/files-index";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { removeCanvasHtmlItem } from "@/shell/display/canvas-tab/canvas-items";
import { removeGeneratedMediaItem } from "@/shell/display/payload-to-tab-spec";
import { contextMenu } from "../../../../desktop-rune/ui/chat/context-menu";
import { topBarOverride } from "../topbar-override";
import { useWindowSize } from "../stage";
import { GUTTER, PRESS, rt, TEXT, useRn } from "../rn";
import { EmptyState } from "./EmptyState";
import { FileThumbnail } from "./files/FileThumbnail";
import { FolderShelf } from "./files/FolderShelf";
import { columnsFor, FILE_TYPES, fileRows, fileTime, folderEntries, pastSection, shownName, TILE_GAP, type DriveListing, type FileRow, type FileType, type FolderEntry, type SortOrder, type SourceFilter, type TypeFilter } from "./files/model";
import { SEARCH_STACK_HEIGHT, SearchStack } from "./files/SearchStack";
import { filesView, useFilesViewMode } from "./files/top-bar";
import { TypeStrip, type TypeOption } from "./files/TypeStrip";

// packages/mobile's FilesPage: every file Stella made or kept for you, newest first in sections by
// day (or by name), as a grid of tiles or a list of rows, with the Drive's folders on a shelf above,
// the types present as a strip at the top, and search, source filter and sort at the bottom.

const DRIVE_VIEW_ARGS = { limit: 200 };
const NO_DRIVE: DriveListing[] = [];
const ROW_THUMBNAIL = { width: 52, height: 60 };

type ListItem =
  | { kind: "section"; key: string; label: string; first: boolean }
  | { kind: "folders"; key: string; folders: FolderEntry[] }
  | { kind: "tiles"; key: string; rows: FileRow[]; details: string[] }
  | { kind: "row"; key: string; row: FileRow; detail: string };

const SECTION = TEXT.listSection;
const TILE_TITLE = rt(16, 600, -0.3, 21);
const TILE_DETAIL = rt(13.5, 500, 0, 18);
const EMPTY_FILTERED = rt(15, 500, 0, 21);

// The rows on screen (the list's `onVisibleRows`), so only files near it fetch their thumbnails.
let visible = { first: 0, last: 12 };
const visibleListeners = new Set<() => void>();
const noteVisible = (rows: { first: number; last: number }) => {
  if (rows.first === visible.first && rows.last === visible.last) return;
  visible = { first: rows.first, last: rows.last };
  for (const listener of visibleListeners) listener();
};
const subscribeVisible = (listener: () => void) => {
  visibleListeners.add(listener);
  return () => {
    visibleListeners.delete(listener);
  };
};
function useNearScreen(index: number): boolean {
  const near = useSyncExternalStore(subscribeVisible, () => index >= visible.first - 4 && index <= visible.last + 6);
  const [seen, setSeen] = useState(near);
  useEffect(() => {
    if (near) setSeen(true);
  }, [near]);
  return near || seen;
}

const forget = (row: FileRow) => {
  const entry = row.local;
  if (!entry) return;
  if (entry.source === "canvas") {
    if (entry.filePath) removeCanvasHtmlItem(entry.filePath);
  } else if (entry.source === "media") removeGeneratedMediaItem(entry.id);
  else forgetArtifactFileEntry(entry.id);
};

const open = (row: FileRow) => openDisplayPayloadTab(row.payload);

const fileMenuFor = (row: FileRow) =>
  contextMenu(() => [[{ label: translateNow("contextMenu.open"), run: () => open(row) }], ...(row.local ? [[{ label: translateNow("contextMenu.removeFromList"), run: () => forget(row) }]] : [])]);

const FileTile = memo(function FileTile({ row, width, detail, wanted }: { row: FileRow; width: number; detail: string; wanted: boolean }) {
  const c = useRn();
  return (
    <col role="button" label={[row.title, detail].filter(Boolean).join(", ")} focusable w={width} shrink={false} {...PRESS} onPress={() => open(row)} onContextMenu={fileMenuFor(row)}>
      <FileThumbnail kind={row.thumbnail} drivePath={row.drivePath} version={row.createdAt} extension={row.extension} size="tile" width={width} height={Math.round(width * 1.06)} wanted={wanted} />
      <text {...TILE_TITLE} color={c.text} mt={10} maxLines={1}>
        {shownName(row)}
      </text>
      <text {...TILE_DETAIL} color={c.textMuted} features="'tnum' 1" maxLines={1}>
        {detail}
      </text>
    </col>
  );
});

const FileListRow = memo(function FileListRow({ row, detail, wanted }: { row: FileRow; detail: string; wanted: boolean }) {
  const c = useRn();
  return (
    <row role="button" label={[row.title, detail].filter(Boolean).join(", ")} focusable w="full" minH={60} py={9} gap={16} align="center" {...PRESS} onPress={() => open(row)} onContextMenu={fileMenuFor(row)}>
      <FileThumbnail kind={row.thumbnail} drivePath={row.drivePath} version={row.createdAt} extension={row.extension} size="row" {...ROW_THUMBNAIL} wanted={wanted} />
      <col grow={1} minW={0} gap={2}>
        <text {...TEXT.listTitle} color={c.text} maxLines={1}>
          {shownName(row)}
        </text>
        {detail ? (
          <text {...TEXT.listDetail} color={c.textMuted} maxLines={1}>
            {detail}
          </text>
        ) : null}
      </col>
    </row>
  );
});

const Item = memo(function Item({ item, index, tileWidth, onOpenFolder }: { item: ListItem; index: number; tileWidth: number; onOpenFolder: (path: string) => void }) {
  const c = useRn();
  const wanted = useNearScreen(index);
  switch (item.kind) {
    case "section":
      return (
        <text role="heading" {...SECTION} color={c.textMuted} pt={item.first ? 14 : 30} pb={12} maxLines={1}>
          {item.label}
        </text>
      );
    case "folders":
      return <FolderShelf folders={item.folders} onOpen={onOpenFolder} />;
    case "tiles":
      return (
        <row gap={TILE_GAP} pb={22}>
          {item.rows.map((row, column) => (
            <FileTile key={row.key} row={row} width={tileWidth} detail={item.details[column] ?? ""} wanted={wanted} />
          ))}
        </row>
      );
    case "row":
      return <FileListRow row={item.row} detail={item.detail} wanted={wanted} />;
  }
});

const SPINNER = `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity="0.22" stroke-width="2.4"/><path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`;

export function FilesPage({ active, bottom }: { active: boolean; bottom: number }) {
  const c = useRn();
  const t = useT();
  const session = useCloudConversationSession();
  const signedIn = session.isCloudConversationReady || Boolean(session.accountUser);
  const local = useFileEntries();
  const driveValue = useBackendValue("drive.files", session.isCloudConversationReady ? DRIVE_VIEW_ARGS : "skip") as DriveListing[] | undefined;
  const drive = driveValue ?? NO_DRIVE;
  const rows = useMemo(() => fileRows(local, drive), [drive, local]);
  const mode = useFilesViewMode();
  const windowWidth = useWindowSize().w;
  const [measured, setMeasured] = useState<number | null>(null);
  const contentWidth = measured ?? windowWidth - GUTTER * 2;
  const [folder, setFolder] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const sources = useMemo(() => (rows.some((row) => row.bucket === "computer") ? (["cloud", "computer"] as const) : (["cloud"] as const)), [rows]);
  const sourceLabel = useCallback(
    (source: SourceFilter) => (source === "all" ? t("mobile.activityHub.files.filterAll") : source === "cloud" ? t("mobile.activityHub.files.sourceCloud") : t("mobile.computer.defaultDeviceLabel")),
    [t],
  );

  const presentTypes = useMemo(() => {
    const present = new Set<FileType>();
    for (const row of rows) present.add(row.type);
    return FILE_TYPES.filter((type) => present.has(type));
  }, [rows]);
  const activeType: TypeFilter = typeFilter !== "all" && presentTypes.includes(typeFilter) ? typeFilter : "all";

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const filtered = rows.filter(
      (row) =>
        (!folder || row.inFolder === folder || (needle !== "" && `${row.inFolder ?? ""}/`.startsWith(`${folder}/`))) &&
        (sourceFilter === "all" || row.bucket === sourceFilter) &&
        (activeType === "all" || row.type === activeType) &&
        (!needle || `${row.title} ${row.inFolder ?? ""}`.toLowerCase().includes(needle)),
    );
    if (sortOrder === "oldest") return filtered.sort((a, b) => a.createdAt - b.createdAt);
    if (sortOrder === "name") return filtered.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }, [activeType, folder, needle, rows, sortOrder, sourceFilter]);

  const folders = useMemo(() => (needle || activeType !== "all" ? [] : folderEntries(sourceFilter === "all" ? rows : rows.filter((row) => row.bucket === sourceFilter), folder)), [activeType, folder, needle, rows, sourceFilter]);

  const columns = columnsFor(contentWidth);
  const tileWidth = Math.floor((contentWidth - TILE_GAP * (columns - 1)) / columns);
  const items = useMemo<ListItem[]>(() => {
    const at = Date.now();
    const out: ListItem[] = [];
    if (folders.length > 0) out.push({ kind: "folders", key: `folders:${folder}`, folders });
    const add = (group: FileRow[]) => {
      if (mode === "list") {
        for (const row of group) {
          out.push({ kind: "row", key: row.key, row, detail: [row.extension.toUpperCase(), folder ? null : row.inFolder, fileTime(row.createdAt, at)].filter(Boolean).join(" · ") });
        }
        return;
      }
      for (let index = 0; index < group.length; index += columns) {
        const cells = group.slice(index, index + columns);
        out.push({ kind: "tiles", key: `tiles:${cells[0]!.key}`, rows: cells, details: cells.map((row) => [row.extension.toUpperCase(), fileTime(row.createdAt, at)].filter(Boolean).join(" · ")) });
      }
    };
    if (sortOrder === "name") {
      add(shown);
      return out;
    }
    let group: FileRow[] = [];
    let previous: string | null = null;
    for (const row of shown) {
      const section = pastSection(row.createdAt, at, t);
      if (section.key !== previous) {
        add(group);
        group = [];
        out.push({ kind: "section", key: `section:${section.key}`, label: section.label, first: out.length === 0 });
        previous = section.key;
      }
      group.push(row);
    }
    add(group);
    return out;
  }, [columns, folder, folders, mode, shown, sortOrder, t]);

  const openFolder = useCallback((path: string) => setFolder(path), []);
  useEffect(() => topBarOverride.onReset("files", () => setFolder("")), []);
  const allFilesLabel = t("mobile.activityHub.files.filterAll");
  useEffect(() => {
    if (!folder) return topBarOverride.set("files", null);
    const parent = folder.slice(0, Math.max(0, folder.lastIndexOf("/")));
    topBarOverride.set("files", { title: folder.split("/").pop() ?? folder, back: { label: parent.split("/").pop() || allFilesLabel, onPress: () => setFolder(parent) } });
  }, [allFilesLabel, folder]);
  useEffect(() => () => topBarOverride.set("files", null), []);

  const loading = signedIn && driveValue === undefined && local.length === 0;
  const hasAnything = rows.length > 0;
  const folderGone = folder !== "" && !loading && !rows.some((row) => `${row.inFolder ?? ""}/`.startsWith(`${folder}/`));
  useEffect(() => {
    if (folderGone) setFolder("");
  }, [folderGone]);
  useEffect(() => filesView.showToggle(hasAnything), [hasAnything]);

  const typeOptions = useMemo<TypeOption<TypeFilter>[]>(() => [{ value: "all", label: t("mobile.activityHub.files.types.all") }, ...presentTypes.map((type) => ({ value: type, label: t(`mobile.activityHub.files.types.${type}`) }))], [presentTypes, t]);
  const filtering = needle.length > 0 || sourceFilter !== "all" || activeType !== "all";

  if (!signedIn && !hasAnything) return <EmptyState id="phone-files-empty" motif="files" message={t("mobile.sidebar.signedOutHint")} bottom={bottom} live={active} />;
  if (loading) {
    return (
      <col id="phone-files-loading" grow={1} minH={0} center pb={bottom}>
        <icon svg={SPINNER} name="phone/files-spinner" view={24} size={22} color={c.textMuted} spin={0.8} />
      </col>
    );
  }
  if (!hasAnything) return <EmptyState id="phone-files-empty" motif="files" message={t("mobile.activityHub.files.empty")} bottom={bottom} live={active} />;

  return (
    <col id="phone-files" grow={1} minH={0} w="full">
      <col id="phone-files-scroll" scrollY grow={1} minH={0} px={GUTTER} pb={SEARCH_STACK_HEIGHT + bottom + 28} onSize={(size) => setMeasured((w) => (w !== null && Math.abs(w - (size.w - GUTTER * 2)) < 0.5 ? w : size.w - GUTTER * 2))}>
        {folder === "" && presentTypes.length > 1 ? <TypeStrip options={typeOptions} value={activeType} onChange={setTypeFilter} /> : null}
        {items.length === 0 ? (
          <text {...EMPTY_FILTERED} color={c.textMuted} textAlign="center" py={48}>
            {filtering ? t("mobile.activityHub.files.emptyFiltered") : t("mobile.activityHub.files.empty")}
          </text>
        ) : (
          <list key={`${mode}:${columns}:${folder}`} w="full" estimate={mode === "grid" ? Math.round(tileWidth * 1.06) + 71 : 78} overscan={[2, 4]} growth={false} onVisibleRows={noteVisible}>
            {items.map((item, index) => (
              <col key={item.key} id={`phone-files-item-${item.key}`} w="full">
                <Item item={item} index={index} tileWidth={tileWidth} onOpenFolder={openFolder} />
              </col>
            ))}
          </list>
        )}
      </col>
      <SearchStack active={active} bottom={bottom} query={query} onQuery={setQuery} sources={sources} source={sourceFilter} onSource={setSourceFilter} sort={sortOrder} onSort={setSortOrder} sourceLabel={sourceLabel} />
    </col>
  );
}
