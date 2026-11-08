import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  type DisplayTabPayload,
  normalizeDisplayPayload,
} from "@stella/contracts/desktop/display-payload";
import type { ChatContext } from "@/shared/types/electron";

type ChatAppSelection = NonNullable<ChatContext["appSelections"]>[number];
import { useChatRuntime } from "@/context/use-chat-runtime";
import { getComposerAppSelections } from "@/features/chat/composer-context";
import {
  fileViewer,
  isExclusiveStageSection,
  useFileViewer,
  VIEWER_SELECTION_SURFACE,
  type FileViewerRect,
} from "@/features/workspace-display/file-viewer-store";
import { DisplayTabIcon } from "@/features/workspace-display/icons";
import {
  addAgentDisplayPayload,
  openDisplayPayloadTab,
} from "@/features/workspace-display/open-payload";
import {
  sidebarSections,
  useSidebarActiveTabId,
  useSidebarOpenTabs,
} from "@/features/workspace-display/sidebar-sections";
import {
  displayTabs,
  useDisplayPanelOpen,
  useDisplayTabList,
} from "@/features/workspace-display/tab-store";
import type { DisplayTab } from "@/features/workspace-display/types";
import { DeferredDisplayContent } from "@/shell/sidebar-sections/DeferredDisplayContent";
import { SidebarSectionBody } from "@/shell/sidebar-sections/SidebarSectionBody";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Plus,
  X,
} from "@/ui/icons";
import { RetainedSurface } from "@/ui/retained-surface";
import {
  ViewerItemContext,
  ViewerNavContext,
  type ViewerNav,
} from "./viewer-item-context";
import { ViewerStrip } from "./ViewerStrip";
import { showSibling, useViewerSiblings } from "./viewer-siblings";
import "@/shell/right-sidebar.css";
import "./workspace-stage.css";

export interface WorkspaceStageHandle {
  open(payload: DisplayTabPayload): void;
  /** Agent output. `tab: false` only registers it (e.g. generated media). */
  update(payload: DisplayTabPayload, opts?: { tab?: boolean }): void;
  close(): void;
}

/* ------------------------------------------------------------------ */
/* Geometry: the stage ends above the composer; the floater never     */
/* covers it.                                                          */
/* ------------------------------------------------------------------ */

const STAGE_GAP_ABOVE_COMPOSER = 12;
const STAGE_BOTTOM_WITHOUT_COMPOSER = 14;
const FLOAT_MARGIN = 8;
const FLOAT_MIN_WIDTH = 320;
const FLOAT_MIN_HEIGHT = 220;
const FLOAT_TOP_GAP = 10;

type Geometry = {
  topbar: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Viewport y the stage and floater must stay above. */
  floor: number;
  composer: { left: number; width: number } | null;
};

const readTopbarHeight = (): number => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    "--shell-topbar-height",
  );
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 38;
};

const findComposerRect = (): DOMRect | null => {
  const surface = document.querySelector(".persistent-chat-surface--active");
  if (!surface) return null;
  let best: DOMRect | null = null;
  for (const el of surface.querySelectorAll<HTMLElement>(".composer-shell")) {
    if (el.closest("[inert]")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (!best || rect.bottom > best.bottom) best = rect;
  }
  return best;
};

const measureGeometry = (): Geometry => {
  const composer = findComposerRect();
  const viewportHeight = window.innerHeight;
  return {
    topbar: readTopbarHeight(),
    viewportWidth: window.innerWidth,
    viewportHeight,
    floor: composer
      ? composer.top - STAGE_GAP_ABOVE_COMPOSER
      : viewportHeight - STAGE_BOTTOM_WITHOUT_COMPOSER,
    composer: composer ? { left: composer.left, width: composer.width } : null,
  };
};

const sameGeometry = (a: Geometry, b: Geometry) =>
  a.topbar === b.topbar &&
  a.viewportWidth === b.viewportWidth &&
  a.viewportHeight === b.viewportHeight &&
  Math.round(a.floor) === Math.round(b.floor) &&
  Math.round(a.composer?.left ?? -1) === Math.round(b.composer?.left ?? -1) &&
  Math.round(a.composer?.width ?? -1) === Math.round(b.composer?.width ?? -1);

let geometry: Geometry | null = null;
const geometryListeners = new Set<() => void>();
const refreshGeometry = () => {
  const next = measureGeometry();
  if (geometry && sameGeometry(geometry, next)) return;
  geometry = next;
  document.documentElement.style.setProperty(
    "--workspace-stage-bottom",
    `${Math.max(0, Math.round(next.viewportHeight - next.floor))}px`,
  );
  for (const listener of geometryListeners) listener();
};
const subscribeGeometry = (listener: () => void) => {
  geometryListeners.add(listener);
  return () => {
    geometryListeners.delete(listener);
  };
};
const getGeometry = (): Geometry => {
  if (!geometry) refreshGeometry();
  return geometry!;
};

/** Keep the composer measurement fresh while anything is on screen. */
const useGeometryTracking = (active: boolean) => {
  useLayoutEffect(() => {
    if (!active) return;
    refreshGeometry();
    const interval = window.setInterval(refreshGeometry, 250);
    window.addEventListener("resize", refreshGeometry);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", refreshGeometry);
    };
  }, [active]);
};

