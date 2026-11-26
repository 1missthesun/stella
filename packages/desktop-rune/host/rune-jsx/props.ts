// Props of the Rune host elements. Each maps onto a Rune builder in engine/src (style.rs,
// text.rs, input.rs, media.rs, webview.rs, windows.rs); host/ELEMENTS.md documents them.
import type {} from "react";
import type { Mods } from "../bridge";

export type Color = string;
export type Size = number | "full" | "fit" | `${number}%`;
export type Run = {
  t: string; w?: number; c?: Color; m?: boolean; bg?: Color; i?: boolean; u?: Color; s?: number; st?: boolean;
  /** A link: pressing it calls the text's `onLink(href)`. */
  href?: string;
  /** Draws `bg` as a CSS inline background: the font's content area, with `pad` (padding-inline) and `margin` (margin-inline) taking room in the line. */
  box?: { pad?: number; margin?: number; radius?: number };
};
export type Shadow = { x?: number; y?: number; blur?: number; spread?: number; color: Color; inset?: boolean };
export type Gradient = { angle?: number; stops: [number, Color][] };
export type Radial = { center?: [number, number]; radius: number | [number, number]; stops: [number, Color][] };
export type Insets = { left?: number; top?: number; right?: number; bottom?: number };
export type Side = "top" | "bottom" | "left" | "right";
export type Effect = { opacity?: number; scale?: number; x?: number; y?: number; blur?: number; dur?: number; bounce?: number };
export type Presence = "fade" | "rise" | "drop" | "blur" | "scale" | "pop" | "slide" | Effect;
export type Frame = { at: number; x?: number; y?: number; scale?: number; scaleX?: number; scaleY?: number; opacity?: number; rotate?: number };
/** `opacity` pulses low↔high, `rotation` spins, `slide` moves from→to, `sequence` plays `frames`. */
export type Loop = {
  kind: "opacity" | "rotation" | "slide" | "sequence"; period: number; delay?: number; times?: number;
  low?: number; high?: number; from?: number | [number, number]; to?: number | [number, number]; frames?: Frame[]; origin?: [number, number];
  /** Each `sequence` segment's timing, like CSS `animation-timing-function`; `easeInOut` by default. `linear` for frames sampled from a curve. */
  ease?: "linear" | "ease" | "easeIn" | "easeOut" | "easeInOut";
};
export type Cursor =
  | "default" | "pointer" | "text" | "grab" | "grabbing" | "notAllowed" | "move"
  | "colResize" | "rowResize" | "ewResize" | "nsResize" | "nwseResize" | "neswResize"
  | "n-resize" | "e-resize" | "s-resize" | "w-resize" | "crosshair" | "cell" | "alias" | "copy"
  | "zoomIn" | "zoomOut" | "help" | "progress" | "wait" | "none";
export type KeyEvent = { key: string; chord: string; mods: Mods };
export type InputKeyEvent = KeyEvent & { value: string; start: number; end: number; length: number };
export type Layout = { x: number; y: number; w: number; h: number };
export type ScrollPos = { x: number; y: number; maxX: number; maxY: number; viewport: [number, number] };
export type Drag = { phase: "start" | "move" | "end"; dx: number; dy: number; x: number; y: number };

