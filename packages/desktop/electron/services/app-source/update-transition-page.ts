import transitionPageScript from "browser-script:./update-transition.page.ts";

export type {
  FocusInMotion,
  FocusPullMotion,
  FrostMotion,
  HoldOptions,
  Rect,
  RevealItem,
  RevealReport,
} from "./update-transition-protocol.js";

const STYLE = `
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
#root { position: fixed; inset: 0; overflow: hidden; }
.hold, .hold-picture, .hold-center { position: absolute; inset: 0; }
.hold-picture { width: 100%; height: 100%; }
.hold-center { display: grid; place-items: center; }
.hold-inner { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.hold-inner svg { width: 34px; height: 34px; }
.hold { --fg: #1d1d1f; --dim: rgba(29, 29, 31, 0.45); color: var(--fg); }
.hold[data-dark="true"] { --fg: #f5f5f7; --dim: rgba(245, 245, 247, 0.45); }
/* One moving thing: light passes through the label; the mark stays still. */
.hold-label {
  font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  letter-spacing: -0.01em;
  color: transparent;
  background: linear-gradient(90deg, var(--dim) 0%, var(--dim) 38%, var(--fg) 50%, var(--dim) 62%, var(--dim) 100%);
  background-size: 260% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation: shimmer 1.8s linear infinite;
}
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0% 0; } }
`;

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div id="root"></div><script>${transitionPageScript}</script></body></html>`;

export const TRANSITION_PAGE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`;
