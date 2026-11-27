/** A detached viewer window: Electron main's window id for it, and the global `window` its items schedule frames on. */
export type DetachedWindow = { window: Window; hostId: string };

export const detachedWindows = new Map<string, DetachedWindow>();