export type BoxProps = {
  /** Stable identity: Rune key, memo id, anchor target and command target. */
  id?: string;
  children?: React.ReactNode;
  // Layout
  w?: Size; h?: Size; minW?: Size; maxW?: Size; minH?: Size; maxH?: Size;
  grow?: number;
  /** Flex basis: `"auto"` starts from the content size (CSS `flex: 1 1 auto` with `grow`), a number is points, `"40%"` a fraction. With `grow` and no basis it is 0 (CSS `flex: 1`). */
  basis?: "auto" | number | `${number}%`;
  shrink?: boolean; aspect?: number;
  pad?: number; px?: number; py?: number; pt?: number; pr?: number; pb?: number; pl?: number;
  mt?: number; mb?: number; ml?: number; mr?: number; mx?: number; my?: number;
  gap?: number; rowGap?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  selfAlign?: "start" | "center" | "end" | "stretch" | "auto";
  center?: boolean; wrap?: boolean;
  /** CSS grid with `columns` equal tracks; children pick one with `column` (0-based). */
  columns?: number; column?: number;
  /** position:absolute against the parent's padding box. */
  absolute?: Insets; inset?: number;
  /** position:fixed: against the window, painted in its top layer (scrims, dialogs, toasts). */
  fixed?: boolean;
  /** Paint above later siblings (`true`), or an explicit paint order. */
  raise?: boolean | number;
  dir?: "ltr" | "rtl";
  // Paint
  fill?: Color; gradient?: Gradient; radial?: Radial;
  border?: Color; borderWidth?: number;
  /** Per-side widths in CSS order: top, right, bottom, left. */
  borderSides?: [number, number, number, number]; borderDash?: number;
  /** Per-corner radii in CSS order: top-left, top-right, bottom-right, bottom-left. */
  radius?: number; corners?: [number, number, number, number];
  /** Clip children to the rounded box (overflow:hidden). */
  clip?: number;
  /** Clips to the box with each side fading out over `[left, top, right, bottom]` points (smoothstep), as a CSS mask-image gradient to transparent. */
  clipFade?: [number, number, number, number];
  shadow?: [number, number, Color]; shadows?: Shadow[];
  opacity?: number; blur?: number; backdropBlur?: number;
  // States
  hover?: Color; press?: Color; hoverFill?: Color; pressFill?: Color; hoverBorder?: Color; pressBorder?: Color;
  /** This element's colour while its nearest hover group is hovered. */
  hoverColor?: Color; hoverOpacity?: [number, number]; hoverGroup?: boolean;
  pressScale?: number;
  focusRing?: { width?: number; offset?: number; color: Color; radius?: number };
  focusFill?: Color; focusBorder?: Color;
  disabled?: boolean;
  /** Laid out but not drawn, hit-tested or announced (visibility:hidden). */
  hidden?: boolean;
  // Transform and motion
  x?: number; y?: number; scale?: number; origin?: [number, number];
  /** Radians, clockwise; `Frame.rotate` too. */
  rotate?: number;
  /** The spring every prop change on this element moves on. */
  motion?: { dur?: number; bounce?: number };
  /** Animate layout changes on a spring of this duration (s). */
  layout?: number;
  enter?: Presence; exit?: Presence;
  loop?: Loop;
  /** Changes inside land at once (search results). */
  instant?: boolean;
  // Interaction
  cursor?: Cursor;
  /** pointer-events:none for the whole subtree. */
  inert?: boolean;
  focusable?: boolean; tabIndex?: number; autoFocus?: boolean;
  /** Arrow-key roving and type-select among focusable children (menus, lists, tabs). */
  focusGroup?: boolean;
  /** Chords this element takes while it (or a child) has focus; each fires `onKey`. Others stay native. */
  keys?: string[];
  windowDrag?: boolean; noWindowDrag?: boolean;
  windowResize?: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  /** Tooltip. */
  title?: string; titleSide?: Side;
  /** Dragging this element out drags files or text to other apps. */
  dragOut?: { paths?: string[]; text?: string };
  /** Restrict `onDropFiles` to these extensions. */
  dropExts?: string[];
  // Scroll
  scrollY?: boolean; scrollX?: boolean;
  /** Follow the end as content grows (chat). */
  stickBottom?: boolean;
  edgeFade?: number;
  /** Per-edge fades with the content hidden under them; `stops` are `[position, alpha]` pairs (CSS mask stops). */
  scrollFade?: { top?: FadeEdge; bottom?: FadeEdge };
  /** Opts a viewport, list or row out of scroll anchoring (CSS `overflow-anchor: none`). */
  noScrollAnchor?: boolean;
  /** Distance from the bottom past which `onFarFromBottom(true)` fires (default 180). */
  farFromBottom?: number;
  /** A list row whose content arrives complete (a sent message): its height glides on the growth spring alone. */
  arrivesWhole?: boolean;
  sticky?: "top" | "bottom"; stickyInset?: number;
  /** Selectable texts inside select as one (drag across paragraphs, Cmd+A). */
  selectionGroup?: boolean;
  // Accessibility
  role?: string; label?: string; checked?: boolean; expanded?: boolean; selected?: boolean;
  // Overlays
  anchor?: { to: string; side?: Side; align?: "start" | "center" | "end"; gap?: number; fit?: boolean };
  /** Escape and (optionally) an outside click call `onDismiss`; traps focus, makes the rest inert. */
  modal?: { clickOutside?: boolean; wheelOutside?: boolean };
  // Events
  onPress?: () => void;
  onDoublePress?: () => void;
  onContextMenu?: (at: { x: number; y: number }) => void;
  onHover?: (inside: boolean) => void;
  onFocus?: (focused: boolean, keyboard: boolean) => void;
  onFocusWithin?: (within: boolean) => void;
  onLayout?: (r: Layout) => void;
  onScroll?: (p: ScrollPos) => void;
  onAtBottom?: (atBottom: boolean) => void;
  onFarFromBottom?: (far: boolean) => void;
  onKey?: (e: KeyEvent) => void;
  onDismiss?: () => void;
  onDropFiles?: (paths: string[]) => void;
  onDropHover?: (over: boolean) => void;
  onDrag?: (d: Drag) => void;
  /** A ref gives the host instance (`HostElement`): `nodeId(ref)` is its engine node, and `ref.current.set({...})` changes props without a React render. */
  ref?: React.Ref<unknown>;
};