const useGeometry = (): Geometry =>
  useSyncExternalStore(subscribeGeometry, getGeometry, getGeometry);

const defaultFloatRect = (geo: Geometry): FileViewerRect => {
  const available = geo.floor - geo.topbar - FLOAT_MARGIN * 2;
  const width = Math.min(
    760,
    Math.max(FLOAT_MIN_WIDTH, geo.composer?.width ?? 680),
    geo.viewportWidth - FLOAT_MARGIN * 2,
  );
  const height = Math.max(
    Math.min(FLOAT_MIN_HEIGHT, available),
    Math.min(500, available),
  );
  const centre = geo.composer
    ? geo.composer.left + geo.composer.width / 2
    : geo.viewportWidth / 2;
  // Top of the chat area, so the latest messages above the composer stay
  // in sight.
  return {
    x: Math.round(centre - width / 2),
    y: Math.round(geo.topbar + FLOAT_TOP_GAP),
    width: Math.round(width),
    height: Math.round(height),
  };
};

/** Fit a rect inside the window, below the top bar and above the composer. */
const clampFloatRect = (
  rect: FileViewerRect,
  geo: Geometry,
): FileViewerRect => {
  const minTop = geo.topbar + 2;
  const maxBottom = geo.floor;
  const maxWidth = geo.viewportWidth - FLOAT_MARGIN * 2;
  const maxHeight = Math.max(120, maxBottom - minTop);
  const width = Math.min(Math.max(rect.width, FLOAT_MIN_WIDTH), maxWidth);
  const height = Math.min(
    Math.max(rect.height, Math.min(FLOAT_MIN_HEIGHT, maxHeight)),
    maxHeight,
  );
  const x = Math.min(
    Math.max(rect.x, FLOAT_MARGIN),
    geo.viewportWidth - FLOAT_MARGIN - width,
  );
  const y = Math.min(Math.max(rect.y, minTop), maxBottom - height);
  return {
    x: Math.round(x),
    y: Math.round(Math.max(minTop, y)),
    width: Math.round(width),
    height: Math.round(height),
  };
};

/* ------------------------------------------------------------------ */
/* Tabs on the stage                                                   */
/* ------------------------------------------------------------------ */

