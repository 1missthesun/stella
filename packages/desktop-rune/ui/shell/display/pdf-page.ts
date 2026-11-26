import { dirname } from "node:path";
import type { Shadow, Tokens } from "../../theme/tokens";

export const PDF_SCHEME = "stella-pdf";
export const PDF_RAIL_MAX_PAGES = 80;
const PAGE_RAIL_THUMB_WIDTH = 76;

/** WebView2 serves a custom scheme as `http://<scheme>.localhost`; WKWebView and WebKitGTK as `<scheme>://localhost`. */
export const pdfViewerUrl = (path: string) => (process.platform === "win32" ? `http://${PDF_SCHEME}.localhost/${path}` : `${PDF_SCHEME}://localhost/${path}`);

const reactPdf = Bun.resolveSync("react-pdf", import.meta.dir);
/** The system WebViews (WebKit, WebView2) lag Chromium's newest built-ins, which pdf.js's modern build expects. */
const PDFJS = Bun.resolveSync("pdfjs-dist/legacy/build/pdf.min.mjs", dirname(reactPdf));
const PDFJS_WORKER = Bun.resolveSync("pdfjs-dist/legacy/build/pdf.worker.min.mjs", dirname(reactPdf));

const cssShadow = (shadows: Shadow[]) => shadows.map((s) => `${s.inset ? "inset " : ""}${s.x}px ${s.y}px ${s.blur}px ${s.spread ?? 0}px ${s.color}`).join(", ");

/** The page's custom properties: desktop-ui's for this theme. */
export function pdfPageTheme(tokens: Tokens): string {
  const vars: Record<string, string> = {
    ...tokens.vars,
    "--focus-ring": cssShadow(tokens.shadow.focusRing),
    "--radius-sm": "6px",
    "--font-size-xs": "11px",
  };
  return `:root{color-scheme:${tokens.dark ? "dark" : "light"};${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}

/** desktop-ui's pdf-viewer-card.css for the pages pane and page rail, with react-pdf's page markup. */
const PAGE_CSS = `
html,body{margin:0;height:100%;overflow:hidden;background:var(--background);-webkit-user-select:none;user-select:none;cursor:default}
.layout{display:flex;height:100%;min-height:0}
.rail{display:flex;flex:0 0 auto;flex-direction:column;align-items:center;gap:12px;width:112px;padding:14px 0;overflow-y:auto;border-right:1px solid var(--border-weak, var(--border));box-sizing:border-box;scrollbar-width:thin}
.rail[hidden]{display:none}
.rail-page{display:flex;flex-direction:column;align-items:center;gap:5px;padding:0;border:0;background:transparent;color:var(--text-weak);font-size:var(--font-size-xs);font-variant-numeric:tabular-nums;cursor:default}
.rail-thumb{overflow:hidden;border-radius:3px;background:white;box-shadow:0 0 0 1px var(--border);transition:box-shadow .12s ease;width:${PAGE_RAIL_THUMB_WIDTH}px}
.rail-page:hover .rail-thumb{box-shadow:0 0 0 1px var(--text-weak)}
.rail-page[data-current="true"]{color:var(--text-strong)}
.rail-page[data-current="true"] .rail-thumb{box-shadow:0 0 0 2px var(--primary, #3b82f6)}
.rail-page:focus-visible{outline:none}
.rail-page:focus-visible .rail-thumb{box-shadow:var(--focus-ring)}
.scroll{flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;overflow-x:hidden;padding:16px;background:var(--background)}
.document{display:flex;flex-direction:column;align-items:center;gap:16px}
.page-wrap{width:100%;display:flex;justify-content:center}
.page{background:white;box-shadow:0 0 0 1px var(--border);border-radius:var(--radius-sm);overflow:hidden;flex:none}
canvas{display:block}
@media (max-width:594px){.rail{display:none}}
`;

const PAGE_SCRIPT = `
import * as pdfjs from "./pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", location.href).href;
const RAIL_MAX = ${PDF_RAIL_MAX_PAGES};
const THUMB = ${PAGE_RAIL_THUMB_WIDTH};
const post = (data) => window.parent.postMessage(data, "*");
const rail = document.querySelector(".rail");
const scroll = document.querySelector(".scroll");
const docEl = document.querySelector(".document");
const theme = document.getElementById("theme");
const wantRail = document.body.dataset.rail === "true";
let pdf = null, sizes = [], current = 1, jumpUntil = 0, width = 0;
const pages = [], thumbs = [], drawn = new Map();

const draw = async (canvas, n, cssWidth) => {
  const key = canvas.dataset.key = n + "@" + cssWidth;
  const page = await pdf.getPage(n);
  if (canvas.dataset.key !== key) return;
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: cssWidth / base.width });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = Math.floor(viewport.width) + "px";
  canvas.style.height = Math.floor(viewport.height) + "px";
  await page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise.catch(() => {});
};

