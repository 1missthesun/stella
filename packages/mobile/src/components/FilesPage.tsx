import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list/react-native";
import { isCloudWorldAppPath } from "@stella/contracts/cloud-world-paths";
import { generatedImageFileName } from "@stella/contracts/generated-image-name";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Text } from "./Text";
import { useFocusEffect } from "expo-router";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useTabBottomInset } from "../lib/bottom-bar";
import { useT } from "../i18n";
import { authClient } from "../lib/auth-client";
import {
  artifactFileKey,
  artifactFileSource,
  conversationFilesFromDrive,
  type ConversationFile,
} from "../lib/conversation-files";
import { useBackendView } from "../lib/backend";
import { tapLight } from "../lib/haptics";
import {
  publishBackOverride,
  publishTopBarAccessory,
  useActivityHub,
  useComputerControl,
} from "../lib/main-shell-store";
import { GlassSurface } from "./glass";
import { pastSection, timeOfDay } from "../lib/list-sections";
import {
  artifactPrimaryFilePath,
  artifactTitle,
} from "../lib/mobile-artifacts";
import type { StoredPhoneAccess } from "../lib/phone-access";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import {
  fileExtension,
  fileThumbnailKind,
  type FileThumbnailKind,
  type FileThumbnailSource,
} from "../lib/file-thumbnails";
import { useFilesViewMode } from "../lib/files-view-mode";
import { useConversationFiles } from "../lib/use-conversation-files";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { useColors } from "../theme/theme-context";
import type { ChatArtifact } from "../types";
import { ArtifactViewer } from "./ArtifactViewer";
import { KIT } from "./chat-settings/kit";
import { EmptyState } from "./EmptyState";
import { useAiryList } from "./airy-list";
import { FilesViewToggle } from "./files/FilesViewToggle";
import { FileThumbnail } from "./files/FileThumbnail";
import { FileTypeStrip, type FileTypeOption } from "./files/FileTypeStrip";
import { FolderShelf, type FolderEntry } from "./files/FolderShelf";
import { Icon } from "./Icon";
import { NativeMenu } from "./NativeMenu";
import type { NativeMenuItem } from "./NativeMenu.types";

const EMPTY_ARTIFACTS: ChatArtifact[] = [];
const DRIVE_VIEW_ARGS = { limit: 200 };
const EMPTY_PAIRED: StoredPhoneAccess[] = [];
const SEARCH_HEIGHT = 48;

type SortOrder = "newest" | "oldest" | "name";
type SourceFilter = "all" | "cloud" | "upload" | `computer:${string}`;

const UNKNOWN_COMPUTER = "computer:unknown";

type FileType =
  | "images"
  | "videos"
  | "audio"
  | "documents"
  | "pages"
  | "code"
  | "other";
type TypeFilter = "all" | FileType;

const FILE_TYPES: FileType[] = [
  "images",
  "videos",
  "audio",
  "documents",
  "pages",
  "code",
  "other",
];

const EXTENSION_TYPES: Record<string, FileType> = {};
const extensions = (type: FileType, list: string) => {
  for (const ext of list.split(" ")) EXTENSION_TYPES[ext] = type;
};
extensions("images", "png jpg jpeg gif webp heic heif svg bmp tif tiff avif ico");
extensions("videos", "mp4 mov m4v webm mkv avi");
extensions("audio", "mp3 wav m4a aac flac ogg opus aiff");
extensions(
  "documents",
  "pdf doc docx xls xlsx ppt pptx md markdown txt rtf csv tsv pages key numbers odt ods odp epub",
);
extensions("pages", "html htm");
extensions(
  "code",
  "js mjs cjs ts tsx jsx py rb go rs java kt swift c h cc cpp hpp cs php sh zsh bash json yaml yml toml xml css scss sql lua dart",
);

type FileRow = ConversationFile & {
  title: string;
  bucket: SourceFilter;
  type: FileType;
  path: string;
  extension: string;
  thumbnail: FileThumbnailKind;
  inFolder: string | null;
};

type ListItem =
  | { kind: "section"; key: string; label: string; first: boolean }
  | { kind: "folders"; key: string; folders: FolderEntry[] }
  | { kind: "tiles"; key: string; rows: FileRow[] }
  | { kind: "row"; key: string; row: FileRow };

