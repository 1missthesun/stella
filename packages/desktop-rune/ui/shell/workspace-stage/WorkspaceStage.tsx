import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { type DisplayTabPayload, normalizeDisplayPayload } from "@stella/contracts/desktop/display-payload";
import { driveLinkTarget } from "@stella/contracts/cloud-world-paths";
import type { ChatContext } from "@/shared/types/electron";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { getComposerAppSelections } from "@/features/chat/composer-context";
import { detachedWindows } from "../../replace/features/workspace-display/detached-windows";
import { DOCKED, fileViewer, isExclusiveStageSection, useFileViewer, VIEWER_SELECTION_SURFACE, type FileViewerMode, type FileViewerRect, type ViewerSurface } from "@/features/workspace-display/file-viewer-store";
import { useViewerItem, viewerItems, type ViewerNav } from "@/features/workspace-display/viewer-items";
import { useTabStageVisible } from "@/features/workspace-display/tab-stage-visible";
import { addAgentDisplayPayload, openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { isDocumentTab, sidebarSections, useSidebarActiveTabId, useSidebarOpenTabs, type SidebarTab } from "@/features/workspace-display/sidebar-sections";
import { displayTabs, useDisplayPanelOpen, useDisplayTabList } from "@/features/workspace-display/tab-store";
import type { DisplayTab } from "@/features/workspace-display/types";
import { publicDriveLink, publicFileLink } from "@/features/cloud/file-share-link";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { translateNow, useT } from "@/shared/i18n";
import { fileMenu, linkMenu, type MenuBuilder, type MenuSection } from "@/platform/context-menu";
import { ViewerItemContext, ViewerSurfaceContext } from "@/shell/workspace-stage/viewer-item-context";
import { clampFloatRect, defaultFloatRect, FLOAT_MIN_HEIGHT, FLOAT_MIN_WIDTH, stageBottom, useGeometry, useGeometryTracking, type Geometry } from "../../replace/shell/workspace-stage/viewer-geometry";
import { canDetachViewer, popOutViewer, reopenViewerWindows, setViewerWindowBackground } from "../../replace/shell/workspace-stage/viewer-windows";
import { showSibling, useViewerSiblings } from "@/shell/workspace-stage/viewer-siblings";
import { DisplayTabIcon } from "../../features/workspace-display/icons";
import { DropdownMenu, Icon, Icons, ManualCopyField, MenuItem, MenuSeparator, RetainedSurface, withStroke, type IconData } from "../../kit";
import { look, mixOklch, useTokens, derive, type Tokens } from "../../theme";
import { useHostWindows, HostWindow } from "../../host/HostWindows";
import { SHELL_TOPBAR_HEIGHT } from "../metrics";
import { useWindowKeys } from "../window-keys";
import { popupMenuBuilder } from "../menu-sections";
import { useOpenTabNotch } from "../topbar/open-tab-notch";
import { SidebarSectionBody } from "../sidebar-sections/SidebarSectionBody";
import { DeferredDisplayContent } from "../sidebar-sections/DeferredDisplayContent";
import { ViewerStrip } from "./ViewerStrip";
import { stepViewer } from "./sibling-nav";
import { startViewerDrag, viewerTear, type HeldViewer } from "./viewer-drag";

type ChatAppSelection = NonNullable<ChatContext["appSelections"]>[number];

export interface WorkspaceStageHandle {
  open(payload: DisplayTabPayload): void;
  update(payload: DisplayTabPayload, opts?: { tab?: boolean }): void;
  close(): void;
}

const STAGE_INSET = 20;
const STAGE_RADIUS = 14;
const STAGE_TOP = SHELL_TOPBAR_HEIGHT - 1;
/** `@container file-viewer (min-width: 760px)`: the strip moves to the left edge and stands up. */
const WIDE_VIEWER = 760;
const NARROW_VIEWER = 460;

const glyph = (name: string, d: string[]): IconData => ({
  name: `viewer/${name}`,
  view: 24,
  body: `<g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d.map((p) => `<path d="${p}"/>`).join("")}</g>`,
});
const MinimizeIcon = glyph("minimize", ["M4.5 14H10v5.5M4.75 19.25 10.5 13.5M19.5 10H14V4.5M19.25 4.75 13.5 10.5"]);
const PopOutIcon = glyph("pop-out", ["M10 5.25H7A2.75 2.75 0 0 0 4.25 8v9A2.75 2.75 0 0 0 7 19.75h9A2.75 2.75 0 0 0 18.75 17v-3", "M13.75 4.25h6v6M19.5 4.5l-7.25 7.25"]);
const DockIcon = glyph("dock", ["M10 5.25H7A2.75 2.75 0 0 0 4.25 8v9A2.75 2.75 0 0 0 7 19.75h9A2.75 2.75 0 0 0 18.75 17v-3", "M12.25 5.75v6h6M12.5 11.5l7.25-7.25"]);

const stageLook = (t: Tokens) =>
  derive(t, "workspace-stage", (t) => ({
    edge: t.vars["--panel-surface-border"] ?? t.c.borderBase,
    highlight: t.vars["--panel-surface-highlight-color"] ?? "#00000000",
    actionHover: mixOklch(t.c.foreground, 7, "transparent"),
    edgeFill: mixOklch(t.c.background, 72, "transparent"),
    divider: t.c.borderWeak,
  }));

/** The rect the stage (and a stage-mode viewer) fills, in the window. */
const stageInsets = (geo: Geometry) => ({ left: STAGE_INSET, top: STAGE_TOP, right: STAGE_INSET, bottom: stageBottom(geo) });

/** The stage's top edge opens where the topbar's open tab stands on it. */
function StageEdge({ fill }: { fill: string }) {
  const notch = useOpenTabNotch();
  if (!notch) return null;
  const left = Math.max(0, notch.left - STAGE_INSET);
  const right = Math.max(0, notch.right - STAGE_INSET);
  if (right <= left) return null;
  return <box absolute={{ left, top: -1 }} w={right - left} h={1} fill={fill} inert />;
}

const useDelayedHidden = (visible: boolean, ms: number) => {
  const [hidden, setHidden] = useState(!visible);
  useEffect(() => {
    if (visible) {
      setHidden(false);
      return;
    }
    const timer = setTimeout(() => setHidden(true), ms);
    return () => clearTimeout(timer);
  }, [visible, ms]);
  return hidden;
};

function TabStage({ visible }: { visible: boolean }) {
  const t = useTokens();
  const l = stageLook(t);
  const geo = useGeometry();
  const hidden = useDelayedHidden(visible, 120);
  return (
    <col
      id="workspace-stage"
      absolute={stageInsets(geo)}
      fill={t.c.background}
      border={l.edge}
      radius={STAGE_RADIUS}
      shadows={t.shadow.lg}
      opacity={visible ? 1 : 0}
      motion={{ dur: visible ? 0.16 : 0.12 }}
      hidden={hidden}
      inert={!visible}
      label={visible ? undefined : ""}
    >
      <col id="workspace-stage-body" grow={1} minH={0} clip={STAGE_RADIUS}>
        <RetainedSurface active={visible} grow={1}>
          <SidebarSectionBody />
        </RetainedSurface>
      </col>
      <StageEdge fill={t.c.background} />
    </col>
  );
}

function HeaderButton({ id, label, shortcut, onPress, disabled, pressed, icon, size = 15, text, narrow }: { id: string; label: string; shortcut?: string; onPress: () => void; disabled?: boolean; pressed?: boolean; icon: IconData; size?: number; text?: string; narrow?: boolean }) {
  const t = useTokens();
  const l = stageLook(t);
  const tip = shortcut ? `${label} (${shortcut})` : label;
  const labelled = Boolean(text) && !narrow;
  const color = pressed ? t.c.textStrong : t.c.textMuted;
  return (
    <row
      id={id}
      role="button"
      label={tip}
      title={tip}
      checked={pressed}
      disabled={disabled}
      focusable={!disabled}
      h={28}
      w={labelled ? undefined : 28}
      pl={labelled ? 7 : 0}
      pr={labelled ? 9 : 0}
      gap={5}
      align="center"
      justify="center"
      radius={6}
      hover={disabled ? undefined : l.actionHover}
      hoverGroup
      opacity={disabled ? 0.35 : 1}
      focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 6 }}
      motion={{ dur: 0.12 }}
      noWindowDrag
      onPress={disabled ? undefined : onPress}
    >
      <Icon icon={icon} size={size} color={color} />
      {labelled ? (
        <text {...look(11, 500)} nowrap color={color} hoverColor={t.c.textStrong}>
          {text}
        </text>
      ) : null}
    </row>
  );
}

