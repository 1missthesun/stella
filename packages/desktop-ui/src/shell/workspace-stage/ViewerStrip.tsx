import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FileEntry } from "@/features/workspace-display/files-index";
import { DisplayTabIcon } from "@/features/workspace-display/icons";
import type { DisplayTab } from "@/features/workspace-display/types";
import {
  deferStripThumbnails,
  useDriveStripThumbnail,
  useStripThumbnail,
  type StripThumbKind,
} from "./strip-thumbnails";
import { Play } from "@/ui/icons";
import { formatTimestampHeader } from "@/features/chat/lib/message-time-labels";
import { translateNow, useLocale, useT } from "@/shared/i18n";
import { contextMenu, fileMenu } from "@/platform/context-menu";
import {
  showSibling,
  useViewerSiblings,
  type StripEntry,
  type StripSet,
} from "./viewer-siblings";

/** Load a thumbnail once it's near the visible part of the strip. */
const useNearView = (ref: React.RefObject<HTMLElement | null>): boolean => {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { root: el.parentElement, rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near, ref]);
  return near;
};

const imagePathOf = (entry: FileEntry): string | null => {
  const payload = entry.payload;
  if (payload.kind !== "media" || payload.asset.kind !== "image") return null;
  return payload.asset.filePaths[0] ?? null;
};

const videoPathOf = (entry: FileEntry): string | null => {
  const payload = entry.payload;
  if (payload.kind !== "media" || payload.asset.kind !== "video") return null;
  return payload.asset.filePath;
};

const pdfPathOf = (entry: FileEntry): string | null =>
  entry.payload.kind === "pdf" ? entry.payload.filePath : null;

/** What the item's thumbnail is made from, if it has one. */
type ThumbSource = {
  kind: StripThumbKind;
  /** A file here, or (for a Drive file) its stand-in path. */
  filePath: string;
  /** Set for a Drive file: what the thumbnail is read from. */
  drivePath: string | null;
};

const thumbSourceOf = (entry: FileEntry): ThumbSource | null => {
  const drivePath = entry.payload.cloudDrivePath ?? null;
  const image = imagePathOf(entry);
  if (image) return { kind: "image", filePath: image, drivePath };
  const video = videoPathOf(entry);
  if (video) return { kind: "video", filePath: video, drivePath };
  const pdf = pdfPathOf(entry);
  if (pdf) return { kind: "pdf", filePath: pdf, drivePath };
  return null;
};

function ThumbImage({ url }: { url: string | null }) {
  return url ? (
    <img className="viewer-strip__img" src={url} alt="" draggable={false} />
  ) : (
    <span className="viewer-strip__img viewer-strip__img--empty" />
  );
}

function LocalThumb({ source }: { source: ThumbSource }) {
  return <ThumbImage url={useStripThumbnail(source.kind, source.filePath, true)} />;
}

function DriveThumb({ source, drivePath }: { source: ThumbSource; drivePath: string }) {
  return <ThumbImage url={useDriveStripThumbnail(source.kind, drivePath, true)} />;
}

/** A document's first page, over its icon once it's made. */
function PageThumb({ source }: { source: ThumbSource }) {
  const local = useStripThumbnail(source.kind, source.filePath, !source.drivePath);
  const drive = useDriveStripThumbnail(source.kind, source.drivePath ?? "", Boolean(source.drivePath));
  const url = source.drivePath ? drive : local;
  return url ? (
    <img
      className="viewer-strip__img viewer-strip__img--page"
      src={url}
      alt=""
      draggable={false}
    />
  ) : null;
}

/** A small still: a picture, a clip's frame half a second in, a PDF's first page. */
function Thumb({ source }: { source: ThumbSource }) {
  return source.drivePath ? (
    <DriveThumb source={source} drivePath={source.drivePath} />
  ) : (
    <LocalThumb source={source} />
  );
}

const extensionOf = (entry: FileEntry): string | null => {
  const payload = entry.payload as Record<string, unknown>;
  const path =
    typeof payload.filePath === "string" ? payload.filePath : entry.title;
  const match = /\.([a-z0-9]{1,5})$/i.exec(path);
  return match ? match[1]!.toUpperCase() : null;
};