const TILE_MIN = 150;
const TILE_MAX_COLUMNS = 5;
const TILE_GAP = 18;
const ROW_THUMBNAIL = { width: 52, height: 60 };

const columnsFor = (width: number): number =>
  Math.min(
    TILE_MAX_COLUMNS,
    Math.max(2, Math.floor((width + TILE_GAP) / (TILE_MIN + TILE_GAP))),
  );

const filePathOf = (key: string): string =>
  key.startsWith("drive:")
    ? key.slice("drive:".length)
    : key.startsWith("path:")
      ? key.slice("path:".length)
      : "";

const driveFolder = (file: ConversationFile): string | null => {
  if (!file.key.startsWith("drive:") || file.source.kind === "upload") return null;
  const path = filePathOf(file.key);
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
};

const PEEK_ORDER: FileThumbnailKind[] = [
  "image",
  "video",
  "text",
  "html",
  "document",
  "audio",
  "none",
];

const folderEntries = (
  rows: readonly FileRow[],
  parent: string,
  sourceOf: (row: FileRow) => FileThumbnailSource,
): FolderEntry[] => {
  const prefix = parent ? `${parent}/` : "";
  const byPath = new Map<string, FileRow[]>();
  for (const row of rows) {
    if (!row.inFolder || !`${row.inFolder}/`.startsWith(prefix)) continue;
    const name = row.inFolder.slice(prefix.length).split("/")[0];
    if (!name) continue;
    const path = `${prefix}${name}`;
    const held = byPath.get(path);
    if (held) held.push(row);
    else byPath.set(path, [row]);
  }
  return [...byPath]
    .map(([path, held]) => ({
      path,
      name: path.slice(prefix.length),
      count: held.length,
      newest: Math.max(...held.map((row) => row.createdAt)),
      peeks: [...held]
        .sort(
          (a, b) =>
            PEEK_ORDER.indexOf(a.thumbnail) - PEEK_ORDER.indexOf(b.thumbnail) ||
            b.createdAt - a.createdAt,
        )
        .slice(0, 3)
        .reverse()
        .map((row) => ({
          key: row.key,
          source: sourceOf(row),
          extension: row.extension,
        })),
    }))
    .sort((a, b) => b.newest - a.newest)
    .map(({ path, name, count, peeks }) => ({ path, name, count, peeks }));
};

const shownName = (row: { title: string; extension: string }): string => {
  const suffix = `.${row.extension}`;
  return row.extension &&
    row.title.length > suffix.length &&
    row.title.toLowerCase().endsWith(suffix)
    ? row.title.slice(0, -suffix.length)
    : row.title;
};

const fileTime = (ms: number, now: number): string => {
  if (ms <= 0) return "";
  const date = new Date(ms);
  if (now - ms < 6 * 24 * 60 * 60_000) {
    return date.toDateString() === new Date(now).toDateString()
      ? timeOfDay(ms)
      : `${date.toLocaleDateString(undefined, { weekday: "short" })} ${timeOfDay(ms)}`;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  });
};

const fileType = (title: string, artifact: ChatArtifact): FileType => {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(title)?.[1]?.toLowerCase();
  const byExtension = ext ? EXTENSION_TYPES[ext] : undefined;
  if (byExtension) return byExtension;
  const payload = artifact.payload;
  switch (payload.kind) {
    case "media":
      if (payload.asset.kind === "image") return "images";
      if (payload.asset.kind === "video") return "videos";
      if (payload.asset.kind === "audio") return "audio";
      return "other";
    case "markdown":
    case "office":
    case "pdf":
      return "documents";
    case "canvas-html":
    case "url":
      return "pages";
    case "source-diff":
      return "code";
    default:
      return "other";
  }
};

