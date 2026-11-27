// The contract between a view's program (running in a PsychoScript live run) and the host that
// renders it. Every platform's host (Rune desktop, web, mobile) speaks exactly this; the program
// side is `runtime/runtime.js`. Change it here and in the runtime together, and raise
// VIEW_PROTOCOL when either side changes shape.

export const VIEW_PROTOCOL = 1;

/** A host node: what renderers draw. Text children are plain strings. */
export type ViewNode = {
  /** Node type, one of VIEW_NODE_TYPES. */
  t: ViewNodeType;
  /** The author's `key`, when given. */
  k?: string | number;
  /** Props, JSON only (handlers are in `h`). */
  p?: Record<string, unknown>;
  /** Handlers: prop name → handler id, delivered back as `{ t: "event", h, v }`. */
  h?: Record<string, number>;
  c?: ViewChild[];
};
export type ViewChild = ViewNode | string;

export const VIEW_NODE_TYPES = [
  // layout
  "Column", "Row", "Stack", "Grid", "Scroll", "Spacer", "Divider", "Pressable",
  // content
  "Text", "Markdown", "Image", "Icon", "Code", "Video", "Audio",
  // inputs
  "Button", "TextField", "Checkbox", "Switch", "Slider", "Select", "Segmented",
  // structure
  "Tabs", "Disclosure", "Modal", "Table", "List", "Chart", "Canvas", "Progress",
] as const;
export type ViewNodeType = (typeof VIEW_NODE_TYPES)[number];

/** Everything `import … from "@stella/view"` can name (runtime/runtime.js `api`); types aside. */
export const VIEW_MODULE_EXPORTS = [
  ...VIEW_NODE_TYPES,
  "h", "createElement", "Fragment", "createContext", "memo",
  "useState", "useReducer", "useEffect", "useLayoutEffect", "useMemo", "useCallback", "useRef", "useContext",
  "useStorage", "useData", "useViewport", "useTheme", "useFrame", "useInterval", "useKey",
  "stella",
] as const;

/** useState/useReducer values by component path, then by hook signature (kind, binding, initial value). */
export type ViewHookState = Record<string, Record<string, unknown>>;

/** Program → host posts. */
export type ViewPost =
  | { t: "render"; rev: number; tree: ViewChild | null; keys?: string[] }
  | { t: "call"; id: number; m: ViewCallMethod; a: unknown[] }
  | { t: "frame" }
  | { t: "log"; level: "log" | "info" | "warn" | "error" | "debug"; text: string }
  | { t: "error"; phase: "render" | "event" | "effect" | "timer" | "main"; message: string; stack?: string }
  | { t: "state"; hooks: ViewHookState }
  | { t: "title"; title: string };

/** Host → program messages. */
export type ViewMessage =
  | { t: "event"; h: number; v?: unknown }
  | { t: "frame"; time: number; dt: number }
  | { t: "reply"; id: number; ok: boolean; v?: unknown; e?: string }
  | { t: "viewport"; width: number; height: number }
  | { t: "theme"; theme: ViewTheme }
  | { t: "data"; data: unknown }
  | { t: "storage"; key: string; value: unknown }
  | { t: "key"; chord: string; key: string }
  | { t: "save" };

export type ViewTheme = { dark: boolean; accent: string; platform: "desktop" | "web" | "ios" | "android" };

/** What a run starts with (the program's `__input()`). */
export type ViewInput = {
  protocol: number;
  viewport: { width: number; height: number };
  theme: ViewTheme;
  /** The view's saved key-value storage. */
  storage: Record<string, unknown>;
  /** The view's data file, when it has one. */
  data: unknown;
  /** Hook state from the run this one replaces (hot swap). */
  restore?: ViewHookState;
};

/** Every host capability a program can call (`stella.*` in the authoring API). */
export const VIEW_CALL_METHODS = [
  "storage.set", "storage.remove", "storage.clear",
  "fetch",
  "clipboard.writeText", "clipboard.readText",
  "openUrl", "notify", "haptic", "share",
  "pickFile", "saveFile",
  "ask", "send",
  "location",
] as const;
export type ViewCallMethod = (typeof VIEW_CALL_METHODS)[number];

/** Budgets every host runs views with. */
export const VIEW_LIMITS = {
  /** Longest a program may compute without waiting on its host. */
  sliceBudgetMs: 100,
  maxHeapBytes: 64 * 1024 * 1024,
  /** Biggest view source the hosts accept. */
  maxSourceBytes: 1024 * 1024,
} as const;
