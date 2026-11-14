import type { BrowserWorkerBackend } from "../worker-api.js";
import { delay, fieldOrSelf, type BrowserWorkerContext } from "./context.js";

export type PageSettleKind = "navigation" | "interaction";

const QUIET_MS = 300;
const INTERACTION_GRACE_MS = 150;
const SETTLE_CAP_MS = 3_000;

const NAVIGATION_ERROR =
  /context was destroyed|navigated or closed|cannot find context|promise was collected|detached/i;

const pageSettleSource = `async ({ kind, quietMs, graceMs, capMs }) => {
  const start = performance.now();
  let last = start;
  let active = false;
  let leaving = false;
  const bump = () => { last = performance.now(); active = true; };
  const leave = () => { leaving = true; };
  const shown = (element) => {
    if (!(element instanceof Element)) return false;
    if (element.checkVisibility && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1 && rect.bottom >= 0 && rect.top <= innerHeight;
  };
  const busy = () => {
    try {
      for (const element of document.querySelectorAll('[aria-busy="true"], [role="progressbar"]:not([aria-valuenow]), progress:not([value]), [class*="spinner" i], [class*="loading" i], [class*="loader" i], [class*="skeleton" i]')) {
        if (shown(element)) return true;
      }
      for (const animation of document.getAnimations()) {
        if (animation.playState === "running" && animation.effect?.getTiming().iterations === Infinity && shown(animation.effect.target)) return true;
      }
    } catch {}
    return false;
  };
  const observer = new MutationObserver(bump);
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "open", "disabled", "aria-busy", "aria-hidden", "aria-expanded", "src", "href"] });
  let resources;
  try { resources = new PerformanceObserver(bump); resources.observe({ type: "resource" }); } catch {}
  addEventListener("pagehide", leave);
  addEventListener("beforeunload", leave);
  try {
    while (performance.now() - start < capMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (leaving) return { state: "navigating" };
      if (document.readyState !== "complete") continue;
      const now = performance.now();
      const quiet = active ? now - last >= quietMs : now - start >= (kind === "interaction" ? graceMs : quietMs);
      if (quiet && !busy()) return { state: "settled", ms: Math.round(now - start) };
    }
    return { state: "timeout", ms: Math.round(performance.now() - start) };
  } finally {
    observer.disconnect();
    resources?.disconnect();
    removeEventListener("pagehide", leave);
    removeEventListener("beforeunload", leave);
  }
}`;

/**
 * Best effort: waits until the page has loaded and stopped changing (DOM,
 * finished resource loads, visible loading indicators), bounded by a short
 * cap. Never throws; a page that cannot be evaluated is left as is.
 */
export const createPageSettle =
  (command: BrowserWorkerContext["command"]) =>
  async (
    backend: BrowserWorkerBackend,
    tabId: number,
    kind: PageSettleKind,
  ): Promise<void> => {
    const deadline = Date.now() + SETTLE_CAP_MS;
    let current = kind;
    let navigating = false;
    for (;;) {
      const capMs = deadline - Date.now();
      if (capMs < 50) return;
      const options = {
        kind: current,
        quietMs: QUIET_MS,
        graceMs: INTERACTION_GRACE_MS,
        capMs,
      };
      let state: unknown;
      try {
        const data = await command(
          "evaluate",
          {
            tabId,
            script: `(${pageSettleSource})(${JSON.stringify(options)})`,
          },
          backend,
        );
        state = fieldOrSelf(fieldOrSelf(data, "result"), "state");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!navigating && !NAVIGATION_ERROR.test(message)) return;
        navigating = true;
        current = "navigation";
        await delay(50);
        continue;
      }
      if (state !== "navigating") return;
      navigating = true;
      current = "navigation";
      await delay(50);
    }
  };
