import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserId } from "./types.ts";
import { DAY, OS, baseDomain, chromeTimeToMs, exists, home, hostOf, msToChromeTime, readJson, readSqliteCopy } from "./util.ts";

export type BrowserProfile = {
  browser: BrowserId;
  browserName: string;
  /** Profile folder. */
  dir: string;
  /** Browser's user-data root (Chromium) or profiles root (Firefox). */
  root: string;
  profileName: string;
  email?: string;
  /** Browser version last run, when the browser records it. */
  version?: string;
};

const LOCALAPPDATA = process.env.LOCALAPPDATA ?? home("AppData", "Local");
const APPDATA = process.env.APPDATA ?? home("AppData", "Roaming");

const CHROMIUM_ROOTS: { browser: BrowserId; name: string; roots: Partial<Record<typeof OS, string>> }[] = [
  { browser: "chrome", name: "Chrome", roots: { linux: home(".config/google-chrome"), darwin: home("Library/Application Support/Google/Chrome"), win32: path.join(LOCALAPPDATA, "Google/Chrome/User Data") } },
  { browser: "edge", name: "Edge", roots: { linux: home(".config/microsoft-edge"), darwin: home("Library/Application Support/Microsoft Edge"), win32: path.join(LOCALAPPDATA, "Microsoft/Edge/User Data") } },
  { browser: "brave", name: "Brave", roots: { linux: home(".config/BraveSoftware/Brave-Browser"), darwin: home("Library/Application Support/BraveSoftware/Brave-Browser"), win32: path.join(LOCALAPPDATA, "BraveSoftware/Brave-Browser/User Data") } },
  { browser: "chromium", name: "Chromium", roots: { linux: home(".config/chromium"), darwin: home("Library/Application Support/Chromium"), win32: path.join(LOCALAPPDATA, "Chromium/User Data") } },
  { browser: "vivaldi", name: "Vivaldi", roots: { linux: home(".config/vivaldi"), darwin: home("Library/Application Support/Vivaldi"), win32: path.join(LOCALAPPDATA, "Vivaldi/User Data") } },
  { browser: "arc", name: "Arc", roots: { darwin: home("Library/Application Support/Arc/User Data") } },
  { browser: "opera", name: "Opera", roots: { linux: home(".config/opera"), darwin: home("Library/Application Support/com.operasoftware.Opera"), win32: path.join(APPDATA, "Opera Software/Opera Stable") } },
];

const FIREFOX_ROOT: Partial<Record<typeof OS, string>> = {
  linux: home(".mozilla/firefox"),
  darwin: home("Library/Application Support/Firefox"),
  win32: path.join(APPDATA, "Mozilla/Firefox"),
};

const readText = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};

