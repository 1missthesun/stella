import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list/react-native";
import { isCloudWorldAppPath } from "@stella/contracts/cloud-world-paths";
import { generatedImageFileName } from "@stella/contracts/generated-image-name";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "../i18n";
import { authClient } from "../lib/auth-client";
import {
  artifactFileKey,
  artifactFileSource,
  conversationFilesFromDrive,
  type ConversationFile,
} from "../lib/conversation-files";
import { useBackendView } from "../lib/backend";
import { isGuest } from "../lib/guest-mode";
import { tapLight } from "../lib/haptics";
import {
  publishTopBarAccessory,
  useActivityHub,
  useComputerControl,
} from "../lib/main-shell-store";
import { pastSection } from "../lib/list-sections";
import {
  artifactIconName,
  artifactPrimaryFilePath,
  artifactTitle,
} from "../lib/mobile-artifacts";
import type { StoredPhoneAccess } from "../lib/phone-access";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";
import { useConversationFiles } from "../lib/use-conversation-files";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { useColors } from "../theme/theme-context";
import type { ChatArtifact } from "../types";
import { ArtifactViewer } from "./ArtifactViewer";
import { EmptyState } from "./EmptyState";
import { Icon, type IconName } from "./Icon";
import { NativeMenu } from "./NativeMenu";
import type { NativeMenuItem } from "./NativeMenu.types";

const EMPTY_ARTIFACTS: ChatArtifact[] = [];
/** The owner's newest drive files the page lists beside the conversation's. */
const DRIVE_VIEW_ARGS = { limit: 200 };
const EMPTY_PAIRED: StoredPhoneAccess[] = [];
const SEARCH_HEIGHT = 40;
const TOP_BAR_CONTROL = 44;

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
};

type ListItem =
  | { kind: "section"; key: string; label: string }
  | { kind: "file"; key: string; row: FileRow };

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

/**
 * The Files page: every file Stella produced or shared in the conversation,
 * wherever it lives (the cloud drive, one of the owner's computers, or an
 * attachment the user sent), plus everything in the owner's Stella Drive,
 * newest first. The conversation's files are read from its journal, so they
 * reach files the chat has long scrolled past; anything the chat holds that
 * the journal has not answered for yet shows too. Drive files come from the
 * live drive listing, so uploads and agent outputs from any device show even
 * when no reply ever linked them. Each opens in the chat's own viewer.
 */
