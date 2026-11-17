import { DAY, OS, fetchJson } from "./util.ts";

/**
 * Facts that are the same for everyone (latest browser/OS versions, the public breach list).
 * Fetched from public sources; in production this comes inside the daily feed so each
 * computer makes one request instead of many.
 */
export type BrowserBar = { browser: "chrome" | "edge" | "firefox"; latest: string; mustHave: string; mustHaveSince: number };

/** Days a release may be out before we call someone behind (browsers update themselves in that time). */
export const UPDATE_GRACE_DAYS = 4;

const chromePlatform = () => (OS === "darwin" ? "mac" : OS === "win32" ? "win64" : "linux");

export const chromeBar = async (): Promise<BrowserBar | undefined> => {
  const url = `https://versionhistory.googleapis.com/v1/chrome/platforms/${chromePlatform()}/channels/stable/versions/all/releases?order_by=starttime%20desc&pageSize=40`;
  const data = await fetchJson<{ releases: { version: string; serving: { startTime: string }; fraction?: number }[] }>(url);
  const rel = data.releases.filter((r) => (r.fraction ?? 1) >= 0.99 || r.fraction === undefined);
  const cutoff = Date.now() - UPDATE_GRACE_DAYS * DAY;
  const latest = rel[0];
  const bar = rel.find((r) => Date.parse(r.serving.startTime) <= cutoff);
  if (!latest || !bar) return undefined;
  return { browser: "chrome", latest: latest.version, mustHave: bar.version, mustHaveSince: Date.parse(bar.serving.startTime) };
};

export const firefoxBar = async (): Promise<BrowserBar | undefined> => {
  const hist = await fetchJson<Record<string, string>>("https://product-details.mozilla.org/1.0/firefox_history_stability_releases.json");
  const major = await fetchJson<Record<string, string>>("https://product-details.mozilla.org/1.0/firefox_history_major_releases.json");
  const all = Object.entries({ ...hist, ...major }).map(([v, d]) => ({ v, t: Date.parse(d) })).sort((a, b) => b.t - a.t || b.v.localeCompare(a.v, undefined, { numeric: true }));
  const cutoff = Date.now() - UPDATE_GRACE_DAYS * DAY;
  const bar = all.find((x) => x.t <= cutoff);
  if (!all[0] || !bar) return undefined;
  return { browser: "firefox", latest: all[0].v, mustHave: bar.v, mustHaveSince: bar.t };
};

export const edgeBar = async (): Promise<BrowserBar | undefined> => {
  const products = await fetchJson<Array<{ Product: string; Releases: Array<{ Platform: string; ProductVersion: string; PublishedTime: string }> }>>("https://edgeupdates.microsoft.com/api/products");
  const plat = OS === "darwin" ? "MacOS" : OS === "win32" ? "Windows" : "Linux";
  const rel = (products.find((p) => p.Product === "Stable")?.Releases ?? []).filter((r) => r.Platform === plat).sort((a, b) => Date.parse(b.PublishedTime) - Date.parse(a.PublishedTime));
  const cutoff = Date.now() - UPDATE_GRACE_DAYS * DAY;
  const bar = rel.find((r) => Date.parse(r.PublishedTime) <= cutoff);
  if (!rel[0] || !bar) return undefined;
  return { browser: "edge", latest: rel[0].ProductVersion, mustHave: bar.ProductVersion, mustHaveSince: Date.parse(bar.PublishedTime) };
};

export type PublicBreach = {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  AddedDate: string;
  PwnCount: number;
  DataClasses: string[];
  IsVerified: boolean;
  IsSensitive: boolean;
  IsSpamList: boolean;
  IsFabricated: boolean;
  IsMalware?: boolean;
};

/** The public list of known breaches (Have I Been Pwned, free, no key, no personal data sent). */
export const breachCatalog = async (): Promise<PublicBreach[]> => fetchJson<PublicBreach[]>("https://haveibeenpwned.com/api/v3/breaches");

/** Latest macOS per major line plus how many security fixes each release carried (SOFA, maintained by the Mac admins community from Apple's own data). */
export type MacRelease = { version: string; released: number; cves: number; exploited: number };
export type MacBar = { majors: { major: string; name: string; latest: MacRelease; releases: MacRelease[] }[] };

export const macosBar = async (): Promise<MacBar | undefined> => {
  type Rel = { ProductVersion: string; ReleaseDate: string; UniqueCVEsCount?: number; ActivelyExploitedCVEs?: string[] };
  const data = await fetchJson<{ OSVersions: { OSVersion: string; Latest: Rel; SecurityReleases: Rel[] }[] }>("https://sofafeed.macadmins.io/v1/macos_data_feed.json");
  const rel = (r: Rel): MacRelease => ({ version: r.ProductVersion, released: Date.parse(r.ReleaseDate), cves: r.UniqueCVEsCount ?? 0, exploited: r.ActivelyExploitedCVEs?.length ?? 0 });
  const majors = data.OSVersions.map((o) => ({ major: o.Latest.ProductVersion.split(".")[0]!, name: o.OSVersion.replace(/\s+\d+$/, ""), latest: rel(o.Latest), releases: o.SecurityReleases.map(rel) }));
  return majors.length ? { majors } : undefined;
};
