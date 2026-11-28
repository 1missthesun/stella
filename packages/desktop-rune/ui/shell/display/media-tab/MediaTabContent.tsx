import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Drag, Magnify } from "../../../../host/rune-jsx/props";
import type { MediaAsset } from "@stella/contracts/desktop/display-payload";
import { displayTabs } from "@/features/workspace-display/tab-store";
import { fileViewer } from "@/features/workspace-display/file-viewer-store";
import type { DisplayTabKind } from "@/features/workspace-display/types";
import { showSibling, useViewerSiblings } from "@/shell/workspace-stage/viewer-siblings";
import { removeGeneratedMediaItem } from "@/shell/display/payload-to-tab-spec";
import type { MediaTabItem } from "@/shell/display/media-tab/media-item";
import { useDisplayFileBlobs, type DisplayFileBlob } from "@/shared/hooks/use-display-file-data";
import { useMediaStream } from "@/shared/hooks/use-media-stream-url";
import { copyImageBlob } from "@/shell/media-clipboard";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { useT } from "@/shared/i18n";
import { ViewerItemContext, useRegisterViewerActions } from "@/shell/workspace-stage/viewer-item-context";
import { Button, EmptyState, useRetainedSurfaceActive } from "../../../kit";
import { look, useTokens } from "../../../theme";
import { AudioPlayer, VideoPlayer } from "./MediaControls";

const filenameOf = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath;

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

const LONG_PROMPT_CHARS = 100;

function HeroPrompt({ text, viewer }: { text: string; viewer: boolean }) {
  const t = useTokens();
  const [expanded, setExpanded] = useState(false);
  const long = text.length > LONG_PROMPT_CHARS;
  return (
    <text
      {...look(viewer ? 11 : 13, 400)}
      color={viewer ? t.c.textWeak : t.c.textStrong}
      textAlign={viewer ? "center" : "start"}
      maxLines={expanded ? undefined : 2}
      truncate={expanded ? undefined : true}
      title={long && !expanded ? text : undefined}
      onPress={long ? () => setExpanded((open) => !open) : undefined}
    >
      {text}
    </text>
  );
}

function MediaActions({ filePath, copyText, copyImage, extra }: { filePath?: string; copyText?: string; copyImage?: DisplayFileBlob | null; extra?: { label: string; run: () => void }[] }) {
  const t = useTokens();
  const [message, setMessage] = useState<string | null>(null);
  const save = useCallback(async () => {
    if (!filePath) return;
    const result = await window.electronAPI?.system?.saveFileAs?.(filePath, filenameOf(filePath));
    if (!result || result.canceled) return;
    setMessage(result.ok ? "Saved" : (result.error ?? "Could not save"));
  }, [filePath]);
  const copy = useCallback(async () => {
    try {
      if (copyImage) {
        await copyImageBlob(copyImage.blob);
        setMessage("Copied");
        return;
      }
      if (copyText != null) setMessage((await copyTextToClipboard(copyText)) ? "Copied" : "Could not copy");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not copy");
    }
  }, [copyImage, copyText]);
  const canSave = Boolean(filePath && window.electronAPI?.system?.saveFileAs);
  const canCopy = Boolean(copyText != null || copyImage);
  if (!canSave && !canCopy && !extra?.length) return null;
  return (
    <row gap={6} align="center" wrap>
      {canSave ? <Button size="small" variant="secondary" onPress={() => void save()}>Save</Button> : null}
      {canCopy ? <Button size="small" variant="secondary" onPress={() => void copy()}>Copy</Button> : null}
      {extra?.map((action) => (
        <Button key={action.label} size="small" variant="secondary" onPress={action.run}>
          {action.label}
        </Button>
      ))}
      {message ? (
        <text {...look(11, 400)} color={t.c.textWeak} enter="fade">
          {message}
        </text>
      ) : null}
    </row>
  );
}

