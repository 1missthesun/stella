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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  type DisplayTabPayload,
  normalizeDisplayPayload,
} from "@stella/contracts/desktop/display-payload";
import type { ChatContext } from "@/shared/types/electron";

type ChatAppSelection = NonNullable<ChatContext["appSelections"]>[number];
import { useChatRuntime } from "@/context/use-chat-runtime";
import { getComposerAppSelections } from "@/features/chat/composer-context";
import { detachedWindows } from "@/features/workspace-display/detached-windows";
import {
  DOCKED,
  fileViewer,
  isExclusiveStageSection,
  useFileViewer,
  VIEWER_SELECTION_SURFACE,
  type FileViewerMode,
  type ViewerSurface,
} from "@/features/workspace-display/file-viewer-store";
import {
  useViewerItem,
  viewerItems,
  type ViewerNav,
} from "@/features/workspace-display/viewer-items";
import { DisplayTabIcon } from "@/features/workspace-display/icons";
import { useTabStageVisible } from "@/features/workspace-display/tab-stage-visible";
import {
  addAgentDisplayPayload,
  openDisplayPayloadTab,
} from "@/features/workspace-display/open-payload";
import {
  isDocumentTab,
  sidebarSections,
  useSidebarActiveTabId,
  useSidebarOpenTabs,
  type SidebarTab,
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
  publicDriveLink,
  publicFileLink,
} from "@/features/cloud/file-share-link";
import { driveLinkTarget } from "@stella/contracts/cloud-world-paths";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { ManualCopyField } from "@/ui/manual-copy-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Link,
  LoaderCircle,
  Maximize2,
  MoreHorizontal,
  Plus,
  Share,
  Trash2,
  X,
} from "@/ui/icons";
import { RetainedSurface } from "@/ui/retained-surface";
import { translateNow, useT } from "@/shared/i18n";
import {
  addContextMenu,
  fileMenu,
  linkMenu,
  type MenuBuilder,
  type MenuSection,
} from "@/platform/context-menu";
import { PortalContainerContext } from "@/ui/portal-container";
import { ViewerItemContext, ViewerSurfaceContext } from "./viewer-item-context";
import {
  clampFloatRect,
  defaultFloatRect,
  FLOAT_MIN_HEIGHT,
  FLOAT_MIN_WIDTH,
  useGeometry,
  useGeometryTracking,
} from "./viewer-geometry";
import { dragViewer, resizeViewer } from "./viewer-drag";
import {
  createViewerHost,
  dropViewerHost,
  placeViewerHost,
  registerViewerSlot,
} from "./viewer-hosts";
import {
  canDetachViewer,
  popOutViewer,
  reopenViewerWindows,
} from "./viewer-windows";
import { ViewerStrip } from "./ViewerStrip";
import { showSibling, useViewerSiblings } from "./viewer-siblings";
import "@/shell/right-sidebar.css";
import "./workspace-stage.css";

export interface WorkspaceStageHandle {
  open(payload: DisplayTabPayload): void;
  update(payload: DisplayTabPayload, opts?: { tab?: boolean }): void;
  close(): void;
}

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

const PopOutIcon = ({ size = 15 }: { size?: number }) => (
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
    <path d="M10 5.25H7A2.75 2.75 0 0 0 4.25 8v9A2.75 2.75 0 0 0 7 19.75h9A2.75 2.75 0 0 0 18.75 17v-3" />
    <path d="M13.75 4.25h6v6M19.5 4.5l-7.25 7.25" />
  </svg>
);

const DockIcon = ({ size = 15 }: { size?: number }) => (
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
    <path d="M10 5.25H7A2.75 2.75 0 0 0 4.25 8v9A2.75 2.75 0 0 0 7 19.75h9A2.75 2.75 0 0 0 18.75 17v-3" />
    <path d="M12.25 5.75v6h6M12.5 11.5l7.25-7.25" />
  </svg>
);

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const fileNameOf = (path: string): string =>
  path.split(/[\\/]/).pop() || path;

const localFilePath = (payload: DisplayTabPayload | undefined): string | null =>
  payload?.kind === "url" ? null : payloadPath(payload);

