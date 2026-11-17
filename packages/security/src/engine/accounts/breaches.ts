import type { SavedLogin, SiteUse } from "../browsers.ts";
import type { PublicBreach } from "../reference.ts";
import type { Finding, HandledLine } from "../types.ts";
import { DAY, baseDomain } from "../util.ts";

const fmtMonth = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric" });

const changePasswordUrl = (domain: string) => `https://${domain}/.well-known/change-password`;

const isReal = (b: PublicBreach) => b.IsVerified && !b.IsFabricated && !b.IsSpamList && !b.IsMalware && Boolean(b.Domain);

/**
 * Sites you have a saved password for that leaked passwords AFTER you last set it there.
 * Uses only the public breach list; nothing about you leaves the computer.
 */
export const siteBreachFindings = (catalog: PublicBreach[], logins: SavedLogin[], use: Map<string, SiteUse>): { findings: Finding[]; handled: HandledLine[] } => {
  const findings: Finding[] = [];
  const handled: HandledLine[] = [];
  const byDomain = new Map<string, SavedLogin[]>();
  for (const l of logins) byDomain.set(l.domain, [...(byDomain.get(l.domain) ?? []), l]);
  let checked = 0;
  for (const b of catalog) {
    if (!isReal(b)) continue;
    const domain = baseDomain(b.Domain);
    const mine = byDomain.get(domain);
    if (!mine?.length) continue;
    checked++;
    const breachAt = Date.parse(b.BreachDate);
    const addedAt = Date.parse(b.AddedDate);
    const leakedPasswords = b.DataClasses.includes("Passwords");
    // Password set before the leak (or unknown) = the leaked one may still be the one in use.
    const stale = mine.some((l) => !l.passwordChanged || l.passwordChanged < breachAt);
    if (!stale) {
      handled.push({ id: `breach-ok:${b.Name}`, text: `${b.Title} leak: you've changed that password since`, at: Date.now() });
      continue;
    }
    const recent = Date.now() - addedAt < 90 * DAY;
    if (!leakedPasswords && !recent) continue;
    const site = use.get(domain);
    const activeUser = Boolean(site && Date.now() - site.lastVisit < 365 * DAY) || mine.some((l) => l.lastUsed && Date.now() - l.lastUsed < 365 * DAY);
    findings.push({
      id: `site-breach:${b.Name}`,
      kind: "breach",
      title: leakedPasswords ? `Change your ${b.Title} password` : `${b.Title} leaked your details`,
      detail: leakedPasswords
        ? `${b.Title} was hacked in ${fmtMonth(breachAt)} and passwords were stolen. Yours there is older than that. If you use it anywhere else, change it there too.`
        : `${b.Title} was hacked in ${fmtMonth(breachAt)} (${b.DataClasses.slice(0, 3).join(", ").toLowerCase()}). Expect convincing fake emails that mention it.`,
      needsYou: leakedPasswords,
      urgency: leakedPasswords ? (recent ? 70 : activeUser ? 50 : 25) : 10,
      ...(leakedPasswords ? { action: { kind: "open" as const, label: "Change password", url: changePasswordUrl(domain) } } : {}),
      evidence: { breach: b.Name, domain, breachDate: b.BreachDate, added: b.AddedDate, dataClasses: b.DataClasses, savedLogins: mine.length },
    });
  }
  if (checked === 0) handled.push({ id: "site-breaches", text: "None of your saved sites are in known leaks", at: Date.now() });
  return { findings, handled };
};

type XonDetail = { breach: string; domain: string; xposed_date: string; xposed_data: string; password_risk: string; verified?: string; details?: string };

/**
 * Leaks that contain this email address (XposedOrNot, free). The email address is the only
 * thing sent; it's said plainly in the app.
 */
export const emailExposure = async (email: string): Promise<XonDetail[]> => {
  const r = await fetch(`https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "StellaSecurity/0.1" } });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`leak check: HTTP ${r.status}`);
  const data = (await r.json()) as { ExposedBreaches?: { breaches_details?: XonDetail[] } | null };
  return data.ExposedBreaches?.breaches_details ?? [];
};

export const emailExposureFindings = (email: string, leaks: XonDetail[], logins: SavedLogin[]): { findings: Finding[]; handled: HandledLine[] } => {
  const findings: Finding[] = [];
  const handled: HandledLine[] = [];
  if (!leaks.length) {
    handled.push({ id: `email-clean:${email}`, text: `${email} isn't in any known leak`, at: Date.now() });
    return { findings, handled };
  }
  const byDomain = new Map<string, SavedLogin[]>();
  for (const l of logins) byDomain.set(l.domain, [...(byDomain.get(l.domain) ?? []), l]);
  let quiet = 0;
  for (const leak of leaks) {
    const domain = leak.domain ? baseDomain(leak.domain) : "";
    const year = parseInt(leak.xposed_date, 10);
    const leakAt = Number.isFinite(year) ? Date.UTC(year, 0, 1) : 0;
    const hasPassword = /password/i.test(leak.xposed_data);
    const mine = domain ? byDomain.get(domain) : undefined;
    const stale = mine?.some((l) => !l.passwordChanged || l.passwordChanged < leakAt + 365 * DAY);
    if (hasPassword && mine?.length && stale) {
      findings.push({
        id: `email-breach:${email}:${leak.breach}`,
        kind: "breach",
        title: `Change your ${leak.breach} password`,
        detail: `Your email ${email} and a password were in the ${leak.breach} leak (${leak.xposed_date}). Change it there, and anywhere you used the same one.`,
        needsYou: true,
        urgency: 55,
        action: { kind: "open", label: "Change password", url: changePasswordUrl(domain) },
        evidence: { leak },
      });
    } else quiet++;
  }
  if (quiet) handled.push({ id: `email-leaks:${email}`, text: `${email}: ${quiet} old leak${quiet === 1 ? "" : "s"}, nothing to do`, at: Date.now() });
  return { findings, handled };
};