const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() || path;

const payloadPath = (payload: DisplayTabPayload | undefined): string | null => {
  if (!payload) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.filePath === "string") return record.filePath;
  if (payload.kind === "media") {
    const asset = payload.asset as Record<string, unknown>;
    if (typeof asset.filePath === "string") return asset.filePath;
    if (Array.isArray(asset.filePaths) && typeof asset.filePaths[0] === "string") return asset.filePaths[0];
  }
  if (payload.kind === "url" && typeof record.url === "string") return record.url;
  return null;
};

const localFilePath = (payload: DisplayTabPayload | undefined): string | null => (payload?.kind === "url" ? null : payloadPath(payload));

const readFileBlob = async (path: string): Promise<Blob | null> => {
  const read = await window.electronAPI?.display?.readFile?.(path, { conversationId: null });
  if (!read || read.missing) return null;
  const bytes = read.bytes;
  const part = bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes);
  return new Blob([part], { type: read.mimeType || "application/octet-stream" });
};

const errorText = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback);

type Placement = FileViewerMode | "window";

function ViewerHeader({ item, placement, width, onDrag, onDetach, onClose, onDock }: { item: DisplayTab; placement: Placement; width: number; onDrag?: (d: DragEvent) => void; onDetach: (() => void) | null; onClose: () => void; onDock?: () => void }) {
  const t = useT();
  const tk = useTokens();
  const l = stageLook(tk);
  const stage = placement === "stage";
  const detached = placement === "window";
  const narrow = width <= NARROW_VIEWER;
  const { detail: meta, actions } = useViewerItem(item.id);
  const drivePath = item.payload?.cloudDrivePath ?? null;
  const path = drivePath ?? payloadPath(item.payload);
  const filePath = drivePath ? null : localFilePath(item.payload);
  const attachment = useViewerChatAttachment(item);
  const [status, setStatus] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const idBase = `file-viewer-${placement === "window" ? "window" : "docked"}`;

  useEffect(() => {
    setStatus(null);
    setManualLink(null);
    setArmed(false);
  }, [item.id]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 2200);
    return () => clearTimeout(timer);
  }, [status]);

  const canSave = Boolean(filePath && window.electronAPI?.system?.saveFileAs);

  const download = useCallback(async () => {
    if (!filePath) return;
    const result = await window.electronAPI?.system?.saveFileAs?.(filePath, fileNameOf(filePath));
    if (!result || result.canceled) return;
    setStatus(result.ok ? "Saved" : (result.error ?? "Couldn't save"));
  }, [filePath]);

  const canShare = Boolean(drivePath || filePath) && item.kind !== "canvas";
  const share = useCallback(() => {
    if (sharing) return;
    const link = drivePath
      ? publicDriveLink(drivePath)
      : filePath
        ? publicFileLink(filePath, null).catch(async () => publicFileLink(filePath, await readFileBlob(filePath)))
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
    if (await copyTextToClipboard(path)) setStatus(item.payload?.kind === "url" ? "Link copied" : "Path copied");
    else setManualLink(path);
  }, [item.payload?.kind, path]);

  const remove = actions?.remove;
  const hasMenu = Boolean(actions?.copy || path || remove);

  const buildMenu: MenuBuilder = async () => {
    const sections: MenuSection[] = [];
    if (actions?.copy) sections.push([{ label: actions.copyLabel ?? translateNow("contextMenu.copy"), run: copyBody }]);
    if (item.payload?.kind === "url" && path) {
      sections.push(linkMenu(path).slice(1));
    } else if (filePath || drivePath) {
      sections.push(
        ...(await fileMenu(drivePath ? driveLinkTarget(drivePath) : filePath!, {
          addToChat: attachment
            ? { label: attachment.added ? translateNow("contextMenu.removeFromChat") : translateNow("contextMenu.addToChat"), run: attachment.toggle }
            : null,
        })()),
      );
      sections.push([{ label: translateNow("contextMenu.copyPublicLink"), run: share }]);
    }
    sections.push([
      ...(detached
        ? [{ label: t("contextMenu.dockViewer"), run: () => onDock?.() }]
        : [
            { label: stage ? t("contextMenu.shrinkViewer") : t("contextMenu.expandViewer"), run: () => fileViewer.toggleMode() },
            ...(onDetach ? [{ label: t("contextMenu.detachViewer"), run: onDetach }] : []),
          ]),
      { label: t("contextMenu.closeViewer"), run: onClose },
    ]);
    return sections;
  };
  useLayoutEffect(() => {
    viewerItems.setMenu(item.id, buildMenu);
  });

  const title = path ? `${item.title}\n${path}` : (item.tooltip ?? item.title);
  return (
    <row
      id={`${idBase}-header`}
      h={40}
      shrink={false}
      align="center"
      gap={8}
      pl={detached && window.electronAPI?.platform === "darwin" ? 78 : 14}
      pr={6}
      cursor={stage || detached ? undefined : "grab"}
      windowDrag={detached || undefined}
      onDrag={onDrag}
      onDoublePress={detached ? undefined : () => fileViewer.toggleMode()}
    >
      <DisplayTabIcon kind={item.kind} size={15} color={tk.c.textWeak} />
      <text {...look(12, 600)} color={tk.c.textStrong} nowrap truncate shrink minW={0} maxW={34 * 7} title={title}>
        {item.title}
      </text>
      {manualLink ? (
        <box grow={1} shrink minW={0} enter="fade">
          <ManualCopyField id={`${idBase}-manual-copy`} value={manualLink} label="Couldn't copy. Select this and copy it." />
        </box>
      ) : status ? (
        <text {...look(11, 400)} color={tk.c.textWeak} nowrap truncate shrink minW={0} role="status" enter="fade">
          {status}
        </text>
      ) : meta ? (
        <text {...look(11, 400)} color={tk.c.textWeak} nowrap shrink={false}>
          {meta}
        </text>
      ) : null}
      <box grow={1} />
      <row gap={2} align="center" shrink={false} noWindowDrag>
        {attachment ? (
          <HeaderButton
            id={`${idBase}-attach`}
            label={attachment.added ? "In chat · click to remove it from your message" : "Add to chat · attach to your next message"}
            onPress={attachment.toggle}
            pressed={attachment.added}
            text={attachment.added ? "In chat" : "Add to chat"}
            narrow={narrow}
            icon={withStroke(attachment.added ? Icons.stella.Check : Icons.stella.Plus, 1.9)}
          />
        ) : null}
        {canSave ? <HeaderButton id={`${idBase}-download`} label="Download" onPress={() => void download()} icon={withStroke(Icons.stella.Download, 1.75)} /> : null}
        {canShare ? (
          <HeaderButton id={`${idBase}-share`} label="Share · copy a public link anyone can open" onPress={share} disabled={sharing} icon={withStroke(sharing ? Icons.stella.LoaderCircle : Icons.stella.Share, 1.75)} />
        ) : null}
        {hasMenu ? (
          <DropdownMenu
            id={`${idBase}-menu`}
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open);
              if (!open) setArmed(false);
            }}
            align="end"
            sideOffset={6}
            trigger={(trigger) => (
              <row
                id={trigger.id}
                role="button"
                label="More"
                title="More"
                focusable
                w={28}
                h={28}
                center
                radius={6}
                fill={trigger.open ? l.actionHover : undefined}
                hover={l.actionHover}
                onPress={trigger.toggle}
              >
                <Icon icon={withStroke(Icons.stella.MoreHorizontal, 1.75)} size={15} color={trigger.open ? tk.c.textStrong : tk.c.textMuted} />
              </row>
            )}
          >
            {actions?.copy ? (
              <MenuItem icon={Icons.stella.Copy} onSelect={() => void copyBody()}>
                {actions.copyLabel ?? "Copy"}
              </MenuItem>
            ) : null}
            {path ? (
              <MenuItem icon={Icons.stella.Link} onSelect={() => void copyPath()}>
                {item.payload?.kind === "url" ? "Copy link" : "Copy path"}
              </MenuItem>
            ) : null}
            {remove ? (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={Icons.stella.Trash2}
                  destructive
                  keepOpen={!armed}
                  onSelect={() => {
                    if (!armed) {
                      setArmed(true);
                      return;
                    }
                    remove();
                  }}
                >
                  {armed ? "Click again to delete" : "Delete"}
                </MenuItem>
              </>
            ) : null}
          </DropdownMenu>
        ) : null}
        <box w={1} h={16} mx={4} fill={l.divider} />
        {detached ? (
          <HeaderButton id={`${idBase}-dock`} label={t("contextMenu.dockViewer")} onPress={() => onDock?.()} icon={DockIcon} />
        ) : (
          <>
            {onDetach ? <HeaderButton id={`${idBase}-detach`} label={t("contextMenu.detachViewer")} onPress={onDetach} icon={PopOutIcon} /> : null}
            <HeaderButton
              id={`${idBase}-mode`}
              label={stage ? "Shrink to a floating viewer" : "Expand"}
              onPress={() => fileViewer.toggleMode()}
              icon={stage ? MinimizeIcon : withStroke(Icons.stella.Maximize2, 1.75)}
            />
          </>
        )}
        {detached && window.electronAPI?.platform === "darwin" ? null : (
          <HeaderButton id={`${idBase}-close`} label="Close" {...(detached ? {} : { shortcut: "Esc" })} onPress={onClose} icon={withStroke(Icons.stella.X, 1.75)} size={16} />
        )}
      </row>
    </row>
  );
}