const readFileBlob = async (path: string): Promise<Blob | null> => {
  const read = await window.electronAPI?.display?.readFile?.(path, {
    conversationId: null,
  });
  if (!read || read.missing) return null;
  const bytes = read.bytes;
  const part =
    bytes.buffer instanceof ArrayBuffer
      ? (bytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(bytes);
  return new Blob([part], {
    type: read.mimeType || "application/octet-stream",
  });
};

const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

function HeaderButton({
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  children,
  text,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
  text?: string;
}) {
  const tip = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className="file-viewer__action"
      data-labelled={text ? "true" : undefined}
      data-pressed={pressed ? "true" : undefined}
      onClick={onClick}
      disabled={disabled}
      aria-label={tip}
      aria-pressed={pressed}
      title={tip}
    >
      {children}
      {text ? <span className="file-viewer__action-text">{text}</span> : null}
    </button>
  );
}

function ViewerHeader({
  item,
  placement,
  onPointerDown,
  onDetach,
  onClose,
  onDock,
}: {
  item: DisplayTab;
  placement: FileViewerMode | "window";
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onDetach: (() => void) | null;
  onClose: () => void;
  onDock?: () => void;
}) {
  const t = useT();
  const stage = placement === "stage";
  const detached = placement === "window";
  const { detail: meta, actions } = useViewerItem(item.id);
  const drivePath = item.payload?.cloudDrivePath ?? null;
  const path = drivePath ?? payloadPath(item.payload);
  const filePath = drivePath ? null : localFilePath(item.payload);
  const attachment = useViewerChatAttachment(item);
  const [status, setStatus] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    setStatus(null);
    setManualLink(null);
    setArmed(false);
  }, [item.id]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 2200);
    return () => window.clearTimeout(timer);
  }, [status]);

  const canSave = Boolean(filePath && window.electronAPI?.system?.saveFileAs);

  const download = useCallback(async () => {
    if (!filePath) return;
    const result = await window.electronAPI?.system?.saveFileAs?.(
      filePath,
      fileNameOf(filePath),
    );
    if (!result || result.canceled) return;
    setStatus(result.ok ? "Saved" : (result.error ?? "Couldn't save"));
  }, [filePath]);

  const canShare = Boolean(drivePath || filePath) && item.kind !== "canvas";
  const share = useCallback(() => {
    if (sharing) return;
    const link = drivePath
      ? publicDriveLink(drivePath)
      : filePath
        ? publicFileLink(filePath, null).catch(async () =>
            publicFileLink(filePath, await readFileBlob(filePath)),
          )
        : null;
    if (!link) return;
    setSharing(true);
    setManualLink(null);
    const copied = copyTextToClipboard(link);
    void (async () => {
      try {
        const url = await link;
        if (await copied) setStatus("Public link copied");
        else setManualLink(url);
      } catch (err) {
        setStatus(errorText(err, "Couldn't share"));
      } finally {
        setSharing(false);
      }
    })();
  }, [drivePath, filePath, sharing]);

  const copyBody = useCallback(async () => {
    if (!actions?.copy) return;
    try {
      await actions.copy();
      setStatus("Copied");
    } catch (err) {
      setStatus(errorText(err, "Couldn't copy"));
    }
  }, [actions]);

  const copyPath = useCallback(async () => {
    if (!path) return;
    setManualLink(null);
    if (await copyTextToClipboard(path)) {
      setStatus(item.payload?.kind === "url" ? "Link copied" : "Path copied");
    } else {
      setManualLink(path);
    }
  }, [item.payload?.kind, path]);

  const remove = actions?.remove;
  const hasMenu = Boolean(actions?.copy || path || remove);

  const buildMenu: MenuBuilder = async ({ target }) => {
    if (target.closest(".viewer-strip")) return null;
    const sections: MenuSection[] = [];
    if (actions?.copy) {
      sections.push([
        {
          label: actions.copyLabel ?? translateNow("contextMenu.copy"),
          run: copyBody,
        },
      ]);
    }
    if (item.payload?.kind === "url" && path) {
      sections.push(linkMenu(path).slice(1));
    } else if (filePath || drivePath) {
      sections.push(
        ...(await fileMenu(drivePath ? driveLinkTarget(drivePath) : filePath!, {
          addToChat: attachment
            ? {
                label: attachment.added
                  ? translateNow("contextMenu.removeFromChat")
                  : translateNow("contextMenu.addToChat"),
                run: attachment.toggle,
              }
            : null,
        })()),
      );
      sections.push([
        { label: translateNow("contextMenu.copyPublicLink"), run: share },
      ]);
    }
    sections.push([
      ...(detached
        ? [{ label: t("contextMenu.dockViewer"), run: () => onDock?.() }]
        : [
            {
              label: stage
                ? t("contextMenu.shrinkViewer")
                : t("contextMenu.expandViewer"),
              run: () => fileViewer.toggleMode(),
            },
            ...(onDetach
              ? [{ label: t("contextMenu.detachViewer"), run: onDetach }]
              : []),
          ]),
      { label: t("contextMenu.closeViewer"), run: onClose },
    ]);
    return sections;
  };
  useLayoutEffect(() => {
    viewerItems.setMenu(item.id, buildMenu);
  });

  return (
    <header
      className="file-viewer__header"
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        if (detached) return;
        if ((event.target as HTMLElement).closest("button")) return;
        fileViewer.toggleMode();
      }}
    >
      <span className="file-viewer__icon" aria-hidden="true">
        <DisplayTabIcon kind={item.kind} size={15} />
      </span>
      <span
        className="file-viewer__title"
        title={path ? `${item.title}\n${path}` : (item.tooltip ?? item.title)}
      >
        {item.title}
      </span>
      {manualLink ? (
        <ManualCopyField
          className="file-viewer__manual-copy"
          value={manualLink}
          label="Couldn't copy. Select this and copy it."
        />
      ) : status ? (
        <span className="file-viewer__status" role="status">
          {status}
        </span>
      ) : meta ? (
        <span className="file-viewer__meta">{meta}</span>
      ) : null}
      <div className="file-viewer__actions">
        {attachment ? (
          <HeaderButton
            label={
              attachment.added
                ? "In chat · click to remove it from your message"
                : "Add to chat · attach to your next message"
            }
            onClick={attachment.toggle}
            pressed={attachment.added}
            text={attachment.added ? "In chat" : "Add to chat"}
          >
            {attachment.added ? (
              <Check size={15} strokeWidth={1.9} />
            ) : (
              <Plus size={15} strokeWidth={1.9} />
            )}
          </HeaderButton>
        ) : null}
        {canSave ? (
          <HeaderButton label="Download" onClick={() => void download()}>
            <Download size={15} strokeWidth={1.75} />
          </HeaderButton>
        ) : null}
        {canShare ? (
          <HeaderButton
            label="Share · copy a public link anyone can open"
            onClick={share}
            disabled={sharing}
          >
            {sharing ? (
              <LoaderCircle
                size={15}
                strokeWidth={1.75}
                className="file-viewer__spin"
              />
            ) : (
              <Share size={15} strokeWidth={1.75} />
            )}
          </HeaderButton>
        ) : null}
        {hasMenu ? (
          <DropdownMenu modal={!detached} onOpenChange={(open) => !open && setArmed(false)}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="file-viewer__action"
                aria-label="More"
                title="More"
              >
                <MoreHorizontal size={15} strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              collisionPadding={8}
              className="file-viewer__menu"
            >
              {actions?.copy ? (
                <DropdownMenuItem onSelect={() => void copyBody()}>
                  <span data-slot="dropdown-menu-item-icon">
                    <Copy size={14} />
                  </span>
                  {actions.copyLabel ?? "Copy"}
                </DropdownMenuItem>
              ) : null}
              {path ? (
                <DropdownMenuItem onSelect={() => void copyPath()}>
                  <span data-slot="dropdown-menu-item-icon">
                    <Link size={14} />
                  </span>
                  {item.payload?.kind === "url" ? "Copy link" : "Copy path"}
                </DropdownMenuItem>
              ) : null}
              {remove ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    data-variant="destructive"
                    data-armed={armed ? "true" : undefined}
                    onSelect={(event) => {
                      if (!armed) {
                        event.preventDefault();
                        setArmed(true);
                        return;
                      }
                      remove();
                    }}
                  >
                    <span data-slot="dropdown-menu-item-icon">
                      <Trash2 size={14} />
                    </span>
                    {armed ? "Click again to delete" : "Delete"}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <span className="file-viewer__divider" aria-hidden="true" />
        {detached ? (
          <HeaderButton
            label={t("contextMenu.dockViewer")}
            onClick={() => onDock?.()}
          >
            <DockIcon />
          </HeaderButton>
        ) : (
          <>
            {onDetach ? (
              <HeaderButton
                label={t("contextMenu.detachViewer")}
                onClick={onDetach}
              >
                <PopOutIcon />
              </HeaderButton>
            ) : null}
            <HeaderButton
              label={stage ? "Shrink to a floating viewer" : "Expand"}
              onClick={() => fileViewer.toggleMode()}
            >
              {stage ? (
                <MinimizeIcon size={15} />
              ) : (
                <Maximize2 size={15} strokeWidth={1.75} />
              )}
            </HeaderButton>
          </>
        )}
        {detached && window.electronAPI?.platform === "darwin" ? null : (
          <HeaderButton
            label="Close"
            {...(detached ? {} : { shortcut: "Esc" })}
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.75} />
          </HeaderButton>
        )}
      </div>
    </header>
  );
}

