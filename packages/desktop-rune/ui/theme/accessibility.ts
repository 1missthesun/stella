import { useSyncExternalStore } from "react";
import type { Appearance } from "../../host/bridge";
import { isLowMemoryWindowsDevice } from "../../../desktop/electron/resource-profile";
import { GLASS_MATERIAL, type MaterialPrefs } from "./tokens";

/**
 * Weak hardware draws the solid material, as under Reduce Transparency: the signal Electron's
 * windows get as `lowPower=1` (Windows with 8 GB of RAM or less; `STELLA_LOW_MEMORY_WINDOWS`
 * overrides it on any platform). On the LG Gram glass cost ~21 points of iGPU and ~1 W over solid,
 * and trimming its knobs didn't pay. The web build has no `process`, so it keeps glass.
 */
const LOW_POWER = (() => {
  try {
    return typeof process !== "undefined" && isLowMemoryWindowsDevice();
  } catch {
    return false;
  }
})();
const BASE: MaterialPrefs = LOW_POWER ? { solid: true, contrast: false } : GLASS_MATERIAL;

/** Apple turns Reduce Transparency on with Increase Contrast; a contrast theme flattens materials too. */
const fromAppearance = (a: Appearance): MaterialPrefs => {
  const contrast = Boolean(a.increaseContrast || a.forcedColors);
  return { solid: LOW_POWER || contrast || Boolean(a.reduceTransparency), contrast };
};

let prefs: MaterialPrefs = BASE;
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

/** The system's Reduce Transparency and contrast settings, as the engine's `appearance` event reports them, and low-power hardware. */
export const useMaterialPrefs = (): MaterialPrefs => useSyncExternalStore(subscribe, read, read);
