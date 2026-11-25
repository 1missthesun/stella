export type DetachedWindow = {
  window: Window;
  root: HTMLElement;
  stopMirroring: () => void;
};

/**
 * Kept apart from viewer state: a Window reached through component props is
 * walked by React's development profiler, which throws on sandboxed frames.
 */
export const detachedWindows = new Map<string, DetachedWindow>();