const fileName = (file: ConversationFile): string => {
  if (file.name?.trim()) return file.name.trim();
  const payload = file.artifact.payload;
  const filePath = artifactPrimaryFilePath(payload);
  const name = filePath?.split(/[?#]/)[0]?.split(/[\\/]/).pop();
  if (
    name &&
    payload.kind === "media" &&
    payload.asset.kind === "image" &&
    payload.presentation === "inline-image"
  ) {
    return generatedImageFileName({
      prompt: payload.prompt,
      index: 0,
      count: payload.asset.filePaths.length,
      extension: /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? "png",
    });
  }
  return name || artifactTitle(payload);
};

const titledArtifact = (artifact: ChatArtifact, title: string): ChatArtifact => {
  const payload = artifact.payload;
  if (payload.kind === "agent-work" || payload.kind === "map-route") return artifact;
  if (artifactTitle(payload) === title) return artifact;
  return { ...artifact, payload: { ...payload, title } };
};

export function FilesPage() {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bottomInset = useTabBottomInset();
  const hub = useActivityHub();
  const computer = useComputerControl();
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);
  const hubArtifacts = hub?.artifacts ?? EMPTY_ARTIFACTS;
  const preferredAccess = hub?.access ?? null;
  const pairedDesktops = computer?.pairedDesktops ?? EMPTY_PAIRED;
  const journal = useConversationFiles(
    signedIn ? (hub?.conversationId ?? null) : null,
    hub?.revision ?? null,
  );
  const driveFiles = useBackendView(
    "drive.files",
    signedIn ? DRIVE_VIEW_ARGS : "skip",
  ).value;
  const driveRows = useMemo(
    () =>
      driveFiles
        ? conversationFilesFromDrive(driveFiles, hub?.conversationId ?? "")
        : [],
    [driveFiles, hub?.conversationId],
  );
  const airy = useAiryList();
  const mode = useFilesViewMode();
  const windowWidth = useWindowDimensions().width;
  const [contentWidth, setContentWidth] = useState(
    windowWidth - KIT.gutter * 2,
  );
  const [folder, setFolder] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [viewerArtifact, setViewerArtifact] = useState<ChatArtifact | null>(
    null,
  );

  const rows = useMemo<FileRow[]>(() => {
    const fallbackDevice = preferredAccess?.desktopDeviceId ?? null;
    const byKey = new Map<string, ConversationFile>();
    for (const file of journal.files) byKey.set(file.key, file);
    const merged: ConversationFile[] = [...journal.files];
    for (const file of driveRows) {
      const known = byKey.get(file.key);
      if (known) {
        byKey.set(file.key, { ...known, folder: file.folder });
        continue;
      }
      byKey.set(file.key, file);
      merged.push(file);
    }
    for (const artifact of hubArtifacts) {
      const filePath = artifactPrimaryFilePath(artifact.payload);
      if (!filePath || isCloudWorldAppPath(filePath)) continue;
      const key = artifactFileKey(artifact);
      const known = byKey.get(key);
      if (known) {
        byKey.set(key, { ...known, artifact });
        continue;
      }
      const payload = artifact.payload as { createdAt?: unknown };
      const file: ConversationFile = {
        key,
        artifact,
        createdAt: typeof payload.createdAt === "number" ? payload.createdAt : 0,
        source: artifactFileSource(artifact),
      };
      byKey.set(key, file);
      merged.push(file);
    }
    return merged.map((entry) => {
      const file = byKey.get(entry.key) ?? entry;
      const deviceId =
        file.source.kind === "computer"
          ? (file.source.deviceId ?? fallbackDevice)
          : null;
      const bucket: SourceFilter =
        file.source.kind === "computer"
          ? deviceId
            ? `computer:${deviceId}`
            : UNKNOWN_COMPUTER
          : file.source.kind;
      const title = fileName(file);
      const path = filePathOf(file.key);
      const extension = fileExtension(path) || fileExtension(title);
      return {
        ...file,
        artifact: titledArtifact(file.artifact, title),
        title,
        bucket,
        type: fileType(title, file.artifact),
        path,
        extension,
        thumbnail: path ? fileThumbnailKind(extension) : "none",
        inFolder: driveFolder(file),
      };
    });
  }, [driveRows, hubArtifacts, journal.files, preferredAccess?.desktopDeviceId]);

  const computerLabel = useCallback(
    (deviceId: string | null) =>
      (deviceId ? journal.deviceNames.get(deviceId) : undefined) ??
      t("mobile.computer.defaultDeviceLabel"),
    [journal.deviceNames, t],
  );

  const bucketLabel = useCallback(
    (bucket: SourceFilter) => {
      if (bucket === "all") return t("mobile.activityHub.files.filterAll");
      if (bucket === "cloud") return t("mobile.activityHub.files.sourceCloud");
      if (bucket === "upload") return t("mobile.activityHub.files.sourceUpload");
      if (bucket === UNKNOWN_COMPUTER) return computerLabel(null);
      return computerLabel(bucket.slice("computer:".length));
    },
    [computerLabel, t],
  );

  const buckets = useMemo(() => {
    const computers = new Set<SourceFilter>();
    for (const access of pairedDesktops) {
      computers.add(`computer:${access.desktopDeviceId}`);
    }
    let hasUploads = false;
    for (const row of rows) {
      if (row.bucket.startsWith("computer:")) computers.add(row.bucket);
      if (row.bucket === "upload") hasUploads = true;
    }
    return [
      "cloud" as SourceFilter,
      ...computers,
      ...(hasUploads ? (["upload"] as SourceFilter[]) : []),
    ];
  }, [pairedDesktops, rows]);

  const presentTypes = useMemo(() => {
    const present = new Set<FileType>();
    for (const row of rows) present.add(row.type);
    return FILE_TYPES.filter((type) => present.has(type));
  }, [rows]);
  const activeType: TypeFilter =
    typeFilter !== "all" && presentTypes.includes(typeFilter)
      ? typeFilter
      : "all";

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter(
      (row) =>
        (!folder ||
          row.inFolder === folder ||
          (needle !== "" && `${row.inFolder ?? ""}/`.startsWith(`${folder}/`))) &&
        (sourceFilter === "all" || row.bucket === sourceFilter) &&
        (activeType === "all" || row.type === activeType) &&
        (!needle ||
          `${row.title} ${row.folder ?? ""}`.toLowerCase().includes(needle)),
    );
    if (sortOrder === "oldest") {
      return [...filtered].sort((a, b) => a.createdAt - b.createdAt);
    }
    if (sortOrder === "name") {
      return [...filtered].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      );
    }
    return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  }, [activeType, folder, query, rows, sortOrder, sourceFilter]);

  const thumbnailSources = useRef(new Map<string, FileThumbnailSource>());
  const thumbnailSourceOf = useCallback(
    (row: FileRow): FileThumbnailSource => {
      const deviceId =
        row.source.kind === "computer"
          ? row.bucket.slice("computer:".length)
          : null;
      const access =
        (deviceId
          ? pairedDesktops.find((entry) => entry.desktopDeviceId === deviceId)
          : undefined) ?? preferredAccess;
      const conversationId = row.artifact.conversationId;
      const known = thumbnailSources.current.get(row.key);
      if (
        known &&
        known.kind === row.thumbnail &&
        known.access === access &&
        known.conversationId === conversationId
      ) {
        return known;
      }
      const next = {
        filePath: row.path,
        kind: row.thumbnail,
        conversationId,
        access,
      };
      thumbnailSources.current.set(row.key, next);
      return next;
    },
    [pairedDesktops, preferredAccess],
  );

  const searching = query.trim().length > 0;
  const folders = useMemo(
    () =>
      searching || activeType !== "all" || sourceFilter === "upload"
        ? []
        : folderEntries(
            sourceFilter === "all"
              ? rows
              : rows.filter((row) => row.bucket === sourceFilter),
            folder,
            thumbnailSourceOf,
          ),
    [activeType, folder, rows, searching, sourceFilter, thumbnailSourceOf],
  );

  const columns = columnsFor(contentWidth);
  const tileWidth = Math.floor(
    (contentWidth - TILE_GAP * (columns - 1)) / columns,
  );
  const now = Date.now();
  const items = useMemo<ListItem[]>(() => {
    const at = Date.now();
    const out: ListItem[] = [];
    if (folders.length > 0) {
      out.push({ kind: "folders", key: `folders:${folder}`, folders });
    }
    const add = (group: FileRow[]) => {
      if (mode === "list") {
        for (const row of group) out.push({ kind: "row", key: row.key, row });
        return;
      }
      for (let index = 0; index < group.length; index += columns) {
        const cells = group.slice(index, index + columns);
        out.push({ kind: "tiles", key: `tiles:${cells[0]!.key}`, rows: cells });
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
        out.push({
          kind: "section",
          key: `section:${section.key}`,
          label: section.label,
          first: out.length === 0,
        });
        previous = section.key;
      }
      group.push(row);
    }
    add(group);
    return out;
  }, [columns, folder, folders, mode, shown, sortOrder, t]);

  const siblings = useMemo(() => shown.map((row) => row.artifact), [shown]);
  const accessById = useMemo(() => {
    const map = new Map<string, StoredPhoneAccess>();
    for (const row of shown) {
      if (!row.bucket.startsWith("computer:")) continue;
      const deviceId = row.bucket.slice("computer:".length);
      const access = pairedDesktops.find(
        (entry) => entry.desktopDeviceId === deviceId,
      );
      if (access) map.set(row.artifact.id, access);
    }
    return map;
  }, [pairedDesktops, shown]);

  const deviceById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of shown) {
      if (row.source.kind === "computer" && row.source.deviceId) {
        map.set(row.artifact.id, row.source.deviceId);
      }
    }
    return map;
  }, [shown]);
  const deviceIdOf = useCallback(
    (artifact: ChatArtifact) => deviceById.get(artifact.id) ?? null,
    [deviceById],
  );

  const openArtifact = useCallback((artifact: ChatArtifact) => {
    tapLight();
    setViewerArtifact(artifact);
  }, []);

  const openFolder = useCallback((path: string) => {
    tapLight();
    setFolder(path);
  }, []);
  const folderGone =
    folder !== "" &&
    !journal.loading &&
    !rows.some((row) => `${row.inFolder ?? ""}/`.startsWith(`${folder}/`));
  useEffect(() => {
    if (folderGone) setFolder("");
  }, [folderGone]);
  const allFilesLabel = t("mobile.activityHub.files.filterAll");
  useFocusEffect(
    useCallback(() => {
      if (!folder) return;
      const parent = folder.slice(0, Math.max(0, folder.lastIndexOf("/")));
      const up = () => setFolder(parent);
      publishBackOverride({
        label: parent.split("/").pop() || allFilesLabel,
        onPress: up,
        onReset: () => setFolder(""),
        title: folder.split("/").pop(),
      });
      const hardware = BackHandler.addEventListener("hardwareBackPress", () => {
        up();
        return true;
      });
      return () => {
        hardware.remove();
        publishBackOverride(null);
      };
    }, [allFilesLabel, folder]),
  );

  const filtering =
    query.trim().length > 0 || sourceFilter !== "all" || activeType !== "all";
  const hasAnything = rows.length > 0;
  const seekingOlder = !hasAnything && journal.hasMore;
  const firstLoad = (journal.loading || seekingOlder) && !hasAnything;
  const { loading: journalLoading, loadingMore, loadMore } = journal;
  useEffect(() => {
    if (seekingOlder && !journalLoading && !loadingMore) loadMore();
  }, [journalLoading, loadMore, loadingMore, seekingOlder]);

  const menuItems = useMemo<NativeMenuItem[]>(() => {
    const choose = (next: SourceFilter) => () => setSourceFilter(next);
    const sortBy = (next: SortOrder) => () => setSortOrder(next);
    return [
      {
        id: "filter:all",
        title: bucketLabel("all"),
        selected: sourceFilter === "all",
        onPress: choose("all"),
      },
      ...buckets.map((bucket) => ({
        id: `filter:${bucket}`,
        title: bucketLabel(bucket),
        selected: sourceFilter === bucket,
        systemImage: (bucket === "cloud"
          ? "cloud"
          : bucket === "upload"
            ? "arrow.up.circle"
            : "desktopcomputer") as NativeMenuItem["systemImage"],
        onPress: choose(bucket),
      })),
      {
        id: "sort:newest",
        title: t("mobile.activityHub.files.sortNewest"),
        selected: sortOrder === "newest",
        separatorBefore: true,
        onPress: sortBy("newest"),
      },
      {
        id: "sort:oldest",
        title: t("mobile.activityHub.files.sortOldest"),
        selected: sortOrder === "oldest",
        onPress: sortBy("oldest"),
      },
      {
        id: "sort:name",
        title: t("mobile.activityHub.files.sortName"),
        selected: sortOrder === "name",
        onPress: sortBy("name"),
      },
    ];
  }, [bucketLabel, buckets, sortOrder, sourceFilter, t]);

  const cycleFilter = useCallback(() => {
    const order: SourceFilter[] = ["all", ...buckets];
    const index = order.indexOf(sourceFilter);
    setSourceFilter(order[(index + 1) % order.length] ?? "all");
  }, [buckets, sourceFilter]);

  const narrowed = sourceFilter !== "all" || sortOrder !== "newest";

  useFocusEffect(
    useCallback(() => {
      if (!hasAnything) return;
      publishTopBarAccessory(<FilesViewToggle />);
      return () => publishTopBarAccessory(null);
    }, [hasAnything]),
  );

  const renderItem = ({ item }: LegendListRenderItemProps<ListItem>) => {
    switch (item.kind) {
      case "section":
        return (
          <Text
            style={[airy.section, styles.section, item.first && airy.sectionFirst]}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            accessibilityRole="header"
          >
            {item.label}
          </Text>
        );
      case "folders":
        return <FolderShelf folders={item.folders} onOpen={openFolder} />;
      case "tiles":
        return (
          <View style={styles.tiles}>
            {item.rows.map((row) => (
              <FileTile
                key={row.key}
                row={row}
                source={thumbnailSourceOf(row)}
                width={tileWidth}
                detail={[row.extension.toUpperCase(), fileTime(row.createdAt, now)]
                  .filter(Boolean)
                  .join(" · ")}
                onOpen={openArtifact}
              />
            ))}
          </View>
        );
      case "row":
        return (
          <FileListRow
            key={item.row.key}
            row={item.row}
            source={thumbnailSourceOf(item.row)}
            detail={[
              item.row.extension.toUpperCase(),
              folder ? null : item.row.inFolder,
              fileTime(item.row.createdAt, now),
            ]
              .filter(Boolean)
              .join(" · ")}
            onOpen={openArtifact}
          />
        );
    }
  };

  const typeOptions = useMemo<FileTypeOption<TypeFilter>[]>(
    () => [
      { value: "all", label: t("mobile.activityHub.files.types.all") },
      ...presentTypes.map((type) => ({
        value: type,
        label: t(`mobile.activityHub.files.types.${type}`),
      })),
    ],
    [presentTypes, t],
  );
  const [stackHeight, setStackHeight] = useState(SEARCH_HEIGHT);

  if (!signedIn && !hasAnything) {
    return (
      <View style={styles.root}>
        <EmptyState motif="files" message={t("mobile.sidebar.signedOutHint")} />
      </View>
    );
  }

  if (firstLoad) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  if (!hasAnything) {
    return (
      <View style={styles.root}>
        <EmptyState motif="files" message={t("mobile.activityHub.files.empty")} />
      </View>
    );
  }

  return (
    <View
      style={styles.root}
      onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}
    >
      <LegendList<ListItem>
        key={`${mode}:${columns}:${folder}`}
        style={styles.list}
        contentContainerStyle={{
          paddingBottom: stackHeight + bottomInset + 28,
          paddingHorizontal: KIT.gutter,
        }}
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        renderItem={renderItem}
        extraData={tileWidth}
        onEndReached={journal.hasMore ? journal.loadMore : undefined}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={
          folder === "" && presentTypes.length > 1 ? (
            <FileTypeStrip
              options={typeOptions}
              value={activeType}
              onChange={setTypeFilter}
            />
          ) : null
        }
        ListFooterComponent={
          journal.loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.textMuted} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Text
            style={styles.emptyFiltered}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {filtering
              ? t("mobile.activityHub.files.emptyFiltered")
              : t("mobile.activityHub.files.empty")}
          </Text>
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        estimatedItemSize={mode === "grid" ? tileWidth + 66 : 78}
        recycleItems
      />

      <KeyboardStickyView
        style={[styles.stack, { paddingBottom: bottomInset + 4 }]}
        offset={{ closed: 0, opened: bottomInset }}
        pointerEvents="box-none"
      >
        <View
          style={styles.controls}
          pointerEvents="box-none"
          onLayout={(event) => setStackHeight(event.nativeEvent.layout.height)}
        >
          <GlassSurface
            legible
            ringed
            interactive
            radius={SEARCH_HEIGHT / 2}
            style={styles.search}
          >
            <Icon name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("mobile.activityHub.files.searchPlaceholder")}
              placeholderTextColor={fadeHex(colors.textMuted, 0.8)}
              selectionColor={colors.accent}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            />
            {query.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mobile.activityHub.search.clear")}
                hitSlop={10}
                onPress={() => setQuery("")}
              >
                <Icon name="x" size={14} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </GlassSurface>
          <NativeMenu
            label={
              <Icon
                name="filter"
                size={18}
                color={narrowed ? colors.accent : colors.text}
              />
            }
            accessibilityLabel={t("mobile.activityHub.files.filterLabel")}
            items={menuItems}
            width={SEARCH_HEIGHT}
            height={SEARCH_HEIGHT}
            circular
            onFallbackPress={cycleFilter}
          />
        </View>
      </KeyboardStickyView>

      <ArtifactViewer
        visible={Boolean(viewerArtifact)}
        artifact={viewerArtifact}
        access={
          (viewerArtifact ? accessById.get(viewerArtifact.id) : undefined) ??
          preferredAccess
        }
        onClose={() => setViewerArtifact(null)}
        siblings={siblings}
        onNavigate={setViewerArtifact}
        deviceIdOf={deviceIdOf}
      />
    </View>
  );
}

