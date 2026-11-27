// Stella Views authoring API. A view is one `.view.tsx` file that `export default`s its root
// component; it runs natively on every device (no browser, no server) and updates live when its
// file changes. Import everything from "@stella/view" (or "react" for the hooks).
//
// Colours take theme names ("text", "muted", "accent", "danger", "success", "warning",
// "surface", "subtle", "border") or any CSS colour ("#1e88e5", "rgb(…)", "oklch(…)").
// Sizes are points; "full" fills the parent; "50%" is a fraction of it.

declare module "@stella/view" {
  export type Key = string | number;
  export type Child = Element | string | number | boolean | null | undefined | Child[];
  export interface Element {
    readonly $$v: 1;
    readonly type: unknown;
    readonly props: unknown;
    readonly key: Key | null;
  }
  export type Component<P = {}> = (props: P) => Child;
  export type HostComponent<P> = { readonly $$host: string; (props: P): Element };

  export type Color = "text" | "muted" | "accent" | "danger" | "success" | "warning" | "surface" | "subtle" | "border" | (string & {});
  export type Size = number | "full" | "fit" | `${number}%`;
  export type Padding = number | [vertical: number, horizontal: number] | [top: number, right: number, bottom: number, left: number];
  export type IconName = string;

  export type BoxProps = {
    key?: Key;
    children?: Child;
    gap?: number;
    padding?: Padding;
    align?: "start" | "center" | "end" | "stretch" | "baseline";
    justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
    wrap?: boolean;
    grow?: number;
    shrink?: number;
    width?: Size;
    height?: Size;
    minWidth?: Size;
    maxWidth?: Size;
    minHeight?: Size;
    maxHeight?: Size;
    aspect?: number;
    background?: Color;
    /** "sm" | "md" | "lg" | "xl" | "full" or points. */
    radius?: "sm" | "md" | "lg" | "xl" | "full" | number;
    /** true draws a hairline in the theme's border colour. */
    border?: boolean | Color;
    shadow?: "sm" | "md" | "lg";
    opacity?: number;
    hidden?: boolean;
    /** Animate layout and prop changes on a spring. */
    animate?: boolean;
    /** Entry and exit animations. */
    enter?: "fade" | "rise" | "drop" | "scale" | "pop" | "slide";
    exit?: "fade" | "rise" | "drop" | "scale" | "pop" | "slide";
    /** A tooltip. */
    tooltip?: string;
  };

  // ---------------------------------------------------------------- layout
  /** Children top to bottom. */
  export const Column: HostComponent<BoxProps>;
  /** Children left to right. */
  export const Row: HostComponent<BoxProps>;
  /** Children layered on top of each other, the first at the back. */
  export const Stack: HostComponent<BoxProps>;
  /** A grid of `columns` equal columns; children fill it row by row. */
  export const Grid: HostComponent<BoxProps & { columns: number }>;
  /** A scrolling area; give it a height (or let it grow in a bounded parent). */
  export const Scroll: HostComponent<BoxProps & { horizontal?: boolean; stickToBottom?: boolean }>;
  /** Flexible empty space (or `size` points of it). */
  export const Spacer: HostComponent<{ key?: Key; size?: number }>;
  export const Divider: HostComponent<{ key?: Key; vertical?: boolean }>;
  export type DragEvent = { phase: "start" | "move" | "end"; dx: number; dy: number; x: number; y: number };
  /** A box that takes presses, hovers and drags. */
  export const Pressable: HostComponent<
    BoxProps & {
      onPress?: () => void;
      onDoublePress?: () => void;
      onLongPress?: () => void;
      onHover?: (inside: boolean) => void;
      onDrag?: (event: DragEvent) => void;
      cursor?: "pointer" | "grab" | "grabbing" | "crosshair" | "text" | "default";
      disabled?: boolean;
      /** Fill while hovered / pressed. */
      hoverBackground?: Color;
      pressBackground?: Color;
    }
  >;

