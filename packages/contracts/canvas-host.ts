/**
 * Where a canvas runs, and under which policy.
 *
 * A canvas is model-made HTML. It runs in an iframe sandboxed to an opaque
 * origin (`allow-scripts`, never `allow-same-origin`), under its own content
 * security policy: its inline and CDN scripts run, and it can't reach the
 * network beyond those CDNs, the app's DOM, storage, cookies or APIs.
 *
 * - Desktop: served from `stella-canvas:` with the policy as a header
 *   (canvas-protocol.ts in Electron main).
 * - Web: a `srcdoc` frame would inherit the chat page's policy, which runs no
 *   inline script, so the chat loads `canvas-host.html` (written beside the
 *   web build's index.html) into the sandboxed frame instead. That page has
 *   the canvas policy of its own, takes the canvas HTML from its parent once
 *   (`stella:canvas-html`), writes it in place of itself and says so
 *   (`stella:canvas-written`), so the canvas's own scripts run under the
 *   canvas policy, not the chat's. The website's `_headers` sends that policy
 *   (plus `sandbox`) for the page in place of the chat's header policy, which
 *   would otherwise apply too; keep the two equal.
 * - Phone: a WebView of its own (canvas-policy.ts in the app).
 */

/**
 * Where a canvas may load scripts, styles and fonts from, and fetch. Never
 * `stella-media:` (local files, for the app renderer only), `stella-app:`,
 * or a wildcard.
 */
export const CANVAS_CDN_SOURCES = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://cdn.tailwindcss.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://esm.sh",
].join(" ");

/**
 * The canvas policy, without the `sandbox` directive (a meta policy can't
 * carry one; the frame's attribute does). `self` lets a desktop canvas load
 * the files beside it; a web canvas has no files beside it.
 *
 * `unsafe-eval` adds nothing to what inline scripts can already do here, and
 * in-browser compilers (Babel standalone, Alpine, Vue's template build) need
 * it. `form-action 'none'`: a form submits to nothing; a canvas action form
 * is read by the bridge instead.
 */
export const canvasPolicyDirectives = (options: { self: boolean }): string[] => {
  const self = options.self ? "'self' " : "";
  return [
    "default-src 'none'",
    `script-src ${self}'unsafe-inline' 'unsafe-eval' ${CANVAS_CDN_SOURCES}`,
    `style-src ${self}'unsafe-inline' ${CANVAS_CDN_SOURCES}`,
    `font-src ${self}data: ${CANVAS_CDN_SOURCES}`,
    `img-src ${self}https: data: blob:`,
    `media-src ${self}https: data: blob:`,
    `connect-src ${CANVAS_CDN_SOURCES}`,
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ];
};

/**
 * The frame's sandbox. `allow-forms` only lets a form fire its submit event
 * (which the action bridge reads); `form-action 'none'` keeps it from going
 * anywhere.
 */
export const CANVAS_FRAME_SANDBOX = "allow-scripts allow-forms";

export const CANVAS_HOST_FILE = "canvas-host.html";

const CANVAS_HOST_SCRIPT = String.raw`
(() => {
  const parent = window.parent;
  if (!parent || parent === window) return;
  const onMessage = (event) => {
    const data = event.data;
    if (event.source !== parent || !data || data.type !== "stella:canvas-html" || typeof data.html !== "string") return;
    window.removeEventListener("message", onMessage);
    document.open();
    document.write(data.html);
    document.close();
    parent.postMessage({ type: "stella:canvas-written" }, "*");
  };
  window.addEventListener("message", onMessage);
  parent.postMessage({ type: "stella:canvas-host-ready" }, "*");
})();
`;

const attribute = (value: string): string => value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;");

/** The web's canvas host page (see above). */
export const CANVAS_HOST_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attribute(canvasPolicyDirectives({ self: false }).join("; "))}">
<meta name="referrer" content="no-referrer">
<script>${CANVAS_HOST_SCRIPT}</script>
</head>
<body></body>
</html>
`;

export type CanvasHostMessage = { type: "stella:canvas-host-ready" } | { type: "stella:canvas-written" };

export const canvasHostMessageType = (data: unknown): CanvasHostMessage["type"] | null => {
  const type = data && typeof data === "object" ? (data as { type?: unknown }).type : null;
  return type === "stella:canvas-host-ready" || type === "stella:canvas-written" ? type : null;
};