function StripItem({
  entry,
  current,
  fromId,
  tooltip,
  onPointerPick,
}: {
  entry: FileEntry;
  current: boolean;
  fromId: string;
  tooltip: string;
  onPointerPick: (id: string) => void;
}) {
  const source = thumbSourceOf(entry);
  const drivePath = entry.payload.cloudDrivePath ?? null;
  const ref = useRef<HTMLButtonElement | null>(null);
  const near = useNearView(ref);
  const media = source && source.kind !== "pdf" ? source.kind : null;
  const ext = media ? null : extensionOf(entry);
  return (
    <button
      ref={ref}
      type="button"
      className="viewer-strip__item"
      data-kind={media ?? "file"}
      data-current={current ? "true" : undefined}
      aria-current={current ? "true" : undefined}
      aria-label={entry.title}
      title={tooltip}
      onClick={(event) => {
        if (current) return;
        // A click (not Enter or ⇧←/→, which arrive with no detail) picks
        // something already on screen, so the strip stays where it is.
        if (event.detail > 0) onPointerPick(entry.id);
        showSibling(fromId, entry);
      }}
      onContextMenu={contextMenu(
        async () => {
          const open = () => showSibling(fromId, entry);
          // A Drive file's payload path is a stand-in, not a file here.
          const path = drivePath ? null : (source?.filePath ?? entry.filePath);
          if (!path) return [[{ label: translateNow("contextMenu.open"), run: open }]];
          return await fileMenu(path, { open, image: source?.kind === "image" })();
        },
        { claims: ["image"] },
      )}
    >
      {source && media ? (
        <>
          {near ? (
            <Thumb source={source} />
          ) : (
            <span className="viewer-strip__img viewer-strip__img--empty" />
          )}
          {media === "video" ? (
            <span className="viewer-strip__badge" aria-hidden="true">
              <Play size={9} />
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span className="viewer-strip__file" aria-hidden="true">
            <DisplayTabIcon kind={entry.kind} size={16} />
            {ext ? <span className="viewer-strip__ext">{ext}</span> : null}
          </span>
          {source && near ? <PageThumb source={source} /> : null}
        </>
      )}
    </button>
  );
}

/** Where `el` sits along the strip, measured from the list itself. */
const offsetIn = (list: HTMLElement, el: HTMLElement, vertical: boolean) => {
  let offset = 0;
  let node: HTMLElement | null = el;
  while (node && node !== list) {
    offset += vertical ? node.offsetTop : node.offsetLeft;
    const parent = node.offsetParent as HTMLElement | null;
    if (parent !== list && parent && !list.contains(parent)) break;
    node = parent;
  }
  return offset;
};

/** The strip's direction, scroll and visible length, and where a node sits in it. */
const placeOf = (list: HTMLElement) => {
  const vertical = getComputedStyle(list).flexDirection === "column";
  // Offsets, not client rects: the viewer's open animation scales it.
  const scroll = vertical ? list.scrollTop : list.scrollLeft;
  const view = vertical ? list.clientHeight : list.clientWidth;
  const fit = (node: HTMLElement) => ({
    start: offsetIn(list, node, vertical) - scroll,
    size: vertical ? node.offsetHeight : node.offsetWidth,
  });
  return { vertical, scroll, view, fit };
};

/**
 * Centre `el` (with the whole set it belongs to, when that fits): only when
 * the viewer opens or the strip turns between rail and row.
 */
const centerOn = (list: HTMLElement, el: HTMLElement) => {
  const { vertical, scroll, view, fit } = placeOf(list);
  const group = el.closest<HTMLElement>(".viewer-strip__set");
  const item = fit(el);
  const whole = group ? fit(group) : item;
  const span = whole.size <= view - 24 ? whole : item;
  const target = scroll + span.start - (view - span.size) / 2;
  if (Math.abs(target - scroll) < 1) return;
  list.scrollTo({ [vertical ? "top" : "left"]: target, behavior: "auto" });
};

/** Whether all of `el` is inside the strip's visible part. */
const isInView = (list: HTMLElement, el: HTMLElement) => {
  const { view, fit } = placeOf(list);
  const item = fit(el);
  return item.start >= 0 && item.start + item.size <= view;
};

/**
 * Bring `el` into view when part of it is off the strip (stepping with the
 * arrow keys past an edge), with a little of the next item showing. An
 * item already in view never moves the strip.
 */
const reveal = (list: HTMLElement, el: HTMLElement) => {
  const { vertical, scroll, view, fit } = placeOf(list);
  const item = fit(el);
  const margin = Math.min(item.size * 0.6, view / 4);
  let target = scroll;
  if (item.start < 0) target = scroll + item.start - margin;
  else if (item.start + item.size > view)
    target = scroll + item.start + item.size - view + margin;
  if (Math.abs(target - scroll) < 1) return;
  list.scrollTo({ [vertical ? "top" : "left"]: target, behavior: "smooth" });
};

/** "2:14 PM" today, "Yesterday", "Mon" this week, "Nov 7" before. */
const shortWhen = (ms: number, locale: string): string => {
  const date = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days <= 0) {
    return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }
  if (days === 1) {
    const label = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      -1,
      "day",
    );
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  }
  if (days < 7) return date.toLocaleDateString(locale, { weekday: "short" });
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
};