function EdgeArrows({ nav }: { nav: ViewerNav | null }) {
  const t = useT();
  if (!nav || (!nav.canPrevious && !nav.canNext)) return null;
  const previousTip = nav.sets
    ? `${nav.previousLabel} (←) · ${t("shell.display.viewerStrip.previousSet")} (⇧←)`
    : `${nav.previousLabel} (←)`;
  const nextTip = nav.sets
    ? `${nav.nextLabel} (→) · ${t("shell.display.viewerStrip.nextSet")} (⇧→)`
    : `${nav.nextLabel} (→)`;
  return (
    <>
      <button
        type="button"
        className="file-viewer__edge"
        data-dir="previous"
        disabled={!nav.canPrevious}
        onClick={nav.previous}
        aria-label={previousTip}
        title={previousTip}
      >
        <ChevronLeft size={18} strokeWidth={2} />
      </button>
      <button
        type="button"
        className="file-viewer__edge"
        data-dir="next"
        disabled={!nav.canNext}
        onClick={nav.next}
        aria-label={nextTip}
        title={nextTip}
      >
        <ChevronRight size={18} strokeWidth={2} />
      </button>
    </>
  );
}

const useSiblingNav = (item: DisplayTab | null): ViewerNav | null => {
  const { items, index, sets } = useViewerSiblings(
    item?.id ?? "",
    item?.kind ?? "text",
  );
  const grouped = sets.length > 1;
  return useMemo(() => {
    if (!item || index === -1 || items.length < 2) return null;
    const previous = items[index - 1];
    const next = items[index + 1];
    return {
      canPrevious: Boolean(previous),
      canNext: Boolean(next),
      previous: () => previous && showSibling(item.id, previous),
      next: () => next && showSibling(item.id, next),
      previousLabel: "Previous",
      nextLabel: "Next",
      sets: grouped,
    };
  }, [grouped, index, item, items]);
};

