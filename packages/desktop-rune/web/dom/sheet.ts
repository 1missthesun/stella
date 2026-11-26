const BASE = `
@property --rbc { syntax: "*"; inherits: false; }
@property --rbw { syntax: "*"; inherits: false; }
html, body { margin: 0; height: 100%; overflow: hidden; }
html[data-native-font-smoothing="on"], html[data-native-font-smoothing="on"] body, .aa { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
.aa { text-rendering: optimizeLegibility; }
#root { position: fixed; inset: 0; display: flex; }
.r { display: flex; position: relative; box-sizing: border-box; flex-shrink: 0; margin: 0; padding: 0; border: 0; outline: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
.r.col, .r.win { flex-direction: column; }
.r.win { flex: 1 1 auto; width: 100%; height: 100%; overflow: hidden; }
.r.top { position: fixed; }
.r.sy { overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
.r.sx { overflow-x: auto; overflow-y: hidden; }
.r.sx.sy { overflow: auto; }
.r.sy, .r.sx { scrollbar-width: thin; scrollbar-color: var(--rune-scrollbar, rgba(127,127,127,.35)) transparent; }
.r.sy::-webkit-scrollbar, .r.sx::-webkit-scrollbar { width: 8px; height: 8px; }
.r.sy::-webkit-scrollbar-thumb, .r.sx::-webkit-scrollbar-thumb { background: var(--rune-scrollbar, rgba(127,127,127,.35)); border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
.r.sy::-webkit-scrollbar-track, .r.sx::-webkit-scrollbar-track { background: transparent; }
.r.na { overflow-anchor: none; }
.inert, .inert * { pointer-events: none !important; }
.hid { visibility: hidden; }
.sel, .sel * { user-select: text; -webkit-user-select: text; }
.hf:hover { background-color: var(--hf) !important; }
.pf:active { background-color: var(--pf) !important; }
.hb:hover { --rbc: var(--hbc); }
.pb:active { --rbc: var(--pbc); }
.ps:active { transform: var(--rt, ) scale(var(--ps)) !important; }
.ff:focus-within { background-color: var(--ff) !important; }
.fb:focus-within { --rbc: var(--fbc); }
.fr:focus-visible { outline: var(--frw) solid var(--frc); outline-offset: var(--fro); }
.fr.frr:focus-visible { outline: none; box-shadow: 0 0 0 var(--frw) var(--frc), var(--rsh, 0 0 #0000); }
.hg:hover .hc, .hg.hc:hover { color: var(--hc) !important; }
.hg:hover .hc .rt, .hg:hover .hc svg { color: var(--hc) !important; }
.ho { opacity: var(--ho0); transition: opacity .15s ease; }
.hg:hover .ho, .hg:focus-within .ho { opacity: var(--ho1); }
.dis { cursor: default; }
.rt { display: block; position: relative; box-sizing: border-box; flex-shrink: 1; margin: 0; white-space: pre-wrap; overflow-wrap: break-word; font-family: var(--rune-sans); font-kerning: normal; }
.rt.nw { white-space: pre; }
.rt.tr { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.rt.tf { white-space: pre; overflow: hidden; -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent); }
.rt.th { white-space: pre; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.rt.th > .ltr { direction: ltr; unicode-bidi: isolate; }
.rt.tr, .rt.tf, .rt.th, .rt.tm { min-width: 0; }
.rt.tm { display: flex; white-space: pre; overflow: hidden; }
.rt.tm > .tmh { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; }
.rt.tm > .tmt { flex: 0 0 auto; white-space: pre; }
.sel::selection, .sel *::selection { background: var(--rsel, Highlight); }
.rt.ml { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
.rt a, .rt .lk { color: inherit; text-decoration: none; cursor: pointer; }
.ri { display: flex; position: relative; box-sizing: border-box; flex-shrink: 0; }
svg.ri { display: block; overflow: visible; }
.ri > svg { display: block; width: 100%; height: 100%; overflow: visible; }
.rin { display: flex; position: relative; box-sizing: border-box; flex-shrink: 0; font-family: var(--rune-sans); font-kerning: normal; }
.rin > .f { flex: 1 1 auto; min-width: 0; width: 100%; margin: 0; padding: 0; border: 0; outline: none; background: transparent; font: inherit; letter-spacing: inherit; line-height: inherit; color: inherit; resize: none; box-sizing: border-box; font-family: inherit; text-align: inherit; }
.rin > textarea.f { overflow-y: hidden; display: block; }
.rin > textarea.f.scroll { overflow-y: auto; scrollbar-width: thin; }
.rin > .f::placeholder { color: var(--ph); opacity: 1; }
.rin > .mk { position: absolute; pointer-events: none; white-space: pre-wrap; overflow-wrap: break-word; overflow: hidden; color: inherit; }
.rin > .mk mark { color: inherit; background: transparent; }
.rin.marked > .f { color: transparent !important; }
.rimg { display: block; position: relative; box-sizing: border-box; flex-shrink: 0; }
.rwv { display: flex; position: relative; box-sizing: border-box; flex-shrink: 0; }
.rwv > iframe { flex: 1 1 auto; width: 100%; height: 100%; border: 0; display: block; background: transparent; border-radius: inherit; }
.rmd { display: block; position: relative; box-sizing: border-box; flex-shrink: 1; min-width: 0; }
.rmd { overflow-wrap: break-word; font-family: var(--rune-sans); font-kerning: normal; }
.rmd > :first-child { margin-top: 0 !important; }
.rmd > :last-child { margin-bottom: 0 !important; }
.rmd li > :first-child { margin-top: 0; }
.rmd li > :last-child { margin-bottom: 0; }
.rmd li::marker { color: var(--md-marker, currentColor); }
.rmd a.mdl:hover { text-decoration: underline !important; text-underline-offset: 2px; color: var(--md-link-hover); }
.rmd h1, .rmd h2, .rmd h3, .rmd h4, .rmd h5, .rmd h6, .rmd p, .rmd ul, .rmd ol, .rmd pre, .rmd blockquote, .rmd table { font-weight: inherit; }
.rmd h1, .rmd h2, .rmd h3, .rmd h4, .rmd h5, .rmd h6 { font-weight: 600; }
.rmd .mdca.hov { opacity: 0; transition: opacity 120ms ease; }
.rmd .mdcode:hover .mdca.hov, .rmd .mdcode:focus-within .mdca.hov { opacity: 1; }
.rmd .mdcb { all: unset; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; cursor: pointer; color: inherit; transition: color 150ms ease; }
.rmd .mdcb:hover { color: var(--mdca-hover, inherit); }
.rmd .mdta { position: absolute; z-index: 1; display: flex; align-items: center; padding-left: 6px; border-radius: 6px; transition: opacity 120ms ease; }
@media (hover: hover) { .rmd .mdta.hov { opacity: 0; } .rmd .mdtable:is(:hover, :focus-within) .mdta.hov { opacity: 1; } }
.rmd .mdtb { all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; cursor: pointer; color: inherit; transition: color 150ms ease; }
.rmd .mdtb:hover { color: var(--mdca-hover, inherit); }
.rmd pre::-webkit-scrollbar { height: 6px; }
.rune-tip { position: fixed; z-index: 2147483000; pointer-events: none; box-sizing: border-box; max-width: 280px; padding: 5px 8px; border-radius: 7px; font: 500 12px/1.35 var(--rune-sans); letter-spacing: -0.1px; white-space: pre-wrap; background: var(--rune-tip-bg, #1f1f1c); color: var(--rune-tip-fg, #f4f3ee); box-shadow: 0 4px 16px rgba(0,0,0,.18), 0 0 0 0.5px rgba(255,255,255,.06); opacity: 0; transform: translateY(2px); transition: opacity .12s ease, transform .12s ease; }
.rune-tip.on { opacity: 1; transform: none; }
.rune-color-motion .r, .rune-color-motion .rt, .rune-color-motion .rin, .rune-color-motion .rmd * { transition: background-color var(--rcm) ease, color var(--rcm) ease, box-shadow var(--rcm) ease, fill var(--rcm) ease !important; }
@keyframes rune-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .r, .rt { transition: none !important; } }
`;

let installed = false;
const dynamic = new Map<string, string>();
let dynamicEl: HTMLStyleElement | null = null;

export function installSheet() {
  if (installed) return;
  installed = true;
  const style = document.createElement("style");
  style.dataset.rune = "base";
  style.textContent = BASE;
  document.head.appendChild(style);
  dynamicEl = document.createElement("style");
  dynamicEl.dataset.rune = "dynamic";
  document.head.appendChild(dynamicEl);
}

/** Adds a rule once (keyframes for loops and presence), keyed by its name. */
export function ensureRule(name: string, css: string) {
  if (dynamic.has(name)) return;
  dynamic.set(name, css);
  installSheet();
  dynamicEl!.appendChild(document.createTextNode(css));
}

export const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
