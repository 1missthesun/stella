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
`visible`, `contentProtection` (left out of screen captures; macOS and Windows), `bg`/`fill`/`gradient`, `titlebar` (height of an app-drawn titlebar; the window keeps
its controls over it), `trafficLights` (macOS inset), `dark` (native chrome scheme), `dir`, `keys` +
`onKey` (window-level chords).

`kind="background"` holds a page that must run as if shown (a media `<webview>`: mic, WebAudio,
timers) with no Stella window on screen: a 1×1 (or `w`×`h`) transparent, borderless,
click-through window that never takes focus, is left out of captures and stays off the Dock and
task switchers. macOS: a non-activating NSPanel on every Space. Windows: `WS_EX_NOACTIVATE` +
tool window. Linux: a transparent click-through window opened inactive.

`visible={false}` at mount creates no native window until it turns true; turning it false later
hides (unmaps) the window and keeps its state.

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
  siblings. `dir` (fixed and anchored layers take their tree ancestors' `dir`, as CSS direction reaches
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
- Transforms: `x y scale rotate origin`.
- `motion {dur, bounce}` is the spring every prop change rides. `layout` (s) animates layout
  changes. `instant` makes changes land without motion.
- `enter` / `exit`: a preset (`fade rise drop blur scale pop slide`) or `{opacity, scale, x, y,
  blur, dur, bounce}`.
- `loop`: `opacity`, `rotation`, `slide`, or `sequence {period, delay, frames:[{at, x, y, scale,
  opacity, rotate}]}`. `at` ≤ 1 is a fraction of the period. `scaleX` / `scaleY` are averaged,
  since Rune scales uniformly.

**Interaction.**
- Pointer and focus: `cursor`, `inert` (pointer-events none for the subtree), `focusable`,
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
- `modal {clickOutside, wheelOutside}` traps focus and makes the rest of the window inert.
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

### text

- Content: `spans: [{t, w, c, m, bg, i, u, s, st, href}]`. The run fields are: text, weight,
  colour, mono, background, italic, underline colour, size, strike, and a link (`onLink(href)`).
- Style: `size weight lineHeight tracking color mono family` (a registered font family, `sans`,
  `mono` or `system-mono`), `italic underline strike`.
- Selection: `selectable`, `selectionColor`.
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
  - `onKey({key, chord, mods, value, start, end, length})`: for `keys` chords
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
imageMargin listMargin quoteMargin ruleMargin tableMargin`. Also `tableCellPadding`,
`tableHeaderPad`.

**Numbers and switches.** `codeBlockRadius inlineCodePad strongWeight textWidth
tableHeaderWeight`; booleans `listMarkersOutside tableFlushLeft tableFullWidth`.

**Compound values.**
- `codeBlock [fill, border]` (or `codeBlockFill` + `codeBlockBorder`)
- `quote [rule, width, pad, textColor]`
- `table [border, headerFill]`

**Fonts.** Each takes `{size, weight, lineHeight, tracking, family}`: `body` (alias `bodyFont`),
`codeBlockFont`, `tableFont`, and headings via `headings` (array, level 1 first) or `headingFont`
(`{"1": …}`). Heading margins use `headingMargins` / `headingMargin` in the same two shapes.

**`syntaxHighlight`** (boolean) turns colouring off. **`syntax`.** `{keyword, string, number, comment, type, function, property, punctuation,
operator, inserted, deleted}` colours. `dark` picks the neutral base.

**`codeFrame`.** `{label, labelSize, labelGap, actions: [{id, label?, svg?, view?}], actionColor,
actionHover, actionsOnHover}` adds a language row above each code block, with actions at its top
right. Pressing an action fires `onCodeAction({action, index, language, source})`; TS does the
copy or download. `inside: {fill, border, radius, pad: [x, top, bottom]}` draws the block's frame itself with
the label row inside it (streamdown's layout): pair it with `codeBlock: ["transparent", "transparent"]`
and `codeBlockPadding: [0, y]`. `actionsAt: [top, right]` floats the actions at that inset from
the frame's top right corner instead of placing them in the label row.

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
on unmount. A native view can't be clipped: inside a scroll box it shows only while it lies wholly
in the viewport, so give webviews a panel of their own rather than scrolling content. `radius` /
`corners` round it (macOS); an ancestor's radius doesn't, so give the webview its panel's corners.
A native view draws above every engine layer, so while an overlay (an anchored popover or menu, or
a lifted layer holding a `modal`) overlaps it, the view steps aside and its slot shows the page's
last snapshot (macOS; elsewhere the slot is empty) under the overlay, until the overlay goes.
WebKitGTK keeps one handler per scheme for the whole process; the engine routes each request to
the view that asked, so any number of views can share a scheme.

**Platform.** On Linux the engine runs on X11 (XWayland under Wayland) while the webview feature
is built in, because WebKitGTK children need an X11 parent; `STELLA_RUNE_BACKEND=wayland` opts
out. macOS uses WKWebView and Windows uses WebView2 as child views.

## Engine API (`engine` in `host/bridge.ts`)

- `window.*`: focus, show, hide, close, minimize, maximize, unmaximize, toggleMaximize,
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
  - `lookUp(window?)`: macOS dictionary. Not wired yet; it returns false.
- `input.*`, `media.*`, `webview.*`
- `control.*`, `quit()`

## Verification hooks

- `engine.control.input(events, window?)` replays real input through Rune's own input paths
  (`WindowHandle::inject_script`). The events use the Rune `--script` format:
  - `{type:"tap", key:"send"}`, `{type:"tap", x, y}`
  - `{type:"type", text}`, `{type:"key", name:"k", cmd:true}` (flags `shift ctrl alt logo cmd`; `cmd` is the primary modifier, Ctrl off macOS, and matches `mod+…` chords)
  - `{type:"drag", key, dx, dy}`, `{type:"wheel", …}`, `{paste:"text"}`, `{focus:true}`
  - `t` is seconds from now
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
- `STELLA_RUNE_APP=<path.tsx>` swaps the app entry (`demo/gallery/App.tsx` exercises everything
  here). An entry that exports `Root` renders its own `<window>`s; one that exports `App` is
  wrapped in `<window id="main">`.
