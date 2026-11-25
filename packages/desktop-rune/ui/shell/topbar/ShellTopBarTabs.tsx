import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { openTabNotch } from "./open-tab-notch";
import { useWindowKeys } from "../window-keys";

const TAB_CHORDS = ["mod+t", ...Array.from({ length: 9 }, (_, i) => `mod+${i + 1}`)];
import { fileViewer, useFileViewer } from "@/features/workspace-display/file-viewer-store";
import { fileNameFromDisplayTabId, isDocumentTab, sidebarSections, useSidebarActiveTabId, useSidebarOpenTabs, type SidebarTab } from "@/features/workspace-display/sidebar-sections";
import { displayTabs, useDisplayPanelOpen, useDisplayTabList } from "@/features/workspace-display/tab-store";
import { cloudAppTitles } from "@/features/cloud/cloud-app-title-store";
import { cloudAppIdFromLocation } from "@/features/cloud/open-cloud-app-panel";
import { openDocumentTab } from "@/shell/sidebar-sections/open-document-tab";
import { SIDEBAR_SECTION_META } from "@/shell/sidebar-sections/section-meta";
import { displaySearchStore } from "@/features/workspace-display/display-search-store";
import { useEmailUnseenCount } from "@/features/email/email-unseen";
import { Icons, type IconData } from "../../kit";
import { derive, fontSize, look, mixOklch, useTokens, type Tokens } from "../../theme";
import { DisplayTabIcon } from "../../features/workspace-display/icons";
import { SHELL_TOPBAR_HEIGHT } from "../metrics";
import { GroupIcon } from "./chrome";
import { NewTabMenu } from "./NewTabMenu";

const SECTION_ICON: Record<string, IconData> = {
  home: Icons.nav.CustomHouse,
  files: Icons.stella.Folder,
  apps: Icons.stella.AppWindowMac,
  browser: Icons.stella.Globe,
  schedule: Icons.stella.Clock,
  updates: Icons.stella.Download,
  email: Icons.stella.Mail,
  takeover: Icons.stella.Lock,
};

const CHAT_FULL_GAP = 6;
const TAB_GAP = 2;
const TAB_MAX = 152;
const TAB_TIGHT = 104;
const TAB_COMPACT = 60;
const TAB_LEAD = 10 + 18 + 6;
const TAB_TRAIL = 26;
const TAB_TRAIL_TIGHT = 10;
const FOOT = 8;
const SETTLE_MS = 170;

const LABEL = look(fontSize.sm, 500, { lh: 26 / fontSize.sm });

const labelRoom = (width: number) => width - TAB_LEAD - (width < TAB_TIGHT ? TAB_TRAIL_TIGHT : TAB_TRAIL);

const leaveStageViewer = () => {
  if (fileViewer.getSnapshot().mode === "stage") fileViewer.close();
};

const openTab = (tab: SidebarTab) => {
  if (isDocumentTab(tab)) {
    openDocumentTab(tab);
    return;
  }
  leaveStageViewer();
  sidebarSections.activateTab(tab.id);
  displayTabs.setPanelOpen(true);
};

function tabLook(t: Tokens) {
  return derive(t, "topbar-tabs", (t) => {
    const edge = t.c.panelSurfaceBorder ?? t.c.border;
    const fill = t.c.background;
    return {
      edge,
      fill,
      rest: t.c.textMuted,
      hover: t.c.textBase,
      strong: t.c.textStrong,
      hoverFill: mixOklch(t.c.foreground, 5, "transparent"),
      viewingFill: mixOklch(t.c.foreground, 7, "transparent"),
      draggingFill: mixOklch(t.c.foreground, 9, t.c.background),
      closeHover: mixOklch(t.c.foreground, 10, "transparent"),
      newHover: mixOklch(t.c.foreground, 7, t.c.background),
      newOpen: mixOklch(t.c.foreground, 9, t.c.background),
      foot: (side: "left" | "right") => ({
        center: (side === "left" ? [0, 0] : [1, 0]) as [number, number],
        radius: FOOT + 1,
        stops: [
          [0, "#00000000"],
          [(FOOT - 0.4) / (FOOT + 1), "#00000000"],
          [(FOOT + 0.1) / (FOOT + 1), edge],
          [(FOOT + 0.9) / (FOOT + 1), edge],
          [1, fill],
        ] as [number, string][],
      }),
    };
  });
}

