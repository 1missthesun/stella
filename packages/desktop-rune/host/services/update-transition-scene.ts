// What the full window draws over itself while the app source changes under it, shared by the host's
// UpdateTransition and the UI's UpdateTransitionLayer. The UI is rebuilt on every interface swap, so
// the scene lives on globalThis rather than in either module.

export type TransitionScene =
  | { kind: "cover"; before: string }
  | { kind: "reveal"; before: string }
  | { kind: "frost"; before: string; tint: string; dur: number }
  | { kind: "hold"; frosted: string; dark: boolean; label: string; labelDelayMs: number; heldMs: number }
  | { kind: "focusIn"; frosted: string; dark: boolean; label: string };

/** The live app under the scene: blur and scale, moved on a spring of `dur` seconds after `delayMs`, or at once. */
export type AppLook = { blur: number; scale: number; dur?: number; delayMs?: number };

type Store = {
  scene: TransitionScene | null;
  app: AppLook;
  live: boolean;
  version: number;
  listeners: Set<() => void>;
};

const REST: AppLook = { blur: 0, scale: 1 };

const store = (): Store => {
  const g = globalThis as { __stellaRuneUpdateTransition?: Store };
  return (g.__stellaRuneUpdateTransition ??= { scene: null, app: REST, live: false, version: 0, listeners: new Set() });
};

const changed = (s: Store) => {
  s.version += 1;
  for (const listener of [...s.listeners]) listener();
};

export const transitionScene = () => store().scene;
export const transitionApp = () => store().app;
export const transitionVersion = () => store().version;

export function setTransitionScene(scene: TransitionScene | null, app: AppLook = REST): void {
  const s = store();
  s.scene = scene;
  s.app = app;
  changed(s);
}

export function subscribeTransition(listener: () => void): () => void {
  const s = store();
  s.listeners.add(listener);
  return () => void s.listeners.delete(listener);
}

/** The full window's launch splash has left: the app under a held frame is showing. */
export function setTransitionAppLive(live: boolean): void {
  const s = store();
  if (s.live === live) return;
  s.live = live;
  changed(s);
}

export const transitionAppLive = () => store().live;