const IMMEDIATE_KINDS: ReadonlySet<DisplayTab["kind"]> = new Set([
  "image",
  "video",
  "audio",
]);

const gestureStart = (event: ReactPointerEvent<HTMLElement>) => ({
  pointerId: event.pointerId,
  clientX: event.clientX,
  clientY: event.clientY,
  screenX: event.screenX,
  screenY: event.screenY,
});

const addItemMenu = (event: ReactMouseEvent, id: string): void => {
  const menu = viewerItems.menu(id);
  if (!menu) return;
  addContextMenu(event, menu, {
    claims: viewerItems.get(id).actions?.copy ? ["image"] : [],
  });
};

function ViewerSlot({ surface }: { surface: ViewerSurface }) {
  const attach = useCallback(
    (slot: HTMLDivElement | null) =>
      slot ? registerViewerSlot(surface, slot) : undefined,
    [surface],
  );
  return <div ref={attach} className="file-viewer__slot" />;
}

function ViewerMain({
  item,
  surface,
}: {
  item: DisplayTab | null;
  surface: ViewerSurface;
}) {
  const { nav: bodyNav } = useViewerItem(item?.id ?? null);
  const siblingNav = useSiblingNav(item);
  return (
    <div className="file-viewer__main">
      <div className="file-viewer__body">
        <ViewerSlot surface={surface} />
        <EdgeArrows nav={bodyNav ?? siblingNav} />
      </div>
      {item ? <ViewerStrip item={item} /> : null}
    </div>
  );
}

