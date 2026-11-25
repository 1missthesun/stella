import {
  sidebarSections,
  useSidebarOpenTabs,
} from "@/features/workspace-display/sidebar-sections";
import {
  displayTabs,
  useDisplayTabList,
} from "@/features/workspace-display/tab-store";
import { useEffect, useLayoutEffect } from "react";
import { publishCloudApps } from "./cloud-apps-store";
import { cloudAppTitles } from "./cloud-app-title-store";
import { cloudAppIdFromLocation } from "./open-cloud-app-panel";
import type { CloudAppsState } from "./use-cloud-apps";

function AccountScopedCloudApps({ state }: { state: CloudAppsState }) {
  const sidebarTabs = useSidebarOpenTabs();
  const { tabs } = useDisplayTabList();

  useLayoutEffect(() => {
    publishCloudApps(state);
  }, [state]);

  useLayoutEffect(() => {
    cloudAppTitles.replace(
      state.accountScope,
      state.phase === "ready" ? state.apps : [],
    );
    return () => cloudAppTitles.clear(state.accountScope);
  }, [state.accountScope, state.apps, state.phase]);

  useEffect(() => {
    if (state.phase !== "ready") return;
    const titles = new Map(state.apps.map((app) => [app.appId, app.title]));
    for (const tab of sidebarTabs) {
      if (tab.kind !== "apps") continue;
      const appId = cloudAppIdFromLocation(tab.location);
      if (appId !== null && !titles.has(appId)) sidebarSections.closeTab(tab.id);
    }
    for (const tab of tabs) {
      if (tab.kind !== "app") continue;
      const title = titles.get(cloudAppIdFromLocation(tab.id) ?? "");
      if (title === undefined) {
        displayTabs.closeTab(tab.id);
      } else if (title !== tab.title) {
        displayTabs.openTab({ ...tab, title }, { activate: false });
      }
    }
  }, [sidebarTabs, state.apps, state.phase, tabs]);

  return null;
}

/** Keeps the open apps' tabs, titles and viewers in step with the account. */
export function CloudAppsSync({ state }: { state: CloudAppsState }) {
  return <AccountScopedCloudApps key={state.accountScope} state={state} />;
}
