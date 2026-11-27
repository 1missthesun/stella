import { useSyncExternalStore } from "react";
import type { Appearance } from "../../host/bridge";
import { GLASS_MATERIAL, type MaterialPrefs } from "./tokens";

/** Apple turns Reduce Transparency on with Increase Contrast; a contrast theme flattens materials too. */
const fromAppearance = (a: Appearance): MaterialPrefs => {
  const contrast = Boolean(a.increaseContrast || a.forcedColors);
  return { solid: contrast || Boolean(a.reduceTransparency), contrast };
};

let prefs: MaterialPrefs = GLASS_MATERIAL;
let started = false;
const listeners = new Set<() => void>();

const set = (next: MaterialPrefs) => {
  if (next.solid === prefs.solid && next.contrast === prefs.contrast) return;
  prefs = next.solid || next.contrast ? next : GLASS_MATERIAL;
  for (const listener of listeners) listener();
};

const start = () => {
  if (started) return;
  if (typeof stella === "undefined") return;
  started = true;
  stella.on("appearance", (e) => set(fromAppearance(e)));
  void stella.engine.appearance.get().then((a) => set(fromAppearance(a))).catch(() => {});
};

const subscribe = (listener: () => void) => {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const read = () => prefs;

/** The system's Reduce Transparency and contrast settings, as the engine's `appearance` event reports them. */
export const useMaterialPrefs = (): MaterialPrefs => useSyncExternalStore(subscribe, read, read);
