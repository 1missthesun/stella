"use client";

import { useEffect } from "react";

// The landing's long sections use `content-visibility: auto`, so the browser skips laying out the
// ones far from the screen. A skipped section takes the height it last had when it was drawn
// (`contain-intrinsic-size: auto …`), and only a guess before that. The guesses can't be right at
// every width, so without this the page's height changes as sections get drawn: "Get Stella"
// overshoots into the footer, a reload lands in the wrong section, and the scrollbar jumps.
//
// This draws every section once (one per idle moment after load or a width change; all at once
// right before an in-page link jumps or a reload restores), which makes the browser remember each real height. Skipping then resumes, so
// off-screen sections still cost nothing while you read or scroll.
export function ContentVisibilitySettle() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-landing-root]");
    if (!root) return;
    let settled = false;
    let release = 0;
    let idleCallback = 0;
    let idleTimer = 0;
    let resizeTimer = 0;

    // Everything at once: for a jump that has to land right now (#link, reload, back/forward).
    const settle = () => {
      root.dataset.cvRender = "1";
      // The browser records the drawn heights at the end of the next frame; keep one more for safety.
      cancelAnimationFrame(release);
      release = requestAnimationFrame(() => {
        release = requestAnimationFrame(() => {
          delete root.dataset.cvRender;
          settled = true;
        });
      });
    };

    // One section per idle slot otherwise, so drawing them never becomes one long task that
    // blocks a tap while the page is still loading.
    const sections = () =>
      Array.from(root.querySelectorAll<HTMLElement>(":scope > main > section, :scope > footer")).filter(
        (el) => getComputedStyle(el).contentVisibility === "auto",
      );
    let queue: HTMLElement[] = [];
    const later = (fn: () => void) => {
      if (typeof window.requestIdleCallback === "function") idleCallback = window.requestIdleCallback(fn, { timeout: 2000 });
      else idleTimer = window.setTimeout(fn, 50);
    };
    const drawNext = () => {
      const el = queue.shift();
      if (!el) {
        settled = true;
        return;
      }
      el.dataset.cvRender = "1";
      release = requestAnimationFrame(() => {
        release = requestAnimationFrame(() => {
          delete el.dataset.cvRender;
          later(drawNext);
        });
      });
    };
    const settleGently = () => {
      queue = sections();
      later(drawNext);
    };

    // A reload or back/forward restores the old scroll offset, and a #link jumps, as soon as the page
    // is laid out: draw everything right away so they land where the reader was.
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (location.hash || window.scrollY > 0 || nav?.type === "reload" || nav?.type === "back_forward") {
      settle();
    } else {
      settleGently();
    }

    // Section heights follow the width (and svh, which the phone toolbar doesn't change), so only a
    // width change needs a redraw; phones fire resize on every toolbar show/hide while scrolling.
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      settled = false;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(settleGently, 250);
    };

    // In-page links: draw everything before the browser works out where the target is.
    const onClick = (event: MouseEvent) => {
      if (settled || event.defaultPrevented) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      const href = link?.getAttribute("href") ?? "";
      if (href.startsWith("#") || href.startsWith("/#")) {
        root.dataset.cvRender = "1";
        void root.offsetHeight;
        settle();
      }
    };

    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("click", onClick, true);
      window.clearTimeout(resizeTimer);
      if (idleCallback) window.cancelIdleCallback(idleCallback);
      window.clearTimeout(idleTimer);
      cancelAnimationFrame(release);
      delete root.dataset.cvRender;
      queue = [];
      root.querySelectorAll<HTMLElement>("[data-cv-render]").forEach((el) => delete el.dataset.cvRender);
    };
  }, []);

  return null;
}
