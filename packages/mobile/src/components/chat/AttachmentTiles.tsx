import { useMemo, useState, type ReactNode } from "react";
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
    offFlow: { left: 0, opacity: 0, position: "absolute", top: 0 },
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

export const IMAGE_TILE_MAX_WIDTH = 180;
const IMAGE_TILE_MIN_WIDTH = 40;

function TilePress({
  onPress,
  label,
  children,
}: {
  onPress?: () => void;
  label?: string;
  children: ReactNode;
}) {
  if (!onPress) return <>{children}</>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
    >
      {children}
    </Pressable>
  );
}

export function ImageTile({
  uri,
  name,
  colors,
  onPress,
}: {
  uri: string;
  name?: string;
  colors: Colors;
  onPress?: () => void;
}) {
  const styles = tileStyles(colors);
  const [aspect, setAspect] = useState(1);
  const width = Math.round(
    Math.min(
      Math.max(ATTACHMENT_TILE_SIZE * aspect, IMAGE_TILE_MIN_WIDTH),
      IMAGE_TILE_MAX_WIDTH,
    ),
  );
  return (
    <TilePress onPress={onPress} label={name}>
      <View style={[styles.tile, { width }]}>
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="contain"
          accessibilityLabel={name}
          onLoad={(event) => {
            const { width: w, height: h } = event.source;
            if (w > 0 && h > 0) setAspect(w / h);
          }}
        />
      </View>
    </TilePress>
  );
}

export function FileTile({
  name,
  colors,
  onPress,
}: {
  name: string;
  colors: Colors;
  onPress?: () => void;
}) {
  const styles = tileStyles(colors);
  return (
    <TilePress onPress={onPress} label={name}>
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
    </TilePress>
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
  onPress,
}: {
  text: string;
  colors: Colors;
  onPress?: () => void;
}) {
  const styles = tileStyles(colors);
  return (
    <TilePress onPress={onPress} label="Pasted text">
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
    </TilePress>
  );
}

const fitCount = (
  widths: readonly number[],
  available: number,
): number => {
  let used = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const next = used + (index > 0 ? TILE_GAP : 0) + widths[index]!;
    const remaining = widths.length - index - 1;
    const reserve = remaining > 0 ? TILE_GAP + ATTACHMENT_TILE_SIZE : 0;
    if (next + reserve > available) return index;
    used = next;
  }
  return widths.length;
};

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
  const [itemWidths, setItemWidths] = useState<Record<string, number>>({});
  const shownCount = useMemo(() => {
    if (expanded || width <= 0) return items.length;
    const widths = items.map(
      (item) => itemWidths[item.key] ?? ATTACHMENT_TILE_SIZE,
    );
    return fitCount(widths, width);
  }, [expanded, itemWidths, items, width]);
  if (items.length === 0) return null;
  const hiddenCount = items.length - shownCount;
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
      {items.map((item, index) => (
        <View
          key={item.key}
          style={index < shownCount ? null : styles.offFlow}
          pointerEvents={index < shownCount ? "auto" : "none"}
          onLayout={(event: LayoutChangeEvent) => {
            const next = Math.round(event.nativeEvent.layout.width);
            setItemWidths((previous) =>
              previous[item.key] === next
                ? previous
                : { ...previous, [item.key]: next },
            );
          }}
        >
          {item.node}
        </View>
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
