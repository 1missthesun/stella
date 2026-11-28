# Rune elements and engine protocol (v1)

What the TS host can render and call. Prop types are `host/rune-jsx/props.ts` (the source of
truth for names); the engine side is `engine/src/` (`props.rs` parses, `style.rs` / `text.rs` /
`input.rs` / `media.rs` / `markdown.rs` / `webview.rs` / `windows.rs` build).

## Processes and the bridge

`stella-engine` (Rust, Rune) starts first, opens the main window, then spawns the TS host
(`bun host/main.tsx`). One Bun process holds the whole app; the engine keeps a retained mirror of
the element tree and draws it.

| Direction | Unix | Windows | Format |
|---|---|---|---|
| host → engine | fd 4 (`STELLA_RUNE_BRIDGE_OUT_FD`) | stdout | binary frames: `u32 len` + ops |
| engine → host | fd 5 (`STELLA_RUNE_BRIDGE_IN_FD`) | stdin | JSON lines |

The host's own stdout goes to the engine's stderr, so `console.log` never corrupts the bridge.
Fd 3 is left for the launcher socket. The engine's own arguments after the binary are passed on
(`bun host/main.tsx <args…>`), so a launch's `stella://` link reaches the host. The host runs in
its own process group (Linux: it also dies with the engine); SIGTERM, SIGINT or SIGHUP to the
engine ends that whole group.

Host → engine ops: `1 create(id, kind)`, `2 props(id, json)`, `4 append`, `5 insert`, `6 remove`,
`9 commit(gen, ack, t0, kind)`, `10 cmd(json)`, `11 blob(id, bytes)`, `12 freeBlob(id)`.
The reconciler (`host/reconciler.ts`) emits these; app code never does.

Engine → host lines (`onEngineEvent(t, fn)` in `bridge.ts`):

- `ev` → routed to `on*` props: `{t:"ev", n, e, seq, at, input, ...payload}`
- `reply` → resolves `request()`
- `window` → `{id, kind}`, where kind is one of: close-requested, closed, focus, blur, resize (w, h),
  maximize, unmaximize, enter-full-screen, leave-full-screen
- `menu`, `tray`, `shortcut`, `notification`, `appearance` (`{dark, accentColor}`), `rec`
- `open-url` → `{url}`: a link the system opened with the app. On macOS this is the Apple Event.
  On Windows and Linux it is the launch's own links on the schemes in `STELLA_RUNE_URL_SCHEMES`
  (default `stella`). Later launches' links come through the host's single-instance lock.

Commands: `engine.*` in `bridge.ts` (typed). `request(cmd, args)` returns a Promise; window-bound
commands take `window` (a `<window id>`), or find the window from `target` (an element `id`).

## Windows

Root children are `<window id>` elements. The first `main` (or kind-less) window binds to the
native window the engine opened at launch; every other window opens when mounted and closes when
unmounted. Render windows from anywhere with `windowPortal(<window …/>, key)` (keeps context).

