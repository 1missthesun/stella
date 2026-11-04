const { ipcRenderer } = require("electron");
const log = (...a) => ipcRenderer.send("log", ...a);
function attachPress(el, kind) {
  let press = null;
  el.addEventListener("pointerdown", (e) => {
    log("pointerdown", e.button, e.screenX, e.screenY);
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    press = { id: e.pointerId, sx: e.screenX, sy: e.screenY, lx: e.screenX, ly: e.screenY, moved: false };
  });
  el.addEventListener("pointermove", (e) => {
    if (!press || press.id !== e.pointerId) return;
    press.lx = e.screenX; press.ly = e.screenY;
    if (!press.moved) {
      if (Math.hypot(press.lx - press.sx, press.ly - press.sy) < 5) return;
      press.moved = true;
      ipcRenderer.send("dragStart", { screenX: press.sx, screenY: press.sy });
    }
    ipcRenderer.send("dragMove", { screenX: press.lx, screenY: press.ly });
  });
  const end = (e, cancelled) => {
    log(cancelled ? "pointercancel" : "pointerup", e.screenX, e.screenY);
    if (!press || press.id !== e.pointerId) return;
    const p = press; press = null;
    if (p.moved) { ipcRenderer.send("dragMove", { screenX: p.lx, screenY: p.ly }); ipcRenderer.send("dragEnd"); return; }
    if (!cancelled) ipcRenderer.send("toggle");
  };
  el.addEventListener("pointerup", (e) => end(e, false));
  el.addEventListener("pointercancel", (e) => end(e, true));
  el.addEventListener("lostpointercapture", () => log("lostpointercapture"));
}
let lastMove = 0;
window.addEventListener("mousemove", (e) => { if (Date.now() - lastMove > 250) { lastMove = Date.now(); log("mousemove", e.clientX, e.clientY, e.target.className); } });
module.exports = { attachPress, log, ipcRenderer };