export type TextProps = BoxProps & {
  spans?: Run[]; size?: number; weight?: number; lineHeight?: number; tracking?: number; color?: Color;
  mono?: boolean;
  /** A registered or installed family ("Manrope", "IBM Plex Mono"), or "sans" / "mono" / "system-mono". */
  family?: string;
  /** CSS `font-feature-settings`, e.g. `"'ss01' 1, 'tnum' 1"`. */
  features?: string;
  /** Thin, grayscale-smoothed glyphs in a browser (`-webkit-font-smoothing: antialiased`), as the engine always draws them; browser text is otherwise smoothed normally. */
  antialias?: boolean;
  italic?: boolean; underline?: boolean; strike?: boolean;
  selectable?: boolean;
  selectionColor?: Color;
  maxLines?: number; truncate?: boolean | "end" | "middle" | "head" | "fade"; nowrap?: boolean;
  /** CSS `text-wrap: balance` (Chromium's): 2 to 6 wrapped lines break at the narrowest width that keeps their count; they still align in the element's width. */
  balance?: boolean;
  textAlign?: "start" | "center" | "end"; textCase?: "upper" | "lower";
  onLink?: (href: string) => void;
};

export type InputProps = Omit<TextProps, "onKey"> & {
  placeholder?: string; placeholderColor?: Color;
  /** Controlled value. Echoes of what the engine reported are recognised, so typing never races. */
  value?: string;
  multiline?: boolean; secure?: boolean; spellcheck?: boolean; readOnly?: boolean; selectOnFocus?: boolean;
  caretColor?: Color;
  onInput?: (value: string) => void;
  /** Enter (Shift+Enter types a newline in a multiline field). */
  onSubmit?: (value: string) => void;
  onSelection?: (sel: { start: number; end: number }) => void;
  /** Files or an image pasted, or text past `pasteAsEvent` (shorter text pastes natively). `image` is a PNG path. */
  onPaste?: (p: { files: string[]; image: string | null; text: string }) => void;
  onKey?: (e: InputKeyEvent) => void;
  /** Chords reported through `onKey` that still do what they do (Tab moves focus, arrows move the caret), as a DOM `onKeyDown` that doesn't `preventDefault`. */
  keysPass?: string[];
  /** Multiline: grow from `minLines` to `maxLines` (or `maxH`), then scroll inside with the caret kept in view. */
  minLines?: number;
  /** Highlights over UTF-16 ranges of the value (mentions, chips, matches). Paint only: no reshaping. */
  /** Highlights over UTF-16 ranges: `pad` widens each side, `vpad` reaches past the font's ascent and descent (both 0 for a CSS inline background). */
  marks?: { start: number; end: number; bg?: Color; color?: Color; radius?: number; pad?: number; vpad?: number }[];
  /** A text paste at or over either threshold isn't inserted; it fires `onPaste` with its text instead. */
  pasteAsEvent?: { minChars?: number; minLines?: number };
  /** The value's laid-out line count, whenever it changes. */
  onLines?: (e: { lines: number; height: number }) => void;
};