  // ---------------------------------------------------------------- content
  export type TextStyle = {
    variant?: "display" | "title" | "heading" | "subheading" | "body" | "label" | "caption" | "mono";
    size?: number;
    weight?: 400 | 500 | 600 | 700;
    color?: Color;
    align?: "start" | "center" | "end";
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    /** Clamp to this many lines, with an ellipsis. */
    lines?: number;
    selectable?: boolean;
    /** Monospaced digits and letters. */
    mono?: boolean;
  };
  /** Text. Nest `<Text>` inside `<Text>` for bold, coloured or linked runs (`href`). */
  export const Text: HostComponent<{ key?: Key; children?: Child; href?: string } & TextStyle & Pick<BoxProps, "grow" | "width" | "maxWidth" | "hidden">>;
  /** Markdown: headings, lists, tables, code, links. */
  export const Markdown: HostComponent<{ key?: Key; children: string; selectable?: boolean }>;
  /** An image from an https URL or a data: URI. */
  export const Image: HostComponent<
    Pick<BoxProps, "key" | "width" | "height" | "maxWidth" | "maxHeight" | "aspect" | "radius" | "border"> & {
      src: string;
      alt?: string;
      fit?: "cover" | "contain";
      /** Opens full size on press, with pinch and scroll zoom. */
      zoomable?: boolean;
    }
  >;
  /** One of Stella's icons (Lucide names: "search", "check", "chevron-right", "play", "plus", "x", …). */
  export const Icon: HostComponent<{ key?: Key; name: IconName; size?: number; color?: Color }>;
  /** Source code, monospaced and selectable. */
  export const Code: HostComponent<{ key?: Key; children: string; language?: string }>;
  export const Video: HostComponent<Pick<BoxProps, "key" | "width" | "height" | "aspect" | "radius"> & { src: string; autoplay?: boolean; loop?: boolean; muted?: boolean; fit?: "cover" | "contain" }>;
  export const Audio: HostComponent<{ key?: Key; src: string; autoplay?: boolean; loop?: boolean; title?: string }>;
  /** A progress bar; leave out `value` for an ongoing activity. */
  export const Progress: HostComponent<{ key?: Key; value?: number; color?: Color; width?: Size }>;

  // ---------------------------------------------------------------- inputs
  export const Button: HostComponent<{
    key?: Key;
    children?: Child;
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "small" | "normal" | "large";
    icon?: IconName;
    iconRight?: IconName;
    disabled?: boolean;
    fullWidth?: boolean;
    tooltip?: string;
    onPress?: () => void;
  }>;
  export const TextField: HostComponent<{
    key?: Key;
    value: string;
    onChange?: (value: string) => void;
    /** Enter (Shift+Enter is a new line when multiline). */
    onSubmit?: (value: string) => void;
    placeholder?: string;
    label?: string;
    error?: string;
    multiline?: boolean;
    secure?: boolean;
    disabled?: boolean;
    autoFocus?: boolean;
    width?: Size;
    grow?: number;
  }>;
  export const Checkbox: HostComponent<{ key?: Key; checked: boolean; onChange?: (checked: boolean) => void; label?: string; disabled?: boolean }>;
  export const Switch: HostComponent<{ key?: Key; checked: boolean; onChange?: (checked: boolean) => void; label?: string; description?: string; disabled?: boolean }>;
  export const Slider: HostComponent<{ key?: Key; value: number; onChange?: (value: number) => void; min?: number; max?: number; step?: number; label?: string; disabled?: boolean; width?: Size }>;
  export type Option = string | { value: string; label: string };
  export const Select: HostComponent<{ key?: Key; value: string; options: Option[]; onChange?: (value: string) => void; placeholder?: string; label?: string; disabled?: boolean; width?: Size }>;
  /** A row of mutually exclusive choices. */
  export const Segmented: HostComponent<{ key?: Key; value: string; options: Option[]; onChange?: (value: string) => void }>;

