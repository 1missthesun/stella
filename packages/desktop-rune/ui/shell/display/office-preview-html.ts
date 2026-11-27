export type OfficeOutlineKind = "presentation" | "document";
export type OfficeOutlineEntry = { label: string; level: number };
export type OfficeSheetTab = { index: number; name: string };
export type OfficePreviewMeta = { count: number; sheets: OfficeSheetTab[]; activeSheet: number | null };

export const SLIDE_SELECTOR = ".slide-container, [data-slide-index]";
export const HEADING_SELECTOR = "h1, h2, h3";
const SLIDE_HEADING_SELECTOR = "h1, h2, h3, .title, [class*='title']";
const PAGE_SELECTOR = "section, article, .page, [data-page]";
const MAX_ENTRIES = 80;

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number(key.slice(1)));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[key] ?? entity;
  });

/** Every element opened so far, in document order: what tells one element's matches from another's. */
const counter = () => {
  let index = 0;
  return { handler: { element: () => void index++ }, current: () => index };
};

/** desktop-ui's `parsePreviewMeta` (DOMParser) with Bun's HTMLRewriter. */
export function parseOfficePreviewMeta(html: string | undefined, kind: "document" | "spreadsheet" | "presentation"): OfficePreviewMeta {
  const empty: OfficePreviewMeta = { count: 0, sheets: [], activeSheet: null };
  if (!html) return empty;
  const order = counter();
  if (kind === "spreadsheet") {
    const tabs: { index: number; active: boolean; text: string }[] = [];
    let open: { index: number; active: boolean; text: string } | null = null;
    new HTMLRewriter()
      .on("*", order.handler)
      .on(".sheet-tab[data-sheet]", {
        element(el) {
          const index = Number(el.getAttribute("data-sheet"));
          const tab = { index, active: (el.getAttribute("class") ?? "").split(/\s+/).includes("active"), text: "" };
          tabs.push(tab);
          open = tab;
          el.onEndTag(() => {
            if (open === tab) open = null;
          });
        },
        text(chunk) {
          if (open) open.text += chunk.text;
        },
      })
      .transform(html);
    const sheets: OfficeSheetTab[] = [];
    let activeSheet: number | null = null;
    for (const tab of tabs) {
      if (!Number.isInteger(tab.index)) continue;
      sheets.push({ index: tab.index, name: squash(decode(tab.text)) || String(tab.index + 1) });
      if (activeSheet === null && tab.active) activeSheet = tab.index;
    }
    return { count: sheets.length, sheets, activeSheet: activeSheet ?? sheets[0]?.index ?? null };
  }
  const seen = new Set<number>();
  new HTMLRewriter()
    .on("*", order.handler)
    .on(kind === "presentation" ? SLIDE_SELECTOR : PAGE_SELECTOR, { element: () => void seen.add(order.current()) })
    .transform(html);
  return { ...empty, count: seen.size };
}

/** desktop-ui's `parseOfficeOutline` (DOMParser) with Bun's HTMLRewriter. */
export function parseOfficeOutline(html: string | undefined, kind: OfficeOutlineKind): OfficeOutlineEntry[] {
  if (!html) return [];
  const order = counter();
  if (kind === "presentation") {
    type Slide = { element: number; all: string; heading: string | null; capturing: number | null };
    const slides: Slide[] = [];
    const openSlides: Slide[] = [];
    let lastAll: unknown = null;
    let lastHeading: unknown = null;
    new HTMLRewriter()
      .on("*", order.handler)
      .on(SLIDE_SELECTOR, {
        element(el) {
          const slide: Slide = { element: order.current(), all: "", heading: null, capturing: null };
          slides.push(slide);
          openSlides.push(slide);
          el.onEndTag(() => {
            openSlides.splice(openSlides.indexOf(slide), 1);
          });
        },
        text(chunk) {
          if (chunk === lastAll) return;
          lastAll = chunk;
          for (const slide of openSlides) slide.all += chunk.text;
        },
      })
      .on(SLIDE_HEADING_SELECTOR, {
        element(el) {
          const element = order.current();
          const captured = openSlides.filter((slide) => slide.heading === null && slide.element !== element);
          if (captured.length === 0) return;
          for (const slide of captured) {
            slide.heading = "";
            slide.capturing = element;
          }
          el.onEndTag(() => {
            for (const slide of captured) if (slide.capturing === element) slide.capturing = null;
          });
        },
        text(chunk) {
          if (chunk === lastHeading) return;
          lastHeading = chunk;
          for (const slide of openSlides) if (slide.capturing !== null) slide.heading += chunk.text;
        },
      })
      .transform(html);
    const clean = (text: string) => text.replace(/^slide\s+\d+\s*[:.\-–]?\s*/i, "");
    return slides.slice(0, MAX_ENTRIES).map((slide, index) => {
      const heading = clean(squash(decode(slide.heading ?? "")));
      const fallback = clean(squash(decode(slide.all))).slice(0, 60);
      return { label: heading || fallback || `Slide ${index + 1}`, level: 1 };
    });
  }
  const headings: { level: number; text: string }[] = [];
  let open: { level: number; text: string } | null = null;
  let last: unknown = null;
  new HTMLRewriter()
    .on(HEADING_SELECTOR, {
      element(el) {
        const heading = { level: Number(el.tagName.slice(1)) || 1, text: "" };
        headings.push(heading);
        const outer = open;
        open = heading;
        el.onEndTag(() => {
          open = outer;
          if (outer) outer.text += heading.text;
        });
      },
      text(chunk) {
        if (chunk === last) return;
        last = chunk;
        if (open) open.text += chunk.text;
      },
    })
    .transform(html);
  return headings
    .map((heading) => ({ label: squash(decode(heading.text)), level: heading.level }))
    .filter((entry) => entry.label.length > 0)
    .slice(0, MAX_ENTRIES);
}