const sizeBox = (box, n, cssWidth) => {
  const [w, h] = sizes[n - 1];
  box.style.width = Math.floor(cssWidth) + "px";
  box.style.height = Math.floor((cssWidth * h) / w) + "px";
};

const visible = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const box = entry.target;
    const n = Number(box.dataset.n);
    const cssWidth = box.dataset.thumb ? THUMB : width;
    if (drawn.get(box) === cssWidth) continue;
    drawn.set(box, cssWidth);
    draw(box.firstChild, n, cssWidth);
  }
}, { rootMargin: "800px 0px" });

const layoutPages = () => {
  const next = Math.floor(scroll.getBoundingClientRect().width);
  if (next <= 0 || next === width) return;
  width = next;
  for (let i = 0; i < pages.length; i++) {
    sizeBox(pages[i], i + 1, width);
    drawn.delete(pages[i]);
    visible.unobserve(pages[i]);
    visible.observe(pages[i]);
  }
};

const setCurrent = (n) => {
  if (n === current) return;
  thumbs[current - 1]?.removeAttribute("data-current");
  thumbs[current - 1]?.removeAttribute("aria-current");
  current = n;
  thumbs[n - 1]?.setAttribute("data-current", "true");
  thumbs[n - 1]?.setAttribute("aria-current", "page");
  post({ type: "stella:pdf-page", page: n });
};

const trackPage = () => {
  const line = scroll.getBoundingClientRect().top + scroll.clientHeight / 3;
  let page = 1;
  for (const el of pages) {
    if (el.getBoundingClientRect().top > line) break;
    page = Number(el.dataset.n) || page;
  }
  setCurrent(page);
};

const goTo = (n) => {
  const el = pages[n - 1];
  if (!el) return;
  const top = el.parentElement.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
  jumpUntil = performance.now() + 700;
  setCurrent(n);
  scroll.scrollTo({ top, behavior: "smooth" });
};

let frame = 0;
scroll.addEventListener("scroll", () => {
  if (performance.now() < jumpUntil) return;
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; trackPage(); });
}, { passive: true });

let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layoutPages, width === 0 ? 0 : 100);
}).observe(scroll);

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "stella:pdf-goto" && typeof data.page === "number") goTo(data.page);
  if (data.type === "stella:pdf-theme" && typeof data.css === "string") theme.textContent = data.css;
});

try {
  pdf = await pdfjs.getDocument({ url: new URL("./document.pdf", location.href).href }).promise;
  const count = Math.max(pdf.numPages, 1);
  for (let n = 1; n <= pdf.numPages; n++) {
    const vp = (await pdf.getPage(n)).getViewport({ scale: 1 });
    sizes.push([vp.width, vp.height]);
  }
  width = Math.floor(scroll.getBoundingClientRect().width);
  for (let n = 1; n <= pdf.numPages; n++) {
    const wrap = document.createElement("div");
    wrap.className = "page-wrap";
    const box = document.createElement("div");
    box.className = "page";
    box.dataset.n = String(n);
    box.appendChild(document.createElement("canvas"));
    sizeBox(box, n, width);
    wrap.appendChild(box);
    docEl.appendChild(wrap);
    pages.push(box);
    visible.observe(box);
  }
  if (wantRail && count > 1) {
    rail.hidden = false;
    for (let n = 1; n <= Math.min(count, RAIL_MAX); n++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rail-page";
      button.setAttribute("aria-label", "Page " + n);
      if (n === current) { button.dataset.current = "true"; button.setAttribute("aria-current", "page"); }
      const box = document.createElement("div");
      box.className = "rail-thumb";
      box.dataset.n = String(n);
      box.dataset.thumb = "true";
      box.appendChild(document.createElement("canvas"));
      sizeBox(box, n, THUMB);
      const label = document.createElement("span");
      label.textContent = String(n);
      button.append(box, label);
      button.addEventListener("click", () => goTo(n));
      rail.appendChild(button);
      thumbs.push(button);
      visible.observe(box);
    }
  }
  post({ type: "stella:pdf-loaded", numPages: count });
  trackPage();
} catch (error) {
  post({ type: "stella:pdf-error", message: error && error.message ? String(error.message) : "" });
}
`;

/** The viewer document: the pages pane (and its page rail when asked), drawn by the pdf.js react-pdf uses. */
export const pdfPageHtml = (themeCss: string, rail: boolean) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style id="theme">${themeCss}</style><style>${PAGE_CSS}</style></head>
<body data-rail="${rail ? "true" : "false"}"><div class="layout"><nav class="rail" aria-label="Pages" hidden></nav><div class="scroll"><div class="document"></div></div></div>
<script type="module">${PAGE_SCRIPT}</script></body></html>`;

export const pdfjsAsset = (name: string) => (name === "pdf.min.mjs" ? Bun.file(PDFJS) : name === "pdf.worker.min.mjs" ? Bun.file(PDFJS_WORKER) : null);
