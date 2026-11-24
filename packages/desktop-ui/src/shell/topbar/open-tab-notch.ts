import { useEffect, useLayoutEffect, type RefObject } from "react";

const OPEN_TAB = '.topbar-tabs__tab[data-tab-id][data-active="true"]';
const LEFT = "--topbar-open-tab-left";
const RIGHT = "--topbar-open-tab-right";
const FOOT_REACH = 7;
const FOOT_SIZE = 8;
const REACH_GAP = 12;
const REACH_GROW_DELAY_MS = 500;

export function syncOpenTabNotch(strip: HTMLElement | null): void {
  if (strip) markStripScroll(strip);
  const root = document.documentElement;
  const open = strip?.querySelector<HTMLElement>(OPEN_TAB);
  let left = 0;
  let right = 0;
  if (strip && open) {
    const tab = open.getBoundingClientRect();
    const bounds = strip.getBoundingClientRect();
    const chat = strip
      .querySelector<HTMLElement>(".topbar-tabs__tab--chat")
      ?.getBoundingClientRect();
    left = Math.max(tab.left - FOOT_REACH, chat?.right ?? bounds.left);
    right = Math.min(tab.right + FOOT_REACH, bounds.right);
    const hidden = chat ? chat.right - (tab.left - FOOT_SIZE) : 0;
    const clip =
      hidden > 0 ? `inset(0 -${FOOT_SIZE}px 0 ${hidden - FOOT_SIZE}px)` : "";
    if (open.style.clipPath !== clip) open.style.clipPath = clip;
  }
  for (const tab of strip?.querySelectorAll<HTMLElement>(
    ".topbar-tabs__tab[data-tab-id]",
  ) ?? []) {
    if (tab !== open && tab.style.clipPath) tab.style.clipPath = "";
  }
  if (right > left) {
    const nextLeft = `${left}px`;
    const nextRight = `${right}px`;
    if (root.style.getPropertyValue(LEFT) !== nextLeft) {
      root.style.setProperty(LEFT, nextLeft);
    }
    if (root.style.getPropertyValue(RIGHT) !== nextRight) {
      root.style.setProperty(RIGHT, nextRight);
    }
  } else if (root.style.getPropertyValue(LEFT)) {
    root.style.removeProperty(LEFT);
    root.style.removeProperty(RIGHT);
  }
}

function markStripScroll(strip: HTMLElement): void {
  const scrolled = strip.scrollLeft > 0.5;
  const overflowing = strip.scrollWidth > strip.clientWidth + 0.5;
  if ((strip.dataset.scrolled === "true") !== scrolled) {
    if (scrolled) strip.dataset.scrolled = "true";
    else delete strip.dataset.scrolled;
  }
  if ((strip.dataset.overflowing === "true") !== overflowing) {
    if (overflowing) strip.dataset.overflowing = "true";
    else delete strip.dataset.overflowing;
  }
}

export function revealOpenTab(strip: HTMLElement): void {
  if (strip.dataset.reordering === "true") return;
  const open = strip.querySelector<HTMLElement>(OPEN_TAB);
  if (!open) return;
  const tab = open.getBoundingClientRect();
  const bounds = strip.getBoundingClientRect();
  const chat = strip
    .querySelector<HTMLElement>(".topbar-tabs__tab--chat")
    ?.getBoundingClientRect();
  const leftEdge = (chat?.right ?? bounds.left) + FOOT_REACH;
  const over = tab.right + FOOT_REACH - bounds.right;
  const under = leftEdge - tab.left;
  if (over > 0.5) strip.scrollLeft += Math.min(over, Math.max(0, -under));
  else if (under > 0.5) strip.scrollLeft -= under;
}

export function useOpenTabNotch(
  stripRef: RefObject<HTMLDivElement | null>,
  revision: unknown,
): void {
  useLayoutEffect(() => {
    syncOpenTabNotch(stripRef.current);
  });

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const sync = () => syncOpenTabNotch(strip);
    let frame = 0;
    const follow = () => {
      sync();
      frame =
        strip.dataset.reordering === "true" ? requestAnimationFrame(follow) : 0;
    };
    const resizes = new ResizeObserver(() => {
      revealOpenTab(strip);
      sync();
    });
    resizes.observe(strip);
    for (const tab of strip.children) resizes.observe(tab);
    const reorders = new MutationObserver(() => {
      if (!frame) follow();
    });
    reorders.observe(strip, {
      attributes: true,
      attributeFilter: ["data-reordering"],
    });
    strip.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      resizes.disconnect();
      reorders.disconnect();
      strip.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [stripRef, revision]);

  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(LEFT);
      document.documentElement.style.removeProperty(RIGHT);
    },
    [],
  );
}

export function useTabStripReach(
  stripRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const bar = stripRef.current?.closest<HTMLElement>(".shell-topbar-full");
    const column = bar?.querySelector<HTMLElement>(".shell-topbar-activity");
    const mark = column?.querySelector<HTMLElement>(
      ".shell-topbar-activity__trigger",
    );
    if (!bar || !column || !mark) return;
    let applied = 0;
    let timer = 0;
    const apply = (reach: number) => {
      applied = reach;
      bar.style.setProperty("--topbar-tabs-reach", `${reach}px`);
    };
    const measure = () => {
      const free = (column.offsetWidth - mark.offsetWidth) / 2 - REACH_GAP;
      const reach = Math.max(0, Math.floor(free));
      window.clearTimeout(timer);
      if (reach <= applied) apply(reach);
      else timer = window.setTimeout(() => apply(reach), REACH_GROW_DELAY_MS);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    observer.observe(mark);
    apply(
      Math.max(
        0,
        Math.floor((column.offsetWidth - mark.offsetWidth) / 2 - REACH_GAP),
      ),
    );
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      bar.style.removeProperty("--topbar-tabs-reach");
    };
  }, [stripRef]);
}
