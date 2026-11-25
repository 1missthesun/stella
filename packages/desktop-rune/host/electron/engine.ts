// The shim's view of the engine platform API (host/bridge.ts `engine` + `onEngineEvent`). The
// host also runs headless (services only, for tooling), so every call degrades to a fallback
// when no engine is attached.

export type EngineDisplay = {
  id: number;
  label?: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  size?: { width: number; height: number };
  workAreaSize?: { width: number; height: number };
  scaleFactor: number;
  rotation?: number;
  internal?: boolean;
  monochrome?: boolean;
  colorDepth?: number;
  colorSpace?: string;
  depthPerComponent?: number;
  displayFrequency?: number;
  accelerometerSupport?: "available" | "unavailable" | "unknown";
  touchSupport?: "available" | "unavailable" | "unknown";
  detected?: boolean;
};

export type EngineMenuItem = {
  id?: string;
  label?: string;
  accelerator?: string;
  enabled?: boolean;
  checked?: boolean;
  visible?: boolean;
  type?: "normal" | "separator" | "checkbox" | "radio" | "submenu";
  submenu?: EngineMenuItem[];
};

export type EngineBounds = { x: number; y: number; width: number; height: number };

export type EngineApi = typeof import("../bridge").engine;

export type EngineEventOf = {
  window: { t: "window"; id: string; kind: string; bounds?: EngineBounds; w?: number; h?: number };
  notification: { t: "notification"; id: string; action: "click" | "close" };
  menu: { t: "menu"; id: string };
  tray: { t: "tray"; id: string; kind: "click" | "menu" | "double-click" | "right-click"; item?: string };
  shortcut: { t: "shortcut"; accel: string };
  appearance: { t: "appearance"; dark: boolean; accentColor?: string; reducedMotion?: boolean };
  display: { t: "display"; kind?: string };
};

type BridgeModule = {
  engine?: EngineApi;
  onEngineEvent?: (t: string, handler: (event: any) => void) => () => void;
};

let bridge: BridgeModule | null = null;

/** Attaches the engine bridge; until then (and in a headless host) the fallbacks answer. */
/** `module` is host/bridge.ts; its `engine` and `onEngineEvent` exports are used when present. */
export function attachEngine(module: object) {
  bridge = module as BridgeModule;
  for (const [t, handlers] of pendingListeners) for (const h of handlers) bridge.onEngineEvent?.(t, h);
}

export function engine(): EngineApi | null {
  return bridge?.engine ?? null;
}

const pendingListeners = new Map<string, Set<(event: any) => void>>();

export function onEngine<K extends keyof EngineEventOf>(t: K, handler: (event: EngineEventOf[K]) => void): () => void {
  if (bridge?.onEngineEvent) return bridge.onEngineEvent(t, handler);
  let set = pendingListeners.get(t);
  if (!set) pendingListeners.set(t, (set = new Set()));
  set.add(handler);
  return () => {
    set!.delete(handler);
  };
}

const warned = new Set<string>();

export function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(`[electron-shim] ${message}`);
}

/** Runs an engine call; logs and returns the fallback when there is no engine or it fails. */
export async function viaEngine<T>(name: string, call: (e: EngineApi) => Promise<T> | undefined, fallback: () => T | Promise<T>): Promise<T> {
  const e = engine();
  if (e) {
    try {
      const result = call(e);
      if (result !== undefined) return await result;
    } catch (error) {
      warnOnce(`engine-failed:${name}`, `engine ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return await fallback();
}
