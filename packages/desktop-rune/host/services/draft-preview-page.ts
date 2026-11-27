// The draft preview tab's page (draft-preview.ts): the preview window's latest frame, an invisible
// accessible layer of its elements over it (so snapshots, locators and the agent's clicks find
// them), and the page's pointer, wheel, keys and text sent on to the window. Frames come from a
// long poll that also reports the page's size, which the window follows.

const script = String.raw`
const API = "/__preview/";
const isMac = navigator.platform.startsWith("Mac");
const frame = document.getElementById("frame");
const layer = document.getElementById("layer");
const problem = document.getElementById("problem");
let seen = 0;
let size = { width: innerWidth, height: innerHeight };
let scale = 1;
let frameUrl = null;
let pressedOn = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const painted = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function place() {
  scale = Math.min(innerWidth / size.width, innerHeight / size.height) || 1;
  frame.style.width = size.width * scale + "px";
  frame.style.height = size.height * scale + "px";
}
// The window follows the page's size, which each poll reports: a resize cuts the waiting one short.
let waiting = null;
let resizeTimer = 0;
addEventListener("resize", () => {
  place();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => waiting?.abort(), 80);
});

const ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "tablist", "menu", "menuitem", "menubar", "listbox", "option", "list", "listitem", "dialog", "alertdialog", "heading", "img", "slider", "progressbar", "scrollbar", "searchbox", "combobox", "toolbar", "tooltip", "navigation", "region", "status", "alert", "grid", "row", "cell", "tree", "treeitem", "separator", "group"]);
const nodes = new Map();

function nodeFor(e) {
  const editable = e.role === "textbox" || e.role === "searchbox" || e.role === "textfield" || e.role === "input" || e.role === "textarea";
  const tag = editable ? "textarea" : e.role === "button" ? "button" : e.role === "link" ? "a" : e.role === "text" ? "span" : "div";
  let node = nodes.get(e.key);
  if (!node || node.tagName.toLowerCase() !== tag) {
    node = document.createElement(tag);
    node.dataset.key = e.key;
    if (tag === "a") node.href = "#";
    if (tag === "button") node.type = "button";
    nodes.set(e.key, node);
  }
  if (tag === "div" && ROLES.has(e.role)) node.setAttribute("role", e.role); else if (tag === "div") node.removeAttribute("role");
  if (e.label) node.setAttribute("aria-label", e.label); else node.removeAttribute("aria-label");
  if (editable) {
    if (document.activeElement !== node) node.value = e.text ?? "";
    if (e.label && !node.placeholder) node.placeholder = e.label;
  } else {
    const text = e.text ?? (tag === "button" || tag === "a" ? e.label ?? "" : "");
    if (node.textContent !== text) node.textContent = text;
  }
  if (e.focusable && !editable && tag !== "button" && tag !== "a") node.tabIndex = -1; else if (!editable && tag !== "button" && tag !== "a") node.removeAttribute("tabindex");
  const [x, y, w, h] = e.rect;
  node.style.cssText = "left:" + x * scale + "px;top:" + y * scale + "px;width:" + w * scale + "px;height:" + h * scale + "px";
  return node;
}

let refocusing = false;
function showElements(list) {
  // Snapshots read in the window's tree order; smaller elements stack above larger ones, so an
  // element inside another (or under a large empty layer) takes the click.
  const keep = new Set();
  const ordered = list.map((e) => { keep.add(e.key); return nodeFor(e); });
  const byArea = list.map((e, i) => [e.rect[2] * e.rect[3], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  byArea.forEach(([, i], z) => { ordered[i].style.zIndex = String(z); });
  const active = document.activeElement;
  for (const [key, node] of nodes) if (!keep.has(key)) { node.remove(); nodes.delete(key); }
  ordered.forEach((node, i) => { if (layer.children[i] !== node) layer.insertBefore(node, layer.children[i] ?? null); });
  // Moving the focused field blurs it; it keeps focus (the window's field already has it).
  if (active && active !== document.activeElement && active.isConnected) {
    refocusing = true;
    active.focus({ preventScroll: true });
    refocusing = false;
  }
}

async function poll() {
  for (;;) {
    try {
      waiting = new AbortController();
      const r = await fetch(API + "next?seen=" + seen + "&w=" + innerWidth + "&h=" + innerHeight, { cache: "no-store", signal: waiting.signal });
      if (!r.ok) throw new Error(String(r.status));
      const s = await r.json();
      problem.hidden = !s.error;
      problem.textContent = s.error ?? "";
      if (s.png && s.seq > seen) {
        const blob = await (await fetch(API + "frame/" + s.png + ".png", { cache: "no-store" })).blob();
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => {});
        frame.src = url;
        if (frameUrl) URL.revokeObjectURL(frameUrl);
        frameUrl = url;
        size = { width: s.width, height: s.height };
        place();
        showElements(s.elements);
        await painted();
      }
      seen = Math.max(seen, s.seq);
    } catch (error) {
      if (error?.name !== "AbortError") await sleep(400);
    }
  }
}

let queue = [];
let sending = Promise.resolve();
function send(event) {
  queue.push(event);
  if (queue.length > 1) return;
  queueMicrotask(() => {
    const events = queue;
    queue = [];
    sending = sending.then(() => fetch(API + "input", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(events) })).catch(() => {});
  });
}

const at = (e) => ({ x: Math.round((e.clientX / scale) * 10) / 10, y: Math.round((e.clientY / scale) * 10) / 10 });
const buttonOf = (e) => (e.button === 2 ? "secondary" : e.button === 1 ? "middle" : "primary");
const editableOf = (t) => t instanceof HTMLTextAreaElement;
let moveFrame = 0;
let lastMove = null;

addEventListener("pointerdown", (e) => {
  pressedOn = e.target;
  if (editableOf(e.target)) e.target.focus({ preventScroll: true }); else document.getElementById("sink").focus({ preventScroll: true });
  e.preventDefault();
  send({ type: "down", ...at(e), button: buttonOf(e) });
}, true);
addEventListener("pointermove", (e) => {
  lastMove = at(e);
  if (moveFrame) return;
  moveFrame = requestAnimationFrame(() => { moveFrame = 0; if (lastMove) send({ type: "move", ...lastMove }); });
}, true);
addEventListener("pointerup", (e) => { e.preventDefault(); send({ type: "up", ...at(e), button: buttonOf(e) }); }, true);
addEventListener("contextmenu", (e) => e.preventDefault(), true);
addEventListener("click", (e) => e.preventDefault(), true);
addEventListener("wheel", (e) => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  send({ type: "wheel", ...at(e), dx: -e.deltaX * unit, dy: -e.deltaY * unit, shift: e.shiftKey, cmd: isMac ? e.metaKey : e.ctrlKey });
}, { capture: true, passive: false });

// Focus that came without a press (a locator's fill or focus) presses the element in the window.
addEventListener("focusin", (e) => {
  const t = e.target;
  if (refocusing || t === pressedOn || !(t instanceof HTMLElement) || !t.dataset.key) return;
  const r = t.getBoundingClientRect();
  send({ type: "tap", x: (r.left + r.width / 2) / scale, y: (r.top + r.height / 2) / scale });
}, true);
addEventListener("pointerup", () => { setTimeout(() => { pressedOn = null; }, 0); }, true);

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"]);
addEventListener("keydown", (e) => {
  if (e.isComposing || MODIFIERS.has(e.key)) return;
  const cmd = isMac ? e.metaKey : e.ctrlKey;
  if (e.key.length === 1 && !cmd && !e.altKey && !(isMac && e.ctrlKey)) {
    e.preventDefault();
    send({ type: "type", text: e.key, every: 0 });
    return;
  }
  e.preventDefault();
  send({ type: "key", name: e.key.length === 1 ? e.key.toLowerCase() : e.key, shift: e.shiftKey, alt: e.altKey, cmd, ctrl: isMac && e.ctrlKey, logo: !isMac && e.metaKey, repeat: e.repeat });
}, true);
// Text inserted without keys (a locator's fill, keyboard.type, an input method).
addEventListener("beforeinput", (e) => {
  e.preventDefault();
  const t = e.target;
  if (editableOf(t) && t.value && t.selectionStart === 0 && t.selectionEnd === t.value.length && e.inputType.startsWith("insert")) {
    send({ type: "key", name: "a", cmd: true });
  }
  if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") send({ type: "key", name: "Enter", shift: e.inputType === "insertLineBreak" });
  else if (e.inputType === "deleteContentBackward") send({ type: "key", name: "Backspace" });
  else if (e.inputType === "deleteContentForward") send({ type: "key", name: "Delete" });
  else if (e.data) send({ type: "type", text: e.data, every: 0 });
}, true);
addEventListener("paste", (e) => {
  e.preventDefault();
  const text = e.clipboardData?.getData("text/plain");
  if (text) send({ type: "paste", text });
}, true);

place();
poll();
`;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function previewPage(name: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Preview: ${escapeHtml(name)}</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0b0c; }
  #frame { position: fixed; left: 0; top: 0; display: block; user-select: none; -webkit-user-drag: none; pointer-events: none; }
  #layer { position: fixed; inset: 0; }
  #layer > * { position: absolute; box-sizing: border-box; margin: 0; padding: 0; border: 0; outline: none; resize: none; overflow: hidden; background: transparent; color: transparent; caret-color: transparent; font-size: 1px; opacity: 0.001; }
  #sink { position: fixed; left: -100px; top: 0; width: 1px; height: 1px; opacity: 0; }
  #problem { position: fixed; left: 12px; right: 12px; bottom: 12px; max-height: 45%; overflow: auto; margin: 0; padding: 12px 14px; border-radius: 10px; background: #2a0f12; color: #ffd7d9; font: 12px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; }
</style>
</head>
<body>
<img id="frame" alt="">
<div id="layer"></div>
<textarea id="sink" aria-hidden="true" tabindex="-1"></textarea>
<pre id="problem" role="alert" hidden></pre>
<script>${script}</script>
</body>
</html>`;
}
