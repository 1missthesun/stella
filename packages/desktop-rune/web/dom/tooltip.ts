import type { Side } from "../../host/rune-jsx/props";

let tip: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let owner: HTMLElement | null = null;

const DELAY_MS = 500;
const GAP = 6;

function tipEl(): HTMLDivElement {
  if (tip?.isConnected) return tip;
  tip = document.createElement("div");
  tip.className = "rune-tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  return tip;
}

function place(el: HTMLElement, text: string, side: Side) {
  const t = tipEl();
  t.textContent = text;
  const a = el.getBoundingClientRect();
  const r = t.getBoundingClientRect();
  let x = a.left + (a.width - r.width) / 2;
  let y = side === "top" ? a.top - GAP - r.height : a.bottom + GAP;
  if (side === "left") { x = a.left - GAP - r.width; y = a.top + (a.height - r.height) / 2; }
  if (side === "right") { x = a.right + GAP; y = a.top + (a.height - r.height) / 2; }
  if (side === "bottom" && y + r.height > window.innerHeight - 4) y = a.top - GAP - r.height;
  if (side === "top" && y < 4) y = a.bottom + GAP;
  x = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
  t.style.left = `${Math.round(x)}px`;
  t.style.top = `${Math.round(y)}px`;
  t.classList.add("on");
}

export function showTip(el: HTMLElement, text: string, side: Side = "bottom") {
  hideTip();
  owner = el;
  timer = setTimeout(() => {
    timer = null;
    if (owner === el && el.isConnected) place(el, text, side);
  }, DELAY_MS);
}

export function hideTip(el?: HTMLElement) {
  if (el && owner !== el) return;
  owner = null;
  if (timer) clearTimeout(timer);
  timer = null;
  tip?.classList.remove("on");
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => hideTip(), true);
  window.addEventListener("scroll", () => hideTip(), true);
}