/**
 * desktop-ui's `injectPreviewChrome`. The iframe there is sandboxed without scripts; a WebView
 * has no sandbox, so the document's own scripts are refused by its CSP instead (the WebView's
 * injected scripts still run).
 */
export function injectOfficePreviewChrome(html: string, zoomPercent: number, sheet: number | null): string {
  const sheetRules =
    sheet === null
      ? ""
      : `
  .sheet-tabs,
  .sheet-content {
    display: none !important;
  }
  .sheet-content[data-sheet="${sheet}"] {
    display: flex !important;
    flex-direction: column;
  }`;
  const style = `
<meta http-equiv="Content-Security-Policy" content="script-src 'none'">
<style id="stella-artifact-preview-style">
  html {
    background: #f7f7f8 !important;
  }
  body {
    zoom: ${zoomPercent / 100};
  }
  .file-title {
    display: none !important;
  }${sheetRules}
</style>`;
  return html.includes("</head>") ? html.replace("</head>", `${style}</head>`) : `${style}${html}`;
}

/** The outline rail's half inside the WebView: which entry is in view, and jumping to one. */
export const officeOutlinePreload = (kind: OfficeOutlineKind) => `(() => {
  const SELECTOR = ${JSON.stringify(kind === "presentation" ? SLIDE_SELECTOR : HEADING_SELECTOR)};
  const headings = ${kind === "document"};
  const textOf = (node) => (node && node.textContent || "").replace(/\\s+/g, " ").trim();
  const targets = () => Array.from(document.querySelectorAll(SELECTOR)).filter((node) => !headings || textOf(node).length > 0);
  const scrollContainerOf = (node) => {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (el === document.body || el === document.documentElement) break;
      const { overflowY } = getComputedStyle(el);
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
    }
    return document.scrollingElement || document.documentElement;
  };
  const viewportTopOf = (container) => container === (document.scrollingElement || document.documentElement) ? 0 : container.getBoundingClientRect().top;
  let jumpUntil = 0;
  let current = -1;
  const report = (index) => {
    if (index === current) return;
    current = index;
    window.parent.postMessage({ type: "stella:office-outline-current", index }, "*");
  };
  document.addEventListener("scroll", () => {
    if (performance.now() < jumpUntil) return;
    const list = targets();
    const first = list[0];
    if (!first) return;
    const line = viewportTopOf(scrollContainerOf(first)) + 48;
    let index = 0;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].getBoundingClientRect().top <= line) index = i;
      else break;
    }
    report(index);
  }, { capture: true, passive: true });
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "stella:office-outline-jump" || typeof data.index !== "number") return;
    const target = targets()[data.index];
    if (!target) return;
    const container = scrollContainerOf(target);
    const top = target.getBoundingClientRect().top - viewportTopOf(container) + container.scrollTop;
    jumpUntil = performance.now() + 700;
    current = data.index;
    container.scrollTo({ top, behavior: "smooth" });
  });
})();`;