  // ---------------------------------------------------------------- structure
  /** A tab bar; render the selected panel yourself below it. */
  export const Tabs: HostComponent<{ key?: Key; value: string; tabs: Option[]; onChange?: (value: string) => void }>;
  /** A titled section that folds open and closed. */
  export const Disclosure: HostComponent<{ key?: Key; title: string; children?: Child; defaultOpen?: boolean; open?: boolean; onToggle?: (open: boolean) => void }>;
  /** A dialog over the view (a bottom sheet on phones). Escape or a press outside calls onClose. */
  export const Modal: HostComponent<{ key?: Key; open: boolean; onClose?: () => void; title?: string; children?: Child; size?: "sm" | "md" | "lg" }>;
  export type TableColumn<Row> = {
    key: keyof Row & string;
    title: string;
    align?: "start" | "center" | "end";
    /** Points, or a share of the free width ("2fr"). */
    width?: number | `${number}fr`;
    format?: "number" | "currency" | "percent" | "date";
    sortable?: boolean;
  };
  /** A table that sizes its columns to their content, with a sticky header and sorting. */
  export function Table<Row extends Record<string, unknown>>(props: {
    key?: Key;
    columns: TableColumn<Row>[];
    rows: Row[];
    /** Custom cell content; return undefined to show the value. */
    renderCell?: (row: Row, column: TableColumn<Row>, index: number) => Child;
    onRowPress?: (row: Row, index: number) => void;
    /** Starting sort; the user can change it on sortable columns. */
    sort?: { key: string; direction: "asc" | "desc" };
    maxHeight?: Size;
    striped?: boolean;
  }): Element;
  /** A long list: only the rows on screen are drawn, however many items there are. */
  export function List<Item>(props: {
    key?: Key;
    items: Item[];
    renderItem: (item: Item, index: number) => Child;
    itemKey?: (item: Item, index: number) => Key;
    /** Typical row height, for scrolling before rows are measured. */
    estimatedItemHeight?: number;
    gap?: number;
    dividers?: boolean;
    height?: Size;
    grow?: number;
  }): Element;
  export type ChartType = "line" | "area" | "bar" | "pie" | "scatter";
  /** A chart of `data` rows: `x` names the category or x field, `y` one or more series fields. */
  export function Chart<Row extends Record<string, unknown>>(props: {
    key?: Key;
    type: ChartType;
    data: Row[];
    x: keyof Row & string;
    y: (keyof Row & string) | (keyof Row & string)[];
    height?: number;
    stacked?: boolean;
    colors?: Color[];
    legend?: boolean;
    /** Value format for the axis and labels. */
    format?: "number" | "currency" | "percent";
    title?: string;
  }): Element;

  // ---------------------------------------------------------------- canvas
  export type Paint = { fill?: Color; stroke?: Color; width?: number; opacity?: number; cap?: "butt" | "round" | "square" };
  export type TextPaint = { color?: Color; size?: number; weight?: 400 | 500 | 600 | 700; align?: "start" | "center" | "end"; mono?: boolean };
  export interface Graphics {
    readonly width: number;
    readonly height: number;
    clear(color?: Color): Graphics;
    rect(x: number, y: number, w: number, h: number, paint?: Paint & { radius?: number }): Graphics;
    circle(cx: number, cy: number, r: number, paint?: Paint): Graphics;
    ellipse(cx: number, cy: number, rx: number, ry: number, paint?: Paint): Graphics;
    line(x1: number, y1: number, x2: number, y2: number, paint?: Paint): Graphics;
    /** SVG path data ("M0 0 L10 10 Z"). */
    path(d: string, paint?: Paint): Graphics;
    polyline(points: number[], paint?: Paint): Graphics;
    text(text: string, x: number, y: number, paint?: TextPaint): Graphics;
    image(src: string, x: number, y: number, w: number, h: number): Graphics;
    save(): Graphics;
    restore(): Graphics;
    translate(x: number, y: number): Graphics;
    rotate(radians: number): Graphics;
    scale(x: number, y?: number): Graphics;
    alpha(opacity: number): Graphics;
  }
  export type PointerEvent = { type: "down" | "move" | "up"; x: number; y: number };
  /** 2D drawing, redrawn whenever the component renders: pair it with `useFrame` for animation. */
  export const Canvas: HostComponent<{
    key?: Key;
    width: number;
    height: number;
    draw: (g: Graphics) => void;
    onPointer?: (event: PointerEvent) => void;
    background?: Color;
    /** Scale to the parent's width, keeping the ratio. */
    fit?: boolean;
  }>;

