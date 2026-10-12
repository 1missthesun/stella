export const CANVAS_CDN_HOSTS = [
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "cdn.tailwindcss.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "esm.sh",
] as const;

const CANVAS_CDN_SOURCES = CANVAS_CDN_HOSTS.map((host) => `https://${host}`).join(" ");

export const CANVAS_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${CANVAS_CDN_SOURCES}`,
  `style-src 'unsafe-inline' ${CANVAS_CDN_SOURCES}`,
  `font-src data: ${CANVAS_CDN_SOURCES}`,
  "img-src https: data: blob:",
  "media-src https: data: blob:",
  `connect-src ${CANVAS_CDN_SOURCES}`,
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CANVAS_CSP}"><meta name="referrer" content="no-referrer">`;

const LEADING_PREAMBLE = /^﻿?\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype[^>]*>)?/i;

export function withCanvasPolicy(html: string): string {
  const preamble = LEADING_PREAMBLE.exec(html)?.[0] ?? "";
  return preamble + CSP_META + html.slice(preamble.length);
}

const measureSource = (postSize: string) => String.raw`
  const measureDocument = () => {
    const body = document.body;
    if (!body) return;
    const root = document.documentElement;
    const scrollY = window.scrollY || 0;
    const marginBottom = (element) => parseFloat(getComputedStyle(element).marginBottom) || 0;
    let bottom = body.getBoundingClientRect().bottom + scrollY + marginBottom(body);
    for (const child of body.children) {
      const rect = child.getBoundingClientRect();
      if (rect.height > 0) bottom = Math.max(bottom, rect.bottom + scrollY + marginBottom(child));
    }
    const width = root.clientWidth || window.innerWidth;
    if (bottom > 0 && width > 0) ${postSize}(Math.ceil(bottom), width);
  };
  let measureQueued = false;
  const queueMeasure = () => {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(() => {
      measureQueued = false;
      measureDocument();
    });
  };
  const startMeasuring = () => {
    queueMeasure();
    try {
      const observer = new ResizeObserver(queueMeasure);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    } catch {}
    window.addEventListener("load", queueMeasure);
    setTimeout(queueMeasure, 400);
    setTimeout(queueMeasure, 1500);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startMeasuring);
  } else {
    startMeasuring();
  }
`;

export const DOCUMENT_SIZE_MESSAGE = "stella:document-size";

export function documentSizeScript(token: string): string {
  const key = JSON.stringify(`__stellaDocumentSize_${token}`);
  const tokenLiteral = JSON.stringify(token);
  return String.raw`
(() => {
  const key = ${key};
  if (window[key]) return;
  Object.defineProperty(window, key, { value: true });
  const token = ${tokenLiteral};
  const bridge = window.ReactNativeWebView;
  if (!bridge || typeof bridge.postMessage !== "function") return;
  const post = bridge.postMessage.bind(bridge);
  const stringify = JSON.stringify;
  const postSize = (height, width) => post(stringify({ type: "${"stella:document-size"}", token, height, width }));
  ${measureSource("postSize")}
})();
true;
`;
}

export function canvasBridgeScript(token: string): string {
  const key = JSON.stringify(`__stellaCanvas_${token}`);
  const tokenLiteral = JSON.stringify(token);
  return String.raw`
(() => {
  const key = ${key};
  if (window[key]) return;
  Object.defineProperty(window, key, { value: true });
  const token = ${tokenLiteral};
  const bridge = window.ReactNativeWebView;
  if (!bridge || typeof bridge.postMessage !== "function") return;
  const post = bridge.postMessage.bind(bridge);
  const stringify = JSON.stringify;
  const closest = Element.prototype.closest;
  const getAttribute = Element.prototype.getAttribute;
  const getById = Document.prototype.getElementById;
  const query = Document.prototype.querySelector;
  const escape = CSS.escape;
  const scrollTo = window.scrollTo.bind(window);
  try { delete window.ReactNativeWebView; } catch {}
  try { Object.defineProperty(window, "ReactNativeWebView", { value: undefined, configurable: false, writable: false }); } catch {}

  const navigate = (rawHref) => {
    const href = String(rawHref).trim();
    if (href.startsWith("#")) {
      let fragment;
      try { fragment = decodeURIComponent(href.slice(1)); } catch { return; }
      if (!fragment) {
        scrollTo({ top: 0, behavior: "auto" });
        return;
      }
      const target = getById.call(document, fragment) ||
        query.call(document, '[name="' + escape(fragment) + '"]');
      if (target) target.scrollIntoView();
      return;
    }
    post(stringify({ type: "stella:canvas-navigate", token, href }));
  };

  window.addEventListener("click", (event) => {
    const target = event.target;
    const anchor = target instanceof Element ? closest.call(target, "a[href]") : null;
    if (!anchor) return;
    event.preventDefault();
    if (!event.isTrusted) return;
    navigate(getAttribute.call(anchor, "href") || "");
  }, true);

  window.addEventListener("submit", (event) => {
    event.preventDefault();
  }, true);

  const postSize = (height, width) => post(stringify({ type: "${"stella:document-size"}", token, height, width }));
  ${measureSource("postSize")}
})();
true;
`;
}
