import { memo } from "react";
import { useTPlural } from "@/shared/i18n";
import { GUTTER, PRESS, rt, useRn } from "../../rn";
import { frameFill } from "./FileThumbnail";
import type { FolderEntry, FolderPeek } from "./model";
import { TextThumbnail } from "./TextThumbnail";
import { useFileThumbnail, useThumbnailFade } from "./thumbnails";

// packages/mobile's files/FolderShelf: the open folder's subfolders in a sideways row, each a soft
// well with up to three of its files fanned out as small pages, its name and its file count.

const TILE_WIDTH = 152;
const TILE_HEIGHT = 112;
const SHEET_WIDTH = 62;
const SHEET_HEIGHT = 76;
const DEG = Math.PI / 180;
const PAGE_INK = "#8b8c92";
const SHELF_HEIGHT = 4 + TILE_HEIGHT + 10 + 21 + 18;

const FAN = [
  { rotate: -9, left: 16, top: 30 },
  { rotate: 8, left: TILE_WIDTH - SHEET_WIDTH - 16, top: 30 },
  { rotate: 0, left: (TILE_WIDTH - SHEET_WIDTH) / 2, top: 20 },
];

const NAME = rt(16, 600, -0.3, 21);
const COUNT = rt(13.5, 500, 0, 18);
const EXTENSION = rt(11, 700, -0.2);

function Peek({ peek, front }: { peek: FolderPeek; front: boolean }) {
  const state = useFileThumbnail(peek.kind, peek.drivePath, peek.version, peek.extension, true);
  const thumbnail = state.status === "ready" ? state.thumbnail : null;
  const fade = useThumbnailFade(state.status === "ready");
  if (thumbnail?.kind === "image") return <image src={thumbnail.path} w={SHEET_WIDTH} h={SHEET_HEIGHT} fit="cover" enter={fade} />;
  if (thumbnail?.kind === "text") return <TextThumbnail text={thumbnail.text} extension={peek.extension} width={SHEET_WIDTH} />;
  if (!front) return null;
  return (
    <box w="full" h="full" center>
      <text {...EXTENSION} color={PAGE_INK} maxLines={1}>
        {peek.extension.slice(0, 4).toUpperCase()}
      </text>
    </box>
  );
}

const FolderTile = memo(function FolderTile({ folder, onOpen }: { folder: FolderEntry; onOpen: (path: string) => void }) {
  const c = useRn();
  const tPlural = useTPlural();
  const count = tPlural("shell.appSource.files", folder.count);
  const peeks = folder.peeks.slice(0, FAN.length);
  const page = c.dark ? "#f4f4f5" : "#ffffff";
  return (
    <col id={`phone-files-folder-${folder.path}`} role="button" label={`${folder.name}, ${count}`} focusable w={TILE_WIDTH} shrink={false} {...PRESS} onPress={() => onOpen(folder.path)}>
      <box w={TILE_WIDTH} h={TILE_HEIGHT} shrink={false} mb={10} radius={18} clip={18} fill={frameFill(c.text, c.dark)}>
        {peeks.map((peek, index) => {
          const slot = FAN.at(index - peeks.length)!;
          return (
            <box key={peek.key} absolute={{ left: slot.left, top: slot.top }} w={SHEET_WIDTH} h={SHEET_HEIGHT} rotate={slot.rotate * DEG} radius={7} fill={page} shadows={[{ x: 0, y: 3, blur: 7, color: c.dark ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.14)" }]}>
              <col w="full" h="full" radius={7} clip={7} fill={page}>
                <Peek peek={peek} front={index === peeks.length - 1} />
              </col>
            </box>
          );
        })}
      </box>
      <text {...NAME} color={c.text} maxLines={1}>
        {folder.name}
      </text>
      <text {...COUNT} color={c.textMuted} maxLines={1}>
        {count}
      </text>
    </col>
  );
});

export function FolderShelf({ folders, onOpen }: { folders: readonly FolderEntry[]; onOpen: (path: string) => void }) {
  return (
    <row id="phone-files-folders" scrollX h={SHELF_HEIGHT} shrink={false} mx={-GUTTER} px={GUTTER} pt={4} gap={16}>
      {folders.map((folder) => (
        <FolderTile key={folder.path} folder={folder} onOpen={onOpen} />
      ))}
    </row>
  );
}