function TabStage({ visible }: { visible: boolean }) {
  return (
    <section
      className="workspace-stage workspace-stage--tabs"
      data-visible={visible ? "true" : "false"}
      aria-hidden={!visible}
    >
      <RetainedSurface active={visible} className="workspace-stage__body">
        <SidebarSectionBody />
      </RetainedSurface>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The file viewer: floating, or expanded onto the stage               */
/* ------------------------------------------------------------------ */

const MinimizeIcon = ({ size = 15 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4.5 14H10v5.5M4.75 19.25 10.5 13.5M19.5 10H14V4.5M19.25 4.75 13.5 10.5" />
  </svg>
);

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const CopyIcon = ({ size = 12 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </svg>
);

function ViewerHeader({
  item,
  meta,
  stage,
  onPointerDown,
}: {
  item: DisplayTab;
  meta: string | null;
  stage: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const path = payloadPath(item.payload);
  const [copied, setCopied] = useState(false);
  const attachment = useViewerChatAttachment(item);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyPath = useCallback(() => {
    if (!path) return;
    void navigator.clipboard.writeText(path).then(() => setCopied(true));
  }, [path]);

  return (
    <header
      className="file-viewer__header"
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        fileViewer.toggleMode();
      }}
    >
      <span className="file-viewer__icon" aria-hidden="true">
        <DisplayTabIcon kind={item.kind} size={15} />
      </span>
      {path ? (
        <span className="file-viewer__name">
          <button
            type="button"
            className="file-viewer__title file-viewer__title--copy"
            title={`${path}\nClick to copy the path`}
            onClick={copyPath}
          >
            {item.title}
          </button>
          <button
            type="button"
            className="file-viewer__copy"
            onClick={copyPath}
            aria-label="Copy path"
            title="Copy path"
          >
            {copied ? <Check size={12} strokeWidth={2.2} /> : <CopyIcon />}
          </button>
          {copied ? (
            <span className="file-viewer__copied" role="status">
              Copied
            </span>
          ) : null}
        </span>
      ) : (
        <span className="file-viewer__title" title={item.tooltip ?? item.title}>
          {item.title}
        </span>
      )}
      {meta && !copied ? (
        <span className="file-viewer__meta">{meta}</span>
      ) : null}
      <div className="file-viewer__actions">
        {attachment ? (
          <button
            type="button"
            className="file-viewer__add"
            data-added={attachment.added ? "true" : undefined}
            onClick={attachment.toggle}
            title={
              attachment.added
                ? "Remove from the message"
                : "Attach to your next message"
            }
          >
            {attachment.added ? (
              <>
                <Check size={13} strokeWidth={2} /> In chat
              </>
            ) : (
              <>
                <Plus size={13} strokeWidth={2} /> Add to chat
              </>
            )}
          </button>
        ) : null}
        <button
          type="button"
          className="file-viewer__action"
          onClick={() => fileViewer.toggleMode()}
          aria-label={stage ? "Shrink to a floating viewer" : "Expand"}
          title={stage ? "Shrink to a floating viewer" : "Expand"}
        >
          {stage ? (
            <MinimizeIcon size={14} />
          ) : (
            <Maximize2 size={14} strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          className="file-viewer__action"
          onClick={() => fileViewer.close()}
          aria-label="Close (Esc)"
          title="Close (Esc)"
        >
          <X size={14} strokeWidth={1.9} />
        </button>
      </div>
    </header>
  );
}

/** Arrows that appear at the media's left and right edges on hover. */
function EdgeArrows({ nav }: { nav: ViewerNav | null }) {
  if (!nav || (!nav.canPrevious && !nav.canNext)) return null;
  return (
    <>
      <button
        type="button"
        className="file-viewer__edge"
        data-dir="previous"
        disabled={!nav.canPrevious}
        onClick={nav.previous}
        aria-label={`${nav.previousLabel} (←)`}
        title={`${nav.previousLabel} (←)`}
      >
        <ChevronLeft size={18} strokeWidth={2} />
      </button>
      <button
        type="button"
        className="file-viewer__edge"
        data-dir="next"
        disabled={!nav.canNext}
        onClick={nav.next}
        aria-label={`${nav.nextLabel} (→)`}
        title={`${nav.nextLabel} (→)`}
      >
        <ChevronRight size={18} strokeWidth={2} />
      </button>
    </>
  );
}

const SIBLING_NOUNS: Record<string, string> = {
  image: "photo",
  video: "video",
  audio: "clip",
  canvas: "canvas",
};

/** Item-to-item navigation across the conversation's photos, videos, clips. */
const useSiblingNav = (item: DisplayTab | null): ViewerNav | null => {
  const { items, index } = useViewerSiblings(
    item?.id ?? "",
    item?.kind ?? "text",
  );
  return useMemo(() => {
    if (!item || index === -1 || items.length < 2) return null;
    const noun = SIBLING_NOUNS[item.kind] ?? "item";
    const previous = items[index - 1];
    const next = items[index + 1];
    return {
      canPrevious: Boolean(previous),
      canNext: Boolean(next),
      previous: () => previous && showSibling(item.id, previous),
      next: () => next && showSibling(item.id, next),
      previousLabel: `Previous ${noun}`,
      nextLabel: `Next ${noun}`,
    };
  }, [index, item, items]);
};

function FileViewerFrame({
  hiddenForExclusiveTab,
}: {
  hiddenForExclusiveTab: boolean;
}) {
  const { fileId, mode, rect, detail } = useFileViewer();
  const { tabs } = useDisplayTabList();
  const item = fileId ? (tabs.find((tab) => tab.id === fileId) ?? null) : null;
  const geo = useGeometry();
  const stage = mode === "stage";
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [bodyNav, setBodyNav] = useState<ViewerNav | null>(null);
  const siblingNav = useSiblingNav(item);
  const nav = bodyNav ?? siblingNav;
  const { items: siblings, index: siblingIndex } = useViewerSiblings(
    item?.id ?? "",
    item?.kind ?? "text",
  );
  const meta =
    siblingIndex !== -1 && siblings.length > 1
      ? `${siblingIndex + 1} of ${siblings.length}`
      : detail;

  useEffect(() => setBodyNav(null), [fileId]);

  useEffect(() => {
    if (fileId && !item) fileViewer.close();
  }, [fileId, item]);

  const floatRect = useMemo(
    () => clampFloatRect(rect ?? defaultFloatRect(geo), geo),
    [geo, rect],
  );

  const startGesture = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      apply: (dx: number, dy: number, start: FileViewerRect) => FileViewerRect,
    ) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture?.(event.pointerId);
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const start = floatRect;
      let latest = start;
      setInteracting(true);
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        latest = clampFloatRect(
          apply(ev.clientX - startX, ev.clientY - startY, start),
          getGeometry(),
        );
        fileViewer.setRect(latest, false);
      };
      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        if (target.hasPointerCapture?.(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
        document.body.style.userSelect = previousUserSelect;
        setInteracting(false);
        fileViewer.setRect(latest, true);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [floatRect],
  );

  const handleHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (stage) return;
      if ((event.target as HTMLElement).closest("button, a, input")) return;
      startGesture(event, (dx, dy, start) => ({
        ...start,
        x: start.x + dx,
        y: start.y + dy,
      }));
    },
    [stage, startGesture],
  );

  const handleResizePointerDown = useCallback(
    (edge: ResizeEdge) => (event: ReactPointerEvent<HTMLElement>) => {
      startGesture(event, (dx, dy, start) => {
        let { x, y, width, height } = start;
        if (edge.includes("e")) width = start.width + dx;
        if (edge.includes("s")) height = start.height + dy;
        if (edge.includes("w")) {
          width = Math.max(FLOAT_MIN_WIDTH, start.width - dx);
          x = start.x + (start.width - width);
        }
        if (edge.includes("n")) {
          height = Math.max(FLOAT_MIN_HEIGHT, start.height - dy);
          y = start.y + (start.height - height);
        }
        return { x, y, width, height };
      });
    },
    [startGesture],
  );

  if (!item) return null;
  const hidden = !stage && hiddenForExclusiveTab;

  return (
    <div
      ref={frameRef}
      className="file-viewer"
      data-mode={mode}
      data-hidden={hidden ? "true" : undefined}
      data-interacting={interacting ? "true" : undefined}
      role="dialog"
      aria-label={item.title}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      style={
        stage
          ? undefined
          : {
              left: floatRect.x,
              top: floatRect.y,
              width: floatRect.width,
              height: floatRect.height,
            }
      }
    >
      <ViewerHeader
        item={item}
        meta={meta}
        stage={stage}
        onPointerDown={handleHeaderPointerDown}
      />
      <div className="file-viewer__body">
        <ViewerItemContext value={item.id}>
          <ViewerNavContext value={setBodyNav}>
            <DeferredDisplayContent key={item.id} render={item.render} />
          </ViewerNavContext>
        </ViewerItemContext>
        <EdgeArrows nav={nav} />
      </div>
      <ViewerStrip item={item} />
      {!stage
        ? RESIZE_EDGES.map((edge) => (
            <div
              key={edge}
              className="file-viewer__resize"
              data-edge={edge}
              onPointerDown={handleResizePointerDown(edge)}
              aria-hidden="true"
            />
          ))
        : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Composer chip for the item on screen                                */
/* ------------------------------------------------------------------ */

const payloadPath = (payload: DisplayTabPayload | undefined): string | null => {
  if (!payload) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.filePath === "string") return record.filePath;
  if (payload.kind === "media") {
    const asset = payload.asset as Record<string, unknown>;
    if (typeof asset.filePath === "string") return asset.filePath;
    if (
      Array.isArray(asset.filePaths) &&
      typeof asset.filePaths[0] === "string"
    )
      return asset.filePaths[0];
  }
  if (payload.kind === "url" && typeof record.url === "string")
    return record.url;
  return null;
};

const withViewerSelection = (
  prev: ChatContext | null,
  itemId: string,
  selection: ChatAppSelection | null,
): ChatContext | null => {
  const current = getComposerAppSelections(prev);
  const others = current.filter(
    (entry) =>
      entry.surface !== VIEWER_SELECTION_SURFACE ||
      entry.anchor?.path !== itemId,
  );
  return {
    ...(prev ?? { window: null }),
    appSelection: null,
    appSelections: selection ? [...others, selection] : others,
  };
};

/**
 * "Add to chat": attach what's open to the next message as a chip. Nothing
 * is attached until the user asks, and the chip is theirs to remove.
 */
function useViewerChatAttachment(
  item: DisplayTab,
): { added: boolean; toggle: () => void } | null {
  const chat = useChatRuntime();
  const { detail } = useFileViewer();
  const setChatContext = chat.composer.setChatContext;
  const added = getComposerAppSelections(chat.composer.chatContext).some(
    (entry) =>
      entry.surface === VIEWER_SELECTION_SURFACE &&
      entry.anchor?.path === item.id,
  );
  const toggle = useCallback(() => {
    if (added) {
      setChatContext((prev) => withViewerSelection(prev, item.id, null));
      return;
    }
    const label = detail ? `${item.title} · ${detail}` : item.title;
    const path = payloadPath(item.payload);
    setChatContext((prev) =>
      withViewerSelection(prev, item.id, {
        label,
        snapshot: [
          `The user attached this from Stella's viewer: ${label}.`,
          path ? `Location: ${path}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        surface: VIEWER_SELECTION_SURFACE,
        anchor: { kind: VIEWER_SELECTION_SURFACE, path: item.id },
      }),
    );
    chat.composer.requestFocus?.();
  }, [added, chat.composer, detail, item, setChatContext]);
  if (item.kind === "chat" || item.kind === "home") return null;
  return { added, toggle };
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

const isEditableTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return Boolean(
    el.closest("input, textarea, select, [contenteditable='true']"),
  );
};

const editableIsEmpty = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return true;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value.length === 0;
  }
  return (el.textContent ?? "").length === 0;
};

const hasOpenOverlay = (): boolean =>
  Boolean(
    document.querySelector(
      "[role='dialog'][data-state='open'], [role='menu'][data-state='open'], [data-radix-popper-content-wrapper]",
    ),
  );

export const WorkspaceStage = memo(
  forwardRef<WorkspaceStageHandle, { portalTarget?: Element | null }>(
    function WorkspaceStage({ portalTarget }, ref) {
      const panelOpen = useDisplayPanelOpen();
      const sidebarTabs = useSidebarOpenTabs();
      const activeTabId = useSidebarActiveTabId();
      const activeTab =
        sidebarTabs.find((tab) => tab.id === activeTabId) ?? null;
      const tabStageVisible = panelOpen && activeTab !== null;
      const viewer = useFileViewer();
      const exclusiveTabShown =
        tabStageVisible && isExclusiveStageSection(activeTab?.kind);

      useImperativeHandle(
        ref,
        () => ({
          open(rawPayload) {
            const next = normalizeDisplayPayload(rawPayload);
            if (next) openDisplayPayloadTab(next);
          },
          update(rawPayload, opts) {
            const next = normalizeDisplayPayload(rawPayload);
            if (next) addAgentDisplayPayload(next, { tab: opts?.tab ?? true });
          },
          close() {
            fileViewer.close();
            displayTabs.setPanelOpen(false);
          },
        }),
        [],
      );

      // A stage with nothing to show falls back to the chat.
      useEffect(() => {
        if (panelOpen && !activeTab) displayTabs.setPanelOpen(false);
      }, [activeTab, panelOpen]);

      // Looking at a tab clears its dot.
      useEffect(() => {
        if (tabStageVisible && activeTab?.unread) {
          sidebarSections.activateTab(activeTab.id);
        }
      }, [activeTab, tabStageVisible]);

      useGeometryTracking(tabStageVisible || Boolean(viewer.fileId));

      useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
          if (event.defaultPrevented) return;
          const viewerState = fileViewer.getSnapshot();
          if (event.key === "Escape") {
            if (hasOpenOverlay()) return;
            if (viewerState.fileId) {
              fileViewer.close();
              event.preventDefault();
              return;
            }
            if (displayTabs.getLayoutSnapshot().panelOpen) {
              if (
                isEditableTarget(event.target) &&
                !editableIsEmpty(event.target)
              )
                return;
              displayTabs.setPanelOpen(false);
              event.preventDefault();
            }
            return;
          }
          if (
            (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
            viewerState.fileId &&
            !event.metaKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.shiftKey
          ) {
            if (
              isEditableTarget(event.target) &&
              !editableIsEmpty(event.target)
            )
              return;
            const frame = document.querySelector(".file-viewer");
            if (frame?.getAttribute("data-hidden") === "true") return;
            const target = event.target as HTMLElement | null;
            if (target?.closest("video, audio, [role='slider']")) return;
            const button = frame?.querySelector<HTMLButtonElement>(
              event.key === "ArrowLeft"
                ? ".file-viewer__edge[data-dir='previous']"
                : ".file-viewer__edge[data-dir='next']",
            );
            if (button && !button.disabled) {
              button.click();
              event.preventDefault();
            }
          }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
      }, []);

      const target =
        portalTarget ?? document.querySelector(".full-body") ?? document.body;

      return createPortal(
        <>
          <TabStage visible={tabStageVisible} />
          <FileViewerFrame hiddenForExclusiveTab={exclusiveTabShown} />
        </>,
        target,
      );
    },
  ),
);
