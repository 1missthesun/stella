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

export type EngineApi = {
  window: {
    focus(id: string): Promise<void>;
    show(id: string): Promise<void>;
    hide(id: string): Promise<void>;
    minimize(id: string): Promise<void>;
    maximize(id: string): Promise<void>;
    unmaximize(id: string): Promise<void>;
    setFullScreen(id: string, on: boolean): Promise<void>;
    close(id: string): Promise<void>;
    center(id: string): Promise<void>;
    getBounds(id: string): Promise<EngineBounds>;
    setBounds(id: string, bounds: Partial<EngineBounds>): Promise<void>;
    isMaximized(id: string): Promise<boolean>;
    isFocused(id: string): Promise<boolean>;
  };
  clipboard: {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
    readHTML(): Promise<string>;
    writeHTML(html: string, text?: string): Promise<void>;
    readImage(): Promise<Uint8Array | null>;
    writeImage(png: Uint8Array): Promise<void>;
    readFiles(): Promise<string[]>;
    availableFormats(): Promise<string[]>;
  };
  dialog: {
    openFile(opts: {
      title?: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
      multi?: boolean;
      directory?: boolean;
    }): Promise<string[] | null>;
    saveFile(opts: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  };
  notify(n: { id: string; title: string; body?: string; icon?: string; silent?: boolean }): Promise<void>;
  menu: {
    popup(items: EngineMenuItem[], at: { window?: string; x?: number; y?: number }): Promise<string | null>;
    setApplicationMenu(items: EngineMenuItem[] | null): Promise<void>;
  };
  tray: {
    create(opts: { icon: string | Uint8Array; tooltip?: string; menu?: EngineMenuItem[] }): Promise<string>;
    setMenu(id: string, menu: EngineMenuItem[] | null): Promise<void>;
    setTooltip(id: string, tooltip: string): Promise<void>;
    setIcon(id: string, icon: string | Uint8Array): Promise<void>;
    destroy(id: string): Promise<void>;
  };
  shortcut: {
    register(accelerator: string): Promise<boolean>;
    unregister(accelerator: string): Promise<void>;
    unregisterAll(): Promise<void>;
  };
  screen: {
    displays(): Promise<EngineDisplay[]>;
    primary(): Promise<EngineDisplay>;
    cursorPoint(): Promise<{ x: number; y: number }>;
  };
  appearance: { get(): Promise<{ dark: boolean; accentColor?: string; reducedMotion?: boolean }> };
  shell?: {
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<string>;
    showItemInFolder(path: string): Promise<void>;
  };
};

export type EngineEventOf = {
  window: { t: "window"; id: string; kind: string; bounds?: EngineBounds };
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
