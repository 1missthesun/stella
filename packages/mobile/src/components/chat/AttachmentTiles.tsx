import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { Icon } from "../Icon";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/setup-text-defaults";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { fadeHex } from "../../theme/oklch";

export const ATTACHMENT_TILE_SIZE = 64;
const TILE_GAP = 6;

export type AttachmentTileItem = { key: string; node: ReactNode };

const makeAttachmentTileStyles = (colors: Colors) =>
  StyleSheet.create({
    row: {
      alignItems: "flex-end",
      flexDirection: "row",
      gap: TILE_GAP,
      width: "100%",
    },
    rowStart: { justifyContent: "flex-start" },
    rowEnd: { justifyContent: "flex-end" },
    rowWrap: { flexWrap: "wrap" },
    tile: {
      alignItems: "center",
      backgroundColor: fadeHex(colors.textMuted, 0.12),
      borderColor: colors.border,
      borderCurve: "continuous",
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 3,
      height: ATTACHMENT_TILE_SIZE,
      justifyContent: "center",
      overflow: "hidden",
      width: ATTACHMENT_TILE_SIZE,
    },
    image: { height: "100%", width: "100%" },
    fileName: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 11,
      maxWidth: "100%",
      paddingHorizontal: 5,
    },
    textTile: {
      alignItems: "stretch",
      justifyContent: "flex-start",
      paddingHorizontal: 6,
      paddingVertical: 5,
    },
    textPreview: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 9,
      lineHeight: 12,
    },
    moreText: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
    },
  });

type TileStyles = ReturnType<typeof makeAttachmentTileStyles>;

const tileStylesCache = new WeakMap<Colors, TileStyles>();

const tileStyles = (colors: Colors): TileStyles => {
  let styles = tileStylesCache.get(colors);
  if (!styles) {
    styles = makeAttachmentTileStyles(colors);
    tileStylesCache.set(colors, styles);
  }
  return styles;
};

export const attachmentTileStyle = (colors: Colors) => tileStyles(colors).tile;

export function ImageTile({
  uri,
  name,
  colors,
}: {
  uri: string;
  name?: string;
  colors: Colors;
}) {
  const styles = tileStyles(colors);
  return (
    <View style={styles.tile}>
      <Image
        source={{ uri }}
        style={styles.image}
        contentFit="contain"
        accessibilityLabel={name}
      />
    </View>
  );
}

export function FileTile({
  name,
  colors,
}: {
  name: string;
  colors: Colors;
}) {
  const styles = tileStyles(colors);
  return (
    <View style={styles.tile} accessibilityLabel={name}>
      <Icon name="file-text" size={18} color={colors.textMuted} />
      <Text
        style={styles.fileName}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {name}
      </Text>
    </View>
  );
}

const firstLines = (text: string): string =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3)
    .join("\n")
    .slice(0, 160);

export function PastedTextTile({
  text,
  colors,
}: {
  text: string;
  colors: Colors;
}) {
  const styles = tileStyles(colors);
  return (
    <View
      style={[styles.tile, styles.textTile]}
      accessibilityLabel="Pasted text"
    >
      <Text
        style={styles.textPreview}
        numberOfLines={4}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {firstLines(text) || "Pasted text"}
      </Text>
    </View>
  );
}

/**
 * One row of same-size attachment tiles. When more tiles exist than fit, the
 * last slot becomes a "+N" tile; tapping it reveals the rest.
 */
export function AttachmentTileRow({
  items,
  align,
  colors,
  style,
}: {
  items: AttachmentTileItem[];
  align: "start" | "end";
  colors: Colors;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = tileStyles(colors);
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const capacity = useMemo(
    () =>
      width > 0
        ? Math.max(
            1,
            Math.floor((width + TILE_GAP) / (ATTACHMENT_TILE_SIZE + TILE_GAP)),
          )
        : items.length,
    [items.length, width],
  );
  if (items.length === 0) return null;
  const overflowing = !expanded && items.length > capacity;
  const shown = overflowing ? items.slice(0, capacity - 1) : items;
  const hiddenCount = overflowing ? items.length - shown.length : 0;
  return (
    <View
      onLayout={(event: LayoutChangeEvent) => {
        const next = Math.floor(event.nativeEvent.layout.width);
        setWidth((previous) => (previous === next ? previous : next));
      }}
      style={[
        styles.row,
        align === "end" ? styles.rowEnd : styles.rowStart,
        expanded ? styles.rowWrap : null,
        style,
      ]}
    >
      {shown.map((item) => (
        <Fragment key={item.key}>{item.node}</Fragment>
      ))}
      {hiddenCount > 0 ? (
        <Pressable
          style={styles.tile}
          accessibilityRole="button"
          accessibilityLabel={`Show ${hiddenCount} more`}
          onPress={() => setExpanded(true)}
        >
          <Text style={styles.moreText}>+{hiddenCount}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