function EdgeArrows({ nav, idBase }: { nav: ViewerNav | null; idBase: string }) {
  const t = useT();
  const tk = useTokens();
  const l = stageLook(tk);
  if (!nav || (!nav.canPrevious && !nav.canNext)) return null;
  const previousTip = nav.sets ? `${nav.previousLabel} (←) · ${t("shell.display.viewerStrip.previousSet")} (⇧←)` : `${nav.previousLabel} (←)`;
  const nextTip = nav.sets ? `${nav.nextLabel} (→) · ${t("shell.display.viewerStrip.nextSet")} (⇧→)` : `${nav.nextLabel} (→)`;
  const arrow = (dir: "previous" | "next", tip: string, enabled: boolean, run: () => void) => (
    <row absolute={dir === "previous" ? { left: 14 } : { right: 22 }} h="full" align="center" inert={!enabled}>
      <box
        id={`${idBase}-edge-${dir}`}
        role="button"
        label={tip}
        title={tip}
        focusable={enabled}
        w={36}
        h={36}
        radius={18}
        center
        fill={l.edgeFill}
        hover={tk.c.background}
        backdropBlur={10}
        shadows={[{ x: 0, y: 0, blur: 0, spread: 1, color: tk.c.borderBase }, ...tk.shadow.sm]}
        hoverOpacity={enabled ? [0, 1] : [0, 0]}
        motion={{ dur: 0.15 }}
        onPress={enabled ? run : undefined}
      >
        <Icon icon={withStroke(dir === "previous" ? Icons.stella.ChevronLeft : Icons.stella.ChevronRight, 2)} size={18} color={tk.c.textStrong} />
      </box>
    </row>
  );
  return (
    <>
      {arrow("previous", previousTip, nav.canPrevious, nav.previous)}
      {arrow("next", nextTip, nav.canNext, nav.next)}
    </>
  );
}