`<window>` props: `id`, `kind` (`main` | `panel` | `overlay` | `background`), `title`, `w`, `h`, `minSize`,
`maxSize`, `position`, `resizable`, `frameless`, `transparent`, `alwaysOnTop`, `clickThrough`,
`visible`, `contentProtection` (left out of screen captures; macOS and Windows), `isolated` (its keys are its own: a
command naming a key with no `window` never reaches inside it, so another window can hold the same keys), `bg`/`fill`/`gradient`, `titlebar` (height of an app-drawn titlebar; the window keeps
its controls over it), `trafficLights` (macOS inset), `dark` (native chrome scheme), `zoom` (page zoom
factor, as Electron's `setZoomFactor`), `dir`, `keys` +
`onKey` (window-level chords).

`kind="background"` holds a page that must run as if shown (a media `<webview>`: mic, WebAudio,
timers) with no Stella window on screen: a 1×1 (or `w`×`h`) transparent, borderless,
click-through window that never takes focus, is left out of captures and stays off the Dock,
task switchers and the accessibility tree. macOS: a non-activating NSPanel on every Space.
Windows: `WS_EX_NOACTIVATE` + tool window. Linux X11: override-redirect, so the window manager
never sees it (native Wayland has no such window).

`visible={false}` opens the native window hidden, as Electron's `show: false` does: its webviews
load and run at the window's size (Turnstile solves before the window ever shows), and its
first shown frame lays them out. Turning it false later hides (unmaps) the window and keeps its
state.

Close: the OS close button sends `window close-requested`; the window stays until TS unmounts it
or calls `engine.window.close(id)`. Inside, `windowDrag` / `noWindowDrag` mark drag regions and
`windowResize="se"` (etc.) makes an element a resize edge for frameless windows.

## Elements

| Element | What it is |
|---|---|
| `col` `row` `box` | flex containers; `box` is Rune's `el()`, a row (`center` centres both axes) |
| `text` | text; string children or `spans` (rich runs) |
| `input` | native text field (single or `multiline`) |
| `image` | path, `file://`, `blob:N`, `data:`, `http(s)` (fetched by the host), SVG |
| `icon` | SVG body tinted through `currentColor` |
| `vector` | SVG paths drawn as shapes, for drawing that changes every frame |
| `surface` | streamed frames (a page screencast) with raw pointer, wheel and key input |
| `markdown` | rune-kit Markdown: streaming, selection, syntax, tables, mermaid |
| `video` `audio` | native player |
| `list` | virtualized column (only rows near the viewport are built); inside a `scrollY` box |
| `webview` | lazy OS webview (wry) in this element's rect |

Containers also take GPU effects (`fx`, `light`, `lit`): see Effects below.

### Common props (every element)

A prop set to `false` is the same as leaving it out, except where `false` means something
different: `visible`, `resizable`, `spellcheck`, `dark`, `checked`, `expanded`, `selected` and
`growth`.

**Direct updates.** A ref gives the element's host instance. `ref.current.set({ svg })` changes
props without a React render, as code writing the DOM in `requestAnimationFrame` does. Every
`set` in one task goes to the engine as one frame, and a prop set this way stays over the one
React renders until it is set again. Use it for props that change every frame (a `vector`'s
`svg`, an animated `x`), so idle animation costs no commits.

**Identity.** `id` is the Rune key and the target for commands, anchors and the `control`
dumps. An element with an `id` is memoized: it rebuilds only when it or something under it changed.

**Layout.**
- Sizes: `w h minW maxW minH maxH`, each a number, `"full"`, `"fit"` or `"N%"`.
- Flex: `grow`, `basis`, `shrink`, `aspect`, `pad px py pt pr pb pl`, margins `mt mb ml mr mx my`, `gap`,
  `rowGap`, `align`, `justify` (incl. `between around evenly`), `selfAlign`, `center`, `wrap`.
  `grow={g}` is CSS `flex: g 1 0%`: it fills a bounded parent and sizes to its content in an
  unbounded one (an auto-height dialog, a `w="fit"` row). `basis` overrides that 0%: `"auto"`
  starts from the content size (`grow={1} basis="auto"` is CSS `flex: 1 1 auto`), a number is
  points, and `"40%"` is a fraction. `<text>` shrinks like a CSS text flex
  item, down to its longest word. A scroller's end padding counts in its scroll extent.
- Grid: `columns` on the container, `column` on the child.
- Position: `absolute={{left,top,right,bottom}}` or `inset`. `left` and `right` are physical, as in CSS: they stay put under `dir="rtl"`. `fixed` pins to the window and paints
  in its top layer, keeping React context (scrims, dialogs, toasts). `raise` paints above later
  siblings; a numeric `raise={n}` is CSS `z-index`. Top layers (`fixed`, and anchored elements
  with a numeric `raise`) stack by that number, then tree order, as CSS stacks positioned portals
  in the root stacking context: a menu (`raise={10000}`) covers a later dialog (`raise={51}`). `dir` (fixed and anchored layers take their tree ancestors' `dir`, as CSS direction reaches
  fixed descendants).

**Paint.** `fill`, `gradient {angle, stops}`, `radial`, `border`, `borderWidth`, `borderSides
[top, right, bottom, left]`, `borderDash`, `radius`, `corners [tl, tr, br, bl]` (both in CSS order), `clip` (overflow hidden, rounded),
`shadow [y, blur, color]` or `shadows [{x,y,blur,spread,color,inset}]` (CSS box-shadow order: the first paints on top), `opacity`, `blur`,
`backdropBlur`.

**States.**
- Pointer: `hover`, `press` (fills), `hoverFill`, `pressFill`, `hoverBorder`, `pressBorder`,
  `pressScale`.
- Hover groups: `hoverGroup` on the parent; on children, `hoverColor` and `hoverOpacity
  [rest, hovered]`.
- Focus: `focusRing {width, offset, color, radius}`, `focusFill`, `focusBorder`.
- `disabled`. `hidden` keeps the element's space but doesn't draw it, hit-test it or announce it.

**Motion.**
- Transforms: `x y scale rotate origin`. `rotate` (here and in `loop` frames) is in radians.
- `motion {dur, bounce}` is the spring every prop change rides. `layout` (s) animates layout
  changes. `instant` makes changes land without motion. Without `motion` or `layout` on the
  element or an ancestor, a change lands at once, as in CSS.
- `enter` / `exit`: a preset (`fade rise drop blur scale pop slide`) or `{opacity, scale, x, y,
  blur, dur, bounce}`.
- `matched: "id"` (SwiftUI `matchedGeometryEffect`): an element that mounts in the same commit
  another with that id leaves starts where the old one was drawn, with its velocity, radius, fill
  and opacity, and springs on its `motion` to its own place; neither plays `enter`/`exit`.
  `matchedInPlace` keeps it in its destination's paint order and clips while it moves, so a
  selection pill rendered only inside the selected tab slides under the labels to the next one,
  across a scrolling strip too. Reduce Motion lands it at once.
- `loop`: `opacity`, `rotation`, `slide`, or `sequence {period, delay, ease, frames:[{at, x, y, scale,
  opacity, rotate}]}`. `at` ≤ 1 is a fraction of the period. `scaleX` / `scaleY` are averaged,
  since Rune scales uniformly. `ease` (`linear ease easeIn easeOut easeInOut`, default `easeInOut`)
  times each segment like CSS `animation-timing-function`; frames sampled from a curve want `linear`.
  A `sequence` repeats unless `times` is 1: then it plays once from when the loop first appears on
  the element (already drawn or not) and holds its last frame, so it can play an entrance late.

**Interaction.**
- Pointer and focus: `cursor` (CSS names, also `crosshair`, `cell`, `copy`, `alias`, `zoomIn`/`zoomOut`,
  `help`, `progress`/`wait`, `none`, one-way `n|e|s|w-resize`), `inert` (pointer-events none for the subtree), `focusable`,
  `tabIndex`, `autoFocus`, `focusGroup` (arrow-key roving and type-select).
- `keys: ["mod+k", "Escape", "shift+Enter"]`: chords this element takes while focus is inside;
  each fires `onKey`. `mod` is ⌘ on macOS and Ctrl elsewhere; names are DOM key names.
- `title` + `titleSide`: a tooltip.
- Drag and drop: `dragOut {paths | text}` drags files or text out to other apps. `onDropFiles` and
  `onDropHover` take drops; `dropExts` filters them.

**Scroll.**
- `scrollY`, `scrollX`.
- `stickBottom`: follows the end as content grows (chat).
- `edgeFade`.
- `scrollFade={{top?, bottom?}}`: per-edge fades. Each edge is `{size, stops?, linear?, feather?, fullAt?}`.
  `stops` is up to three `[position, alpha]` pairs (CSS mask stops), and every fade in a window
  shares one stop curve. An edge you leave out doesn't fade.
- `noScrollAnchor`: opts a viewport, list or row out of scroll anchoring. `scrollY` boxes anchor
  by default, like CSS `overflow-anchor: auto`.
- `farFromBottom` (default 180) with `onFarFromBottom(far)`: fires when the viewport crosses that
  distance from its end.
- `sticky` (`"top"` | `"bottom"`) with `stickyInset`.
- `selectionGroup`: one selection across the texts inside. Read it with `engine.selection.get()`.

**Accessibility (AccessKit).** `role`, `label`, `checked`, `expanded`, `selected`. A `text` is
its own label.

**Overlays.**
- `anchor {to: "<id>", side, align, gap, fit}` places the element against another element, in
  the window's top layer (popovers, menus).
- `modal {clickOutside, wheelOutside, returnFocus}` traps focus and makes the rest of the window inert; `returnFocus: false` leaves nothing focused as it closes instead of returning focus to what had it.
  Escape, or a press outside when `clickOutside` is set, fires `onDismiss`.

**Events.** Every `on*` function prop is wired only when present.

| Prop | Payload |
|---|---|
| `onPress()`, `onDoublePress()` | none |
| `onContextMenu({x,y})` | point |
| `onHover(inside)` | boolean |
| `onFocus(focused, keyboard)` | booleans |
| `onFocusWithin(within)` | boolean |
| `onLayout({x,y,w,h})` | window rect |
| `onScroll({x,y,maxX,maxY,viewport})` | scroll position |
| `onAtBottom(atBottom)` | boolean |
| `onKey({key, chord, mods})` | key |
| `onDismiss()` | none |
| `onDropFiles(paths)`, `onDropHover(over)` | paths, boolean |
| `onDrag({phase, dx, dy, x, y})` | drag |

### Effects: fx, light, lit

GPU effects from rune-fx and rune-light, as props on a `col`, `row` or `box`. The engine reads
them from the tree every frame, so a hot swap or a `ref.current.set({ fx })` changes them with
no engine rebuild. A window draws exactly as before until one of its elements sets one of
these props. Types are in `host/rune-jsx/props.ts` (`FxLayer`, `Glass`, `Lighting`, `Lit`);
`demo/gallery/Fx.tsx` shows each one (`STELLA_RUNE_APP=demo/gallery/Fx.tsx`).

**`fx`**: one layer or an array of them, painted in the element's shape (`radius`/`corners`).

- Liquid Glass: `{ glass: true }` or `{ glass: { … } }` refracts and lenses whatever is painted
  behind the element (images, text, content scrolling under it), with a bevelled rim catching the
  light and a contact shadow. Keys: `bevel` (14), `depth` (16), `dispersion` (0.14),
  `magnification` (1.04), `presence` (1), `frost` 0..1 and `frostSigma` (18), `shadow` (0.35),
  `rim` (1.6), `lightAngle` (radians, -2.09), `saturation` (1: of what shows through, before the
  tint; Apple's regular glass is about 1.6), `perceptual` (false: true mixes `saturation` and
  `veil` in sRGB, as UIKit does, so tints measured from iOS carry over), `tint` + `tintAmount`, `veil` (0..1: mixes the
  body toward `tint` so labels stay legible), `merge: {x,y,w,h,radius}` + `unionK` (22) + `morph`
  (a second shape it flows into, in the element's points).
- Glass groups: glass elements with the same `group` (a string) in a window draw as one surface,
  like Apple's `GlassEffectContainer`. Shapes closer than `spacing` points (`unionK`, 22) bridge
  into each other and pinch apart as they move away, so two capsules sliding together (`x` +
  `motion`) merge and separate with no per-frame commits. The first member in tree order supplies
  the glass settings for the whole group; up to 8 others join it.
- Morphing: `morphFrom: "id"` (or `true`: the element's `anchor.to`) grows the glass out of that
  element's shape when it mounts, lensing the whole way, and shrinks it back into it when it's
  removed: the engine keeps the element on screen, inert, until the glass is home (at most 3 s).
  The source stays as it is the whole time: the morphing glass fades in over it as it leaves the
  source's shape and out as it gets back, so the morph starts and ends as the source itself, its
  icon and label included. The element's children are there to press from the first frame and
  fade and scale in as the glass starts to grow; its border and shadows come in as the glass
  nears its size. On removal the children fade out at once (the element keeps its size
  meanwhile), so give the element itself no `enter`/`exit`. Opening it again while it goes back
  carries on from where the glass is. The glass is clipped as the element's children are, so a
  menu that scrolls puts `scrollY` on an inner `col` rather than on the morphing element.
  `morphMotion: { dur, bounce }` is the opening spring (0.18 s, 0.06; it goes back on 0.7× that,
  critically damped); Reduce Motion skips
  it. A menu anchored to its button:
  `<col anchor={{ to: "plus", side: "top" }} fx={{ glass: { …recipe, morphFrom: true } }}>`.
  `demo/gallery/GlassMorph.tsx` shows a menu, a group and a sliding tab pill
  (`MORPH_AUTO=1` loops them).
- Adaptive dimming: `adapt` (0..1, default 0, off) measures what is behind the glass on every
  frame that draws it and scales `veil` and `shadow` from it, after Apple's regular glass: a
  denser veil and shadow over busy content (text, images) or content far from `tint`, a lighter
  veil over a plain backdrop, and a softer shadow over a plain light one.
- `onBackdrop={(b) => …}` on a glass element reports what it sees behind it, `{ lum, contrast }`:
  mean perceptual (sRGB) luminance and its standard deviation, 0..1 (`contrast` is near 0 over a
  plain fill, 0.15 and up over text or images). It fires once when the element first draws, then
  only when either value moves by 0.04, at most every 120 ms (a held reading follows once the gap
  has passed), so scrolling content under it sends a handful of events and a window at rest sends
  none. Use it to flip glyphs and tint between light and dark, with some hysteresis:

```tsx
const [light, setLight] = useState(false);
<row radius={20} fx={{ glass: { adapt: 1, veil: 0.5, tint: light ? "#f5f5f7" : "#1c1c1e" } }}
  onBackdrop={(b) => setLight((was) => (was ? b.lum > 0.45 : b.lum > 0.6))}>
  <text color={light ? "#1d1d1f" : "#f5f5f7"}>Share</text>
</row>
```
- Fills: `{ fill: "<id>", preset?, …params }`. `liquidMetal` (presets `chrome` `gold` `rose`
  `gunmetal`; `tint light flow scale speed bevel dome angle iridescence contrast`, `anchor:
  "world" | "element"`), `flutedGlass` (presets `reeded` `fine` `frosted` `wide`; `rib angle
  refraction frost dispersion highlight tint tintAmount`; refracts the backdrop), `metaballs`
  (presets `lava` `mint`; `colors base count size speed gloss`), and `meshGradient` `dither`
  `grainGradient` `swirl` `voronoi` `waves` `halftone` `plastic` with their own params by name.
  Every fill takes `border` (paint only a band this wide inside the edge) and `intensity`. Ids
  and param names are camelCase or snake_case. An unknown id, preset or param logs
  `stella-engine: fx: …` and drops that layer.
- Every layer: `place` (`"under"`, the default: after the element's own fill and before its
  children, so labels stay on top; `"over"`: over the children), `inset`, `opacity`, `seed`,
  `blend` (`normal` `multiply` `screen` `overlay` `softLight`).
- Animated fills (liquid metal, metaballs, …) keep the window drawing at the display's refresh
  while on screen and hold still under the system's reduced motion. Glass and other static
  layers draw only when something under or around them changes.

```tsx
<row h={48} radius={24} px={18} align="center" fx={{ glass: { veil: 0.2, tint: c.bg } }}>
  <text weight={600}>New chat</text>
</row>
<box w={220} h={64} radius={32} fx={{ fill: "liquidMetal", preset: "chrome" }} />
<col w={222} h={332} fx={{ fill: "flutedGlass", preset: "reeded" }} />
```

**`light`**: lights the element's contents with rune-light: soft shadows from `lit` children,
bevel highlights and glow. `{ lights: [{ x, y, z?, color?, intensity?, radius?, range?, bulb?,
specular?, softness?, shafts?, spot?: { axis: [x,y,z], angle } }], ambient?, exposure?,
contactAo?, rim?, backgroundGloss?, backgroundRoughness?, albedoFloor?, shaftsOver? }`. Light
positions are in the element's points; `z` is the height above the UI (80) and `ambient` 1
shows the UI as designed (0.55). Move a light with `ref.current.set({ light })` each frame.
Text inside is lit with the surface it sits on.

**`lit`**: how an element stands under its enclosing `light`: `raised` (height, points),
`floating: [base, top]`, `bevel: [width, height]`, `gloss: [gloss, roughness]`, `emissive`
(a colour it glows with), `unlit` (ignores the light).

```tsx
<col ref={lamp} fill="#26262b" light={{ ambient: 0.35, lights: [{ x: 180, y: 120, color: "#ffe2bd", intensity: 2 }] }}>
  <col w={140} h={110} radius={16} fill="#3a3a40" lit={{ raised: 10, bevel: [8, 3] }} />
</col>
```

### text

- Content: `spans: [{t, w, c, m, bg, i, u, s, st, href}]`. The run fields are: text, weight,
  colour, mono, background, italic, underline colour, size, strike, and a link (`onLink(href)`).
- Style: `size weight lineHeight tracking color mono family` (a registered font family, `sans`,
  `mono` or `system-mono`), `italic underline strike`. `antialias` only reaches the web build,
  where browser text is otherwise smoothed normally; the engine always draws it so.
- Selection: `selectable`, `selectionColor`. Selectable text without a `selectionColor` selects in Chromium's default colours (active and inactive).
- Wrapping: `maxLines`, `truncate` (`true` | `end` | `middle` | `head` | `fade`), `nowrap`,
  `balance` (CSS `text-wrap: balance`: 2 to 6 lines break at the narrowest width that keeps their
  count, still aligned in the element's width), `textAlign`, `textCase`.

### input

- Value: `value` is controlled. The engine recognises echoes of values it reported, so typing
  never races a re-render. `placeholder`, `placeholderColor`.
- Options: `multiline secure spellcheck readOnly selectOnFocus caretColor`, plus every text style
  prop. IME, undo, selection and spellcheck are native.
- Events:
  - `onInput(value)`
  - `onSubmit(value)`: Enter; Shift+Enter is a newline when `multiline`
  - `onSelection({start,end})`: UTF-16 offsets
  - `onPaste({files, image, text})`: fires for file and image pastes; `image` is a temp PNG path.
    With `pasteAsEvent: {minChars?, minLines?}`, a text paste at or over either threshold fires
    it too, and that text is not inserted.
  - `onKey({key, chord, mods, value, start, end, length})`: for `keys` chords, and for `keysPass`
    chords, which still do what they do (Tab moves focus, arrows move the caret)
  - `onLines({lines, height})`: the laid-out line count, whenever it changes
- Growth (`multiline`): `minLines`, `maxLines` and/or `maxH` grow the field with its text, then
  scroll inside it with the caret kept in view. The box props (size, padding, paint) wrap that
  viewport.
- `marks: [{start, end, bg?, color?, radius?, pad?}]`: paint-only highlights over UTF-16 ranges
  (mentions, matches). They never reshape the text.
- Commands: `engine.input.get / set / select`, `engine.focus(id)`, `engine.blur()`.

### image, icon, video

- `image`: `src`, `fit` (`cover` | `contain` | `stretch`), `tint`, and any box paint (border,
  radius, shadows). Without `w` and `h` it takes the image's natural size (1 image px = 1 pt; an
  SVG's own size) once it has decoded, like `<img>`. It shrinks with the ratio kept to fit the
  room its parent gives it and its own `maxW`/`maxH`, never grows past that size, and isn't
  stretched across a row. With one side set, the other follows the image's ratio. Markdown
  images also lay out again once they decode.
- `icon`: `svg` (the inner body of an `<svg>`, `currentColor` allowed), `view` (viewBox size,
  default 24), `size`, `color`, `spin` (period in seconds). Each distinct body is cached for the
  life of the process, so use `vector` for anything that changes per frame.
- `vector`: `viewBox` (`[w, h]`, stretched to the element's size) and `paths`, each
  `{d, fill?, stroke?, strokeWidth?, cap?, opacity?, evenOdd?}`. Paths are rebuilt on each change
  and nothing is cached. Gradients and `transform` aren't drawn here: bake transforms into `d`.
  Or pass `svg`, a whole `<svg>` document with gradients, `clipPath` and transforms. It is
  rasterized at 2x into the element's own pixels on each change and replaced in place. A
  72 pt rig at 60 Hz costs about 2 ms of frame CPU at p95.
- `video` / `audio`: `src`, `fit`, `autoplay`, `muted`, `loopMedia`. Commands:
  `engine.media.play / pause / seek / state`.

### surface

For a page screencast or any frames produced elsewhere (an in-app browser tab streamed over CDP).

- `src="blob:N"` takes a JPEG, PNG or WebP. Each new blob decodes on the engine's decode thread
  into the node's own pixels and swaps in place, with no layout or fade. A frame superseded
  before its turn is skipped. Free the previous blob as soon as you send the next.
- `fit`: `stretch` (default) or `contain`.
- Pointer: `onPointer({kind, x, y, button, buttons, clicks, mods})` in the element's own points.
  `kind` is `move`, `down`, `up` or `leave`; `button` is `left`, `right`, `middle`, `back`,
  `forward` or `other`. All buttons reach it, and no press semantics are applied.
- `onWheel({x, y, dx, dy, mode, mods})`: wheels over a surface never scroll what's around it. `mode: "line"` is a mouse wheel: `dx`/`dy` are its steps, ±1 per notch (fractions for a free-spinning wheel, more with macOS acceleration). `mode: "pixel"` is a trackpad, in points. Positive moves content right/down (the wheel turned up), the opposite sign of DOM `deltaY`.
- Keyboard: `onKeyRaw({type: "down" | "up", key, text, mods})` fires for every key while it's
  focused (a press focuses it). Chords the `<window keys>` take pass to the window.
- `cursor` sets the pointer shape.
- Not yet: IME composition and physical key codes.
- Cost on a 240 Hz display: 30 fps of 640×360 JPEG frames costs p95 1.4 ms of frame CPU, with
  memory flat.

### markdown

`src`, `streaming`, `selectable`, `onLink(href)`, `onCodeAction(...)`, and `mdStyle`, an object
whose keys are rune-kit `MarkdownStyle` builders in camelCase.

**Colours.** `text muted link linkUnderline linkHover inlineCodeBg inlineCodeText codeBlockText
quoteRule rule selection tableRules tableHeaderRule tableHeaderText`, `tableOutline` (a colour or
null).

**`[a, b]` pairs.** `codeBlockPadding`, `list [indent, gap]`, `listNestedIndent`,
`inlineCodeFont [scale, weight]`, and the `[top, bottom]` margins: `paragraphMargin codeMargin
imageMargin listMargin quoteMargin ruleMargin tableMargin`. Also `tableCellPadding` and
`tableHeaderPad` as `[x, y]`: `x` on each side of a cell, `y` above and below. `tableFlushLeft`
drops the first column's left padding; on the web it pads every cell on its right only (`2x`,
none after the last column), as desktop-ui's table.

**Numbers and switches.** `codeBlockRadius inlineCodePad inlineCodePadY strongWeight textWidth
tableHeaderWeight`, `inlineCodeSize` (inline code at this size in headings too, in place of
`inlineCodeFont`'s scale), `taskAfterMarker` (task items keep their list marker and put the
checkbox this many px before the text), and the table's line widths `tableHeaderRuleWidth tableRuleWidth
tableOutlineWidth` (0.5 by default); booleans `listMarkersOutside tableFlushLeft tableFullWidth`, and `tableTabular` (tabular figures
in cells, on by default).

**Task checkbox.** `taskCheckbox { size radius left top fillOn mark markSize fillOff borderOff }`;
`top` is from the item's first line top (centred when absent), `left` is unused with
`taskAfterMarker`.

**Selection.** `selectionStyle: "chromium"` paints a selection as Chromium's default
`::selection` (active and inactive) in place of `selection`. `pageCopy: [code, table]` copies a
selection as Chromium copies Streamdown's page instead of as Markdown: no list markers, one
newline after a block (two after a paragraph or heading whose bottom margin is at least half
its size), the code label on its own line, and `code`/`table` more newlines before a code
block's and a table's text. `joinSelection: true` puts a selectable Markdown's texts in the
`selectionGroup` around it instead of a group of its own, so a selection runs across messages.

**Compound values.**
- `codeBlock [fill, border]` (or `codeBlockFill` + `codeBlockBorder`)
- `quote [rule, width, pad, textColor]`
- `table [border, headerFill]`

**Fonts.** Each takes `{size, weight, lineHeight, tracking, family}`: `body` (alias `bodyFont`),
`codeBlockFont`, `tableFont`, and headings via `headings` (array, level 1 first) or `headingFont`
(`{"1": …}`). Heading margins use `headingMargins` / `headingMargin` in the same two shapes.

**`syntaxHighlight`** (boolean) turns colouring off. **`syntax`.** `{keyword, string, number, comment, type, function, property, punctuation,
operator, inserted, deleted}` colours. `dark` picks the neutral base.

**`codeFrame`.** `{label, labelSize, labelGap, actions: [{id, label?, svg?, view?, size?}], actionColor,
actionHover, actionsOnHover}` adds a language row above each code block, with actions at its top
right. Pressing an action fires `onCodeAction({action, index, language, source})`; TS does the
copy or download. `inside: {fill, border, radius, pad: [x, top, bottom]}` draws the block's frame itself with
the label row inside it (streamdown's layout): pair it with `codeBlock: ["transparent", "transparent"]`
and `codeBlockPadding: [0, y]`. `actionsAt: [top, right]` floats the actions at that inset from
the frame's top right corner instead of placing them in the label row. `actionsFill` paints a pill
behind them (`actionsPad: [x, y]`, `actionsRadius`), `gap` spaces them, and `buttonPad` makes each
button `size + 2 × buttonPad` square with `actionHover` as the icon's hover colour (without it,
buttons are 22 high and `actionHover` is a hover fill). `swap: {index, id, svg, view?}` draws block
`index`'s action `id` with another icon, such as Streamdown's check after a copy.

**`tableFrame`.** `{actions: [{id, label?, svg?, view?, size?}], actionColor, actionHover,
actionsOnHover, actionsAt: [top, right], actionsFill, gap, buttonPad}` floats a row of actions at
each table's top right (default inset `[6, 0]`), on `actionsFill` so it covers the header text
beneath it, shown on hover unless `actionsOnHover: false`. Each button is `size + 2 × buttonPad`
square. Pressing one fires `onTableAction({action, index, rows, align, rect})`: `rows` are the
cells' plain text, header first; `align` is `start`/`center`/`end` per column; `rect` is the
button in window points, `null` when pressed from the keyboard. TS does the copy, download and
full-screen view.

**Links and images.**
- `linkStyles: [{prefix, color?, weight?, bg?, pad?, underline?, ring?: [color, width],
  hover?: {color?, bg?, underline?, ring?}, help?}]`: a look for links by href prefix (the first
  match wins). `help` is the link's tooltip. Use it for connector chips and file links.
- `onLinkContextMenu({href, x, y})`: right-click on a link, at window points.
- `images: {[srcAsWritten]: pathOrBlob}` resolves `![alt](src)` sources (a path, `file://` or
  `blob:N`); unlisted sources load as written. Images draw at their own size up to the text's
  width. `imageRadius` rounds them, and `onImage({src, alt})` makes them pressable.
- `w="fit"` hugs the text (with `maxW` for chat bubbles).

### list

Children are rows. `estimate` is the row height guess and `overscan` is `[before, after]` in rows.
Only rows near the viewport are built. The list must sit inside a `scrollY` box.

- `growth`: rows ease their height changes, on by default. `false` turns it off. Or pass
  `{dur, bounce, edge, clip}`, where `edge` is how a streaming row's bottom reveals: `feather`,
  `fastFeather`, `none` or `wordFade`.
- `arrivesWhole` on a row (a sent message): its height glides on the growth spring alone,
  without the streaming speed limits.
- `onVisibleRows({first, last, end})`: the visible indices (`last` is inclusive), on first layout
  and on every change.
- `engine.scroll.toKey(viewport, rowId, at)` lands a row `at` points below the viewport's top,
  whether or not it is mounted. `"row/mark"` lands a mark inside a row.

### webview

**Props.**
- `url` or `html`
- `transparent`, `devtools`, `userAgent`
- `preload`: JS run before the page's own scripts
- `protocols`: custom schemes

**Events.**
- `onMessage({data, targetOrigin})`: the page calls `window.ipc.postMessage(json)`, or
  `window.parent.postMessage(data, origin)` / `window.top.postMessage(…)`. Iframe-style
  deliverables and Cloud Apps keep working unchanged.
- `onRequest({rid, scheme, url, method, headers, body})`: answer with
  `engine.webview.respond(rid, {status, headers, body})`, where `body` is a string or bytes.
- `onNavigate({url, mainFrame})`: main-frame navigations only on Linux (from the document
  response) and Windows (NavigationStarting). On macOS `mainFrame` is absent and frame
  navigations can arrive too.
- `onTitle(title)`, `onLoad({phase, url})`, `onReady()`, `onError(error)`.

**Commands.** `engine.webview.post(id, data)` delivers a `MessageEvent` to the page (as
`window.postMessage` would). The rest: `eval load loadHtml reload back forward focus blur zoom
url`.

The view is created on first layout, follows the element's rect and visibility, and is destroyed
on unmount. A `<window>` remounted in the same batch (a hot swap) keeps its webviews: each moves to
the remounted `<webview>` with the same `id` (without an `id`, the same `url`/`html`) and the same
creation-time props (`protocols`, `preload`, `userAgent`, `microphone`, `transparent`,
`devtools`); the page keeps running and the new element gets `onReady`, the page's title and,
when it had finished loading, `onLoad({phase: "finished", url, kept: true})`. A view under a `hidden` or `opacity={0}` ancestor (a retained tab in the background) is hidden. It is clipped like any child: to its scroll viewports and `clip` ancestors (rounded by
a rounded clip's corners where they reach it), and rounded by its own `radius` / `corners`. Elements
CSS would paint over it (positioned later siblings of it or of an ancestor, a higher `raise`, fixed
layers) cut their drawn shape out of the native view, which then neither shows nor takes the pointer
there, so a pill over a canvas draws and clicks while the page beside it stays live. A cut shows
the engine's drawing, not the page: a translucent element over a webview shows what the engine
draws under the view rather than the page through it. Such elements that draw nothing (a row
holding two pills, a resize edge) take the pointer from the page across their box, as CSS boxes
do, while the page still shows through. macOS masks the WKWebView's layer and passes hits there to
the engine; Linux sets the X11 container's bounding and input shapes; Windows sets the WebView2
container's window region, which can't take the pointer without hiding the page, so on Windows the
page keeps the pointer under elements that draw nothing. While an overlay (an anchored popover or menu, or a lifted layer holding a `modal`)
overlaps a view, the view steps aside and its slot shows the page's last snapshot under the
overlay, until the overlay goes (Windows: the slot is empty). `control.screenshot` and
`control.record` draw each view's snapshot with the same clip and cuts.
On Linux a `transparent` view's page background is the colour the engine draws under it (its own
and its ancestors' fills down to the first opaque one): wry's X11 container is an opaque child
window, so a page with no background of its own shows what it would in Electron.
On Linux WebKitGTK lays pages out at GTK's integer scale; the engine zooms each view so a CSS
pixel is one point at the window's scale, as in Electron (`webview.zoom` multiplies that). A
window's `zoom` zooms its views too, as Electron's page zoom does its iframes: the view keeps
its box in the zoomed layout, and its page lays out in the same CSS pixels at `zoom` times the
size.
WebKitGTK keeps one handler per scheme for the whole process; the engine routes each request to
the view that asked, so any number of views can share a scheme.

**Platform.** On Linux the engine runs on X11 (XWayland under Wayland) while the webview feature
is built in, because WebKitGTK children need an X11 parent. Electron Stella runs the same way
(Hyprland lists it as an XWayland client). `STELLA_RUNE_BACKEND=wayland` opts out, and then a
`<webview>` fires `error` ("webviews need the X11 backend") and its rect stays empty; no window
maps. A child is impossible there: a `wl_subsurface` must belong to the parent's own client, and
WebKitGTK draws through GTK's own `wl_display` connection, so the only Wayland link between two
clients' surfaces is xdg-foreign, which parents toplevels, not children. Electron's iframes have
no such problem because Chromium composites them into its own surface. Native Wayland webviews
would need WebKit drawn offscreen (WPE or a GTK offscreen window) into a Rune image, with input
synthesized the way `/control/input` already synthesizes GDK events. macOS uses WKWebView and
Windows uses WebView2 as child views. WebView2's environment starts asynchronously on the first
view, with wry's options, and is warmed by a hidden controller in that view's window (the cold
browser and renderer start); views wait for it rather than blocking the UI thread for the seconds
that takes, and share it.

## Engine API (`engine` in `host/bridge.ts`)

- `window.*`: focus, show, hide, close, minimize, restore, maximize, unmaximize, toggleMaximize,
  setFullScreen, center, setTitle, setAlwaysOnTop, setBounds, getBounds, isMaximized
- `webview.state(target)`: why a native view shows or hides (rect, fits its scroll viewport, the
  overlays covering it)
- `clipboard.*`: read, readText, readHTML, readFiles, readImage (PNG bytes), writeText,
  writeHTML, writeImage
- `dialog.*`: openFile (`multi`), openFolder, saveFile, all with filters and defaultPath.
  Message boxes are drawn by the UI.
- `notify({id, title, body, actions})`; clicks come back as `notification` events
- `menu.popup(items, {window, x, y, anchor})` resolves with the picked id
- `tray.*`: create, setMenu, setTooltip, setIcon, destroy
- `app.setBadge(label, count?)`: the Dock badge as given on macOS ("3", "99+", null clears);
  the count over the main window's taskbar button on Windows; nothing yet on Linux (resolves false)
- `shortcut.*`: register, unregister, unregisterAll. These are global and take Electron
  accelerators.
- `screen.displays()`, `screen.primary()`
- `appearance.get()`
- `shell.*`: openExternal, openPath, showItemInFolder
- `fonts({files, sans, mono})`, `background(color, window?)`, `colorMotion(dur)`
- `scroll.*`: to (`"end"` or y), intoView, page, stop, toKey (`viewport, key, at`),
  keepOnScreen (`key`, across the next commit)
- `focus(id)`, `blur()`
- `selection.*`:
  - `get(window?)` → `{text, rect?}` or null: the window's selected text, as copying takes it, from a
    `selectionGroup` or selectable `text`/`markdown`. `rect` `{x,y,w,h}` is the union of the
    settled selection's line boxes in window points as scrolled; absent while a press is still
    making it.
  - Event `selection` (`onEngineEvent("selection", …)`): `{window, n, text, rect}` once a
    selection settles (release of a drag, double/triple-click, shift-extend, select-all), and
    `{window, n, cleared: true}` when the window's selection clears.
  - `copy(window?)`.
  - `lookUp(window?)`: macOS dictionary popover for the window's selection, drawn at its first glyph in that text's font, as Chromium's `showDefinitionForSelection` does; true when shown. ⌃⌘D and a force click or three-finger tap on the selection show it too. False with no selection, and off macOS.
- `input.*`, `media.*`, `webview.*`
- `control.*`, `quit()`

## Verification hooks

- `engine.control.input(events, window?)` replays real input through Rune's own input paths
  (`WindowHandle::inject_script`). The events use the Rune `--script` format:
  - `{type:"tap", key:"send"}`, `{type:"tap", x, y}`
  - `{type:"type", text}`, `{type:"key", name:"k", cmd:true}` (flags `shift ctrl alt logo cmd`; `cmd` is the primary modifier, Ctrl off macOS, and matches `mod+…` chords)
  - `{type:"drag", key, dx, dy}`, `{type:"wheel", …}`, `{paste:"text"}`, `{focus:true}`
  - `t` is seconds from now
  - Linux: pointer events on what shows of a native webview, and keys while the last injected
    press landed in one, go to that view as X events would (trusted, with click counts and
    focus), without moving the real pointer or the system's focus; the rest go to Rune. Windows
    and macOS still send everything to Rune, so a script can't drive a page there.
- `engine.control.elements(window?, key?)` lists every drawn element: key, path, role, label,
  text, rect, opacity, focused, focusable, inert, fill, textColor.
- With `STELLA_RUNE_CTL_PORT=<port>`, the host serves the same over loopback HTTP:
  - `POST /control/input {events, window}`
  - `GET /control/elements?window=&key=`
  - `POST /control/request {cmd, ...args}`, for any engine command
  - `GET /control/screenshot?path=&window=` and `GET /control/record?dir=&fps=&seconds=&window=`
- `engine.control.screenshot(path, window?)` draws a frame and writes what the window presents
  to `path` as a PNG, in physical pixels (`{path, width, height, scale}`). It reads the GPU's
  drawable, so native WebViews (drawn by the OS over the window) are not in it.
- `RUNE_UNSEEN=1` in the engine's environment (macOS) keeps every window open and presenting on
  the display's clock but invisible: alpha 0, click-through, no Dock or app-switcher entry, never
  activated. Screenshots, recordings, input and frame metrics work as on a visible window.
  `RUNE_OPEN_INACTIVE=1` alone shows the windows but never takes focus.
- `engine.control.record(dir, {fps, seconds, window})` writes the presented frames to
  `dir/frame-NNNNN.png` and replies `{frames, asked, errors}` once all are written.
- `POST /control/request {cmd:"control.liveResize", dx, ms, window}` (macOS) drags the window's
  right edge out by `dx` points and back over `ms` as a person would: AppKit's own live resize,
  from mouse events posted to the app, so the real pointer never moves. It replies `{steps}` when
  the drag is over. Record the screen around it to check that layout follows the edge frame by
  frame. During a resize and `windows::RESIZE_ECHO` after, the host's commits land with
  `Tx::follows_resize`: what answers the new size (measured layout, `window.innerWidth`
  breakpoints) lays out at once rather than springing behind the edge.
- `STELLA_RUNE_APP=<path.tsx>` swaps the app entry (`demo/gallery/App.tsx` exercises everything
  here). An entry that exports `Root` renders its own `<window>`s; one that exports `App` is
  wrapped in `<window id="main">`.
