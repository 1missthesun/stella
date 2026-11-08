import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FileEntry } from "@/features/workspace-display/files-index";
import { DisplayTabIcon } from "@/features/workspace-display/icons";
import type { DisplayTab } from "@/features/workspace-display/types";
import { useDisplayFileBlobs } from "@/shared/hooks/use-display-file-data";
import { useMediaStream } from "@/shared/hooks/use-media-stream-url";
import { Play } from "@/ui/icons";
import { showSibling, useViewerSiblings } from "./viewer-siblings";

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
}: {
  entry: FileEntry;
  current: boolean;
  fromId: string;
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
      title={entry.title}
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

/** Scroll `list` just enough to keep `el` (and a neighbour) in view. */
const keepInView = (list: HTMLElement, el: HTMLElement, center: boolean) => {
  const vertical = getComputedStyle(list).flexDirection === "column";
  // Offsets, not client rects: the viewer's open animation scales it.
  const scroll = vertical ? list.scrollTop : list.scrollLeft;
  const start = (vertical ? el.offsetTop : el.offsetLeft) - scroll;
  const size = vertical ? el.offsetHeight : el.offsetWidth;
  const view = vertical ? list.clientHeight : list.clientWidth;
  const pad = Math.min(size * 1.3, view / 3);
  let target = scroll;
  if (center) target = scroll + start - (view - size) / 2;
  else if (start < pad) target = scroll + start - pad;
  else if (start + size > view - pad) target = scroll + start + size - view + pad;
  if (Math.abs(target - scroll) < 1) return;
  list.scrollTo({
    [vertical ? "top" : "left"]: target,
    behavior: center ? "auto" : "smooth",
  });
};

/**
 * One strip for everything the conversation made or opened (photos, videos,
 * audio, documents), oldest first. A rail on the left when the viewer is
 * wide, a row along the bottom when it's narrow. Like the filmstrips in
 * Photos and Lightroom it holds still while you step, and only scrolls when
 * the current item nears an edge.
 */
export function ViewerStrip({ item }: { item: DisplayTab }) {
  const { items, index } = useViewerSiblings(item.id, item.kind);
  const listRef = useRef<HTMLDivElement | null>(null);
  const firstScroll = useRef(true);
  const lastLength = useRef(0);
  const show = index !== -1 && items.length > 1;

  useLayoutEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>("[data-current='true']");
    if (!list || !current) return;
    // Centre on open and whenever the list itself changes; glide only when
    // stepping through a list that holds still.
    const settled = !firstScroll.current && lastLength.current === items.length;
    keepInView(list, current, !settled);
    firstScroll.current = false;
    lastLength.current = items.length;
  }, [index, items.length, show]);

  // Switching between rail and row re-centres the current item.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    let vertical = getComputedStyle(list).flexDirection === "column";
    const observer = new ResizeObserver(() => {
      const next = getComputedStyle(list).flexDirection === "column";
      if (next === vertical) return;
      vertical = next;
      const current = list.querySelector<HTMLElement>("[data-current='true']");
      if (current) keepInView(list, current, true);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [show]);

  if (!show) return null;

  return (
    <nav className="viewer-strip" aria-label="Everything in this chat">
      <div ref={listRef} className="viewer-strip__list" role="list">
        {items.map((entry) => (
          <StripItem
            key={entry.id}
            entry={entry}
            current={entry.id === item.id}
            fromId={item.id}
          />
        ))}
      </div>
    </nav>
  );
}
