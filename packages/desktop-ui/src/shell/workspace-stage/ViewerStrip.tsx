import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FileEntry } from "@/features/workspace-display/files-index";
import { DisplayTabIcon } from "@/features/workspace-display/icons";
import type { DisplayTab } from "@/features/workspace-display/types";
import { useDisplayFileBlobs } from "@/shared/hooks/use-display-file-data";
import { useMediaStream } from "@/shared/hooks/use-media-stream-url";
import { Play } from "@/ui/icons";
import { formatTimestampHeader } from "@/features/chat/lib/message-time-labels";
import { useLocale, useT } from "@/shared/i18n";
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

function ImageThumb({ filePath }: { filePath: string }) {
  const { files } = useDisplayFileBlobs([filePath]);
  const url = files[0]?.url;
  return url ? (
    <img className="viewer-strip__img" src={url} alt="" draggable={false} />
  ) : (
    <span className="viewer-strip__img viewer-strip__img--empty" />
  );
}

const videoPathOf = (entry: FileEntry): string | null => {
  const payload = entry.payload;
  if (payload.kind !== "media" || payload.asset.kind !== "video") return null;
  return payload.asset.filePath;
};

/** A poster frame: the browser paints the frame at the fragment's time. */
function VideoThumb({ filePath }: { filePath: string }) {
  const { url } = useMediaStream(filePath, "video");
  return url ? (
    <video
      className="viewer-strip__img"
      src={`${url}#t=0.5`}
      muted
      playsInline
      preload="metadata"
      tabIndex={-1}
      aria-hidden="true"
    />
  ) : (
    <span className="viewer-strip__img viewer-strip__img--empty" />
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
}: {
  entry: FileEntry;
  current: boolean;
  fromId: string;
  tooltip: string;
}) {
  const imagePath = imagePathOf(entry);
  const videoPath = imagePath ? null : videoPathOf(entry);
  const ref = useRef<HTMLButtonElement | null>(null);
  const near = useNearView(ref);
  const ext = imagePath || videoPath ? null : extensionOf(entry);
  return (
    <button
      ref={ref}
      type="button"
      className="viewer-strip__item"
      data-kind={imagePath ? "image" : videoPath ? "video" : "file"}
      data-current={current ? "true" : undefined}
      aria-current={current ? "true" : undefined}
      aria-label={entry.title}
      title={tooltip}
      onClick={() => {
        if (!current) showSibling(fromId, entry);
      }}
    >
      {imagePath ? (
        near ? (
          <ImageThumb filePath={imagePath} />
        ) : (
          <span className="viewer-strip__img viewer-strip__img--empty" />
        )
      ) : videoPath ? (
        <>
          {near ? (
            <VideoThumb filePath={videoPath} />
          ) : (
            <span className="viewer-strip__img viewer-strip__img--empty" />
          )}
          <span className="viewer-strip__badge" aria-hidden="true">
            <Play size={9} />
          </span>
        </>
      ) : (
        <span className="viewer-strip__file" aria-hidden="true">
          <DisplayTabIcon kind={entry.kind} size={16} />
          {ext ? <span className="viewer-strip__ext">{ext}</span> : null}
        </span>
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

/**
 * Scroll `list` just enough to keep `el` (and a neighbour) in view. On a
 * jump (`center`) the whole set `el` belongs to comes into view when it fits.
 */
const keepInView = (list: HTMLElement, el: HTMLElement, center: boolean) => {
  const vertical = getComputedStyle(list).flexDirection === "column";
  // Offsets, not client rects: the viewer's open animation scales it.
  const scroll = vertical ? list.scrollTop : list.scrollLeft;
  const view = vertical ? list.clientHeight : list.clientWidth;
  const group = el.closest<HTMLElement>(".viewer-strip__set");
  const fit = (node: HTMLElement) => ({
    start: offsetIn(list, node, vertical) - scroll,
    size: vertical ? node.offsetHeight : node.offsetWidth,
  });
  const item = fit(el);
  const whole = group ? fit(group) : item;
  const span = center && whole.size <= view - 24 ? whole : item;
  const pad = Math.min(item.size * 1.3, view / 3);
  let target = scroll;
  if (center) target = scroll + span.start - (view - span.size) / 2;
  else if (item.start < pad) target = scroll + item.start - pad;
  else if (item.start + item.size > view - pad)
    target = scroll + item.start + item.size - view + pad;
  if (Math.abs(target - scroll) < 1) return;
  list.scrollTo({
    [vertical ? "top" : "left"]: target,
    behavior: center ? "auto" : "smooth",
  });
};

/** Whether all of `el` is inside the strip's visible part. */
const isInView = (list: HTMLElement, el: HTMLElement, vertical: boolean) => {
  const start =
    offsetIn(list, el, vertical) - (vertical ? list.scrollTop : list.scrollLeft);
  const size = vertical ? el.offsetHeight : el.offsetWidth;
  const view = vertical ? list.clientHeight : list.clientWidth;
  return start >= 0 && start + size <= view;
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
 * the current item nears an edge.
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
  const firstScroll = useRef(true);
  const lastLength = useRef(0);
  const lastSet = useRef<string | null>(null);
  const show = index !== -1 && items.length > 1;
  const grouped = sets.length > 1;

  useLayoutEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>("[data-current='true']");
    if (!list || !current) return;
    // Centre on open, whenever the list itself changes, and on entering
    // another set; glide only when stepping inside a set.
    const settled =
      !firstScroll.current &&
      lastLength.current === items.length &&
      lastSet.current === (set?.key ?? null);
    keepInView(list, current, !settled);
    firstScroll.current = false;
    lastLength.current = items.length;
    lastSet.current = set?.key ?? null;
  }, [index, items.length, set?.key, show]);

  // Switching between rail and row re-centres the current item, and so does
  // any resize that hides it (the viewer's first open settles its height
  // after the strip has already scrolled).
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    let vertical = getComputedStyle(list).flexDirection === "column";
    const observer = new ResizeObserver(() => {
      const current = list.querySelector<HTMLElement>("[data-current='true']");
      if (!current) return;
      const next = getComputedStyle(list).flexDirection === "column";
      if (next !== vertical || !isInView(list, current, next)) {
        keepInView(list, current, true);
      }
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