  // ---------------------------------------------------------------- React
  export const Fragment: unknown;
  export function createElement(type: unknown, props?: Record<string, unknown> | null, ...children: Child[]): Element;
  export function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void];
  export function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, (action: A) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(make: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  export type Context<T> = { Provider: HostComponent<{ value: T; children?: Child }> };
  export function createContext<T>(defaultValue: T): Context<T>;
  export function useContext<T>(context: Context<T>): T;
  export function memo<P>(component: Component<P>, equal?: (a: P, b: P) => boolean): (props: P & { key?: Key }) => Element;

  // ---------------------------------------------------------------- Stella hooks
  /** A value saved with the view: it survives restarts and edits, and syncs to the user's devices. */
  export function useStorage<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void];
  /** The view's data file (`name.data.json` beside `name.view.tsx`), live: it re-renders when the file changes. */
  export function useData<T = unknown>(): T | null;
  /** The space the view has, in points. Design narrow-first: phones are ~390 wide, Stella's side panel ~420. */
  export function useViewport(): { width: number; height: number };
  export function useTheme(): { dark: boolean; accent: string; platform: "desktop" | "web" | "ios" | "android" };
  /** Calls `fn(dt, time)` on every display frame while the component is mounted (milliseconds). */
  export function useFrame(fn: (dt: number, time: number) => void): void;
  /** Calls `fn` every `ms` milliseconds; `null` pauses it. */
  export function useInterval(fn: () => void, ms: number | null): void;
  /** Keyboard shortcuts while the view has focus: "mod+k" (⌘ on macOS, Ctrl elsewhere), "Escape", "ArrowUp", "shift+Enter". */
  export function useKey(chords: string | string[], fn: (key: string) => void): void;

  export type FetchInit = { method?: string; headers?: Record<string, string>; body?: string };
  export type FetchResponse = { ok: boolean; status: number; statusText: string; headers: Record<string, string>; url: string; text(): Promise<string>; json<T = unknown>(): Promise<T> };
  export type PickedFile = { name: string; path?: string; text: string };

  /** What the device can do for the view. Each call is a Promise. */
  export const stella: {
    storage: {
      get<T = unknown>(key: string): T | undefined;
      set(key: string, value: unknown): Promise<void>;
      remove(key: string): Promise<void>;
      keys(): string[];
      clear(): Promise<void>;
    };
    /** HTTPS straight from the device, without CORS. Public internet only. */
    fetch(url: string, init?: FetchInit): Promise<FetchResponse>;
    clipboard: { writeText(text: string): Promise<void>; readText(): Promise<string> };
    openUrl(url: string): Promise<void>;
    notify(title: string, options?: { body?: string }): Promise<void>;
    haptic(kind?: "light" | "medium" | "heavy" | "success" | "warning" | "error" | "selection"): Promise<void>;
    share(content: { text?: string; url?: string; title?: string }): Promise<void>;
    pickFile(options?: { accept?: string[] }): Promise<PickedFile | null>;
    /** Saves text (or JSON) where the user picks; resolves with the path, or null if cancelled. */
    saveFile(name: string, content: string | object): Promise<string | null>;
    /** Asks Stella's language model; resolves with its reply text. */
    ask(prompt: string, options?: { system?: string }): Promise<string>;
    /** Sends a message to the conversation the view belongs to, as the user. */
    send(message: string): Promise<void>;
    location(): Promise<{ latitude: number; longitude: number; accuracy: number } | null>;
    readonly platform: "desktop" | "web" | "ios" | "android";
  };
}

declare module "react" {
  export * from "@stella/view";
}

declare namespace JSX {
  type Element = import("@stella/view").Element;
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: import("@stella/view").Key;
  }
  interface IntrinsicElements {}
}

// Globals a view has besides the language's own (Math, JSON, Date, Map, Promise, …).
declare const console: { log(...a: unknown[]): void; info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void; debug(...a: unknown[]): void };
declare function setTimeout(fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): number;
declare function clearTimeout(id: number | undefined): void;
declare function setInterval(fn: () => void, ms?: number): number;
declare function clearInterval(id: number | undefined): void;
declare function requestAnimationFrame(fn: (time: number) => void): number;
declare function cancelAnimationFrame(id: number): void;
