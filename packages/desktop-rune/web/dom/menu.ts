import type { MenuItem } from "../../host/bridge";
import { elementOf } from "./registry";

let open: { close: (id: string | null) => void } | null = null;

const dark = () => {
  const bg = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
  return (bg[0]! * 299 + bg[1]! * 587 + bg[2]! * 114) / 1000 < 128;
};

/** `engine.menu.popup` in a browser tab: a menu drawn in the page at the point or under the anchor, resolving with the pick. */
export function popupMenu(items: MenuItem[], at: { x?: number; y?: number; anchor?: string }): Promise<string | null> {
  open?.close(null);
  return new Promise((resolve) => {
    const d = dark();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.style.cssText = `position:fixed;z-index:2147483001;min-width:180px;max-width:320px;padding:4px;border-radius:10px;box-sizing:border-box;font:400 13px/1.3 var(--rune-sans);letter-spacing:-0.1px;background:${d ? "#262624" : "#ffffff"};color:${d ? "#ecebe6" : "#1f1f1c"};box-shadow:0 8px 28px rgba(0,0,0,${d ? 0.45 : 0.16}),0 0 0 0.5px ${d ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.1)"};max-height:70vh;overflow-y:auto;`;
    const close = (id: string | null) => {
      if (open?.close !== close) return;
      open = null;
      menu.remove();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      resolve(id);
    };
    const outside = (e: PointerEvent) => { if (!menu.contains(e.target as Node)) close(null); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(null); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")];
        const i = buttons.indexOf(document.activeElement as HTMLElement);
        buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    };
    const add = (list: MenuItem[], into: HTMLElement) => {
      for (const item of list) {
        if (item.visible === false) continue;
        if (item.type === "separator") {
          const sep = document.createElement("div");
          sep.style.cssText = `height:1px;margin:4px 6px;background:${d ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)"};`;
          into.appendChild(sep);
          continue;
        }
        if (item.submenu?.length) {
          add([{ type: "separator" }, ...item.submenu], into);
          continue;
        }
        const row = document.createElement("div");
        row.setAttribute("role", "menuitem");
        row.tabIndex = -1;
        const disabled = item.enabled === false;
        if (disabled) row.setAttribute("aria-disabled", "true");
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;cursor:default;outline:none;${disabled ? "opacity:.45;" : ""}`;
        const check = item.type === "checkbox" || item.type === "radio";
        row.textContent = `${check ? (item.checked ? "✓ " : " ") : ""}${item.label ?? ""}`;
        const hover = d ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.05)";
        row.onpointerenter = () => { row.style.background = hover; };
        row.onpointerleave = () => { row.style.background = ""; };
        row.onfocus = () => { row.style.background = hover; };
        row.onblur = () => { row.style.background = ""; };
        if (!disabled) {
          row.onclick = () => close(item.id ?? null);
          row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); close(item.id ?? null); } };
        }
        into.appendChild(row);
      }
    };
    add(items, menu);
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    let x = at.x ?? 0;
    let y = at.y ?? 0;
    const anchor = at.anchor ? elementOf(at.anchor) : undefined;
    if (anchor) {
      const a = anchor.getBoundingClientRect();
      x = a.left;
      y = a.bottom + 4;
    }
    x = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    if (y + r.height > window.innerHeight - 4) y = Math.max(4, (anchor ? anchor.getBoundingClientRect().top - 4 : y) - r.height);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    open = { close };
    setTimeout(() => {
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", key, true);
    }, 0);
  });
}
