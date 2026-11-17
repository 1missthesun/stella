import type { Extension, SavedLogin, SiteUse } from "../browsers.ts";
import type { InventoryItem } from "../checks/inventory.ts";
import type { Threat } from "../judge.ts";
import type { Finding, HandledLine } from "../types.ts";
import { DAY, baseDomain, compareVersions } from "../util.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Is an installed app the one a story names? Exact-ish name match, never substring of short names. */
const sameApp = (installed: string, named: string) => {
  const a = norm(installed);
  const b = norm(named);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length >= 5 && (a.startsWith(b) || a.endsWith(b))) return true;
  // "Google Chrome" vs package "google-chrome"/"chrome"
  const stripped = b.replace(/^(google|microsoft|mozilla|apple|adobe)/, "");
  return stripped.length >= 4 && (a === stripped || a.startsWith(stripped));
};

export type MatchContext = {
  sites: Map<string, SiteUse>;
  logins: SavedLogin[];
  apps: InventoryItem[];
  extensions: Extension[];
  browsers: { name: string; version: string }[];
};

/**
 * Plain-code matching of the day's threats against what's on this computer. Nothing leaves it.
 * A match on a saved password or a visit inside the story's window is strong; a visit long
 * before the incident is not reported.
 */
export const matchThreats = (threats: Threat[], ctx: MatchContext): { findings: Finding[]; handled: HandledLine[] } => {
  const findings: Finding[] = [];
  const loginDomains = new Set(ctx.logins.map((l) => l.domain));
  const headsUp: HandledLine[] = [];
  for (const t of threats) {
    const reasons: string[] = [];
    let strong = false;
    // The fake sites themselves: having visited one is the strongest sign there is.
    for (const raw of t.badDomains ?? []) {
      const d = baseDomain(raw);
      const use = ctx.sites.get(d);
      if (use) {
        reasons.push(`you visited ${d} on ${new Date(use.lastVisit).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
        strong = true;
      }
    }
    // Sites
    for (const raw of t.domains ?? []) {
      const d = baseDomain(raw);
      const use = ctx.sites.get(d);
      const saved = loginDomains.has(d);
      if (!use && !saved) continue;
      const from = t.window?.from ? Date.parse(t.window.from) : NaN;
      const to = t.window?.to ? Date.parse(t.window.to) + DAY : NaN;
      if (Number.isFinite(from) && use && !saved) {
        // Only visits inside the window count for skimming-style incidents.
        if (use.lastVisit < from) continue;
        if (Number.isFinite(to) && use.lastVisit > to && use.visits <= 1) continue;
      } else if (!saved && use && Date.now() - use.lastVisit > 365 * DAY) continue;
      reasons.push(saved ? `you have a saved password for ${d}` : `you used ${d}${use ? ` (last ${new Date(use.lastVisit).toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : ""}`);
      if (t.kind === "breach" || t.kind === "skimming") strong = true;
    }
    // Apps (and browsers, which are apps too)
    for (const named of t.apps ?? []) {
      const installed = [...ctx.apps.map((a) => ({ name: a.name, version: String(a.facts.version ?? "") })), ...ctx.browsers].find((a) => sameApp(a.name, named.name));
      if (!installed) continue;
      if (named.fixedVersion && installed.version && compareVersions(installed.version.replace(/^\d+:/, ""), named.fixedVersion) >= 0) continue;
      reasons.push(`you have ${installed.name}${installed.version ? ` ${installed.version}` : ""}`);
      strong = true;
    }
    // Extensions
    for (const named of t.extensions ?? []) {
      const hit = ctx.extensions.find((e) => (named.id && e.id === named.id) || (!named.id && norm(e.name) === norm(named.name)));
      if (hit) {
        reasons.push(`the ${hit.name} extension is in ${hit.browserName}`);
        strong = true;
      }
    }
    if (!reasons.length) continue;
    // A scam that imitates a brand you use, or an outage, is worth a line, not an interruption.
    if (!strong || t.kind === "outage") {
      headsUp.push({ id: `news-headsup:${t.id}`, text: t.kind === "outage" ? t.headline : `Heads-up: ${t.headline.charAt(0).toLowerCase()}${t.headline.slice(1)}`, at: Date.now() });
      continue;
    }
    findings.push({
      id: `news:${t.id}`,
      kind: "news",
      title: t.title,
      detail: t.detail,
      needsYou: true,
      urgency: 50 + t.severity * 10,
      ...(t.sources[0] ? { action: actionFor(t) } : {}),
      evidence: { headline: t.headline, why: reasons, sources: t.sources, kind: t.kind },
    });
  }
  const handled: HandledLine[] = [
    { id: "news-today", text: findings.length ? `${threats.length} security stories today; ${findings.length} need${findings.length === 1 ? "s" : ""} you` : `${threats.length} security stor${threats.length === 1 ? "y" : "ies"} today; none put you at risk`, at: Date.now() },
    ...headsUp,
  ];
  return { findings, handled };
};

const actionFor = (t: Threat): NonNullable<Finding["action"]> => {
  const d = t.domains?.[0];
  if (t.action === "change_password" && d) return { kind: "open", label: "Change password", url: `https://${baseDomain(d)}/.well-known/change-password` };
  if (t.action === "update_app") return { kind: "open", label: "How to update", url: t.sources[0]! };
  return { kind: "open", label: "Read what happened", url: t.sources[0]! };
};
