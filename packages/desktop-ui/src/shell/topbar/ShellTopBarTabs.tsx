import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  fileNameFromDisplayTabId,
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
import { DisplayTabIcon } from "@/features/workspace-display/icons";
import { cloudAppTitles } from "@/features/cloud/cloud-app-title-store";
import { cloudAppIdFromLocation } from "@/features/cloud/open-cloud-app-panel";
import { SIDEBAR_SECTION_META } from "@/shell/sidebar-sections/section-meta";
import { MessageSquare, Plus, X } from "@/ui/icons";
import { displaySearchStore } from "@/features/workspace-display/display-search-store";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { NewTabMenu } from "./NewTabMenu";
import { useTabReorder } from "./use-tab-reorder";
import {
  revealOpenTab,
  useOpenTabNotch,
  useTabStripReach,
} from "./open-tab-notch";
import { useEmailUnseenCount } from "@/features/email/email-unseen";
import "./shell-topbar-tabs.css";

/**
 * Chrome-style tabs in the top bar: Chat first, then everything that lasts
 * (browser, apps, canvases, Home and its places, sign-in). The active tab
 * fills the stage over the chat; Chat puts the stage away.
 */
export function ShellTopBarTabs() {
  const tabs = useSidebarOpenTabs();
  const activeTabId = useSidebarActiveTabId();
  const panelOpen = useDisplayPanelOpen();
  const { tabs: displayItems } = useDisplayTabList();
  const navigate = useNavigate();
  const onChatRoute = useRouterState({
    select: (state) => state.location.pathname === "/chat",
  });
  const cloudTitles = useSyncExternalStore(
    cloudAppTitles.subscribe,
    cloudAppTitles.getSnapshot,
    cloudAppTitles.getSnapshot,
  ).titles;
  const stripRef = useRef<HTMLDivElement>(null);
  const tabIds = tabs.map((tab) => tab.id).join("\n");
  const onTabPointerDown = useTabReorder(stripRef, tabIds);
  useOpenTabNotch(stripRef, tabIds);
  useTabStripReach(stripRef);
  const chatActive = !panelOpen;
  const [menuOpen, setMenuOpenState] = useState(false);
  const emailUnseen = useEmailUnseenCount();
  const setMenuOpen = (next: boolean) => {
    setMenuOpenState(next);
    if (!next) displaySearchStore.close();
  };

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!activeTabId || !panelOpen || !strip) return;
    strip
      .querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    // The browser does not know the pinned Chat tab covers the strip's
    // start, so a tab scrolled under it still counts as in view.
    revealOpenTab(strip);
  }, [activeTabId, panelOpen]);

  // Fade a tab's title only when it is actually cut off, and note how far
  // the tabs have been narrowed (the close button moves; see the CSS).
  // Chat gives up its name first: it goes to its icon alone whenever the
  // other tabs would otherwise be narrowed past their titles.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const mark = () => {
      const chat = strip.querySelector<HTMLElement>(".topbar-tabs__tab--chat");
      if (chat) {
        if (chatNeedsRoom(strip)) chat.dataset.compact = "true";
        else delete chat.dataset.compact;
      }
      for (const label of strip.querySelectorAll<HTMLElement>(
        ".topbar-tabs__label",
      )) {
        const clipped = label.scrollWidth > label.clientWidth + 1;
        if (clipped) label.dataset.clipped = "true";
        else delete label.dataset.clipped;
      }
      for (const tab of strip.querySelectorAll<HTMLElement>("[data-tab-id]")) {
        const width = tab.offsetWidth;
        if (width < 60) tab.dataset.compact = "true";
        else delete tab.dataset.compact;
        if (width >= 60 && width < 104) tab.dataset.tight = "true";
        else delete tab.dataset.tight;
      }
    };
    const observer = new ResizeObserver(mark);
    observer.observe(strip);
    // The strip sizes to its tabs while they fit, so watch the bar's side
    // that gives it room too.
    const side = strip.closest<HTMLElement>(".shell-topbar-full__left");
    if (side) observer.observe(side);
    for (const tab of strip.children) observer.observe(tab);
    mark();
    return () => observer.disconnect();
  }, [tabs, cloudTitles, displayItems]);

  const showChat = () => {
    displayTabs.setPanelOpen(false);
    if (!onChatRoute) void navigate({ to: "/chat" });
  };

  // ⌘T opens the + menu, ⌘1 Chat, ⌘2–9 the tabs after it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)
        return;
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        setMenuOpenState((open) => !open);
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        if (index === 0) {
          event.preventDefault();
          displayTabs.setPanelOpen(false);
          return;
        }
        const list = sidebarSections.getSnapshot().tabs;
        const target =
          event.key === "9" ? list[list.length - 1] : list[index - 1];
        if (!target) return;
        event.preventDefault();
        sidebarSections.activateTab(target.id);
        displayTabs.setPanelOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
        return (
          item?.title ||
          tab.file?.title ||
          fileNameFromDisplayTabId(tab.location)
        );
      }
      default:
        return SIDEBAR_SECTION_META[tab.kind].label;
    }
  };

  const renderIcon = (tab: SidebarTab) => {
    if (tab.kind === "files" && tab.location) {
      const item = displayItems.find((d) => d.id === tab.location);
      const kind = item?.kind ?? tab.file?.kind;
      if (kind) return <DisplayTabIcon kind={kind} size={18} />;
    }
    const { Icon } = SIDEBAR_SECTION_META[tab.kind];
    return <Icon size={18} strokeWidth={1.5} />;
  };

  const emailTabOpen = tabs.some((tab) => tab.kind === "email");

  return (
    <div className="topbar-tabs">
      <div
        ref={stripRef}
        className="topbar-tabs__strip"
        role="tablist"
        aria-label="Tabs"
      >
        <div
          className="topbar-tabs__tab topbar-tabs__tab--chat"
          data-active={chatActive ? "true" : undefined}
        >
          <button
            type="button"
            role="tab"
            aria-selected={chatActive}
            className="topbar-tabs__target"
            onClick={showChat}
            title="Chat (⌘1)"
          >
            <span className="topbar-tabs__icon" aria-hidden="true">
              <MessageSquare size={18} strokeWidth={1.5} />
            </span>
            <span className="topbar-tabs__label">Chat</span>
          </button>
        </div>
        {tabs.map((tab) => {
          const active = panelOpen && tab.id === activeTabId;
          const title = titleFor(tab);
          return (
            <div
              key={tab.id}
              className="topbar-tabs__tab"
              data-tab-id={tab.id}
              data-active={active ? "true" : undefined}
              data-unread={tab.unread ? "true" : undefined}
              onPointerDown={(event) => onTabPointerDown(event, tab.id)}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="topbar-tabs__target"
                title={tab.unread ? `${title} · new from Stella` : title}
                onClick={() => {
                  sidebarSections.activateTab(tab.id);
                  displayTabs.setPanelOpen(true);
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) sidebarSections.closeTab(tab.id);
                }}
              >
                <span className="topbar-tabs__icon" aria-hidden="true">
                  {renderIcon(tab)}
                  {tab.unread || (tab.kind === "email" && !active && emailUnseen > 0) ? (
                    <span className="topbar-tabs__dot" />
                  ) : null}
                </span>
                <span className="topbar-tabs__label">{title}</span>
              </button>
              <button
                type="button"
                className="topbar-tabs__close"
                aria-label={`Close ${title}`}
                title={`Close ${title}`}
                onClick={() => sidebarSections.closeTab(tab.id)}
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="topbar-tabs__new"
            data-active={menuOpen || undefined}
            aria-label="Open"
            title="Open (⌘T)"
          >
            <span className="topbar-tabs__icon" aria-hidden="true">
              <Plus size={18} strokeWidth={1.5} />
              {!emailTabOpen && emailUnseen > 0 ? <span className="topbar-tabs__dot" /> : null}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="new-tab-menu-popover"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            // The search field focuses itself once search opens.
            event.preventDefault();
            displaySearchStore.open();
          }}
        >
          <NewTabMenu onPick={() => setMenuOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Pinned Chat with its name, and the room around the strip (see the CSS). */
const CHAT_FULL_GAP = 6;
const TAB_GAP = 2;
const TAB_MAX = 152;
const TAB_TIGHT = 104;
/** Icon, its gap and the leading padding of a tab with a title. */
const TAB_LEAD = 10 + 18 + 6;
/** Room kept after the title: for the close button, or less once tight. */
const TAB_TRAIL = 26;
const TAB_TRAIL_TIGHT = 10;

let measureContext: CanvasRenderingContext2D | null = null;

function textWidth(text: string, font: string): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return 0;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

function labelRoom(width: number): number {
  return width - TAB_LEAD - (width < TAB_TIGHT ? TAB_TRAIL_TIGHT : TAB_TRAIL);
}

/**
 * Whether the tabs would be narrowed past their titles (or scroll) with
 * Chat showing its name. Worked out from the room the bar gives the strip,
 * not from the tabs as they stand, so Chat does not flip back and forth as
 * its own width changes.
 */
function chatNeedsRoom(strip: HTMLElement): boolean {
  const chat = strip.querySelector<HTMLElement>(".topbar-tabs__tab--chat");
  const tabs = [
    ...strip.querySelectorAll<HTMLElement>(".topbar-tabs__tab[data-tab-id]"),
  ];
  const side = strip.closest<HTMLElement>(".shell-topbar-full__left");
  const holder = strip.parentElement;
  if (!chat || !side || !holder || tabs.length === 0) return false;

  const sideStyle = getComputedStyle(side);
  let room =
    side.clientWidth -
    parseFloat(sideStyle.paddingLeft) -
    parseFloat(sideStyle.paddingRight);
  const sideGap = parseFloat(sideStyle.columnGap) || 0;
  for (const child of side.children) {
    if (child === holder) continue;
    const width = (child as HTMLElement).offsetWidth;
    if (width > 0) room -= width + sideGap;
  }
  const holderGap = parseFloat(getComputedStyle(holder).columnGap) || 0;
  for (const child of holder.children) {
    if (child === strip) continue;
    room -= (child as HTMLElement).offsetWidth + holderGap;
  }
  // The strip's trailing padding, less what its negative margin gives back.
  const stripStyle = getComputedStyle(strip);
  room -=
    parseFloat(stripStyle.paddingRight) + parseFloat(stripStyle.marginRight);

  const target = chat.querySelector<HTMLElement>(".topbar-tabs__target");
  const label = chat.querySelector<HTMLElement>(".topbar-tabs__label");
  if (!target || !label) return false;
  const font = getComputedStyle(target).font;
  const chatFull = Math.ceil(TAB_LEAD + 10 + textWidth(label.textContent ?? "", font));

  const width = Math.min(
    TAB_MAX,
    (room - chatFull - CHAT_FULL_GAP - TAB_GAP * tabs.length) / tabs.length,
  );
  const fits = labelRoom(width);
  return tabs.some((tab) => {
    const title = tab.querySelector<HTMLElement>(".topbar-tabs__label")
      ?.textContent;
    if (!title) return false;
    // A title too long even for a full-width tab only asks for that width.
    const wanted = Math.min(textWidth(title, font), labelRoom(TAB_MAX));
    return wanted > fits + 0.5;
  });
}
