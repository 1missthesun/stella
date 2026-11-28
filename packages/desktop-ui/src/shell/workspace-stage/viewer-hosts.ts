import type { ViewerSurface } from "@/features/workspace-display/file-viewer-store";

type MediaState = {
  media: HTMLMediaElement;
  time: number;
  playing: boolean;
};

type ScrollState = { element: Element; top: number; left: number };

type HostState = { scrolled: ScrollState[]; media: MediaState[] };

const slots = new Map<ViewerSurface, HTMLElement>();
const placements = new Map<HTMLElement, ViewerSurface>();
/** What a host showed when its slot left the page, until it lands in the next one. */
const carried = new WeakMap<HTMLElement, HostState>();

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

const SCROLL_RETRY_FRAMES = 6;

/** A scroller a new window hasn't laid out yet takes its position a few frames later. */
const restoreScroll = (
  scrolled: ScrollState[],
  view: Window,
  frames = SCROLL_RETRY_FRAMES,
): void => {
  const pending = scrolled.filter(({ element, top, left }) => {
    element.scrollTo(left, top);
    return (
      Math.abs(element.scrollTop - top) > 1 ||
      Math.abs(element.scrollLeft - left) > 1
    );
  });
  if (pending.length > 0 && frames > 0) {
    view.requestAnimationFrame(() => restoreScroll(pending, view, frames - 1));
  }
};

const stateOf = (host: HTMLElement): HostState => ({
  scrolled: scrolledIn(host),
  media: mediaIn(host),
});

/**
 * Moving a node between documents keeps its React state but drops its scroll
 * positions and restarts its media, so those are carried across. A host whose
 * slot already left the page (the viewer moved to or from a window of its own)
 * reads as unscrolled and paused, so it uses what its slot saw on the way out.
 */
const moveInto = (slot: HTMLElement, host: HTMLElement): void => {
  if (host.parentNode === slot) return;
  const state = host.isConnected ? stateOf(host) : carried.get(host);
  carried.delete(host);
  slot.appendChild(host);
  if (!state) return;
  restoreScroll(state.scrolled, slot.ownerDocument.defaultView ?? window);
  state.media.forEach(resume);
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
    // React lets go of the slot before taking it off the page: the last
    // moment its hosts still know where they were scrolled to.
    for (const host of placements.keys()) {
      if (host.parentNode === slot && host.isConnected) {
        carried.set(host, stateOf(host));
      }
    }
  };
};
