import type { ViewerSurface } from "@/features/workspace-display/file-viewer-store";

type MediaState = {
  media: HTMLMediaElement;
  time: number;
  playing: boolean;
};

type ScrollState = { element: Element; top: number; left: number };

const slots = new Map<ViewerSurface, HTMLElement>();
const placements = new Map<HTMLElement, ViewerSurface>();

const scrolledIn = (host: HTMLElement): ScrollState[] => {
  const scrolled: ScrollState[] = [];
  for (const element of host.querySelectorAll("*")) {
    const { scrollTop: top, scrollLeft: left } = element;
    if (top !== 0 || left !== 0) scrolled.push({ element, top, left });
  }
  return scrolled;
};

const mediaIn = (host: HTMLElement): MediaState[] =>
  [...host.querySelectorAll<HTMLMediaElement>("video, audio")].map((media) => ({
    media,
    time: media.currentTime,
    playing: !media.paused && !media.ended,
  }));

const resume = ({ media, time, playing }: MediaState): void => {
  const apply = () => {
    if (time > 0) media.currentTime = time;
    if (playing) void media.play().catch(() => undefined);
  };
  if (media.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
  else media.addEventListener("loadedmetadata", apply, { once: true });
};

/**
 * Moving a node between documents keeps its React state but drops its scroll
 * positions and restarts its media, so those are carried across.
 */
const moveInto = (slot: HTMLElement, host: HTMLElement): void => {
  if (host.parentNode === slot) return;
  const scrolled = host.parentNode ? scrolledIn(host) : [];
  const media = host.parentNode ? mediaIn(host) : [];
  slot.appendChild(host);
  for (const { element, top, left } of scrolled) element.scrollTo(left, top);
  media.forEach(resume);
};

export const createViewerHost = (): HTMLElement => {
  const host = document.createElement("div");
  host.className = "file-viewer__host";
  return host;
};

export const placeViewerHost = (
  host: HTMLElement,
  surface: ViewerSurface,
): void => {
  placements.set(host, surface);
  const slot = slots.get(surface);
  if (slot) moveInto(slot, host);
};

export const dropViewerHost = (host: HTMLElement): void => {
  placements.delete(host);
  host.remove();
};

export const registerViewerSlot = (
  surface: ViewerSurface,
  slot: HTMLElement,
): (() => void) => {
  slots.set(surface, slot);
  for (const [host, placed] of placements) {
    if (placed === surface) moveInto(slot, host);
  }
  return () => {
    if (slots.get(surface) === slot) slots.delete(surface);
  };
};
