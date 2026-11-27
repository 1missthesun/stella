// matchMedia over the engine's appearance and the window's viewport, with change events.

export type MediaEnvironment = {
  appearance: { dark: boolean; reducedMotion?: boolean; highContrast?: boolean };
  viewport: { width: number; height: number; devicePixelRatio: number; x?: number; y?: number };
};

type ChangeListener = (event: { matches: boolean; media: string }) => void;

const px = (value: string, env: MediaEnvironment) => {
  const n = parseFloat(value);
  if (value.endsWith("em") || value.endsWith("rem")) return n * 16;
  void env;
  return n;
};

function evaluateFeature(feature: string, env: MediaEnvironment): boolean {
  const m = feature.trim().match(/^\(?\s*([a-z-]+)\s*(?::\s*([^)]+?))?\s*\)?$/i);
  if (!m) return false;
  const name = m[1]!.toLowerCase();
  const value = (m[2] ?? "").trim().toLowerCase();
  const { appearance, viewport } = env;
  switch (name) {
    case "prefers-color-scheme": return value === (appearance.dark ? "dark" : "light");
    case "prefers-reduced-motion": return value === (appearance.reducedMotion ? "reduce" : "no-preference");
    case "prefers-contrast": return value === (appearance.highContrast ? "more" : "no-preference");
    case "prefers-reduced-transparency": return value === "no-preference";
    case "forced-colors": return value === "none";
    case "min-width": return viewport.width >= px(value, env);
    case "max-width": return viewport.width <= px(value, env);
    case "min-height": return viewport.height >= px(value, env);
    case "max-height": return viewport.height <= px(value, env);
    case "orientation": return value === (viewport.width >= viewport.height ? "landscape" : "portrait");
    case "min-resolution": return viewport.devicePixelRatio >= parseFloat(value);
    case "max-resolution": return viewport.devicePixelRatio <= parseFloat(value);
    case "-webkit-min-device-pixel-ratio":
    case "min-device-pixel-ratio": return viewport.devicePixelRatio >= parseFloat(value);
    case "pointer":
    case "any-pointer": return value === "fine";
    case "hover":
    case "any-hover": return value === "hover";
    case "display-mode": return value === "standalone";
    case "color": return true;
    case "screen":
    case "all": return true;
    case "print": return false;
    default: return false;
  }
}

export function evaluateMediaQuery(query: string, env: MediaEnvironment): boolean {
  return query.split(",").some((alternative) => {
    let text = alternative.trim().toLowerCase();
    let negate = false;
    if (text.startsWith("not ")) { negate = true; text = text.slice(4); }
    text = text.replace(/^only\s+/, "");
    const parts = text.split(/\s+and\s+/).filter(Boolean);
    const all = parts.every((part) => evaluateFeature(part, env));
    return negate ? !all : all;
  });
}

export function createMatchMedia(env: MediaEnvironment) {
  const lists = new Set<WeakRef<MediaQueryListImpl>>();

  class MediaQueryListImpl extends EventTarget {
    matches: boolean;
    onchange: ChangeListener | null = null;
    private readonly legacy = new Set<ChangeListener>();
    constructor(readonly media: string) {
      super();
      this.matches = evaluateMediaQuery(media, env);
    }
    addListener(listener: ChangeListener) { this.legacy.add(listener); }
    removeListener(listener: ChangeListener) { this.legacy.delete(listener); }
    refresh() {
      const next = evaluateMediaQuery(this.media, env);
      if (next === this.matches) return;
      this.matches = next;
      const event = Object.assign(new Event("change"), { matches: next, media: this.media });
      this.dispatchEvent(event);
      this.onchange?.(event);
      for (const listener of this.legacy) listener(event);
    }
  }

  return {
    matchMedia(query: string) {
      const list = new MediaQueryListImpl(String(query));
      lists.add(new WeakRef(list));
      return list;
    },
    reevaluate(changed: boolean) {
      if (!changed) return;
      for (const ref of lists) {
        const list = ref.deref();
        if (list) list.refresh(); else lists.delete(ref);
      }
    },
  };
}