function ImageView({ filePaths, viewer, prompt, onSwipe }: { filePaths: string[]; viewer: boolean; prompt?: string; onSwipe: (direction: "next" | "previous") => void }) {
  const t = useT();
  const tk = useTokens();
  const { files, error, missing, missingMessages } = useDisplayFileBlobs(filePaths, "Media preview requires the Electron host runtime.");
  const [activeIndex, setActiveIndex] = useState(0);
  const zoom = useImageZoom(activeIndex);
  const zoomed = zoom.view.scale > 1;
  const safeIndex = Math.max(0, Math.min(activeIndex, files.length - 1));
  const active = files[safeIndex];
  const path = filePaths[safeIndex] ?? "";
  return (
    <col grow={1} minH={0} w="full" gap={viewer ? 0 : 10} align="center">
      {!viewer ? <MediaActions filePath={path} copyImage={active} extra={[{ label: t("shell.display.media.expand"), run: () => fileViewer.expand() }]} /> : null}
      {active ? (
        <box
          id={`media-image-${path}`}
          role="img"
          label={prompt ?? filenameOf(path)}
          title={viewer ? t("shell.display.media.zoom") : undefined}
          grow={1}
          minH={0}
          w="full"
          clip={6}
          center
          cursor={zoomed ? "grab" : "default"}
          onSize={zoom.onFrame}
          onDoublePress={zoom.toggle}
          onMagnify={zoom.onMagnify}
          onDrag={(d) => {
            if (zoom.onDrag(d) || d.phase !== "end" || Math.abs(d.dx) < 80 || Math.abs(d.dx) < Math.abs(d.dy)) return;
            onSwipe(d.dx < 0 ? "next" : "previous");
          }}
        >
          <image
            src={active.url}
            fit="contain"
            maxW="full"
            maxH="full"
            selfAlign="center"
            radius={6}
            onSize={zoom.onImage}
            scale={zoom.view.scale}
            x={zoom.view.x}
            y={zoom.view.y}
            motion={ZOOM_GLIDE}
            instant={zoom.live}
          />
        </box>
      ) : missing[safeIndex] ? (
        <EmptyState motif="unavailable" title={t("shell.display.media.imageUnavailable")} body={missingMessages[safeIndex] ?? `${filenameOf(path)} was moved or deleted.`} />
      ) : error ? (
        <EmptyState motif="preview" title={t("shell.display.preview.failedTitle")} body={error} />
      ) : (
        <text {...look(12, 400)} color={tk.c.textWeak}>
          Loading…
        </text>
      )}
      {!viewer && files.length > 1 ? (
        <row gap={6} role="tablist">
          {files.map((file, i) => (
            <box
              key={filePaths[i]}
              role="tab"
              selected={i === safeIndex}
              title={filenameOf(filePaths[i] ?? "")}
              w={44}
              h={44}
              radius={6}
              clip={6}
              border={i === safeIndex ? tk.c.textStrong : tk.c.borderWeak}
              onPress={() => setActiveIndex(i)}
            >
              {file ? <image src={file.url} fit="cover" w="full" h="full" /> : null}
            </box>
          ))}
        </row>
      ) : null}
    </col>
  );
}

const ZOOM_MAX = 5;
const ZOOM_DOUBLE = 2.5;
const ZOOM_GLIDE = { dur: 0.3, bounce: 0 };
type ZoomView = { scale: number; x: number; y: number };
type Size = { w: number; h: number };
const FIT: ZoomView = { scale: 1, x: 0, y: 0 };

