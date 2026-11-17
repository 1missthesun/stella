import os from "node:os";
import { emailExposure, emailExposureFindings, siteBreachFindings } from "./accounts/breaches.ts";
import { browserDownloads, listExtensions, listProfiles, savedLogins, siteUse, type Extension } from "./browsers.ts";
import { checkBrowserUpdates } from "./checks/browser-updates.ts";
import { enrichForJudging, installedApps, recentDownloads, startupItems, type InventoryItem } from "./checks/inventory.ts";
import { checkEncryption, checkFirewall, checkScreenLock, checkSystemUpdates } from "./checks/system.ts";
import { judgeChanges, type ChangeVerdict } from "./judge.ts";
import type { ModelClient, ModelUsage } from "./model.ts";
import { buildFeed, type Feed } from "./news/feed.ts";
import { matchThreats } from "./news/match.ts";
import { breachCatalog, macosBar } from "./reference.ts";
import { loadState, saveState, type State } from "./state.ts";
import type { Finding, FixAction, HandledLine, RunSummary } from "./types.ts";
import { DAY, OS } from "./util.ts";

export type MailCheck = (model: ModelClient, state: State) => Promise<{ findings: Finding[]; handled: HandledLine[]; usage: ModelUsage }>;

export type ScanOptions = {
  dataDir: string;
  model?: ModelClient;
  /** Model for the shared daily news digest (in production this comes ready-made from Stella's server). */
  newsModel?: ModelClient;
  /** Where to get the ready-made daily feed instead of building it here. */
  feedUrl?: string;
  /** The person's own email addresses (Stella account, browser profiles, connected mail). */
  emails?: string[];
  mail?: MailCheck;
  onProgress?: (line: string) => void;
};

const osLabel = () => `${OS === "darwin" ? "macOS" : OS === "win32" ? "Windows" : "Linux"} ${os.release()}`;

const extensionItem = (e: Extension): InventoryItem => ({
  key: `extension:${e.browser}:${e.profile}:${e.id}`,
  kind: "extension",
  name: e.name,
  facts: {
    browser: e.browserName,
    id: e.id,
    version: e.version,
    fromOfficialStore: e.fromStore,
    installedByCompanyPolicy: e.managed,
    enabled: e.enabled,
    permissions: e.permissions.slice(0, 20),
    sitesItCanRead: [...new Set(e.hostPermissions)].slice(0, 12),
    ...(e.installedAt ? { installed: new Date(e.installedAt).toISOString().slice(0, 10) } : {}),
    ...(e.path && !e.fromStore ? { folder: e.path } : {}),
    ...(e.updateUrl && !e.fromStore ? { updateUrl: e.updateUrl } : {}),
  },
});

const fixFor = (item: InventoryItem, v: ChangeVerdict): FixAction | undefined => {
  switch (v.action) {
    case "trash":
      return item.kind === "download" && typeof item.facts.path === "string" ? { kind: "trash", label: "Move to Trash", path: item.facts.path } : undefined;
    case "remove_extension": {
      const b = String(item.facts.browser ?? "Chrome").toLowerCase();
      const scheme = b.includes("edge") ? "edge" : b.includes("brave") ? "brave" : b.includes("firefox") ? "about" : "chrome";
      return scheme === "about"
        ? { kind: "open", label: "Remove it", url: "about:addons", browser: "firefox" }
        : { kind: "open", label: "Remove it", url: `${scheme}://extensions/?id=${item.facts.id}`, browser: (b.includes("edge") ? "edge" : b.includes("brave") ? "brave" : b.includes("chromium") ? "chromium" : "chrome") };
    }
    case "remove_startup":
      return OS === "darwin"
        ? { kind: "open", label: "Open Login Items", url: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension" }
        : OS === "win32"
          ? { kind: "open", label: "Open Startup apps", url: "ms-settings:startupapps" }
          : undefined;
    case "uninstall":
      return OS === "win32" ? { kind: "open", label: "Uninstall it", url: "ms-settings:appsfeatures" } : OS === "darwin" ? { kind: "open", label: "Show it", url: `file:///Applications/` } : undefined;
    default:
      return undefined;
  }
};

const ZERO: ModelUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, ms: 0 };