function DockedViewer({
  item,
  hiddenForExclusiveTab,
}: {
  item: DisplayTab | null;
  hiddenForExclusiveTab: boolean;
}) {
  const { mode, rect } = useFileViewer();
  const geo = useGeometry();
  const stage = mode === "stage";
  const floatRect = useMemo(
    () => clampFloatRect(rect ?? defaultFloatRect(geo), geo),
    [geo, rect],
  );
  const hidden = !item || (!stage && hiddenForExclusiveTab);
  const detachable = item?.kind !== "chat" && canDetachViewer();

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (stage || !item || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    event.preventDefault();
    dragViewer(gestureStart(event), item.id, floatRect, detachable);
  };

  const startResize =
    (edge: ResizeEdge) => (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const { cursor } = getComputedStyle(event.currentTarget);
      resizeViewer(gestureStart(event), cursor, floatRect, (dx, dy, start) => {
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
    };

  return (
    <div
      className="file-viewer"
      data-surface="docked"
      data-mode={mode}
      data-closed={item ? undefined : "true"}
      data-hidden={hidden ? "true" : undefined}
      role="dialog"
      aria-label={item?.title}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      onContextMenu={(event) => item && addItemMenu(event, item.id)}
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
      {item ? (
        <ViewerHeader
          item={item}
          placement={mode}
          onPointerDown={startDrag}
          onDetach={
            detachable ? () => void popOutViewer(item.id, floatRect) : null
          }
          onClose={() => fileViewer.close()}
        />
      ) : null}
      <ViewerMain item={item} surface={DOCKED} />
      {!stage
        ? RESIZE_EDGES.map((edge) => (
            <div
              key={edge}
              className="file-viewer__resize"
              data-edge={edge}
              onPointerDown={startResize(edge)}
              aria-hidden="true"
            />
          ))
        : null}
    </div>
  );
}

function DetachedViewerFrame({
  name,
  item,
}: {
  name: string;
  item: DisplayTab;
}) {
  const target = detachedWindows.get(name)?.window ?? window;

  useEffect(() => {
    target.document.title = item.title;
  }, [item.title, target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      stepViewer(event, target.document.querySelector(".file-viewer"));
    };
    target.document.addEventListener("keydown", onKey);
    return () => target.document.removeEventListener("keydown", onKey);
  }, [target]);

  return (
    <div
      className="file-viewer"
      data-surface="window"
      data-mode="window"
      data-platform={window.electronAPI?.platform}
      role="dialog"
      aria-label={item.title}
      onContextMenu={(event) => addItemMenu(event, item.id)}
    >
      <ViewerHeader
        item={item}
        placement="window"
        onDetach={null}
        onClose={() => fileViewer.closeDetached(name)}
        onDock={() => {
          window.electronAPI?.window?.show?.();
          flushSync(() => fileViewer.dock(name));
        }}
      />
      <ViewerMain item={item} surface={name} />
    </div>
  );
}

type PlacedBody = {
  item: DisplayTab;
  surface: ViewerSurface;
  active: boolean;
};

function ViewerBody({ item, surface, active }: PlacedBody) {
  const [host] = useState(createViewerHost);

  useLayoutEffect(() => {
    placeViewerHost(host, surface);
  }, [host, surface]);

  useEffect(() => {
    if (active) return;
    for (const media of host.querySelectorAll<HTMLMediaElement>("video, audio")) {
      if (!media.paused) media.pause();
    }
  }, [active, host]);

  useLayoutEffect(
    () => () => {
      viewerItems.setMenu(item.id, null);
      dropViewerHost(host);
    },
    [host, item.id],
  );

  return createPortal(
    <RetainedSurface
      active={active}
      className="file-viewer__item"
      onContextMenu={(event) => addItemMenu(event, item.id)}
    >
      <PortalContainerContext value={detachedWindows.get(surface)?.root ?? null}>
        <ViewerSurfaceContext value={surface}>
          <ViewerItemContext value={item.id}>
            <DeferredDisplayContent
              render={item.render}
              immediate={IMMEDIATE_KINDS.has(item.kind)}
            />
          </ViewerItemContext>
        </ViewerSurfaceContext>
      </PortalContainerContext>
    </RetainedSurface>,
    host,
    item.id,
  );
}

const NO_IDS: readonly string[] = [];
const MAX_WARM_VIEWERS = 8;
const MAX_WARM_FRAMES = 3;
const MAX_WARM_PDFS = 3;
const MAX_WARM_MEDIA = 2;

const warmBucketOf = (
  kind: DisplayTab["kind"],
): "skip" | "frame" | "pdf" | "media" | "light" => {
  switch (kind) {
    case "app":
    case "chat":
    case "home":
    case "trash":
      return "skip";
    case "canvas":
    case "url":
      return "frame";
    case "pdf":
      return "pdf";
    case "video":
    case "audio":
      return "media";
    default:
      return "light";
  }
};

const sameIdList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const trimWarmPool = (
  recent: readonly string[],
  openDocIds: ReadonlySet<string>,
  kindOf: (id: string) => DisplayTab["kind"] | null,
): readonly string[] => {
  const kept: string[] = [];
  let warmCount = 0;
  let frames = 0;
  let pdfs = 0;
  let media = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const id = recent[i]!;
    const kind = kindOf(id);
    if (!kind) continue;
    if (openDocIds.has(id)) {
      kept.push(id);
      continue;
    }
    const bucket = warmBucketOf(kind);
    if (bucket === "skip" || warmCount >= MAX_WARM_VIEWERS) continue;
    if (bucket === "frame" && frames >= MAX_WARM_FRAMES) continue;
    if (bucket === "pdf" && pdfs >= MAX_WARM_PDFS) continue;
    if (bucket === "media" && media >= MAX_WARM_MEDIA) continue;
    kept.push(id);
    warmCount += 1;
    if (bucket === "frame") frames += 1;
    else if (bucket === "pdf") pdfs += 1;
    else if (bucket === "media") media += 1;
  }
  kept.reverse();
  return kept;
};

