"use client";

import { useEffect } from "react";

// The landing's long sections use `content-visibility: auto`, so the browser skips laying out the
// ones far from the screen. A skipped section takes the height it last had when it was drawn
// (`contain-intrinsic-size: auto …`), and only a guess before that. The guesses can't be right at
// every width, so without this the page's height changes as sections get drawn: "Get Stella"
// overshoots into the footer, a reload lands in the wrong section, and the scrollbar jumps.
//
// This draws every section once (when the page is idle, after a resize, or right before an in-page
// link jumps), which makes the browser remember each real height. Skipping then resumes, so
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

    // A reload or back/forward restores the old scroll offset, and a #link jumps, as soon as the page
    // is laid out: draw everything right away so they land where the reader was.
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (location.hash || window.scrollY > 0 || nav?.type === "reload" || nav?.type === "back_forward") {
      settle();
    } else if (typeof window.requestIdleCallback === "function") {
      idleCallback = window.requestIdleCallback(settle, { timeout: 3000 });
    } else {
      idleTimer = window.setTimeout(settle, 1500);
    }

    // Section heights follow the width (and svh, which the phone toolbar doesn't change), so only a
    // width change needs a redraw; phones fire resize on every toolbar show/hide while scrolling.
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      settled = false;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(settle, 250);
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
    };
  }, []);

  return null;
}