export const listProfiles = (): BrowserProfile[] => {
  const out: BrowserProfile[] = [];
  for (const def of CHROMIUM_ROOTS) {
    const root = def.roots[OS];
    if (!root || !exists(root)) continue;
    const version = readText(path.join(root, "Last Version"))?.trim();
    const localState = readJson<{ profile?: { info_cache?: Record<string, { name?: string; user_name?: string }> } }>(path.join(root, "Local State"));
    const cache = localState?.profile?.info_cache ?? {};
    const dirs = Object.keys(cache).length ? Object.keys(cache) : exists(path.join(root, "Default")) ? ["Default"] : def.browser === "opera" ? ["."] : [];
    for (const d of dirs) {
      const dir = path.join(root, d);
      if (!exists(path.join(dir, "Preferences")) && !exists(path.join(dir, "History"))) continue;
      out.push({
        browser: def.browser,
        browserName: def.name,
        dir,
        root,
        profileName: cache[d]?.name || d,
        ...(cache[d]?.user_name ? { email: cache[d]!.user_name } : {}),
        ...(version ? { version } : {}),
      });
    }
  }
  const ffRoot = FIREFOX_ROOT[OS];
  const ini = ffRoot ? readText(path.join(ffRoot, "profiles.ini")) : undefined;
  if (ffRoot && ini) {
    for (const block of ini.split(/\n(?=\[)/)) {
      if (!/^\[Profile/.test(block)) continue;
      const rel = /IsRelative=1/.test(block);
      const p = block.match(/^Path=(.+)$/m)?.[1]?.trim();
      const name = block.match(/^Name=(.+)$/m)?.[1]?.trim() ?? "default";
      if (!p) continue;
      const dir = rel ? path.join(ffRoot, p) : p;
      if (!exists(path.join(dir, "places.sqlite"))) continue;
      const compat = readText(path.join(dir, "compatibility.ini"));
      const version = compat?.match(/LastVersion=([\d.]+)/)?.[1];
      out.push({ browser: "firefox", browserName: "Firefox", dir, root: ffRoot, profileName: name, ...(version ? { version } : {}) });
    }
  }
  return out;
};

export type SiteUse = { domain: string; visits: number; lastVisit: number; hosts: string[] };

/** Sites the person used in the last `days`, grouped by registrable domain. Stays on the computer. */
export const siteUse = async (profiles: BrowserProfile[], days = 120): Promise<Map<string, SiteUse>> => {
  const since = Date.now() - days * DAY;
  const map = new Map<string, SiteUse>();
  const add = (url: string, visits: number, last: number) => {
    const host = hostOf(url);
    if (!host) return;
    const domain = baseDomain(host);
    const cur = map.get(domain) ?? { domain, visits: 0, lastVisit: 0, hosts: [] };
    cur.visits += visits;
    cur.lastVisit = Math.max(cur.lastVisit, last);
    if (cur.hosts.length < 8 && !cur.hosts.includes(host)) cur.hosts.push(host);
    map.set(domain, cur);
  };
  let failed = 0;
  let lastError: unknown;
  for (const p of profiles) {
    try {
      if (p.browser === "firefox") {
        const rows = await readSqliteCopy(path.join(p.dir, "places.sqlite"), "SELECT url, visit_count, last_visit_date FROM moz_places WHERE last_visit_date > ?", since * 1000);
        for (const r of rows) add(String(r.url), Number(r.visit_count ?? 1), Number(r.last_visit_date ?? 0) / 1000);
      } else {
        const rows = await readSqliteCopy(path.join(p.dir, "History"), "SELECT url, visit_count, last_visit_time FROM urls WHERE last_visit_time > ?", msToChromeTime(since));
        for (const r of rows) add(String(r.url), Number(r.visit_count ?? 1), chromeTimeToMs(r.last_visit_time as number));
      }
    } catch (e) {
      // A locked or unreadable profile is skipped; the next run tries again.
      failed++;
      lastError = e;
    }
  }
  if (profiles.length && failed === profiles.length) throw new Error(`couldn't read browsing history: ${(lastError as Error)?.message}`);
  return map;
};

export type SavedLogin = { domain: string; host: string; browser: string; lastUsed?: number; passwordChanged?: number; username?: string };

/** Sites where the browser has a saved password (site and username only; passwords are never read). */
export const savedLogins = async (profiles: BrowserProfile[]): Promise<SavedLogin[]> => {
  const out: SavedLogin[] = [];
  for (const p of profiles) {
    try {
      if (p.browser === "firefox") {
        const logins = readJson<{ logins?: { hostname?: string; timeLastUsed?: number; timePasswordChanged?: number }[] }>(path.join(p.dir, "logins.json"));
        for (const l of logins?.logins ?? []) {
          const host = l.hostname ? hostOf(l.hostname) : undefined;
          if (host) out.push({ domain: baseDomain(host), host, browser: p.browserName, ...(l.timeLastUsed ? { lastUsed: l.timeLastUsed } : {}), ...(l.timePasswordChanged ? { passwordChanged: l.timePasswordChanged } : {}) });
        }
        continue;
      }
      for (const file of ["Login Data", "Login Data For Account"]) {
        const rows = await readSqliteCopy(path.join(p.dir, file), "SELECT origin_url, username_value, date_last_used, date_password_modified, date_created FROM logins WHERE blacklisted_by_user = 0");
        for (const r of rows) {
          const host = hostOf(String(r.origin_url));
          if (!host) continue;
          const lastUsed = chromeTimeToMs(r.date_last_used as number);
          const changed = Math.max(chromeTimeToMs(r.date_password_modified as number), chromeTimeToMs(r.date_created as number));
          out.push({ domain: baseDomain(host), host, browser: p.browserName, ...(lastUsed > 0 ? { lastUsed } : {}), ...(changed > 0 ? { passwordChanged: changed } : {}), ...(r.username_value ? { username: String(r.username_value) } : {}) });
        }
      }
    } catch {
      // skip
    }
  }
  return out;
};

export type BrowserDownload = {
  path: string;
  url: string;
  referrer?: string;
  tabUrl?: string;
  startedAt: number;
  mime?: string;
  bytes?: number;
  dangerType?: number;
  browser: string;
};

export const browserDownloads = async (profiles: BrowserProfile[], sinceMs: number): Promise<BrowserDownload[]> => {
  const out: BrowserDownload[] = [];
  for (const p of profiles) {
    if (p.browser === "firefox") continue;
    try {
      const rows = await readSqliteCopy(
        path.join(p.dir, "History"),
        `SELECT d.id, d.target_path, d.start_time, d.mime_type, d.total_bytes, d.danger_type, d.referrer, d.tab_url,
                (SELECT url FROM downloads_url_chains c WHERE c.id = d.id ORDER BY chain_index DESC LIMIT 1) AS url
         FROM downloads d WHERE d.start_time > ? AND d.target_path != ''`,
        msToChromeTime(sinceMs),
      );
      for (const r of rows) {
        out.push({
          path: String(r.target_path),
          url: String(r.url ?? ""),
          ...(r.referrer ? { referrer: String(r.referrer) } : {}),
          ...(r.tab_url ? { tabUrl: String(r.tab_url) } : {}),
          startedAt: chromeTimeToMs(r.start_time as number),
          ...(r.mime_type ? { mime: String(r.mime_type) } : {}),
          ...(r.total_bytes ? { bytes: Number(r.total_bytes) } : {}),
          dangerType: Number(r.danger_type ?? 0),
          browser: p.browserName,
        });
      }
    } catch {
      // skip
    }
  }
  return out;
};

export type Extension = {
  browser: BrowserId;
  browserName: string;
  profile: string;
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  /** From the browser's own store. */
  fromStore: boolean;
  /** Installed by policy/company or bundled with the browser. */
  managed: boolean;
  installedAt?: number;
  permissions: string[];
  hostPermissions: string[];
  updateUrl?: string;
  path?: string;
};

const resolveMessage = (dir: string, value: string | undefined, defaultLocale?: string): string | undefined => {
  if (!value) return value;
  const m = value.match(/^__MSG_(.+)__$/);
  if (!m) return value;
  const key = m[1]!.toLowerCase();
  for (const loc of [defaultLocale, "en", "en_US", "en_GB"].filter(Boolean) as string[]) {
    const msgs = readJson<Record<string, { message?: string }>>(path.join(dir, "_locales", loc, "messages.json"));
    if (!msgs) continue;
    for (const [k, v] of Object.entries(msgs)) if (k.toLowerCase() === key && v.message) return v.message;
  }
  return value;
};

type ChromeExtPref = {
  location?: number;
  from_webstore?: boolean;
  state?: number;
  disable_reasons?: number | number[];
  install_time?: string;
  first_install_time?: string;
  path?: string;
  manifest?: Record<string, unknown>;
  was_installed_by_default?: boolean;
  was_installed_by_oem?: boolean;
  granted_permissions?: { api?: string[]; explicit_host?: string[]; scriptable_host?: string[] };
};

/** Chromium location codes: 1 internal(store/user), 2 external pref, 4 unpacked, 5 component, 7 external policy download, 8 command line, 10 external component. */
const MANAGED_LOCATIONS = new Set([5, 10, 7, 9]);

export const listExtensions = (profiles: BrowserProfile[]): Extension[] => {
  const out: Extension[] = [];
  for (const p of profiles) {
    if (p.browser === "firefox") {
      const data = readJson<{ addons?: Array<Record<string, any>> }>(path.join(p.dir, "extensions.json"));
      for (const a of data?.addons ?? []) {
        if (a.type !== "extension" || a.location === "app-builtin" || a.location === "app-system-defaults") continue;
        out.push({
          browser: "firefox",
          browserName: p.browserName,
          profile: p.profileName,
          id: String(a.id),
          name: String(a.defaultLocale?.name ?? a.id),
          version: String(a.version ?? ""),
          enabled: Boolean(a.active),
          fromStore: a.sourceURI ? String(a.sourceURI).includes("addons.mozilla.org") : a.signedState === 2,
          managed: a.location === "app-system-share" || a.location === "app-global",
          ...(a.installDate ? { installedAt: Number(a.installDate) } : {}),
          permissions: (a.userPermissions?.permissions ?? []) as string[],
          hostPermissions: (a.userPermissions?.origins ?? []) as string[],
          ...(a.path ? { path: String(a.path) } : {}),
        });
      }
      continue;
    }
    const prefs = { ...(readJson<any>(path.join(p.dir, "Preferences"))?.extensions?.settings ?? {}), ...(readJson<any>(path.join(p.dir, "Secure Preferences"))?.extensions?.settings ?? {}) } as Record<string, ChromeExtPref>;
    for (const [id, s] of Object.entries(prefs)) {
      if (!s || typeof s !== "object") continue;
      if (MANAGED_LOCATIONS.has(s.location ?? 0) && s.location !== 7) continue; // components that ship inside the browser
      let manifest = s.manifest as Record<string, any> | undefined;
      let extDir: string | undefined;
      if (s.path) {
        extDir = path.isAbsolute(s.path) ? s.path : path.join(p.dir, "Extensions", s.path);
        manifest = readJson<Record<string, any>>(path.join(extDir, "manifest.json")) ?? manifest;
      }
      if (!manifest) continue;
      if (manifest.theme || manifest.app?.launch) continue; // themes and old hosted apps
      const disableReasons = Array.isArray(s.disable_reasons) ? s.disable_reasons.length : Number(s.disable_reasons ?? 0);
      const enabled = s.state !== undefined ? s.state === 1 : disableReasons === 0;
      const installTime = s.first_install_time ?? s.install_time;
      const name = resolveMessage(extDir ?? "", manifest.name, manifest.default_locale) ?? id;
      if (s.was_installed_by_default && s.location !== 4) continue;
      const contentHosts = ((manifest.content_scripts ?? []) as Array<{ matches?: string[] }>).flatMap((c) => c.matches ?? []);
      out.push({
        browser: p.browser,
        browserName: p.browserName,
        profile: p.profileName,
        id,
        name,
        version: String(manifest.version ?? ""),
        enabled,
        fromStore: s.from_webstore === true || (typeof manifest.update_url === "string" && /clients2\.google\.com|edge\.microsoft\.com/.test(manifest.update_url)),
        managed: s.location === 7 || s.location === 9,
        ...(installTime ? { installedAt: chromeTimeToMs(Number(installTime)) } : {}),
        permissions: (manifest.permissions ?? []).filter((x: unknown) => typeof x === "string" && !/[:/*]/.test(x as string)),
        hostPermissions: [...(manifest.host_permissions ?? []), ...(manifest.permissions ?? []).filter((x: unknown) => typeof x === "string" && /[:/*]/.test(x as string)), ...contentHosts],
        ...(manifest.update_url ? { updateUrl: String(manifest.update_url) } : {}),
        ...(extDir ? { path: extDir } : {}),
      });
    }
  }
  return out;
};

export const listDirSafe = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