/**
 * Keeps open document tabs plus a bounded LRU pool of recently viewed items
 * mounted and suspended in DOCKED so close -> reopen and sibling switches are
 * instantaneous without background playback or unbounded memory growth.
 */
const useKeptIds = (
  fileId: string | null,
  detached: readonly { name: string; fileId: string }[],
  tabs: readonly DisplayTab[],
  sidebarTabs: readonly SidebarTab[],
): readonly string[] => {
  const [recent, setRecent] = useState(NO_IDS);
  const prevDetachedRef = useRef<readonly string[]>(NO_IDS);
  const openDocIds = useMemo(
    () =>
      new Set(
        sidebarTabs.filter(isDocumentTab).map((tab) => tab.location as string),
      ),
    [sidebarTabs],
  );
  const detachedIds = useMemo(
    () => new Set(detached.map((viewer) => viewer.fileId)),
    [detached],
  );
  const closedDetached = new Set<string>();
  for (const prevId of prevDetachedRef.current) {
    if (!detachedIds.has(prevId) && prevId !== fileId) {
      closedDetached.add(prevId);
    }
  }
  prevDetachedRef.current = detached.map((viewer) => viewer.fileId);

  const kindById = useMemo(() => {
    const map = new Map<string, DisplayTab["kind"]>();
    for (const tab of tabs) map.set(tab.id, tab.kind);
    return map;
  }, [tabs]);

  let next = recent.filter(
    (id) => kindById.has(id) && !closedDetached.has(id),
  );
  if (fileId && kindById.has(fileId)) {
    next = [...next.filter((id) => id !== fileId), fileId];
  }
  const trimmed = trimWarmPool(
    next,
    openDocIds,
    (id) => kindById.get(id) ?? null,
  );
  if (!sameIdList(trimmed, recent)) {
    setRecent(trimmed);
  }
  return trimmed;
};

