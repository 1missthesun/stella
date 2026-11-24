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
 * A meta policy can't carry the `sandbox` directive; the frame's attribute does.
 * In-browser compilers (Babel standalone, Alpine, Vue's template build) need
 * `unsafe-eval`.
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
 * `allow-forms` only lets a form fire its submit event; `form-action 'none'`
 * keeps it from going anywhere.
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
