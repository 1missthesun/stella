import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FileEntry } from "@/features/workspace-display/files-index";
import { DisplayTabIcon } from "@/features/workspace-display/icons";
import type { DisplayTab } from "@/features/workspace-display/types";
import { useDisplayFileBlobs } from "@/shared/hooks/use-display-file-data";
import { useMediaStream } from "@/shared/hooks/use-media-stream-url";
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
      { root: el.parentElement, rootMargin: "0px 240px" },
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
  return (
    <button
      ref={ref}
      type="button"
      className="viewer-strip__item"
      data-kind={imagePath ? "image" : videoPath ? "video" : "file"}
      data-current={current ? "true" : undefined}
      aria-current={current ? "true" : undefined}
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
          <span className="viewer-strip__poster">
            {near ? <VideoThumb filePath={videoPath} /> : null}
          </span>
          <span className="viewer-strip__label">{entry.title}</span>
        </>
      ) : (
        <>
          <span className="viewer-strip__icon" aria-hidden="true">
            <DisplayTabIcon kind={entry.kind} size={14} />
          </span>
          <span className="viewer-strip__label">{entry.title}</span>
        </>
      )}
    </button>
  );
}

/**
 * The per-type strip under the viewer: the conversation's other photos,
 * videos, clips or canvases, centred. Like the filmstrips in Photos and
 * Lightroom it holds still while you step, and only scrolls when the current
 * item would reach an edge (scroll-padding keeps one neighbour in view).
 * PDFs, slides and code carry their own rail inside the viewer instead.
 */
export function ViewerStrip({ item }: { item: DisplayTab }) {
  const { items, index } = useViewerSiblings(item.id, item.kind);
  const listRef = useRef<HTMLDivElement | null>(null);
  const firstScroll = useRef(true);

  useLayoutEffect(() => {
    const current = listRef.current?.querySelector<HTMLElement>(
      "[data-current='true']",
    );
    if (!current) return;
    current.scrollIntoView({
      block: "nearest",
      inline: firstScroll.current ? "center" : "nearest",
      behavior: firstScroll.current ? "auto" : "smooth",
    });
    firstScroll.current = false;
  }, [index]);

  if (index === -1 || items.length < 2) return null;

  return (
    <footer className="viewer-strip">
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
    </footer>
  );
}