function Viewers({ hiddenForExclusiveTab }: { hiddenForExclusiveTab: boolean }) {
  const { fileId, mode, detached } = useFileViewer();
  const { tabs } = useDisplayTabList();
  const sidebarTabs = useSidebarOpenTabs();
  const kept = useKeptIds(fileId, detached, tabs, sidebarTabs);
  const itemOf = (id: string) => tabs.find((tab) => tab.id === id) ?? null;
  const item = fileId ? itemOf(fileId) : null;
  const dockedVisible = Boolean(item) && (mode === "stage" || !hiddenForExclusiveTab);

  useEffect(() => {
    void reopenViewerWindows();
  }, []);

  useEffect(() => {
    if (fileId && !item) fileViewer.close();
    for (const viewer of detached) {
      if (!tabs.some((tab) => tab.id === viewer.fileId)) {
        fileViewer.closeDetached(viewer.name);
      }
    }
  }, [detached, fileId, item, tabs]);

  const bodies: PlacedBody[] = [];
  for (const viewer of detached) {
    const shown = itemOf(viewer.fileId);
    if (!shown) continue;
    bodies.push({ item: shown, surface: viewer.name, active: true });
  }
  const dockedIds = fileId ? [...kept.filter((id) => id !== fileId), fileId] : kept;
  for (const id of dockedIds) {
    const shown = itemOf(id);
    if (!shown || bodies.some((body) => body.item.id === id)) continue;
    bodies.push({
      item: shown,
      surface: DOCKED,
      active: id === fileId && dockedVisible,
    });
  }
  bodies.sort((a, b) => a.item.ord - b.item.ord);
  const hasDocked = bodies.some((body) => body.surface === DOCKED);

  return (
    <>
      {hasDocked ? (
        <DockedViewer
          item={item}
          hiddenForExclusiveTab={hiddenForExclusiveTab}
        />
      ) : null}
      {detached.map(({ name, fileId: id }) => {
        const shown = itemOf(id);
        const root = detachedWindows.get(name)?.root;
        return shown && root
          ? createPortal(
              <PortalContainerContext value={root}>
                <ViewerSurfaceContext value={name}>
                  <DetachedViewerFrame name={name} item={shown} />
                </ViewerSurfaceContext>
              </PortalContainerContext>,
              root,
              name,
            )
          : null;
      })}
      {bodies.map((body) => (
        <ViewerBody key={body.item.id} {...body} />
      ))}
    </>
  );
}

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

function useViewerChatAttachment(
  item: DisplayTab,
): { added: boolean; toggle: () => void } | null {
  const chat = useChatRuntime();
  const { detail } = useViewerItem(item.id);
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
  if ("value" in el) return el.value === "";
  return (el.textContent ?? "").length === 0;
};

const setJumpTarget = (
  frame: Element | null,
  backwards: boolean,
): HTMLButtonElement | null => {
  const set = frame?.querySelector<HTMLElement>(
    ".viewer-strip__set[data-current='true']",
  );
  if (!set) return null;
  const first = set.querySelector<HTMLButtonElement>(".viewer-strip__item");
  if (backwards && first && first.dataset.current !== "true") return first;
  const neighbour = (
    backwards ? set.previousElementSibling : set.nextElementSibling
  ) as HTMLElement | null;
  return (
    neighbour?.querySelector<HTMLButtonElement>(".viewer-strip__item") ?? null
  );
};

const stepViewer = (event: KeyboardEvent, frame: Element | null): void => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (event.metaKey || event.altKey || event.ctrlKey) return;
  if (!frame || frame.getAttribute("data-hidden") === "true") return;
  if (isEditableTarget(event.target) && !editableIsEmpty(event.target)) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("video, audio, [role='slider']")) return;
  const backwards = event.key === "ArrowLeft";
  if (event.shiftKey) {
    const jump = setJumpTarget(frame, backwards);
    if (jump) {
      jump.click();
      event.preventDefault();
    }
    return;
  }
  const button = frame.querySelector<HTMLButtonElement>(
    `.file-viewer__edge[data-dir='${backwards ? "previous" : "next"}']`,
  );
  if (button && !button.disabled) {
    button.click();
    event.preventDefault();
  }
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
      const tabStageVisible = useTabStageVisible();
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

      useEffect(() => {
        if (panelOpen && !activeTab) displayTabs.setPanelOpen(false);
      }, [activeTab, panelOpen]);

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
          if (viewerState.fileId) {
            stepViewer(
              event,
              document.querySelector(".file-viewer[data-surface='docked']"),
            );
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
          <Viewers hiddenForExclusiveTab={exclusiveTabShown} />
        </>,
        target,
      );
    },
  ),
);