type FileCellProps = {
  row: FileRow;
  source: FileThumbnailSource;
  detail: string;
  onOpen: (artifact: ChatArtifact) => void;
};

const FileTile = memo(function FileTile({
  row,
  source,
  width,
  detail,
  onOpen,
}: FileCellProps & { width: number }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[row.title, detail].filter(Boolean).join(", ")}
      onPress={() => onOpen(row.artifact)}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
    >
      <FileThumbnail
        source={source}
        extension={row.extension}
        size="tile"
        width={width}
        height={Math.round(width * 1.06)}
      />
      <Text
        style={styles.tileTitle}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {shownName(row)}
      </Text>
      <Text
        style={styles.tileDetail}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {detail}
      </Text>
    </Pressable>
  );
});

const FileListRow = memo(function FileListRow({
  row,
  source,
  detail,
  onOpen,
}: FileCellProps) {
  const airy = useAiryList();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[row.title, detail].filter(Boolean).join(", ")}
      onPress={() => onOpen(row.artifact)}
      style={({ pressed }) => [airy.row, pressed && airy.pressed]}
    >
      <FileThumbnail
        source={source}
        extension={row.extension}
        size="row"
        {...ROW_THUMBNAIL}
      />
      <View style={airy.copy}>
        <Text
          style={airy.title}
          numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {shownName(row)}
        </Text>
        {detail ? (
          <Text
            style={airy.detail}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0,
    },
    centered: {
      alignItems: "center",
      justifyContent: "center",
    },
    stack: {
      bottom: 0,
      left: 0,
      position: "absolute",
      right: 0,
    },
    controls: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
    },
    search: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: 10,
      height: SEARCH_HEIGHT,
      paddingHorizontal: 16,
    },
    searchInput: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.medium,
      fontSize: 16,
      letterSpacing: -0.2,
      padding: 0,
    },
    list: {
      flex: 1,
      marginHorizontal: -KIT.gutter,
    },
    section: {
      paddingBottom: 12,
    },
    tiles: {
      flexDirection: "row",
      gap: TILE_GAP,
      paddingBottom: 22,
    },
    pressed: {
      opacity: 0.6,
      transform: [{ scale: 0.985 }],
    },
    tileTitle: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
      letterSpacing: -0.3,
      lineHeight: 21,
      marginTop: 10,
    },
    tileDetail: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
      fontVariant: ["tabular-nums"],
      lineHeight: 18,
    },
    footer: {
      paddingVertical: 18,
    },
    emptyFiltered: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      lineHeight: 21,
      paddingVertical: 48,
      textAlign: "center",
    },
  });