/** Keeps a zoomed image covering its middle: it can't be panned past its own edges. */
const clampPan = (v: ZoomView, image: Size | null): ZoomView => {
  if (!image || v.scale <= 1) return { ...v, x: 0, y: 0 };
  const mx = ((v.scale - 1) * image.w) / 2;
  const my = ((v.scale - 1) * image.h) / 2;
  return { scale: v.scale, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
};

/** Pinch to zoom about the fingers, pan a zoomed image with one finger, double-tap to zoom in and back (packages/mobile's image viewer). */
function useImageZoom(resetKey: unknown) {
  const [view, setView] = useState<ZoomView>(FIT);
  const [live, setLive] = useState(false);
  const frame = useRef<Size>({ w: 0, h: 0 });
  const image = useRef<Size | null>(null);
  const current = useRef(view);
  current.current = view;
  const pinching = useRef(false);
  const panFrom = useRef<ZoomView | null>(null);

  useEffect(() => {
    setView(FIT);
    setLive(false);
  }, [resetKey]);

  const settle = (v: ZoomView) => {
    setLive(false);
    setView(v.scale <= 1.02 ? FIT : clampPan({ ...v, scale: Math.min(ZOOM_MAX, v.scale) }, image.current));
  };

  const onMagnify = (m: Magnify) => {
    const v = current.current;
    if (m.phase === "start") {
      pinching.current = true;
      panFrom.current = null;
      setLive(true);
    }
    if (m.delta) {
      // The image sits in the frame's middle and scales about its own middle: keep the point under the fingers there.
      const scale = Math.max(0.6, Math.min(ZOOM_MAX * 1.25, v.scale * (1 + m.delta)));
      const fx = m.x - frame.current.w / 2;
      const fy = m.y - frame.current.h / 2;
      const k = scale / v.scale;
      const next = { scale, x: fx - (fx - v.x) * k, y: fy - (fy - v.y) * k };
      current.current = next;
      if (m.wheel) settle(next);
      else setView(next);
    }
    if (m.phase === "end") {
      pinching.current = false;
      settle(current.current);
    }
  };

  /** Pans a zoomed image; returns whether it took the drag (an image at its fit leaves it for swiping between files). */
  const onDrag = (d: Drag): boolean => {
    if (pinching.current) return true;
    if (d.phase === "start") {
      panFrom.current = current.current.scale > 1 ? current.current : null;
      if (panFrom.current) setLive(true);
      return Boolean(panFrom.current);
    }
    const from = panFrom.current;
    if (!from) return false;
    const next = clampPan({ scale: from.scale, x: from.x + d.dx, y: from.y + d.dy }, image.current);
    if (d.phase === "end") {
      panFrom.current = null;
      settle(next);
    } else {
      current.current = next;
      setView(next);
    }
    return true;
  };

  const toggle = () => setView((v) => (v.scale > 1 ? FIT : { scale: ZOOM_DOUBLE, x: 0, y: 0 }));
  const onFrame = (s: Size) => {
    frame.current = s;
  };
  const onImage = (s: Size) => {
    image.current = s;
  };
  return { view, live, onMagnify, onDrag, toggle, onFrame, onImage };
}

/** A video or audio whose surface is hidden stops playing, as the viewer pauses its media when it isn't shown. */
function usePauseWhenHidden(id: string) {
  const active = useRetainedSurfaceActive();
  useEffect(() => {
    if (!active) void stella.engine.media.pause(id).catch(() => {});
  }, [active, id]);
}

function VideoView({ filePath, viewer }: { filePath: string; viewer: boolean }) {
  const t = useT();
  const tk = useTokens();
  const { url, failure } = useMediaStream(filePath, "video");
  const id = `media-video-${filePath}`;
  usePauseWhenHidden(id);
  const remote = url && !url.startsWith("stella-media:") ? url : null;
  const saveAs = window.electronAPI?.system?.saveFileAs;
  return (
    <col grow={1} minH={0} w="full" gap={10}>
      {failure ? (
        <EmptyState motif="unavailable" title={t("shell.display.media.videoUnavailable")} body={failure} />
      ) : (
        <VideoPlayer
          id={id}
          src={remote ?? filePath}
          onFullSize={() => fileViewer.expand()}
          onMore={saveAs ? () => void saveAs(filePath, filenameOf(filePath)) : undefined}
        />
      )}
      {!viewer ? (
        <>
          <MediaActions filePath={filePath} copyText={filePath} extra={[{ label: t("shell.display.media.expand"), run: () => fileViewer.expand() }]} />
          <text {...look(11, 400)} color={tk.c.textWeak}>
            {filenameOf(filePath)}
          </text>
        </>
      ) : null}
    </col>
  );
}

function AudioView({ filePath, viewer }: { filePath: string; viewer: boolean }) {
  const t = useT();
  const tk = useTokens();
  const { url, failure } = useMediaStream(filePath, "audio file");
  const id = `media-audio-${filePath}`;
  usePauseWhenHidden(id);
  const remote = url && !url.startsWith("stella-media:") ? url : null;
  return (
    <col w="full" gap={viewer ? 0 : 12}>
      <col w="full" gap={8} py={4} px={2}>
        {failure ? (
          <EmptyState motif="unavailable" size="compact" title={t("shell.display.media.audioUnavailable")} body={failure} />
        ) : url ? (
          <AudioPlayer key={url} id={id} src={remote ?? filePath} />
        ) : null}
        <text {...look(12, 400)} color={tk.c.textWeak} textAlign="center" truncate>
          {filenameOf(filePath)}
        </text>
      </col>
      {!viewer ? <MediaActions filePath={filePath} copyText={filePath} extra={[{ label: t("shell.display.media.expand"), run: () => fileViewer.expand() }]} /> : null}
    </col>
  );
}

function DownloadView({ filePath, label, variant, viewer }: { filePath: string; label: string; variant: "model3d" | "download"; viewer: boolean }) {
  const t = useT();
  const tk = useTokens();
  return (
    <row gap={12} py={14} px={4} align="start">
      <box w={48} h={48} radius={12} center fill={tk.c.surfaceBase} border={tk.c.borderWeak}>
        <text {...look(20, 500)} color={tk.c.textWeak}>
          {variant === "model3d" ? "◆" : "↓"}
        </text>
      </box>
      <col gap={6} minW={0} shrink>
        <text {...look(14, 600)} color={tk.c.textStrong}>
          {label}
        </text>
        <text {...look(11, 400)} color={tk.c.textWeak} truncate>
          {filenameOf(filePath)}
        </text>
        <MediaActions
          filePath={filePath}
          copyText={filePath}
          extra={[
            ...(!viewer ? [{ label: t("shell.display.media.expand"), run: () => fileViewer.expand() }] : []),
            { label: t("shell.display.media.revealInFinder"), run: () => window.electronAPI?.system?.showItemInFolder?.(filePath) },
          ]}
        />
      </col>
    </row>
  );
}

function TextView({ text, viewer }: { text: string; viewer: boolean }) {
  const tk = useTokens();
  return (
    <col grow={1} minH={0} w="full" gap={10}>
      {!viewer ? <MediaActions copyText={text} /> : null}
      <col grow={1} minH={0} scrollY py={14} px={4}>
        <text {...look(13, 400, { lh: 1.55 })} color={tk.c.textBase} selectable>
          {text}
        </text>
      </col>
    </col>
  );
}

function MediaPreview({ asset, viewer, prompt, onSwipe }: { asset: MediaAsset; viewer: boolean; prompt?: string; onSwipe: (direction: "next" | "previous") => void }) {
  switch (asset.kind) {
    case "image":
      return <ImageView filePaths={asset.filePaths} viewer={viewer} prompt={prompt} onSwipe={onSwipe} />;
    case "video":
      return <VideoView filePath={asset.filePath} viewer={viewer} />;
    case "audio":
      return <AudioView filePath={asset.filePath} viewer={viewer} />;
    case "model3d":
      return <DownloadView filePath={asset.filePath} label={asset.label ?? "3D model"} variant="model3d" viewer={viewer} />;
    case "download":
      return <DownloadView filePath={asset.filePath} label={asset.label} variant="download" viewer={viewer} />;
    case "text":
      return <TextView text={asset.text} viewer={viewer} />;
  }
}

const useViewerMediaActions = (item: MediaTabItem, onDelete: () => void) => {
  const imagePath = item.asset.kind === "image" ? (item.asset.filePaths[0] ?? null) : null;
  const { files } = useDisplayFileBlobs(imagePath ? [imagePath] : []);
  const blob = files[0]?.blob ?? null;
  const text = item.asset.kind === "text" ? item.asset.text : null;
  useRegisterViewerActions({
    ...(imagePath && blob
      ? { copyLabel: "Copy image", copy: () => copyImageBlob(blob) }
      : text !== null
        ? {
            copyLabel: "Copy text",
            copy: async () => {
              if (!(await copyTextToClipboard(text))) throw new Error("Couldn't copy");
            },
          }
        : {}),
    remove: onDelete,
  });
};

/** desktop-ui's `MediaTabContent`: one generated or opened image, video, sound, model or text, in the viewer or a tab. */
export const MediaTabContent = ({ item }: { item: MediaTabItem }) => {
  const t = useT();
  const tk = useTokens();
  const { items, index } = useViewerSiblings(item.id, mediaKindOf(item));
  const neighbours = useMemo(() => (index === -1 ? { previous: null, next: null } : { previous: items[index - 1] ?? null, next: items[index + 1] ?? null }), [index, items]);
  const step = useCallback(
    (direction: "next" | "previous") => {
      const target = direction === "next" ? neighbours.next : neighbours.previous;
      if (target) showSibling(item.id, target);
    },
    [item.id, neighbours],
  );
  const remove = useCallback(() => {
    removeGeneratedMediaItem(item.id);
    displayTabs.closeTab(item.id);
    fileViewer.closeItem(item.id);
  }, [item.id]);
  // A Drive file's tab is its local item's id behind `drive:` (payload-to-tab-spec's cloud spec).
  const viewerItem = useContext(ViewerItemContext);
  const inViewer = viewerItem === item.id || viewerItem === `drive:${item.id}`;
  useViewerMediaActions(item, remove);

  if (inViewer) {
    return (
      <col id={`media-tab-${item.id}`} grow={1} minH={0} w="full">
        <col grow={1} minH={0} pt={4} pr={10} pb={8} pl={10} align="center" justify="center">
          <MediaPreview asset={item.asset} viewer prompt={item.prompt} onSwipe={step} />
        </col>
        {item.prompt ? (
          <col maxW={72 * 7} selfAlign="center" px={16} pb={8}>
            <HeroPrompt text={item.prompt} viewer />
          </col>
        ) : null}
      </col>
    );
  }

  return (
    <col id={`media-tab-${item.id}`} grow={1} minH={0} w="full" pad={12} gap={12}>
      <col gap={8}>
        <row align="center" gap={8}>
          {item.madeBy ? (
            <text {...look(11, 500)} color={tk.c.textWeak}>
              {item.madeBy}
            </text>
          ) : null}
          <box grow={1} />
          <row role="group" label={t("shell.display.media.itemActions")} gap={6}>
            <Button size="small" variant="ghost" onPress={remove}>
              Delete
            </Button>
          </row>
        </row>
        {item.prompt ? <HeroPrompt text={item.prompt} viewer={false} /> : null}
      </col>
      <col grow={1} minH={0} align="center" justify="center" pad={12}>
        <MediaPreview asset={item.asset} viewer={false} prompt={item.prompt} onSwipe={step} />
      </col>
    </col>
  );
};
