import AsyncStorage from "@react-native-async-storage/async-storage";

export type MainTabId = "chat" | "schedule" | "email" | "apps" | "files" | "settings";

export const MAIN_TAB_HREFS = {
  chat: "/chat",
  schedule: "/schedule",
  email: "/email",
  apps: "/apps",
  files: "/files",
  settings: "/settings",
} as const satisfies Record<MainTabId, string>;

export type MainTabHref = (typeof MAIN_TAB_HREFS)[MainTabId];

const LAST_MAIN_TAB_KEY = "stella-mobile:last-main-tab";

export function readMainTabFromPath(pathname: string): MainTabId | null {
  if (pathname === "/chat") return "chat";
  if (pathname === "/schedule") return "schedule";
  if (pathname === "/email") return "email";
  if (pathname === "/apps") return "apps";
  if (pathname === "/files") return "files";
  if (
    pathname === "/settings" ||
    pathname === "/cloud-home" ||
    pathname === "/engine-accounts"
  ) {
    return "settings";
  }
  return null;
}

function parseMainTab(value: string | null): MainTabId | null {
  if (
    value === "chat" ||
    value === "schedule" ||
    value === "email" ||
    value === "apps" ||
    value === "files" ||
    value === "settings"
  ) {
    return value;
  }
  if (value === "account") return "settings";
  return null;
}

export async function loadLastMainTab(): Promise<MainTabId | null> {
  return parseMainTab(await AsyncStorage.getItem(LAST_MAIN_TAB_KEY));
}

export async function loadLastMainTabHref(): Promise<string> {
  const tab = await loadLastMainTab();
  return MAIN_TAB_HREFS[tab ?? "chat"];
}

type MainShellRouter = { replace: (href: MainTabHref) => void };

let pendingMainTab: MainTabId | null = null;

export function enterMainShell(router: MainShellRouter, href: string): void {
  const tab = readMainTabFromPath(href);
  pendingMainTab = tab && tab !== "chat" ? tab : null;
  router.replace(MAIN_TAB_HREFS.chat);
}

export function queueMainTab(tab: MainTabId): void {
  pendingMainTab = tab === "chat" ? null : tab;
}

export function takePendingMainTab(): MainTabId | null {
  const tab = pendingMainTab;
  pendingMainTab = null;
  return tab;
}

export async function saveLastMainTab(tab: MainTabId): Promise<void> {
  await AsyncStorage.setItem(LAST_MAIN_TAB_KEY, tab);
}