export function FilesPage() {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bottomInset = useSafeAreaInsets().bottom;
  const hub = useActivityHub();
  const computer = useComputerControl();
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user) && !isGuest();
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
      return {
        ...file,
        artifact: titledArtifact(file.artifact, title),
        title,
        bucket,
        type: fileType(title, file.artifact),
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
  }, [activeType, query, rows, sortOrder, sourceFilter]);

  const items = useMemo<ListItem[]>(() => {
    if (sortOrder === "name") {
      return shown.map((row) => ({ kind: "file", key: row.key, row }));
    }
    const now = Date.now();
    const out: ListItem[] = [];
    let previous: string | null = null;
    for (const row of shown) {
      const section = pastSection(row.createdAt, now, t);
      if (section.key !== previous) {
        out.push({
          kind: "section",
          key: `section:${section.key}`,
          label: section.label,
        });
        previous = section.key;
      }
      out.push({ kind: "file", key: row.key, row });
    }
    return out;
  }, [shown, sortOrder, t]);

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

  const filtering =
    query.trim().length > 0 || sourceFilter !== "all" || activeType !== "all";
  const hasAnything = rows.length > 0;
  // Older files are paged in by the list's onEndReached, which never mounts
  // while nothing is resident; keep reaching back until a file turns up or
  // the history runs out.
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
  const accessory = useMemo(
    () =>
      hasAnything ? (
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
          width={TOP_BAR_CONTROL}
          height={TOP_BAR_CONTROL}
          circular
          onFallbackPress={cycleFilter}
        />
      ) : null,
    [colors.accent, colors.text, cycleFilter, hasAnything, menuItems, narrowed, t],
  );

  useEffect(() => {
    publishTopBarAccessory(accessory);
  }, [accessory]);
  useEffect(() => () => publishTopBarAccessory(null), []);

  const renderRow = useCallback(
    ({ item }: LegendListRenderItemProps<ListItem>) =>
      item.kind === "section" ? (
        <Text
          style={styles.section}
          numberOfLines={1}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          accessibilityRole="header"
        >
          {item.label}
        </Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.row.title}
          onPress={() => openArtifact(item.row.artifact)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <Icon
            name={artifactIconName(item.row.artifact.payload) as IconName}
            size={20}
            color={colors.textMuted}
            style={styles.rowIcon}
          />
          <Text
            style={styles.rowTitle}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {item.row.title}
          </Text>
        </Pressable>
      ),
    [colors.textMuted, openArtifact, styles],
  );

  const pills = useMemo(() => {
    const list: { id: TypeFilter; label: string }[] = [];
    if (presentTypes.length < 2) return list;
    list.push({ id: "all", label: t("mobile.activityHub.files.types.all") });
    for (const type of presentTypes) {
      list.push({ id: type, label: t(`mobile.activityHub.files.types.${type}`) });
    }
    return list;
  }, [presentTypes, t]);

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
    <View style={styles.root}>
      <View style={styles.search}>
        <Icon name="search" size={15} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("mobile.activityHub.files.searchPlaceholder")}
          placeholderTextColor={fadeHex(colors.textMuted, 0.7)}
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
      </View>

      {pills.length > 0 || sourceFilter !== "all" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.pillScroll}
          contentContainerStyle={styles.pills}
        >
          {sourceFilter !== "all" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.activityHub.files.filterAll")}
              onPress={() => setSourceFilter("all")}
              style={[styles.pill, styles.pillSelected]}
            >
              <Text
                style={[styles.pillText, styles.pillTextSelected]}
                numberOfLines={1}
                maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
              >
                {bucketLabel(sourceFilter)}
              </Text>
              <Icon name="x" size={10} color={colors.background} />
            </Pressable>
          ) : null}
          {pills.map((pill) => {
            const selected = activeType === pill.id;
            return (
              <Pressable
                key={pill.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  tapLight();
                  setTypeFilter(pill.id);
                }}
                style={({ pressed }) => [
                  styles.pill,
                  selected && styles.pillSelected,
                  pressed && !selected && styles.pillPressed,
                ]}
              >
                <Text
                  style={[styles.pillText, selected && styles.pillTextSelected]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                >
                  {pill.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <LegendList<ListItem>
        style={styles.list}
        contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        renderItem={renderRow}
        onEndReached={journal.hasMore ? journal.loadMore : undefined}
        onEndReachedThreshold={0.6}
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
        estimatedItemSize={48}
        recycleItems
      />

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
    search: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: SEARCH_HEIGHT / 2,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 8,
      height: SEARCH_HEIGHT,
      marginBottom: 14,
      marginTop: 8,
      paddingHorizontal: 14,
    },
    searchInput: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      letterSpacing: -0.2,
      padding: 0,
    },
    pillScroll: {
      flexGrow: 0,
      marginBottom: 6,
      marginHorizontal: -20,
    },
    pills: {
      gap: 8,
      paddingHorizontal: 20,
    },
    pill: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 6,
      height: 32,
      paddingHorizontal: 14,
    },
    pillSelected: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    pillPressed: {
      backgroundColor: colors.surfaceInset,
    },
    pillText: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      letterSpacing: -0.15,
    },
    pillTextSelected: {
      color: colors.background,
    },
    list: {
      flex: 1,
    },
    section: {
      alignSelf: "center",
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
      letterSpacing: -0.1,
      paddingBottom: 6,
      paddingTop: 16,
    },
    row: {
      alignItems: "center",
      borderRadius: 12,
      flexDirection: "row",
      gap: 14,
      marginHorizontal: -8,
      minHeight: 48,
      paddingHorizontal: 8,
      paddingVertical: 10,
    },
    rowPressed: {
      backgroundColor: colors.surfaceInset,
    },
    rowIcon: {
      width: 24,
    },
    rowTitle: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 17,
      letterSpacing: -0.3,
      minWidth: 0,
    },
    footer: {
      paddingVertical: 18,
    },
    emptyFiltered: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 20,
      paddingHorizontal: 20,
      paddingVertical: 36,
      textAlign: "center",
    },
  });
