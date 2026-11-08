import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  useEffect,
  useLayoutEffect,
  useRef,
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
import "./shell-topbar-tabs.css";

const openNewTab = () => {
  sidebarSections.openHomeLauncher();
  displayTabs.setPanelOpen(true);
};

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
  const chatActive = !panelOpen;

  useLayoutEffect(() => {
    if (!activeTabId || !panelOpen) return;
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, panelOpen]);

  const showChat = () => {
    displayTabs.setPanelOpen(false);
    if (!onChatRoute) void navigate({ to: "/chat" });
  };

  // ⌘T new tab (Home), ⌘1 Chat, ⌘2–9 the tabs after it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)
        return;
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        openNewTab();
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
      case "home":
        return "New tab";
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
      if (kind) return <DisplayTabIcon kind={kind} size={14} />;
    }
    const { Icon } = SIDEBAR_SECTION_META[tab.kind];
    return <Icon size={14} strokeWidth={1.75} />;
  };

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
              <MessageSquare size={14} strokeWidth={1.75} />
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
                  {tab.unread ? <span className="topbar-tabs__dot" /> : null}
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
      <button
        type="button"
        className="topbar-tabs__new"
        onClick={openNewTab}
        aria-label="New tab"
        title="New tab (⌘T)"
      >
        <Plus size={15} strokeWidth={1.9} aria-hidden="true" />
      </button>
    </div>
  );
}