/** The open tab's surface: the stage's fill and edge, running into the stage with concave feet. */
function OpenTabSurface({ t }: { t: Tokens }) {
  const l = tabLook(t);
  return (
    <>
      <box absolute={{ left: 0, right: 0, top: 6, bottom: FOOT + 1 }} fill={l.fill} border={l.edge} borderSides={[1, 1, 0, 1]} corners={[9, 9, 0, 0]} inert />
      <row absolute={{ left: -FOOT, right: -FOOT, bottom: 0 }} h={FOOT + 1} inert>
        <box w={FOOT + 1} h={FOOT + 1} radial={l.foot("left")} />
        <box grow={1} h={FOOT + 1} fill={l.fill} ml={-1} mr={-1} />
        <box w={FOOT + 1} h={FOOT + 1} radial={l.foot("right")} />
      </row>
    </>
  );
}

type Drag = { id: string; from: number; target: number; dx: number; slots: { x: number; w: number }[]; settling: boolean };

/** desktop-ui's `ShellTopBarTabs`: pinned Chat, the open tabs (notched into the stage), reorder by drag, and + to open more. */
export function ShellTopBarTabs({ room }: { room: number }) {
  const tk = useTokens();
  const l = tabLook(tk);
  const tabs = useSidebarOpenTabs();
  const activeTabId = useSidebarActiveTabId();
  const panelOpen = useDisplayPanelOpen();
  const { tabs: displayItems } = useDisplayTabList();
  const navigate = useNavigate();
  const onChatRoute = useRouterState({ select: (state) => state.location.pathname === "/chat" });
  const cloudTitles = useSyncExternalStore(cloudAppTitles.subscribe, cloudAppTitles.getSnapshot, cloudAppTitles.getSnapshot).titles;
  const viewer = useFileViewer();
  const filling = viewer.mode === "stage" ? viewer.fileId : null;
  const shownTabId = filling ? (tabs.find((tab) => isDocumentTab(tab) && tab.location === filling)?.id ?? null) : panelOpen ? activeTabId : null;
  const chatActive = !panelOpen && !shownTabId;
  const isOpenElsewhere = (tab: SidebarTab) => isDocumentTab(tab) && (viewer.fileId === tab.location || viewer.detached.some((entry) => entry.fileId === tab.location));
  const [menuOpen, setMenuOpenState] = useState(false);
  const emailUnseen = useEmailUnseenCount();
  const setMenuOpen = (next: boolean) => {
    setMenuOpenState(next);
    if (next) displaySearchStore.open();
    else displaySearchStore.close();
  };
  const widths = useRef(new Map<string, { x: number; w: number }>());
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edges = useRef({ chatRight: 0, stripRight: 0 });
  const syncNotch = () => openTabNotch.set(shownTabId ? (widths.current.get(shownTabId) ?? null) : null, edges.current.chatRight, edges.current.stripRight);
  useEffect(syncNotch);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const titleFor = (tab: SidebarTab): string => {
    switch (tab.kind) {
      case "apps": {
        if (!tab.location) return "Apps";
        const cloudAppId = cloudAppIdFromLocation(tab.location);
        return cloudAppId ? cloudTitles[cloudAppId] || "Cloud app" : "Apps";
      }
      case "files": {
        if (!tab.location) return "Files";
        const item = displayItems.find((d) => d.id === tab.location);
        return item?.title || tab.file?.title || fileNameFromDisplayTabId(tab.location);
      }
      default:
        return SIDEBAR_SECTION_META[tab.kind].label;
    }
  };

  const titles = useMemo(() => new Map(tabs.map((tab) => [tab.id, titleFor(tab)])), [tabs, cloudTitles, displayItems]);

  const chatLabelWidth = labelWidths["__chat"] ?? 26;
  const chatFull = Math.ceil(TAB_LEAD + 10 + chatLabelWidth);
  const chatNeedsRoom = useMemo(() => {
    if (tabs.length === 0 || room <= 0) return false;
    const width = Math.min(TAB_MAX, (room - chatFull - CHAT_FULL_GAP - 26 - 2 - TAB_GAP * tabs.length) / tabs.length);
    const fits = labelRoom(width);
    return tabs.some((tab) => Math.min(labelWidths[tab.id] ?? 0, labelRoom(TAB_MAX)) > fits + 0.5);
  }, [tabs, room, chatFull, labelWidths]);

  useWindowKeys(TAB_CHORDS, (e) => {
    const key = e.chord.slice(4);
    if (key === "t") {
      setMenuOpenState((open) => !open);
      return;
    }
    const index = Number(key) - 1;
    if (index === 0) {
      leaveStageViewer();
      displayTabs.setPanelOpen(false);
      return;
    }
    const list = sidebarSections.getSnapshot().tabs;
    const target = key === "9" ? list[list.length - 1] : list[index - 1];
    if (!target) return false;
    openTab(target);
  });

  const showChat = () => {
    leaveStageViewer();
    displayTabs.setPanelOpen(false);
    if (!onChatRoute) void navigate({ to: "/chat" as never });
  };

  const onTabDrag = (tab: SidebarTab, index: number, d: { phase: "start" | "move" | "end"; dx: number }) => {
    if (d.phase === "start") {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      const slots = tabs.map((t) => widths.current.get(t.id) ?? { x: 0, w: 0 });
      setDrag({ id: tab.id, from: index, target: index, dx: 0, slots, settling: false });
      return;
    }
    setDrag((current) => {
      if (!current || current.id !== tab.id) return current;
      const { slots, from } = current;
      const dragged = slots[from]!;
      const first = slots[0]!;
      const last = slots[slots.length - 1]!;
      const dx = Math.min(last.x + last.w - dragged.x - dragged.w, Math.max(first.x - dragged.x, d.dx));
      const left = dragged.x + dx;
      const right = left + dragged.w;
      let target = from;
      slots.forEach((slot, i) => {
        if (i === from) return;
        const middle = slot.x + slot.w / 2;
        if (i < from && left < middle) target -= 1;
        else if (i > from && right > middle) target += 1;
      });
      if (d.phase === "move") return { ...current, dx, target };
      const settleX = slots[target]!.x - dragged.x + (target > from ? slots[target]!.w - dragged.w : 0);
      settleTimer.current = setTimeout(() => {
        if (target !== from) sidebarSections.moveTab(current.id, target);
        setDrag(null);
      }, SETTLE_MS);
      return { ...current, dx: settleX, target, settling: true };
    });
  };

  const shiftFor = (index: number): number => {
    if (!drag) return 0;
    const step = (drag.slots[drag.from]?.w ?? 0) + TAB_GAP;
    if (index === drag.from) return drag.dx;
    if (drag.from < drag.target && index > drag.from && index <= drag.target) return -step;
    if (drag.from > drag.target && index < drag.from && index >= drag.target) return step;
    return 0;
  };

  const renderIcon = (tab: SidebarTab, color: string, hidden: boolean) => {
    if (tab.kind === "files" && tab.location) {
      const item = displayItems.find((d) => d.id === tab.location);
      const kind = item?.kind ?? tab.file?.kind;
      if (kind) return <DisplayTabIcon kind={kind} size={18} color={color} opacity={hidden ? 0 : 1} />;
    }
    return <GroupIcon icon={SECTION_ICON[tab.kind] ?? Icons.stella.Folder} size={18} strokeWidth={1.5} color={color} opacity={hidden ? 0 : 1} />;
  };

  const emailTabOpen = tabs.some((tab) => tab.kind === "email");
  const dot = (key: string) => <box key={key} absolute={{ top: -3, right: -4 }} w={6} h={6} radius={3} fill={tk.c.primary} shadows={[{ spread: 1.5, color: tk.c.background }]} inert />;

  return (
    <row id="topbar-tabs" h="full" align="center" gap={2} minW={0} shrink>
      <col hidden absolute={{ left: 0, top: 0 }} inert>
        <text {...LABEL} nowrap onLayout={(r) => setLabelWidths((w) => (w["__chat"] === r.w ? w : { ...w, __chat: r.w }))}>Chat</text>
        {tabs.map((tab) => (
          <text key={tab.id} {...LABEL} nowrap onLayout={(r) => setLabelWidths((w) => (w[tab.id] === r.w ? w : { ...w, [tab.id]: r.w }))}>
            {titles.get(tab.id) ?? ""}
          </text>
        ))}
      </col>
      <row id="topbar-tab-chat" h="full" align="center" mr={6} shrink={false} hoverGroup noWindowDrag onLayout={(r) => { edges.current.chatRight = r.x + r.w; syncNotch(); }}>
        <box absolute={{ left: 0, right: 0, top: 6, bottom: 6 }} radius={7} fill={l.hoverFill} hoverOpacity={[0, 1]} inert />
        <row
          id="topbar-tab-chat-target"
          role="tab"
          selected={chatActive}
          label="Chat"
          title="Chat (⌘1)"
          titleSide="bottom"
          focusable
          h={26}
          w={chatNeedsRoom ? 40 : undefined}
          px={chatNeedsRoom ? 0 : 10}
          gap={6}
          align="center"
          justify="center"
          radius={7}
          focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 7 }}
          onPress={showChat}
        >
          <GroupIcon icon={Icons.stella.MessageSquare} size={18} strokeWidth={1.5} color={chatActive ? l.strong : l.rest} hoverColor={chatActive ? l.strong : l.hover} />
          {chatNeedsRoom ? null : <text {...LABEL} nowrap color={chatActive ? l.strong : l.rest} hoverColor={chatActive ? l.strong : l.hover}>Chat</text>}
        </row>
      </row>
      <row id="topbar-tabs-strip" role="tablist" label="Tabs" h="full" align="stretch" gap={TAB_GAP} minW={0} shrink scrollX pr={8} mr={-6} noWindowDrag onLayout={(r) => { edges.current.stripRight = r.x + r.w; syncNotch(); }}>
        {tabs.map((tab, index) => {
          const active = tab.id === shownTabId;
          const title = titles.get(tab.id) ?? "";
          const width = sizes[tab.id] ?? TAB_MAX;
          const compact = width < TAB_COMPACT;
          const tight = !compact && width < TAB_TIGHT;
          const dragging = drag?.id === tab.id;
          const viewing = !active && isOpenElsewhere(tab);
          const color = active || viewing || dragging ? l.strong : l.rest;
          const closeAlways = active && !compact && !tight && !drag;
          const closeOnHover = !drag && (!compact || active);
          const iconSwaps = !drag && ((compact && active) || tight);
          const unreadDot = tab.unread || (tab.kind === "email" && !active && emailUnseen > 0);
          return (
            <row
              key={tab.id}
              id={`topbar-tab-${tab.id}`}
              h="full"
              w={TAB_MAX}
              minW={40}
              shrink
              align="center"
              hoverGroup
              raise={active || dragging ? 2 : undefined}
              x={shiftFor(index)}
              motion={drag && !(dragging && !drag.settling) ? { dur: 0.16 } : { dur: 0 }}
              onLayout={(r) => {
                widths.current.set(tab.id, { x: r.x, w: r.w });
                if (tab.id === shownTabId) syncNotch();
                setSizes((s) => (Math.abs((s[tab.id] ?? -1) - r.w) < 0.5 ? s : { ...s, [tab.id]: r.w }));
              }}
              onDrag={(d) => onTabDrag(tab, index, d)}
            >
              {active ? (
                <OpenTabSurface t={tk} />
              ) : (
                <box
                  absolute={{ left: 0, right: 0, top: 6, bottom: 6 }}
                  radius={7}
                  fill={dragging ? l.draggingFill : viewing ? l.viewingFill : l.hoverFill}
                  hoverOpacity={dragging || viewing ? undefined : drag ? [0, 0] : [0, 1]}
                  inert
                />
              )}
              <row
                id={`topbar-tab-${tab.id}-target`}
                role="tab"
                selected={active}
                label={title}
                title={tab.unread ? `${title} · new from Stella` : title}
                titleSide="bottom"
                focusable
                grow={1}
                minW={0}
                h={26}
                pl={compact ? 0 : 10}
                pr={compact ? 0 : tight ? TAB_TRAIL_TIGHT : TAB_TRAIL}
                gap={6}
                align="center"
                justify={compact ? "center" : "start"}
                radius={7}
                focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 7 }}
                onPress={() => openTab(tab)}
              >
                <box hoverOpacity={iconSwaps ? [1, 0] : undefined}>
                  {renderIcon(tab, color, false)}
                  {unreadDot ? dot("dot") : null}
                </box>
                {compact ? null : <text {...LABEL} nowrap truncate="fade" grow={1} shrink minW={0} color={color} hoverColor={active || viewing ? undefined : l.hover}>{title}</text>}
              </row>
              <box
                id={`topbar-tab-${tab.id}-close`}
                role="button"
                label={`Close ${title}`}
                title={`Close ${title}`}
                absolute={compact ? { top: 11, left: width / 2 - 8 } : tight ? { top: 11, left: 9 } : { top: 11, right: 6 }}
                w={16}
                h={16}
                radius={5}
                center
                hover={l.closeHover}
                hoverOpacity={closeAlways ? undefined : closeOnHover ? [0, 1] : [0, 0]}
                opacity={closeAlways ? 1 : undefined}
                inert={!closeAlways && !closeOnHover}
                onPress={() => sidebarSections.closeTab(tab.id)}
              >
                <GroupIcon icon={Icons.stella.X} size={11} strokeWidth={2} color={tk.c.textWeak} />
              </box>
            </row>
          );
        })}
      </row>
      <NewTabMenu open={menuOpen} onOpenChange={setMenuOpen} anchorFill={l} emailDot={!emailTabOpen && emailUnseen > 0} dot={dot} />
    </row>
  );
}
