import { memo } from "react";
import { Icon } from "../../../../../desktop-rune/ui/kit";
import { alpha } from "../../../../../desktop-rune/ui/theme";
import { glyph } from "../../icons";
import { rt, useRn } from "../../rn";
import type { ThumbnailKind } from "./model";
import { TextThumbnail } from "./TextThumbnail";
import { useFileThumbnail } from "./thumbnails";

// packages/mobile's files/FileThumbnail: a picture fills its frame; a document is a white sheet
// rising from the frame's bottom (a slide deck's sheet sits whole in the middle), showing its
// opening text, its page preview, or its extension; anything without a picture shows its
// extension. Office pages and PDFs, which the RN app renders in a WKWebView or as a PDF image, show
// their extension on the sheet.

const SLIDES = new Set(["ppt", "pptx"]);
const SLIDE_ASPECT = 9 / 16;
const PAGE_INK = "#8b8c92";

export type FileThumbnailSize = "tile" | "row";

export const frameFill = (text: string, dark: boolean) => alpha(text, dark ? 0.085 : 0.05);

function Extension({ extension, row, onPage = false }: { extension: string; row: boolean; onPage?: boolean }) {
  const c = useRn();
  return (
    <box w="full" h="full" center>
      <text {...(row ? rt(9.5, 700, -0.2) : rt(22, 700, -0.6))} color={onPage ? PAGE_INK : c.textMuted} maxLines={1}>
        {extension.slice(0, 4).toUpperCase()}
      </text>
    </box>
  );
}

export const FileThumbnail = memo(function FileThumbnail({ kind, drivePath, version, extension, size, width, height, wanted }: { kind: ThumbnailKind; drivePath: string | null; version: number; extension: string; size: FileThumbnailSize; width: number; height: number; wanted: boolean }) {
  const c = useRn();
  const row = size === "row";
  const state = useFileThumbnail(kind, drivePath ?? "", version, extension, wanted);
  const thumbnail = state.status === "ready" ? state.thumbnail : null;
  const radius = row ? 10 : 18;
  const fill = frameFill(c.text, c.dark);

  if (kind === "image" || kind === "video" || kind === "audio") {
    const still = thumbnail?.kind === "image" ? thumbnail : null;
    return (
      <box w={width} h={height} radius={radius} clip={radius} fill={fill} shrink={false}>
        {still ? <image src={still.path} w={width} h={height} fit="cover" enter={{ opacity: 0, dur: 0.14 }} /> : state.status === "none" ? <Extension extension={extension} row={row} /> : null}
        {kind === "video" && still ? (
          <box absolute={{ left: row ? 4 : 10, bottom: row ? 4 : 10 }} w={row ? 18 : 28} h={row ? 18 : 28} radius={row ? 9 : 14} center fill="rgba(0,0,0,0.5)">
            <Icon icon={glyph("play")} size={row ? 9 : 13} color="#ffffff" />
          </box>
        ) : null}
      </box>
    );
  }

  const inset = row ? 7 : Math.round(width * 0.1);
  const pageWidth = width - inset * 2;
  const slide = SLIDES.has(extension);
  const still = thumbnail?.kind === "image" ? thumbnail : null;
  const text = thumbnail?.kind === "text" ? thumbnail.text : null;
  const blank = kind === "none" || kind === "document" || state.status === "none";
  const sheetWidth = slide && !row ? width - inset : pageWidth;
  const sheetHeight = slide ? sheetWidth * SLIDE_ASPECT : height - (row ? 12 : inset);
  const shadow = row ? { x: 0, y: 4, blur: 4, color: "rgba(0,0,0,0.06)" } : { x: 0, y: 4, blur: 10, color: c.dark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.1)" };
  const corners: [number, number, number, number] = slide ? [6, 6, 6, 6] : row ? [4, 4, 4, 4] : [8, 8, 0, 0];
  return (
    <box w={width} h={height} radius={radius} clip={radius} fill={fill} shrink={false}>
      <col absolute={{ left: (width - sheetWidth) / 2, top: slide ? (height - sheetHeight) / 2 : row ? 6 : inset }} w={sheetWidth} h={sheetHeight} corners={corners} fill="#ffffff" shadows={[shadow]}>
        <col w="full" h="full" corners={corners} clip={corners[0]}>
          {text !== null ? (
            <TextThumbnail text={text} extension={extension} width={pageWidth} />
          ) : still ? (
            <image src={still.path} w={sheetWidth} h={sheetHeight} fit="cover" enter={{ opacity: 0, dur: 0.14 }} />
          ) : blank ? (
            <Extension extension={extension} row={row} onPage />
          ) : null}
        </col>
      </col>
    </box>
  );
});