export type ImageProps = BoxProps & {
  /** A path, file:// URL, blob:<id>, data: URL or http(s) URL. SVG works too. */
  src: string;
  fit?: "cover" | "contain" | "stretch";
  tint?: Color;
};

/** One SVG path of a `<vector>`. Transforms and gradients aren't drawn: bake transforms into `d`. */
export type VectorPath = { d: string; fill?: string; stroke?: string; strokeWidth?: number; cap?: "round" | "butt"; opacity?: number; evenOdd?: boolean };

/** SVG paths drawn as shapes, for drawing that changes every frame (nothing is cached per body). */
export type VectorProps = BoxProps & {
  viewBox?: [number, number]; paths?: VectorPath[];
  /** A whole `<svg>` document (gradients, clipPath, transforms), rasterized at 2x into this element on each change, replaced in place. Takes precedence over `paths`. */
  svg?: string;
};

export type SurfacePointer = { kind: "move" | "down" | "up" | "leave"; x: number; y: number; button: "left" | "right" | "middle" | "back" | "forward" | "other" | null; buttons: number; clicks: number; mods: Mods };
export type SurfaceWheel = { x: number; y: number; dx: number; dy: number; mode: "pixel" | "line"; mods: Mods };
export type SurfaceKey = { type: "down" | "up"; key: string; text: string | null; mods: Mods };

/** Streamed frames (`src="blob:N"`, JPEG/PNG/WebP), decoded off the UI thread and swapped in place, with raw input in its own points. */
export type SurfaceProps = BoxProps & {
  src?: string; fit?: "stretch" | "contain";
  onPointer?: (e: SurfacePointer) => void;
  /** Wheels over the surface never scroll what's around it. */
  onWheel?: (e: SurfaceWheel) => void;
  /** Every key while focused (a press focuses it), except chords the `<window keys>` take. */
  onKeyRaw?: (e: SurfaceKey) => void;
};

export type IconProps = BoxProps & {
  /** SVG body (paths inside the root <svg>, `currentColor` tinted by `color`). */
  svg: string; name?: string; view?: number; size?: number; color?: Color;
  /** Spin period in seconds (loaders). */
  spin?: number;
};

export type TableAction = {
  action: string;
  index: number;
  rows: string[][];
  align: ("start" | "center" | "end")[];
  rect: { x: number; y: number; w: number; h: number } | null;
};

export type MarkdownProps = BoxProps & {
  src: string; streaming?: boolean; selectable?: boolean;
  /** MarkdownStyle builders by camelCase name, plus `codeFrame` and `tableFrame` (host/ELEMENTS.md). */
  mdStyle?: Record<string, unknown>;
  onLink?: (href: string) => void;
  /** A `mdStyle.codeFrame.actions` button was pressed on a code block. */
  onCodeAction?: (a: { action: string; index: number; language: string | null; source: string }) => void;
  /** A `mdStyle.tableFrame.actions` button was pressed on a table: its cells (header row first), column alignment, and the button's window rect (null from the keyboard). */
  onTableAction?: (a: TableAction) => void;
  /** Right-click (control-click) on a link, at window points. */
  onLinkContextMenu?: (e: { href: string; x: number; y: number }) => void;
  /** Looks for links whose href starts with `prefix`; the first match wins. */
  linkStyles?: LinkStyle[];
  /** Image sources as written → what to load (path, `file://`, `blob:N`). Sources not listed load as written. */
  images?: Record<string, string>;
  imageRadius?: number;
  /** A shown image was pressed. */
  onImage?: (e: { src: string; alt: string }) => void;
};

