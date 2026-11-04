// Mirrors packages/desktop/electron/windows/companion-window.ts: a non-focusable
// transparent "mark" window over a focusable transparent "panel" window that
// takes the pointer while the pet is hovered.
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const OUT = process.env.OUT || __dirname;
const VARIANT = process.env.VARIANT || "current";
const logFile = path.join(OUT, `harness-${VARIANT}.log`);
const log = (...a) =>
  fs.appendFileSync(logFile, `${Date.now()} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n`);
const MARK_SIZE = 84, COMPACT = { width: 128, height: 128 }, FULL = { width: 400, height: 560 };
const BOTTOM_INSET = 14, ARC_OVERHANG = 34, GRACE = 340;
let mark, panel, anchor, drag = null, expanded = false;
let markHovered = false, panelHovered = false, hovered = false, graceTimer = null;
let activity = { hovered: false, panelActive: false, expanded: false };
let state = { variant: VARIANT, clicks: 0, dragStarts: 0, dragEnds: 0 };
const writeState = () => {
  state.anchor = anchor; state.expanded = expanded; state.activity = activity;
  state.markBounds = mark && !mark.isDestroyed() ? mark.getBounds() : null;
  state.panelBounds = panel && !panel.isDestroyed() ? panel.getBounds() : null;
  state.scale = screen.getPrimaryDisplay().scaleFactor;
  fs.writeFileSync(path.join(OUT, `state-${VARIANT}.json`), JSON.stringify(state, null, 1));
};
const bounds = (kind) => {
  const area = screen.getDisplayNearestPoint(anchor).workArea;
  const cx = Math.round(anchor.x - COMPACT.width / 2), cy = Math.round(anchor.y + BOTTOM_INSET - COMPACT.height);
  const size = kind === "mark" ? COMPACT : FULL;
  let x = cx + COMPACT.width - size.width, y = cy + COMPACT.height - size.height;
  if (kind === "panel") y = anchor.y + ARC_OVERHANG - size.height;
  x = Math.min(Math.max(x, area.x), area.x + area.width - size.width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - size.height);
  return { b: { x, y, width: size.width, height: size.height }, layout: { anchorX: anchor.x - x, anchorY: anchor.y - y } };
};
const applyBounds = () => {
  for (const [kind, w] of [["panel", panel], ["mark", mark]]) {
    const { b, layout } = bounds(kind);
    w.setBounds(b, false);
    w.webContents.send("layout", layout);
  }
};
const applyStacking = () => {
  const active = activity.panelActive;
  if (VARIANT === "panel-on-top") {
    mark.setIgnoreMouseEvents(false);
    if (active) panel.moveTop(); else mark.moveTop();
  } else {
    if (active) mark.setIgnoreMouseEvents(true, { forward: true });
    else mark.setIgnoreMouseEvents(false);
    mark.moveTop();
  }
};
const applyPanelInteractivity = () => {
  panel.setIgnoreMouseEvents(!activity.panelActive);
  applyStacking();
};
const publish = () => {
  const next = { hovered, panelActive: hovered || expanded, expanded };
  if (JSON.stringify(next) === JSON.stringify(activity)) return;
  const was = activity.panelActive;
  activity = next;
  log("activity", next);
  if (next.panelActive !== was) applyPanelInteractivity();
  mark.webContents.send("activity", next);
  panel.webContents.send("activity", next);
  writeState();
};
const updateHover = () => {
  if (markHovered || panelHovered) {
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    if (!hovered) { hovered = true; publish(); }
    return;
  }
  if (!hovered || graceTimer) return;
  graceTimer = setTimeout(() => { graceTimer = null; if (markHovered || panelHovered) return; hovered = false; publish(); }, GRACE);
};
const kindOf = (s) => (s === mark.webContents ? "mark" : s === panel.webContents ? "panel" : "?");
ipcMain.on("log", (e, ...a) => log(`[${kindOf(e.sender)}]`, ...a));
ipcMain.on("hover", (e, h) => { log(`hover ${kindOf(e.sender)}`, h); if (kindOf(e.sender) === "mark") markHovered = h; else panelHovered = h; updateHover(); });
ipcMain.on("toggle", (e) => { state.clicks++; log(`toggle from ${kindOf(e.sender)}`); expanded = !expanded; publish(); writeState(); });
ipcMain.on("dragStart", (e, c) => { state.dragStarts++; log(`dragStart ${kindOf(e.sender)}`, c); drag = { ox: c.screenX - anchor.x, oy: c.screenY - anchor.y }; expanded = false; publish(); });
ipcMain.on("dragMove", (e, c) => { if (!drag) return; anchor = { x: Math.round(c.screenX - drag.ox), y: Math.round(c.screenY - drag.oy) }; applyBounds(); });
ipcMain.on("dragEnd", (e) => { state.dragEnds++; log(`dragEnd ${kindOf(e.sender)}`, anchor); drag = null; applyBounds(); writeState(); });
const make = (kind) => {
  const w = new BrowserWindow({
    ...bounds(kind).b,
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, closable: true, skipTaskbar: true, hasShadow: false, focusable: kind !== "mark",
    show: false, title: `pet-${kind}`, backgroundColor: "#00000000",
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  w.setAlwaysOnTop(true, "floating");
  w.setContentProtection(true);
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (kind !== "mark") w.setIgnoreMouseEvents(true);
  w.on("page-title-updated", (e) => e.preventDefault());
  w.loadFile(path.join(__dirname, `${kind}.html`));
  return w;
};
app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  anchor = { x: Math.round(area.x + area.width * 0.7), y: Math.round(area.y + area.height * 0.75) };
  log("start", { variant: VARIANT, area, scale: screen.getPrimaryDisplay().scaleFactor, electron: process.versions.electron });
  panel = make("panel");
  mark = make("mark");
  await Promise.all([panel, mark].map((w) => new Promise((r) => w.webContents.once("did-finish-load", r))));
  applyBounds();
  panel.showInactive();
  mark.showInactive();
  mark.moveTop();
  applyPanelInteractivity();
  writeState();
  log("shown", state);
});
