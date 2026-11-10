import { useContext, useMemo } from "react";
import type { DisplayTabPayload } from "@stella/contracts/desktop/display-payload";
import { ChatMessagesContext } from "@/context/chat-messages-context";
import type { EventRecord } from "@/features/chat/lib/event-transforms";
import { deriveConversationFiles } from "@/features/workspace-display/derive-conversation-files";
import { displayTabKindForPayload } from "@/features/workspace-display/payload-kind";
import { canvasDisplayTabId } from "@/shell/display/canvas-tab/canvas-items";
import { idForMediaPayload } from "@/shell/display/payload-to-tab-spec";
import {
  useFileEntries,
  type FileEntry,
} from "@/features/workspace-display/files-index";
import { fileViewer } from "@/features/workspace-display/file-viewer-store";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import type { DisplayTabKind } from "@/features/workspace-display/types";

/**
 * Kinds the strip holds: every file a conversation can produce, in one
 * list, so photos, clips, documents and canvases page through together.
 */
const STRIP_KINDS: ReadonlySet<DisplayTabKind> = new Set([
  "image",
  "video",
  "audio",
  "canvas",
  "pdf",
  "markdown",
  "office-document",
  "office-spreadsheet",
  "office-slides",
  "model3d",
  "download",
  "text",
]);

export const hasSiblingStrip = (kind: DisplayTabKind): boolean =>
  STRIP_KINDS.has(kind);

/**
 * The display id the payload opens under (as `payloadToTabSpec` names it),
 * for the kinds the strip shows.
 */
const stripIdFor = (payload: DisplayTabPayload): string | null => {
  switch (payload.kind) {
    case "media":
      return idForMediaPayload(payload);
    case "canvas-html":
      return canvasDisplayTabId(payload.filePath);
    case "pdf":
      return `pdf:${payload.filePath}`;
    case "markdown":
      return `markdown:${payload.filePath}`;
    case "office":
      return `office:${payload.previewRef.sourcePath}`;
    case "file-artifact":
      return `file-artifact:${payload.filePath}`;
    default:
      return null;
  }
};

const EMPTY_MESSAGES: ReadonlyArray<EventRecord> = [];

/** A strip item, and the set (one message's files) it belongs to. */
export type StripEntry = FileEntry & {
  setKey: string;
  setOrder: number;
  from?: "stella" | "user";
};

/** Consecutive strip items that came with the same message. */
export type StripSet = {
  key: string;
  start: number;
  /** Exclusive. */
  end: number;
  from?: "stella" | "user";
  at: number;
};

/** Photos, videos, clips and canvases linked anywhere in the conversation. */
const useConversationStripEntries = (): StripEntry[] => {
  const messages = useContext(
    ChatMessagesContext,
  ) as ReadonlyArray<EventRecord> | null;
  const events = messages ?? EMPTY_MESSAGES;
  return useMemo(() => {
    const entries: StripEntry[] = [];
    for (const file of deriveConversationFiles(events)) {
      if (file.payload.cloudDrivePath || file.cloudDriveFile) continue;
      const id = stripIdFor(file.payload);
      if (!id) continue;
      entries.push({
        source: "artifact",
        id,
        kind: displayTabKindForPayload(file.payload),
        title: file.path.split(/[\\/]/).pop() || file.path,
        filePath: file.path,
        createdAt: file.timestamp,
        payload: file.payload,
        setKey: file.set?.key ?? id,
        setOrder: file.set?.order ?? 0,
        ...(file.set ? { from: file.set.from } : {}),
      });
    }
    return entries;
  }, [events]);
};

const NO_SETS: StripSet[] = [];

/** Runs of items from the same message, in strip order. */
const setsOf = (items: readonly StripEntry[]): StripSet[] => {
  const sets: StripSet[] = [];
  items.forEach((entry, index) => {
    const last = sets[sets.length - 1];
    if (last && last.key === entry.setKey) {
      last.end = index + 1;
      return;
    }
    sets.push({
      key: entry.setKey,
      start: index,
      end: index + 1,
      ...(entry.from ? { from: entry.from } : {}),
      at: entry.createdAt,
    });
  });
  return sets;
};

/**
 * Every file in this conversation, whatever its type, plus anything already
 * opened, oldest first, so the strip reads in the order the conversation
 * produced them and → moves forward in time. Files that came with the same
 * message stay together, in the order the message lists them.
 */
export const useViewerSiblings = (
  itemId: string,
  kind: DisplayTabKind,
): {
  items: StripEntry[];
  index: number;
  sets: StripSet[];
  /** The set holding the current item, or null. */
  set: StripSet | null;
} => {
  const opened = useFileEntries();
  const linked = useConversationStripEntries();
  const ordered = useMemo(() => {
    if (!STRIP_KINDS.has(kind)) return { items: [], sets: NO_SETS };
    const byId = new Map<string, StripEntry>();
    for (const entry of linked) {
      if (STRIP_KINDS.has(entry.kind)) byId.set(entry.id, entry);
    }
    for (const entry of opened) {
      if (STRIP_KINDS.has(entry.kind) && !byId.has(entry.id)) {
        byId.set(entry.id, { ...entry, setKey: entry.id, setOrder: 0 });
      }
    }
    const items = [...byId.values()].sort(
      (a, b) =>
        a.createdAt - b.createdAt ||
        a.setKey.localeCompare(b.setKey) ||
        a.setOrder - b.setOrder ||
        a.id.localeCompare(b.id),
    );
    return { items, sets: setsOf(items) };
  }, [kind, linked, opened]);
  return useMemo(() => {
    const index = ordered.items.findIndex((entry) => entry.id === itemId);
    const set =
      index === -1
        ? null
        : (ordered.sets.find((run) => index >= run.start && index < run.end) ??
          null);
    return { items: ordered.items, sets: ordered.sets, index, set };
  }, [itemId, ordered]);
};

/** Show `entry` where `fromId` is showing: the viewer, or the active tab. */
export const showSibling = (fromId: string, entry: FileEntry): void => {
  openDisplayPayloadTab(entry.payload, { activate: false });
  if (fileViewer.getSnapshot().fileId === fromId) {
    fileViewer.open(entry.id);
  } else {
    sidebarSections.setLocation("files", entry.id);
  }
};
