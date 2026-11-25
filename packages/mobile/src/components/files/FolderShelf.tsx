import { memo, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useTPlural } from "../../i18n";
import {
  useFileThumbnail,
  type FileThumbnailSource,
} from "../../lib/file-thumbnails";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { fadeHex } from "../../theme/oklch";
import { useColors, useTheme } from "../../theme/theme-context";
import { KIT } from "../chat-settings/kit";
import { SideScroller } from "../SideScroller";
import { Text } from "../Text";
import { TextThumbnail } from "./TextThumbnail";

export type FolderPeek = {
  key: string;
  source: FileThumbnailSource;
  extension: string;
};

export type FolderEntry = {
  path: string;
  name: string;
  count: number;
  peeks: FolderPeek[];
};

const TILE_WIDTH = 152;
const TILE_HEIGHT = 112;
const SHEET_WIDTH = 62;
const SHEET_HEIGHT = 76;

const FAN = [
  { rotate: "-9deg", left: 16, top: 30 },
  { rotate: "8deg", left: TILE_WIDTH - SHEET_WIDTH - 16, top: 30 },
  { rotate: "0deg", left: (TILE_WIDTH - SHEET_WIDTH) / 2, top: 20 },
];

export function FolderShelf({
  folders,
  onOpen,
}: {
  folders: readonly FolderEntry[];
  onOpen: (path: string) => void;
}) {
  return (
    <SideScroller
      style={shelfStyles.shelf}
      contentContainerStyle={shelfStyles.content}
      fade={false}
    >
      {folders.map((folder) => (
        <FolderTile key={folder.path} folder={folder} onOpen={onOpen} />
      ))}
    </SideScroller>
  );
}

const FolderTile = memo(function FolderTile({
  folder,
  onOpen,
}: {
  folder: FolderEntry;
  onOpen: (path: string) => void;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const tPlural = useTPlural();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const count = tPlural("shell.appSource.files", folder.count);
  const peeks = folder.peeks.slice(0, FAN.length);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${folder.name}, ${count}`}
      onPress={() => onOpen(folder.path)}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      testID={`mobile-files-folder-${folder.path}`}
    >
      <View style={styles.well}>
        {peeks
          .map((peek, index) => ({ peek, slot: FAN.at(index - peeks.length)! }))
          .map(({ peek, slot }) => (
            <View
              key={peek.key}
              style={[
                styles.sheet,
                {
                  left: slot.left,
                  top: slot.top,
                  transform: [{ rotate: slot.rotate }],
                },
              ]}
            >
              <Peek
                peek={peek}
                front={peek === peeks.at(-1)}
                styles={styles}
              />
            </View>
          ))}
      </View>
      <Text
        style={styles.name}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {folder.name}
      </Text>
      <Text
        style={styles.count}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {count}
      </Text>
    </Pressable>
  );
});

function Peek({
  peek,
  front,
  styles,
}: {
  peek: FolderPeek;
  front: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  const state = useFileThumbnail(peek.source);
  const thumbnail = state.status === "ready" ? state.thumbnail : null;
  return (
    <View style={styles.page}>
      {thumbnail?.kind === "image" ? (
        <Image
          source={{ uri: thumbnail.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={thumbnail.uri}
          transition={160}
        />
      ) : thumbnail?.kind === "text" ? (
        <TextThumbnail
          text={thumbnail.text}
          extension={peek.extension}
          width={SHEET_WIDTH}
        />
      ) : front ? (
        <View style={styles.center}>
          <Text allowFontScaling={false} style={styles.extension}>
            {peek.extension.slice(0, 4).toUpperCase()}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const shelfStyles = StyleSheet.create({
  shelf: { marginHorizontal: -KIT.gutter },
  content: { gap: 16, paddingHorizontal: KIT.gutter, paddingTop: 4 },
});

const makeStyles = (colors: Colors, isDark: boolean) =>
  StyleSheet.create({
    tile: { width: TILE_WIDTH },
    pressed: { opacity: 0.6, transform: [{ scale: 0.98 }] },
    well: {
      backgroundColor: fadeHex(colors.text, isDark ? 0.085 : 0.05),
      borderCurve: "continuous",
      borderRadius: 18,
      height: TILE_HEIGHT,
      marginBottom: 10,
      overflow: "hidden",
      width: TILE_WIDTH,
    },
    sheet: {
      height: SHEET_HEIGHT,
      position: "absolute",
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: isDark ? 0.45 : 0.14,
      shadowRadius: 7,
      width: SHEET_WIDTH,
    },
    page: {
      backgroundColor: isDark ? "#f4f4f5" : "#ffffff",
      borderCurve: "continuous",
      borderRadius: 7,
      flex: 1,
      overflow: "hidden",
    },
    center: { alignItems: "center", flex: 1, justifyContent: "center" },
    extension: {
      color: "#8b8c92",
      fontFamily: fonts.sans.bold,
      fontSize: 11,
      letterSpacing: -0.2,
    },
    name: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
      letterSpacing: -0.3,
      lineHeight: 21,
    },
    count: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
      lineHeight: 18,
    },
  });