export type MediaProps = BoxProps & { src: string; fit?: "cover" | "contain"; autoplay?: boolean; muted?: boolean; loopMedia?: boolean };

export type LinkPaint = { color?: string; bg?: string; underline?: string; ring?: [string, number] };
export type LinkStyle = { prefix: string; color?: string; weight?: number; bg?: string; pad?: number; underline?: string; ring?: [string, number]; hover?: LinkPaint; help?: string };

export type FadeEdge = { size: number; stops?: [number, number][]; linear?: boolean; feather?: boolean; fullAt?: number };

export type ListProps = BoxProps & {
  /** Estimated row height; only rows near the viewport are built. Must sit inside a scrollY box. */
  estimate?: number; overscan?: [number, number];
  /** Rows ease their height changes (default on). `edge` is how a streaming row's bottom reveals. */
  growth?: boolean | { dur?: number; bounce?: number; edge?: "feather" | "fastFeather" | "none" | "wordFade"; clip?: boolean };
  /** Visible row indices (inclusive), on first layout and whenever they change. */
  onVisibleRows?: (r: { first: number; last: number; end: number }) => void;
};

export type WebviewMessage = { data: unknown; targetOrigin: string };
export type WebviewRequest = { rid: number; scheme: string; url: string; method: string; headers: Record<string, string>; body: string | null };

export type WebviewProps = BoxProps & {
  url?: string; html?: string; transparent?: boolean; devtools?: boolean; userAgent?: string;
  /** JS run before the page's own scripts. */
  preload?: string;
  /** Custom schemes answered by `onRequest` + `engine.webview.respond`. */
  protocols?: string[];
  /** The page may capture the microphone without a prompt (Stella's own pages only, as in Electron's app session). */
  microphone?: boolean;
  onMessage?: (m: WebviewMessage) => void;
  /** Navigations; `mainFrame` is false for a subframe's (macOS asks for those too). */
  onNavigate?: (e: { url: string; mainFrame?: boolean }) => void;
  onTitle?: (title: string) => void;
  /** `kept`: the element took over a live page on a remount, which reports its finished load again. */
  onLoad?: (e: { phase: "started" | "finished"; url: string; kept?: boolean }) => void;
  onRequest?: (r: WebviewRequest) => void;
  onReady?: () => void;
  onError?: (error: string) => void;
};

export type WindowProps = {
  /** Window id: the name for engine.window.* ops and window events. */
  id: string;
  children?: React.ReactNode;
  /** `background`: on screen for the system (a webview inside runs as a visible page, with media and timers) but shows nothing, takes no clicks or focus, and stays out of the Dock, task switchers and captures. 1×1 unless `w`/`h` say otherwise. */
  kind?: "main" | "panel" | "overlay" | "background";
  title?: string;
  w?: number; h?: number; minSize?: [number, number]; maxSize?: [number, number];
  position?: [number, number];
  resizable?: boolean; frameless?: boolean; transparent?: boolean; alwaysOnTop?: boolean; clickThrough?: boolean;
  visible?: boolean;
  /** Leaves the window out of screen captures and recordings (macOS sharingType none, Windows WDA_EXCLUDEFROMCAPTURE; Linux has none). */
  contentProtection?: boolean;
  /** Window background (also `fill`). */
  bg?: Color; fill?: Color; gradient?: Gradient;
  /** Custom titlebar height: the app draws it, the window keeps its controls over it. */
  titlebar?: number;
  trafficLights?: [number, number];
  /** Native chrome colour scheme; unset follows the system. */
  dark?: boolean;
  /** Page zoom, as Electron's `setZoomFactor`: the content lays out `1 / zoom` as wide and draws `zoom` times larger. */
  zoom?: number;
  dir?: "ltr" | "rtl";
  /** Window-level chords (fire `onKey` when nothing focused takes them). */
  keys?: string[];
  onKey?: (e: KeyEvent) => void;
};
