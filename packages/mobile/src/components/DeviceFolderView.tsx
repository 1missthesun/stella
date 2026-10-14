import { useCallback, useMemo } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Text } from "./Text";
import type {
  DeviceFolderEntry,
  DeviceFolderListing,
} from "@stella/contracts/device-file-reads";
import { Icon, type IconName } from "./Icon";
import { useT } from "../i18n";
import { formatTimestampHeader } from "../lib/message-time-labels";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif", "avif", "svg"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const TEXT_EXTS = new Set(["md", "txt", "pdf", "doc", "docx", "csv", "tsv", "xlsx", "pptx", "json"]);
const PAGE_EXTS = new Set(["html", "htm"]);

const entryIcon = (entry: DeviceFolderEntry): IconName => {
  if (entry.kind === "directory") return "folder";
  const dot = entry.name.lastIndexOf(".");
  const ext = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "volume-2";
  if (PAGE_EXTS.has(ext)) return "panel-top";
  if (TEXT_EXTS.has(ext)) return "file-text";
  return "file";
};

export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
};

export function DeviceFolderView({
  listing,
  colors,
  onOpen,
}: {
  listing: DeviceFolderListing;
  colors: Colors;
  onOpen: (entry: DeviceFolderEntry) => void;
}) {
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const count = listing.entries.length;

  const renderRow = useCallback(
    ({ item, index }: ListRenderItemInfo<DeviceFolderEntry>) => {
      const meta = [
        item.kind === "file" ? formatFileSize(item.sizeBytes) : null,
        item.modifiedAt > 0 ? formatTimestampHeader(item.modifiedAt) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.name}
          onPress={() => onOpen(item)}
          style={({ pressed }) => [
            styles.row,
            index === 0 && styles.rowFirst,
            index === count - 1 && styles.rowLast,
            index > 0 && styles.rowDivider,
            pressed && styles.rowPressed,
          ]}
        >
          <View style={styles.rowIcon}>
            <Icon name={entryIcon(item)} size={17} color={colors.text} />
          </View>
          <View style={styles.rowText}>
            <Text
              style={styles.rowTitle}
              numberOfLines={1}
              maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            >
              {item.name}
            </Text>
            {meta ? (
              <Text
                style={styles.rowMeta}
                numberOfLines={1}
                maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
              >
                {meta}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron-right" size={14} color={colors.textMuted} />
        </Pressable>
      );
    },
    [colors.text, colors.textMuted, count, onOpen, styles],
  );

  if (count === 0) {
    return (
      <View style={styles.center}>
        <Icon name="folder" size={28} color={colors.textMuted} />
        <Text style={styles.emptyTitle} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {t("shell.display.folder.emptyTitle")}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={listing.entries}
      keyExtractor={(entry) => entry.path}
      renderItem={renderRow}
      contentContainerStyle={styles.content}
      ListFooterComponent={
        listing.truncated ? (
          <Text style={styles.footer} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("shell.display.folder.truncated", { count })}
          </Text>
        ) : null
      }
    />
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    row: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 12,
      minHeight: 60,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    rowFirst: {
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    rowLast: {
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowDivider: {
      borderTopColor: fadeHex(colors.border, 0.8),
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    rowPressed: {
      backgroundColor: colors.surfaceInset,
    },
    rowIcon: {
      alignItems: "center",
      backgroundColor: colors.surfaceInset,
      borderRadius: 10,
      height: 36,
      justifyContent: "center",
      width: 36,
    },
    rowText: {
      flex: 1,
      gap: 2,
      minWidth: 0,
    },
    rowTitle: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    rowMeta: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
      letterSpacing: -0.05,
    },
    footer: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      paddingVertical: 18,
      textAlign: "center",
    },
    center: {
      alignItems: "center",
      flex: 1,
      gap: 10,
      justifyContent: "center",
      padding: 24,
    },
    emptyTitle: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      textAlign: "center",
    },
  });
