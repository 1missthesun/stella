import type { BrowserProfile } from "../browsers.ts";
import { chromeBar, edgeBar, firefoxBar, type BrowserBar } from "../reference.ts";
import type { BrowserId, Finding, HandledLine } from "../types.ts";
import { OS, compareVersions } from "../util.ts";

export const checkBrowserUpdates = async (profiles: BrowserProfile[]): Promise<{ findings: Finding[]; handled: HandledLine[]; errors: string[] }> => {
  const findings: Finding[] = [];
  const handled: HandledLine[] = [];
  const errors: string[] = [];
  const installed = new Map<string, { name: string; version: string }>();
  for (const p of profiles) if (p.version && (p.browser === "chrome" || p.browser === "edge" || p.browser === "firefox")) installed.set(p.browser, { name: p.browserName, version: p.version });
  const bars = new Map<string, BrowserBar>();
  await Promise.all(
    [...installed.keys()].map(async (b) => {
      try {
        const bar = b === "chrome" ? await chromeBar() : b === "edge" ? await edgeBar() : await firefoxBar();
        if (bar) bars.set(b, bar);
      } catch (e) {
        errors.push(`${b}: ${(e as Error).message}`);
      }
    }),
  );
  for (const [b, info] of installed) {
    const bar = bars.get(b);
    if (!bar) continue;
    if (compareVersions(info.version, bar.mustHave) < 0) {
      const days = Math.floor((Date.now() - bar.mustHaveSince) / 86_400_000);
      const autoUpdates = !(OS === "linux" && b !== "firefox");
      findings.push({
        id: `browser-update:${b}:${bar.mustHave}`,
        kind: "update",
        title: autoUpdates ? `Restart ${info.name} to update it` : `Update ${info.name}`,
        detail: `${info.name} ${info.version} is missing security fixes that came out ${days} days ago. ${autoUpdates ? "Restarting it installs them." : "Your system's updater installs them."}`,
        needsYou: true,
        urgency: 60,
        ...(autoUpdates ? { action: { kind: "open" as const, label: `Update ${info.name}`, url: b === "firefox" ? "about:preferences#general" : b === "edge" ? "edge://settings/help" : "chrome://settings/help", browser: b as BrowserId } } : {}),
        evidence: { installed: info.version, mustHave: bar.mustHave, latest: bar.latest },
      });
    } else {
      handled.push({ id: `browser-current:${b}`, text: `${info.name} is up to date`, at: Date.now() });
    }
  }
  return { findings, handled, errors };
};