const useSiblingNav = (item: DisplayTab | null): ViewerNav | null => {
  const { items, index, sets } = useViewerSiblings(item?.id ?? "", item?.kind ?? "text");
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

const STEP_CHORDS = ["ArrowLeft", "ArrowRight", "shift+ArrowLeft", "shift+ArrowRight"];
const STAGE_CHORDS = ["Escape", ...STEP_CHORDS];

const IMMEDIATE_KINDS: ReadonlySet<DisplayTab["kind"]> = new Set(["image", "video", "audio"]);

const itemMenu = (id: string, at: { x: number; y: number }, windowId?: string) => {
  const menu = viewerItems.menu(id);
  if (menu) void popupMenuBuilder(menu, { ...at, window: windowId });
};

function ViewerBody({ item, surface, active }: { item: DisplayTab; surface: ViewerSurface; active: boolean }) {
  useLayoutEffect(() => () => viewerItems.setMenu(item.id, null), [item.id]);
  return (
    <RetainedSurface id={`file-viewer-item-${surface === DOCKED ? "docked" : "window"}-${item.id}`} active={active} layered>
      <ViewerSurfaceContext value={surface}>
        <ViewerItemContext value={item.id}>
          <DeferredDisplayContent render={item.render} immediate={IMMEDIATE_KINDS.has(item.kind)} />
        </ViewerItemContext>
      </ViewerSurfaceContext>
    </RetainedSurface>
  );
}

function ViewerMain({ item, bodies, surface, wide, idBase }: { item: DisplayTab | null; bodies: PlacedBody[]; surface: ViewerSurface; wide: boolean; idBase: string }) {
  const { nav: bodyNav } = useViewerItem(item?.id ?? null);
  const siblingNav = useSiblingNav(item);
  const Main = wide ? "row" : "col";
  return (
    <Main grow={1} minW={0} minH={0}>
      {item && wide ? <ViewerStrip item={item} vertical /> : null}
      <col id={`${idBase}-body`} grow={1} minW={0} minH={0} clip={0}>
        {bodies.filter((body) => body.surface === surface).map((body) => (
          <ViewerBody key={body.item.id} {...body} />
        ))}
        <EdgeArrows nav={bodyNav ?? siblingNav} idBase={idBase} />
      </col>
      {item && !wide ? <ViewerStrip item={item} vertical={false} /> : null}
    </Main>
  );
}

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
type DragEvent = { phase: string; dx: number; dy: number; x: number; y: number };

const edgeBox = (edge: ResizeEdge) => {
  switch (edge) {
    case "n":
      return { absolute: { left: 12, right: 12, top: -3 }, h: 8 };
    case "s":
      return { absolute: { left: 12, right: 12, bottom: -3 }, h: 8 };
    case "e":
      return { absolute: { top: 12, bottom: 12, right: -3 }, w: 8 };
    case "w":
      return { absolute: { top: 12, bottom: 12, left: -3 }, w: 8 };
    case "ne":
      return { absolute: { top: 0, right: 0 }, w: 14, h: 14 };
    case "nw":
      return { absolute: { top: 0, left: 0 }, w: 14, h: 14 };
    case "se":
      return { absolute: { bottom: 0, right: 0 }, w: 14, h: 14 };
    case "sw":
      return { absolute: { bottom: 0, left: 0 }, w: 14, h: 14 };
  }
};

const resized = (edge: ResizeEdge, start: FileViewerRect, dx: number, dy: number): FileViewerRect => {
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
};

function DockedViewer({ item: docked, carried, bodies, hiddenForExclusiveTab }: { item: DisplayTab | null; carried: DisplayTab | null; bodies: PlacedBody[]; hiddenForExclusiveTab: boolean }) {
  const item = docked ?? carried;
  const t = useTokens();
  const l = stageLook(t);
  const { mode, rect } = useFileViewer();
  const geo = useGeometry();
  const stage = mode === "stage";
  const floatRect = useMemo(() => clampFloatRect(rect ?? defaultFloatRect(geo), geo), [geo, rect]);
  const [live, setLive] = useState<FileViewerRect | null>(null);
  const [held, setHeld] = useState<HeldViewer | null>(null);
  const gesture = useRef<{ start: FileViewerRect } | null>(null);
  const carry = useRef<ReturnType<typeof startViewerDrag> | null>(null);
  const hidden = !item || (!stage && hiddenForExclusiveTab) || !docked;
  const detachable = item?.kind !== "chat" && canDetachViewer();
  const shown = live ?? floatRect;
  const width = stage ? geo.viewportWidth - STAGE_INSET * 2 : shown.width;

  useEffect(() => {
    setViewerWindowBackground(t.c.background);
  }, [t.c.background]);

  const onHeaderDrag = (d: DragEvent) => {
    if (stage || !item) return;
    if (d.phase === "start") {
      carry.current = startViewerDrag(item.id, floatRect, { x: d.x, y: d.y }, detachable, setHeld);
      return;
    }
    const drag = carry.current;
    if (!drag) return;
    if (d.phase === "end" || d.phase === "cancel") {
      carry.current = null;
      drag.end();
      setHeld(null);
      return;
    }
    setHeld(drag.move({ x: d.x, y: d.y }));
  };

  const onResize = (edge: ResizeEdge) => (d: DragEvent) => {
    if (d.phase === "start") {
      gesture.current = { start: floatRect };
      setLive(floatRect);
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const next = clampFloatRect(resized(edge, g.start, d.dx, d.dy), geo);
    if (d.phase === "end" || d.phase === "cancel") {
      gesture.current = null;
      setLive(null);
      fileViewer.setRect(next);
      return;
    }
    setLive(next);
  };

  const frame = stage
    ? { absolute: stageInsets(geo) }
    : held
      ? { absolute: { left: held.rect.x, top: held.rect.y }, w: held.rect.width, h: held.rect.height, x: held.dx, y: held.dy, scale: held.scale, origin: [held.grab.x / held.rect.width, held.grab.y / held.rect.height] as [number, number] }
      : { absolute: { left: shown.x, top: shown.y }, w: shown.width, h: shown.height };

  return (
    <col
      id="file-viewer-docked"
      key={item ? "open" : "closed"}
      role="dialog"
      label={item?.title}
      {...frame}
      fill={t.c.background}
      border={l.edge}
      radius={STAGE_RADIUS}
      clip={STAGE_RADIUS}
      shadows={stage ? t.shadow.lg : [...t.shadow.xl, { x: 0, y: 1, blur: 0, spread: 0, color: l.highlight, inset: true }]}
      hidden={hidden}
      inert={hidden}
      enter={item ? { opacity: 0, y: 8, scale: 0.985, dur: 0.18 } : undefined}
      motion={held || live ? { dur: 0 } : { dur: 0.26 }}
      onContextMenu={item ? (at) => itemMenu(item.id, at) : undefined}
    >
      {item ? (
        <ViewerHeader
          item={item}
          placement={mode}
          width={width}
          onDrag={onHeaderDrag}
          onDetach={detachable ? () => void popOutViewer(item.id, floatRect) : null}
          onClose={() => fileViewer.close()}
        />
      ) : null}
      <ViewerMain item={item} bodies={bodies} surface={DOCKED} wide={width >= WIDE_VIEWER} idBase="file-viewer-docked" />
      {!stage ? RESIZE_EDGES.map((edge) => <box key={edge} id={`file-viewer-resize-${edge}`} {...edgeBox(edge)} cursor={edge === "n" || edge === "s" ? "nsResize" : edge === "e" || edge === "w" ? "ewResize" : edge === "ne" || edge === "sw" ? "neswResize" : "nwseResize"} onDrag={onResize(edge)} />) : null}
      {stage ? <StageEdge fill={t.c.background} /> : null}
    </col>
  );
}

function DetachedViewerFrame({ name, item, bodies }: { name: string; item: DisplayTab; bodies: PlacedBody[] }) {
  const t = useTokens();
  const windows = useHostWindows();
  const snapshot = windows.find((w) => w.frameName === name);
  const [width, setWidth] = useState(snapshot?.bounds.width ?? 800);
  if (!snapshot) return null;
  const dock = () => {
    window.electronAPI?.window?.show?.();
    flushSync(() => fileViewer.dock(name));
  };
  return stella.windowPortal(
    <HostWindow window={{ ...snapshot, title: item.title }} chrome={{ titlebar: 40, trafficLights: window.electronAPI?.platform === "darwin" ? [13, 13] : undefined, dark: t.dark }}>
      <col
        id="file-viewer-window"
        role="dialog"
        label={item.title}
        w="full"
        h="full"
        fill={t.c.background}
        keys={STEP_CHORDS}
        onKey={(k) => stepViewer(k.chord, item.id)}
        onLayout={(r) => setWidth(r.w)}
        onContextMenu={(at) => itemMenu(item.id, at, snapshot.engineId)}
      >
        <ViewerHeader item={item} placement="window" width={width} onDetach={null} onClose={() => fileViewer.closeDetached(name)} onDock={dock} />
        <ViewerMain item={item} bodies={bodies} surface={name} wide={width >= WIDE_VIEWER} idBase="file-viewer-window" />
      </col>
    </HostWindow>,
    name,
  );
}

type PlacedBody = { item: DisplayTab; surface: ViewerSurface; active: boolean };

const NO_IDS: readonly string[] = [];

/** Documents and apps with a tab keep running once shown, until it closes. */
const useKeptIds = (fileId: string | null, sidebarTabs: readonly SidebarTab[]): readonly string[] => {
  const [kept, setKept] = useState(NO_IDS);
  const open = useMemo(() => new Set(sidebarTabs.filter(isDocumentTab).map((tab) => tab.location as string)), [sidebarTabs]);
  const current = kept.filter((id) => open.has(id));
  const next = fileId && open.has(fileId) && !current.includes(fileId) ? [...current, fileId] : current;
  if (next.length !== kept.length || next.some((id, i) => id !== kept[i])) setKept(next);
  return next;
};

function Viewers({ hiddenForExclusiveTab }: { hiddenForExclusiveTab: boolean }) {
  const { fileId, detached } = useFileViewer();
  const { tabs } = useDisplayTabList();
  const sidebarTabs = useSidebarOpenTabs();
  const kept = useKeptIds(fileId, sidebarTabs);
  const itemOf = (id: string) => tabs.find((tab) => tab.id === id) ?? null;
  const item = fileId ? itemOf(fileId) : null;

  useEffect(() => {
    void reopenViewerWindows();
  }, []);

  useEffect(() => {
    if (fileId && !item) fileViewer.close();
    for (const viewer of detached) {
      if (!tabs.some((tab) => tab.id === viewer.fileId)) fileViewer.closeDetached(viewer.name);
    }
  }, [detached, fileId, item, tabs]);

  const bodies: PlacedBody[] = [];
  for (const viewer of detached) {
    const shown = itemOf(viewer.fileId);
    if (shown) bodies.push({ item: shown, surface: viewer.name, active: true });
  }
  const dockedIds = fileId ? [...kept.filter((id) => id !== fileId), fileId] : kept;
  for (const id of dockedIds) {
    const shown = itemOf(id);
    if (!shown || bodies.some((body) => body.item.id === id)) continue;
    bodies.push({ item: shown, surface: DOCKED, active: id === fileId });
  }
  bodies.sort((a, b) => a.item.ord - b.item.ord);
  const tearing = useSyncExternalStore(viewerTear.subscribe, viewerTear.get);
  const carried = tearing && !item ? itemOf(tearing) : null;
  const hasDocked = bodies.some((body) => body.surface === DOCKED) || Boolean(carried);

  return (
    <>
      {hasDocked ? <DockedViewer item={item} carried={carried} bodies={bodies} hiddenForExclusiveTab={hiddenForExclusiveTab} /> : null}
      {detached.map(({ name, fileId: id }) => {
        const shown = itemOf(id);
        return shown && detachedWindows.has(name) ? (
          <ViewerSurfaceContext key={name} value={name}>
            <DetachedViewerFrame name={name} item={shown} bodies={bodies} />
          </ViewerSurfaceContext>
        ) : null;
      })}
    </>
  );
}

const withViewerSelection = (prev: ChatContext | null, itemId: string, selection: ChatAppSelection | null): ChatContext | null => {
  const current = getComposerAppSelections(prev);
  const others = current.filter((entry) => entry.surface !== VIEWER_SELECTION_SURFACE || entry.anchor?.path !== itemId);
  return { ...(prev ?? { window: null }), appSelection: null, appSelections: selection ? [...others, selection] : others };
};

function useViewerChatAttachment(item: DisplayTab): { added: boolean; toggle: () => void } | null {
  const chat = useChatRuntime();
  const { detail } = useViewerItem(item.id);
  const setChatContext = chat.composer.setChatContext;
  const added = getComposerAppSelections(chat.composer.chatContext).some((entry) => entry.surface === VIEWER_SELECTION_SURFACE && entry.anchor?.path === item.id);
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
        snapshot: [`The user attached this from Stella's viewer: ${label}.`, path ? `Location: ${path}` : null].filter(Boolean).join("\n"),
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


export const WorkspaceStage = memo(
  forwardRef<WorkspaceStageHandle, { children?: ReactNode }>(function WorkspaceStage(_props, ref) {
    const panelOpen = useDisplayPanelOpen();
    const sidebarTabs = useSidebarOpenTabs();
    const activeTabId = useSidebarActiveTabId();
    const activeTab = sidebarTabs.find((tab) => tab.id === activeTabId) ?? null;
    const tabStageVisible = useTabStageVisible();
    const viewer = useFileViewer();
    const exclusiveTabShown = tabStageVisible && isExclusiveStageSection(activeTab?.kind);

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
      if (tabStageVisible && activeTab?.unread) sidebarSections.activateTab(activeTab.id);
    }, [activeTab, tabStageVisible]);

    useGeometryTracking(tabStageVisible || Boolean(viewer.fileId));

    useWindowKeys(STAGE_CHORDS, (e) => {
      const viewerState = fileViewer.getSnapshot();
      if (e.chord === "Escape") {
        if (viewerState.fileId) {
          fileViewer.close();
          return;
        }
        if (!displayTabs.getLayoutSnapshot().panelOpen) return false;
        displayTabs.setPanelOpen(false);
        return;
      }
      if (!viewerState.fileId) return false;
      return stepViewer(e.chord, viewerState.fileId);
    });

    return (
      <>
        <TabStage visible={tabStageVisible} />
        <Viewers hiddenForExclusiveTab={exclusiveTabShown} />
      </>
    );
  }),
);