/** One full check. Reads the computer, asks the model only about what's new, and saves the result. */
export const runScan = async (opts: ScanOptions): Promise<RunSummary> => {
  const startedAt = Date.now();
  const state = loadState(opts.dataDir);
  const firstRun = !state.lastRun;
  const progress = opts.onProgress ?? (() => {});
  const errors: RunSummary["errors"] = [];
  const findings: Finding[] = [];
  const handled: HandledLine[] = [];
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const addUsage = (u: ModelUsage) => {
    if (!u.inputTokens && !u.outputTokens) return;
    usage.calls++;
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.costUsd += u.costUsd;
  };
  const guard = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      errors.push({ check: name, message: (e as Error).message });
      return undefined;
    }
  };

  progress("Looking at this computer");
  const profiles = listProfiles();
  const since = firstRun ? startedAt - 14 * DAY : Math.min(state.lastRun!.startedAt, startedAt - DAY);
  const [enc, fw, sys, lock, browsers, sites, logins, startup, apps, downloads, dlHistory] = await Promise.all([
    guard("encryption", checkEncryption),
    guard("firewall", checkFirewall),
    guard("system updates", async () => checkSystemUpdates(OS === "darwin" ? await macosBar().catch(() => undefined) : undefined)),
    guard("screen lock", checkScreenLock),
    guard("browser updates", () => checkBrowserUpdates(profiles)),
    guard("browsing", () => siteUse(profiles)),
    guard("saved passwords", () => savedLogins(profiles)),
    guard("startup items", startupItems),
    guard("apps", installedApps),
    guard("downloads", () => recentDownloads(since)),
    guard("download history", () => browserDownloads(profiles, since)),
  ]);
  for (const r of [enc, fw, sys, lock, browsers]) if (r) (findings.push(...r.findings), handled.push(...r.handled));
  if (browsers?.errors.length) for (const m of browsers.errors) errors.push({ check: "browser updates", message: m });
  const extensions = listExtensions(profiles);

  // Where each download came from, from the browser's own record.
  const fromHistory = new Map((dlHistory ?? []).map((d) => [d.path, d]));
  for (const d of downloads ?? []) {
    const h = fromHistory.get(String(d.facts.path));
    if (h) Object.assign(d.facts, { from: [h.url, h.referrer, h.tabUrl].filter(Boolean), browserWarned: (h.dangerType ?? 0) > 0 });
  }

  // ---- what's new since the last check -> the model judges it
  const inventory: InventoryItem[] = [...(startup ?? []), ...extensions.map(extensionItem), ...(downloads ?? []), ...(apps ?? [])];
  const fresh = inventory.filter((i) => !state.seen[i.key]);
  // The same extension in several browser profiles is one judgment.
  const sameAs = (i: InventoryItem) => (i.kind === "extension" ? `ext:${i.facts.browser}:${i.facts.id}:${i.facts.version}` : i.key);
  const toJudge = [...new Map(fresh.map((i) => [sameAs(i), i])).values()];
  if (toJudge.length && opts.model) {
    await enrichForJudging(toJudge);
    progress(`Checking ${toJudge.length} new thing${toJudge.length === 1 ? "" : "s"}`);
    const batches: InventoryItem[][] = [];
    for (let i = 0; i < toJudge.length; i += 40) batches.push(toJudge.slice(i, i + 40));
    // A first check can be a few hundred apps: three batches at a time.
    for (let i = 0; i < batches.length; i += 3)
      await Promise.all(
        batches.slice(i, i + 3).map(async (batch) => {
          const res = await guard("judge", () => judgeChanges(opts.model!, batch, osLabel()));
          if (!res) return;
          addUsage(res.usage);
          for (const v of res.verdicts) {
            const item = batch.find((b) => b.key === v.key);
            if (!item) continue;
            for (const twin of fresh.filter((f) => sameAs(f) === sameAs(item))) state.seen[twin.key] = { firstSeen: startedAt, name: twin.name, kind: twin.kind, verdict: v };
          }
        }),
      );
  }
  // Every judged item that isn't fine stays a finding until it's gone from the computer.
  const present = new Set(inventory.map((i) => i.key));
  const counts: Record<string, number> = {};
  for (const i of toJudge) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  for (const [key, seen] of Object.entries(state.seen)) {
    if (!present.has(key)) continue;
    const v = seen.verdict;
    if (!v || v.verdict === "fine") continue;
    const item = inventory.find((i) => i.key === key)!;
    const action = fixFor(item, v);
    findings.push({
      id: `item:${key}`,
      kind: item.kind === "extension" ? "extension" : item.kind === "download" ? "download" : item.kind === "startup" ? "startup" : "app",
      title: v.title,
      detail: v.detail,
      needsYou: true,
      urgency: v.verdict === "danger" ? 80 : 35,
      ...(action ? { action } : {}),
      evidence: { name: item.name, ...item.facts, verdict: v.verdict },
    });
  }
  const label: Record<string, string> = { download: "new download", extension: "browser extension", startup: "thing that starts with your computer", app: "new app" };
  for (const [k, n] of Object.entries(counts)) handled.push({ id: `checked:${k}`, text: `Checked ${n} ${firstRun ? label[k]!.replace("new ", "") : label[k]}${n === 1 ? "" : k === "startup" ? "s" : "s"}`.replace("things that starts", "things that start").replace(/thing that starts with your computers$/, "things that start with your computer"), at: Date.now() });
  const uniqueExtensions = new Set(extensions.map((e) => `${e.browser}:${e.id}`)).size;
  if (firstRun && uniqueExtensions && !counts.extension) handled.push({ id: "checked:extension", text: `Checked ${uniqueExtensions} browser extensions`, at: Date.now() });

  // ---- accounts: public breach list vs saved passwords; your email vs known leaks
  progress("Checking your accounts against known leaks");
  const catalog =
    state.breachCatalog && Date.now() - state.breachCatalog.at < DAY
      ? state.breachCatalog.list
      : await guard("breach list", async () => {
          const list = await breachCatalog();
          state.breachCatalog = { at: Date.now(), list };
          return list;
        });
  if (catalog && logins) {
    const r = siteBreachFindings(catalog, logins, sites ?? new Map());
    findings.push(...r.findings);
    handled.push(...r.handled);
  }
  const emails = [...new Set([...(opts.emails ?? []), ...profiles.map((p) => p.email).filter(Boolean)].map((e) => e!.toLowerCase()))];
  state.emailLeaks ??= {};
  for (const email of emails) {
    const cached = state.emailLeaks[email];
    const leaks = cached && Date.now() - cached.at < DAY ? cached.leaks : await guard(`leak check ${email}`, async () => {
      const l = await emailExposure(email);
      state.emailLeaks![email] = { at: Date.now(), leaks: l };
      return l;
    });
    if (leaks) {
      const r = emailExposureFindings(email, leaks as never, logins ?? []);
      findings.push(...r.findings);
      handled.push(...r.handled);
    }
  }

  // ---- today's news vs this person
  progress("Reading today's security news");
  let feed: Feed | undefined = state.feed;
  if (!feed || Date.now() - Date.parse(feed.builtAt) > 12 * 3_600_000) {
    feed = await guard("news", async () => {
      if (opts.feedUrl) {
        const r = await fetch(opts.feedUrl, { signal: AbortSignal.timeout(20_000) });
        if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
        return (await r.json()) as Feed;
      }
      if (!opts.newsModel && !opts.model) throw new Error("no model for the news digest");
      const f = await buildFeed(opts.newsModel ?? opts.model!);
      addUsage(f.usage);
      return f;
    });
    if (feed) state.feed = feed;
  }
  if (feed) {
    const r = matchThreats(feed.threats, {
      sites: sites ?? new Map(),
      logins: logins ?? [],
      apps: apps ?? [],
      extensions,
      browsers: profiles.filter((p) => p.version).map((p) => ({ name: p.browserName, version: p.version! })),
    });
    findings.push(...r.findings);
    handled.push(...r.handled);
  }

  // ---- connected email
  if (opts.mail && opts.model) {
    progress("Checking your email");
    const r = await guard("email", () => opts.mail!(opts.model!, state));
    if (r) {
      addUsage(r.usage);
      findings.push(...r.findings);
      handled.push(...r.handled);
    }
  }

  // ---- what the person sees
  const ids = new Set(findings.map((f) => f.id));
  for (const [id, fx] of Object.entries(state.fixed)) {
    if (!ids.has(id)) {
      handled.unshift({ id: `fixed:${id}`, text: fx.title, at: fx.at });
      if (Date.now() - fx.at > 7 * DAY) delete state.fixed[id];
    }
  }
  const needsYou = findings
    .filter((f) => f.needsYou && !(state.snoozed[f.id] && state.snoozed[f.id]! > Date.now()))
    .sort((a, b) => b.urgency - a.urgency);
  const summary: RunSummary = { startedAt, finishedAt: Date.now(), needsYou, handled, findings, errors, model: usage };
  state.lastRun = summary;
  state.handledLog = [...handled, ...state.handledLog].slice(0, 60);
  saveState(opts.dataDir, state);
  return summary;
};

export const snooze = (dataDir: string, id: string, days = 7) => {
  const s = loadState(dataDir);
  s.snoozed[id] = Date.now() + days * DAY;
  if (s.lastRun) s.lastRun.needsYou = s.lastRun.needsYou.filter((f) => f.id !== id);
  saveState(dataDir, s);
};

export const markFixed = (dataDir: string, id: string, title: string) => {
  const s = loadState(dataDir);
  s.fixed[id] = { at: Date.now(), title };
  if (s.lastRun) {
    s.lastRun.needsYou = s.lastRun.needsYou.filter((f) => f.id !== id);
    s.lastRun.handled = [{ id: `fixed:${id}`, text: title, at: Date.now() }, ...s.lastRun.handled];
  }
  saveState(dataDir, s);
};
