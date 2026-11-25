import { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import {
  useFileThumbnail,
  type FileThumbnailSource,
} from "../../lib/file-thumbnails";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { fadeHex } from "../../theme/oklch";
import { useColors, useTheme } from "../../theme/theme-context";
import { Icon } from "../Icon";
import { Text } from "../Text";
import { TextThumbnail } from "./TextThumbnail";
import { WebThumbnail, type DocumentCrop } from "./WebThumbnail";

const BARS = 26;

const SLIDES = new Set(["ppt", "pptx"]);
const SLIDE_ASPECT = 9 / 16;

const documentCrop = (extension: string): DocumentCrop => {
  switch (extension) {
    case "xls":
    case "xlsx":
      return { zoom: 2.2, from: "start", enlarge: 1.8 };
    case "doc":
    case "docx":
      return { zoom: 1.16, from: "center" };
    case "ppt":
    case "pptx":
      return { zoom: 1.05, from: "center" };
    default:
      return { zoom: 1.07, from: "center", revealAfterMs: 2_600 };
  }
};

const CROPS = new Map<string, DocumentCrop>();
const cropFor = (extension: string): DocumentCrop => {
  const known = CROPS.get(extension);
  if (known) return known;
  const crop = documentCrop(extension);
  CROPS.set(extension, crop);
  return crop;
};

export type FileThumbnailSize = "tile" | "row";

export const FileThumbnail = memo(function FileThumbnail({
  source,
  extension,
  size,
  width,
  height,
}: {
  source: FileThumbnailSource;
  extension: string;
  size: FileThumbnailSize;
  width: number;
  height: number;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const row = size === "row";
  const state = useFileThumbnail(source);
  const { kind } = source;
  const frame = {
    borderRadius: row ? 10 : 18,
    height,
    width,
  };

  if (kind === "image" || kind === "video") {
    const uri =
      state.status === "ready" && state.thumbnail.kind === "image"
        ? state.thumbnail.uri
        : null;
    return (
      <View style={[styles.frame, frame]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="top"
            cachePolicy="memory-disk"
            recyclingKey={uri}
            transition={160}
          />
        ) : state.status === "none" ? (
          <Extension styles={styles} extension={extension} row={row} />
        ) : null}
        {kind === "video" && uri ? (
          <View style={[styles.play, row && styles.playSmall]}>
            <Icon name="play" size={row ? 9 : 13} color="#ffffff" />
          </View>
        ) : null}
      </View>
    );
  }

  if (kind === "audio") {
    return (
      <View style={[styles.frame, frame]}>
        {state.status === "ready" && state.thumbnail.kind === "audio" ? (
          <Wave
            peaks={state.thumbnail.peaks}
            color={colors.text}
            count={row ? 9 : BARS}
            height={height * (row ? 0.5 : 0.34)}
          />
        ) : state.status === "none" ? (
          <Extension styles={styles} extension={extension} row={row} />
        ) : null}
      </View>
    );
  }

  const inset = row ? 7 : Math.round(width * 0.1);
  const pageWidth = width - inset * 2;
  const thumbnail = state.status === "ready" ? state.thumbnail : null;
  const live =
    !row && (thumbnail?.kind === "html" || thumbnail?.kind === "document");
  const blank = kind === "none" || state.status === "none" || (row && !live);
  const slide = SLIDES.has(extension);
  const sheetWidth = slide && !row ? width - inset : pageWidth;
  const slideTop = (height - sheetWidth * SLIDE_ASPECT) / 2;
  return (
    <View style={[styles.frame, frame]}>
      <View
        style={[
          styles.sheet,
          row ? styles.sheetSmall : null,
          { left: inset, right: inset, top: row ? 6 : inset },
          slide && {
            bottom: slideTop,
            left: (width - sheetWidth) / 2,
            right: (width - sheetWidth) / 2,
            top: slideTop,
          },
        ]}
      >
        <View
          style={[
            styles.page,
            row ? styles.pageSmall : null,
            slide && styles.pageWhole,
          ]}
        >
          {thumbnail?.kind === "text" ? (
            <TextThumbnail
              text={thumbnail.text}
              extension={extension}
              width={pageWidth}
            />
          ) : live && thumbnail.kind === "html" ? (
            <WebThumbnail html={thumbnail.html} />
          ) : live && thumbnail.kind === "document" ? (
            <>
              <Extension styles={styles} extension={extension} row={row} onPage />
              <WebThumbnail uri={thumbnail.uri} crop={cropFor(extension)} />
            </>
          ) : blank ? (
            <Extension styles={styles} extension={extension} row={row} onPage />
          ) : null}
        </View>
      </View>
    </View>
  );
});

function Extension({
  styles,
  extension,
  row,
  onPage = false,
}: {
  styles: ReturnType<typeof makeStyles>;
  extension: string;
  row: boolean;
  onPage?: boolean;
}) {
  return (
    <View style={styles.center}>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          styles.extension,
          onPage && styles.extensionOnPage,
          row && styles.extensionSmall,
        ]}
      >
        {extension.slice(0, 4).toUpperCase()}
      </Text>
    </View>
  );
}

function Wave({
  peaks,
  color,
  count,
  height,
}: {
  peaks: readonly number[];
  color: string;
  count: number;
  height: number;
}) {
  const bars = useMemo(() => {
    const span = peaks.length / count;
    const values = Array.from({ length: count }, (_, index) =>
      Math.max(
        0,
        ...peaks.slice(
          Math.floor(index * span),
          Math.max(Math.floor(index * span) + 1, Math.floor((index + 1) * span)),
        ),
      ),
    );
    const loudest = Math.max(...values, 0.0001);
    return values.map((value) => Math.max(0.07, value / loudest));
  }, [count, peaks]);
  return (
    <View style={waveStyles.row}>
      {bars.map((bar, index) => (
        <View
          key={index}
          style={[
            waveStyles.bar,
            { backgroundColor: color, height: Math.max(2, bar * height) },
          ]}
        />
      ))}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  row: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    gap: 2,
  },
  bar: { borderRadius: 1.5, width: 2.5 },
});

const makeStyles = (colors: Colors, isDark: boolean) =>
  StyleSheet.create({
    frame: {
      backgroundColor: fadeHex(colors.text, isDark ? 0.085 : 0.05),
      borderCurve: "continuous",
      overflow: "hidden",
    },
    sheet: {
      bottom: 0,
      position: "absolute",
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.4 : 0.1,
      shadowRadius: 10,
    },
    sheetSmall: { bottom: 6, shadowRadius: 4, shadowOpacity: 0.06 },
    page: {
      backgroundColor: "#ffffff",
      borderCurve: "continuous",
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
      flex: 1,
      overflow: "hidden",
    },
    pageSmall: { borderRadius: 4 },
    pageWhole: { borderRadius: 6 },
    center: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
    },
    extension: {
      color: colors.textMuted,
      fontFamily: fonts.sans.bold,
      fontSize: 22,
      letterSpacing: -0.6,
    },
    extensionOnPage: { color: "#8b8c92" },
    extensionSmall: { fontSize: 9.5, letterSpacing: -0.2 },
    play: {
      alignItems: "center",
      backgroundColor: "rgba(0,0,0,0.5)",
      borderRadius: 14,
      bottom: 10,
      height: 28,
      justifyContent: "center",
      left: 10,
      position: "absolute",
      width: 28,
    },
    playSmall: {
      borderRadius: 9,
      bottom: 4,
      height: 18,
      left: 4,
      width: 18,
    },
  });
