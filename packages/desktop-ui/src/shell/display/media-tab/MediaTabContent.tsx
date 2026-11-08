import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { MediaPreviewCard } from "@/shell/MediaPreviewCard";
import type { SwipeDirection } from "@/shell/ZoomableImage";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { displayTabs } from "@/features/workspace-display/tab-store";
import { fileViewer } from "@/features/workspace-display/file-viewer-store";
import type { DisplayTabKind } from "@/features/workspace-display/types";
import { showSibling, useViewerSiblings } from "@/shell/workspace-stage/viewer-siblings";
import { removeGeneratedMediaItem } from "../payload-to-tab-spec";
import type { MediaTabItem } from "./media-item";
import { MediaActionBar } from "./MediaActionBar";
import { HeroPrompt } from "./HeroPrompt";
import { useT } from "@/shared/i18n";
import { useDisplayFileBlobs } from "@/shared/hooks/use-display-file-data";
import { copyImageBlob } from "@/shell/media-clipboard";
import {
  ViewerItemContext,
  useRegisterViewerActions,
} from "@/shell/workspace-stage/viewer-item-context";
import "../media-tab.css";

const mediaKindOf = (item: MediaTabItem): DisplayTabKind => {
  switch (item.asset.kind) {
    case "image":
    case "video":
    case "audio":
      return item.asset.kind;
    default:
      return "media";
  }
};

const WHEEL_SWIPE_PX = 80;
const WHEEL_GESTURE_IDLE_MS = 220;

const wheelGesture: {
  travel: number;
  fired: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
} = { travel: 0, fired: false, idleTimer: null };

/**
 * In the file viewer the header carries the item's actions (Download, Share,
 * and Copy / Delete in its menu); this hands it the media-specific ones.
 */
const useViewerMediaActions = (item: MediaTabItem, onDelete: () => void) => {
  const imagePath =
    item.asset.kind === "image" ? (item.asset.filePaths[0] ?? null) : null;
  const { files } = useDisplayFileBlobs(imagePath ? [imagePath] : []);
  const blob = files[0]?.blob ?? null;
  const text = item.asset.kind === "text" ? item.asset.text : null;
  useRegisterViewerActions({
    ...(imagePath && blob
      ? { copyLabel: "Copy image", copy: () => copyImageBlob(blob) }
      : text !== null
        ? {
            copyLabel: "Copy text",
            copy: () => navigator.clipboard.writeText(text),
          }
        : {}),
    remove: onDelete,
  });
};

const useMediaNeighbours = (itemId: string, kind: DisplayTabKind) => {
  const { items, index } = useViewerSiblings(itemId, kind);
  return useMemo(() => {
    if (index === -1) return { previous: null, next: null };
    return {
      previous: items[index - 1] ?? null,
      next: items[index + 1] ?? null,
    };
  }, [index, items]);
};

export const MediaTabContent = ({ item }: { item: MediaTabItem }) => {
  const t = useT();
  const neighbours = useMediaNeighbours(item.id, mediaKindOf(item));
  const neighboursRef = useRef(neighbours);
  neighboursRef.current = neighbours;
  const previewRef = useRef<HTMLDivElement | null>(null);

  const step = useCallback((direction: SwipeDirection) => {
    const target =
      direction === "next"
        ? neighboursRef.current.next
        : neighboursRef.current.previous;
    if (target) showSibling(item.id, target);
  }, [item.id]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const gesture = wheelGesture;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (gesture.idleTimer) clearTimeout(gesture.idleTimer);
      gesture.idleTimer = setTimeout(() => {
        gesture.idleTimer = null;
        gesture.travel = 0;
        gesture.fired = false;
      }, WHEEL_GESTURE_IDLE_MS);
      if (gesture.fired || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
        return;
      }
      gesture.travel += event.deltaX;
      if (Math.abs(gesture.travel) < WHEEL_SWIPE_PX) return;
      gesture.fired = true;
      step(gesture.travel > 0 ? "next" : "previous");
    };
    preview.addEventListener("wheel", onWheel, { passive: true });
    return () => preview.removeEventListener("wheel", onWheel);
  }, [step]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest("video, audio, input, [role='slider']")) return;
      if (event.key === "ArrowRight") step("next");
      else if (event.key === "ArrowLeft") step("previous");
      else return;
      event.preventDefault();
    },
    [step],
  );

  const handleDelete = useCallback(() => {
    removeGeneratedMediaItem(item.id);
    displayTabs.closeTab(item.id);
    if (fileViewer.getSnapshot().fileId === item.id) fileViewer.close();
    else sidebarSections.clearLocation("files");
  }, [item.id]);

  const inViewer = useContext(ViewerItemContext) === item.id;
  useViewerMediaActions(item, handleDelete);

  if (inViewer) {
    // The viewer's header holds the actions, so the media gets the space.
    return (
      <div className="media-tab media-tab--viewer">
        <div
          ref={previewRef}
          className="media-tab__hero-preview"
          onKeyDown={handleKeyDown}
        >
          <MediaPreviewCard
            asset={item.asset}
            inDialog
            onSwipe={step}
            {...(item.prompt ? { prompt: item.prompt } : {})}
            {...(item.madeBy ? { madeBy: item.madeBy } : {})}
          />
        </div>
        {item.prompt ? (
          <div className="media-tab__viewer-prompt">
            <HeroPrompt text={item.prompt} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="media-tab">
      <div className="media-tab__surface">
        <div className="media-tab__hero">
          <div
            className="media-tab__hero-bar"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="media-tab__hero-bar-top">
              {item.madeBy ? (
                <span className="media-tab__hero-cap">
                  {item.madeBy}
                </span>
              ) : null}
              <div
                className="media-tab__hero-actions"
                role="group"
                aria-label={t("shell.display.media.itemActions")}
              >
                <MediaActionBar item={item} onDelete={handleDelete} />
              </div>
            </div>
            {item.prompt ? <HeroPrompt text={item.prompt} /> : null}
          </div>
          <div
            ref={previewRef}
            className="media-tab__hero-preview"
            onKeyDown={handleKeyDown}
          >
            <MediaPreviewCard
              asset={item.asset}
              inDialog
              onSwipe={step}
              {...(item.prompt ? { prompt: item.prompt } : {})}
              {...(item.madeBy ? { madeBy: item.madeBy } : {})}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