/**
 * One strip for everything the conversation made or opened (photos, videos,
 * audio, documents), oldest first. A rail on the left when the viewer is
 * wide, a row along the bottom when it's narrow. Like the filmstrips in
 * Photos and Lightroom it holds still while you step, and only scrolls when
 * the current item would otherwise be out of sight.
 *
 * What came with one message sits together as a set, in its own soft tray;
 * the tray you're in is a touch stronger, with when it arrived written
 * quietly under it. Every thumbnail has a faint edge, so dark and bright
 * pictures keep their shape.
 */
export function ViewerStrip({ item }: { item: DisplayTab }) {
  const t = useT();
  const locale = useLocale();
  const { items, index, sets, set } = useViewerSiblings(item.id, item.kind);
  const listRef = useRef<HTMLDivElement | null>(null);
  const centered = useRef(false);
  const picked = useRef<string | null>(null);
  const show = index !== -1 && items.length > 1;
  const grouped = sets.length > 1;

  // The file just shown loads before any thumbnail does.
  useLayoutEffect(() => {
    deferStripThumbnails();
  }, [item.id]);

  // Centred once when the strip appears. After that it holds still: a
  // clicked item is already on screen, and anything else (arrow keys, the
  // edge arrows, a set jump) only scrolls when the item would be hidden.
  useLayoutEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>("[data-current='true']");
    if (!list || !current) {
      centered.current = false;
      return;
    }
    const clicked = picked.current === item.id;
    picked.current = null;
    if (!centered.current) {
      centered.current = true;
      centerOn(list, current);
      return;
    }
    if (!clicked) reveal(list, current);
  }, [item.id, index, show]);

  // Switching between rail and row re-centres the current item; a resize
  // that hides it (the viewer's first open settles its height after the
  // strip has already scrolled) brings it back.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    let vertical = getComputedStyle(list).flexDirection === "column";
    const observer = new ResizeObserver(() => {
      const current = list.querySelector<HTMLElement>("[data-current='true']");
      if (!current) return;
      const next = getComputedStyle(list).flexDirection === "column";
      if (next !== vertical || !isInView(list, current)) centerOn(list, current);
      vertical = next;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [show]);

  if (!show) return null;

  const tooltipFor = (entry: StripEntry, run: StripSet, at: number) => {
    const size = run.end - run.start;
    const parts = [
      run.from === "user"
        ? t("shell.display.viewerStrip.fromYou")
        : run.from === "stella"
          ? t("shell.display.viewerStrip.fromStella")
          : null,
      formatTimestampHeader(run.at, locale),
      size > 1
        ? t("shell.display.viewerStrip.position", {
            index: at - run.start + 1,
            count: size,
          })
        : null,
    ].filter(Boolean);
    return grouped || size > 1 ? `${entry.title}\n${parts.join(" · ")}` : entry.title;
  };

  return (
    <nav
      className="viewer-strip"
      data-grouped={grouped ? "true" : undefined}
      aria-label="Everything in this chat"
    >
      <div ref={listRef} className="viewer-strip__list" role="list">
        {sets.map((run) => {
          const current = run.key === set?.key;
          const caption = shortWhen(run.at, locale);
          return (
            <div
              key={run.key}
              className="viewer-strip__set"
              role="group"
              aria-label={caption}
              data-current={current ? "true" : undefined}
              data-single={run.end - run.start === 1 ? "true" : undefined}
            >
              {items.slice(run.start, run.end).map((entry, offset) => (
                <StripItem
                  key={entry.id}
                  entry={entry}
                  current={entry.id === item.id}
                  fromId={item.id}
                  tooltip={tooltipFor(entry, run, run.start + offset)}
                  onPointerPick={(id) => {
                    picked.current = id;
                  }}
                />
              ))}
              {current && grouped ? (
                <span className="viewer-strip__caption" aria-hidden="true">
                  {caption}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
