# The web build of `ui/` (stella.sh/chat)

stella.sh/chat iframes `/chat-app/index.html`, which the website's `build:chat` builds from the
Rune `ui/` with `web/build.ts`: the host elements are implemented with react-dom and CSS (the DOM
host, `web/dom/`), and everything around the UI (index.html, `public/`, fonts, theme bootstrap,
env) is desktop-ui's. desktop-ui's own web build (`packages/desktop/scripts/build-web-renderer.ts`)
is what stella.sh served before; it stays for per-user renderers of checkouts from before Rune.

```
VITE_STELLA_BACKEND_URL=<backend> bun packages/desktop-rune/web/build.ts [--out DIR] [--script-src SRC]... [--no-minify]
```

The default `--out` is `packages/website/public/chat-app`, where the website's `build:chat`
writes it (with `--script-src https://static.cloudflareinsights.com` for Cloudflare's analytics
beacon). The build fails if any file is over 25 MiB, Cloudflare Workers' static-asset limit; the
largest today is the Views WebAssembly at 9.2 MiB.

## Pieces

| File | Role |
|---|---|
| `web/entry.ts` | Installs the globals the UI reads (`stella.store`, `stella.engine`, `stella.on`), starts `web-renderer-switch` in web builds, renders `ui/App`'s root with react-dom. |
| `web/jsx-runtime.ts` | `rune-jsx` and `react/jsx-runtime` imported from `ui/` (and `web/replace/`) resolve here: host tags map to the DOM components, everything else is React's. Modules outside `ui/` (desktop-ui's own) keep React's runtime. |
| `web/dom/elements.ts`, `input.ts`, `markdown.ts` | The host elements: `row`/`col`/`box`, `text`, `input`, `image`, `icon`, `vector`, `surface`, `video`/`audio`, `list`, `markdown`, `webview` (an iframe), `window` (the main window is the page). |
| `web/dom/hosted-html.ts` | A `<webview html>` (canvases, Office previews) runs in `canvas-host.html`, a sandboxed opaque origin under the canvas policy, as desktop-ui's web build hosts canvases, with the element's `preload` put before the page's scripts. A srcdoc frame would share the chat's origin (storage, session) and its script policy, which refuses the page's inline scripts. The canvas preload (`ui/shell/display/canvas-tab/CanvasFrame.tsx`) hands the action port to the page's bridge as if from the parent. |
| `web/dom/host.ts` | Props every element shares: layout and paint (`style.ts`), enter/exit/layout motion, scroll (pinning, edge fades, `onAtBottom`), anchored and modal top-layer content, press/hover/focus/keys/focus groups, drag, file drop, tooltips, `ref.set(patch)`. |
| `web/engine.ts` | `stella.engine`: scroll, focus, input selection, clipboard, file dialogs (a file input; picked files get virtual paths), downloads for saved files, notifications, popup menus (`dom/menu.ts`), fonts, page background, media and webview commands. |
| `web/globals.ts`, `web/shims/` | `process`, `Buffer`, a small `Bun` and `node:` stand-ins for the modules `ui/` reaches through shared code. |
| `web/replace/` | Stands in for a `packages/desktop-rune/<path>` module on the web: system fonts, font files, the backdrop (a canvas painted once per theme and stretched by the compositor, or CSS radial gradients on low-power devices, as desktop-ui's `ShiftingGradient`), the static home's look writer and `StellaCharacter` (desktop-ui's DOM rig, not the engine's SVG frames). |
| `web/static-home/` | The pre-rendered home: `shell.html` (markup, CSS and an inline script injected before `#root`), `palette.ts` (the look it paints, saved by the app in localStorage for the next load) and `adopt.ts` (hands the draft, selection and focus to the app's composer once it is stable, then fades out). |
| `web/build.ts` | `Bun.build` of `web/entry.ts` with `host/vite-compat.ts`, then desktop-ui's `index.html` with the static home, the built entry (preloaded, run after the static home's first frame), fonts stylesheet, preconnect and CSP sources (including the inline scripts' hashes), `canvas-host.html` and `public/`. `--no-static-home` leaves the home out. |

Stella Views (`web/views/`) cost nothing until a conversation carries a view or a surface opens
one: `stella.views` is a small stand-in, and the host, the TSX compiler, the view worker and the
WebAssembly load on first use.

Behaviour that only the web has comes from the same desktop-ui modules the web build uses
today, because `ui/` imports them: `VITE_STELLA_WEB_BUILD=1` capabilities (cloud execution, no
local runtime), `#ott` sign-in handoff (`global/auth/services/auth-session.ts`),
`web-renderer-switch` (per-user renderers), the theme bootstrap (`public/stella-boot.js`, run
by index.html before the app). What the web can't do degrades as desktop-ui's web build does:
other windows render nothing, native menus are DOM menus, tray and window commands are no-ops.

## Measured against desktop-ui's web build

`packages/website/scripts/perf-chat.mjs --variants old=…,new=… --runs 9` (4× CPU, fast 4G,
ABBA), both built with their static home, medians (2026-11-27, master e2ea10e7e, omarchy):

| | desktop-ui | Rune |
|---|---|---|
| Cold: first typeable composer (the static home) | 1208 ms | 668 ms |
| Cold: the app's composer typeable | 2259 ms | 2681 ms |
| Warm: first typeable composer | 464 ms | 408 ms |
| Warm: the app's composer typeable | 687 ms | 859 ms |
| Composer moves on a cold load | 0 px | 0 px |
| Blocking time after typeable (cold) | 407 ms | 312 ms |
| DOM nodes on the home | 248 | 363 |
| Script / style / layout (cold) | 976 / 122 / 28 ms | 1163 / 203 / 55 ms |
| JS transferred / requests | 869 KB / 79 | 780 KB / 11 |
| Keystroke p90 | 88 ms | 88 ms |

The page is typeable much sooner and moves less code, but the app itself takes over about
400 ms later cold (170 ms warm): more script, style and layout work while it boots and a larger
home DOM. The static home holds the draft until then, so nothing typed is lost. (The 2026-11-26
run measured the app's composer at 3378 ms for desktop-ui and 2396 ms for Rune.)

The static home (`web/static-home/`) is desktop-ui's `--static-home` for the Rune page: the
empty chat's docked composer in the look the app saved for the next load, typeable before the
bundle runs. The app takes the draft, selection and focus over in place, so nothing moves.

## Per-user renderers

A user's desktop builds their renderer whenever their fork holds its checkout's HEAD: after it
pushes a change, and at launch when it fetches the fork
(`packages/desktop/electron/services/app-source/web-renderer.ts`, from the app-source service's
`onForkCurrent`). It uploads it to
`PUT /api/app-source/web-renderer/<id>`, and the backend serves it at
`/chat-app/u/<fork>/<id>/` (R2 `web-renderers/<fork>/<id>/`, immutable, current plus previous
kept). The web app asks `appSource.webRenderer` and switches to it.

Which UI is built follows the shared `/chat-app/`, so a user's own renderer is the same UI as
everyone else's with their changes in it, whichever engine their desktop runs:

- A checkout with `packages/desktop-rune/web/build.ts`: the Rune `ui/`, that script, inputs
  `packages/desktop-ui/`, `contracts/`, `theme/`, `bun.lock` and `packages/desktop-rune/` (not
  `engine/`), ref `refs/stella/web-renderer-rune`, id = `sha1("stella-rune-web\0" + treeSha)`.
  The backend serves ids as immutable, so a tree built both ways needs two ids.
- A checkout from before Rune: desktop-ui, `build-web-renderer.ts`, the same inputs without
  `packages/desktop-rune/`, ref `refs/stella/web-renderer`, id = the tree SHA.

Migration:

- Existing desktop-ui renderers stay where they are and keep serving; nothing on the backend
  changes (the id has the tree SHA's shape, and the backend takes any files up to 64 MB and 800
  files, `.wasm` served as `application/wasm`).
- A desktop that last uploaded a desktop-ui renderer uploads a Rune one at its next launch on a
  checkout with the Rune build, without a new commit: the checkout remembers which kind it last
  uploaded (git config `stella.webRendererKind`; an older checkout without it counts as switched
  when it has the other kind's ref), and a kind that differs builds and uploads even when HEAD
  hasn't moved. Otherwise the change is measured against the kind's own ref, or upstream when it
  has none, which includes whatever they changed in desktop-ui. The record then points at the new
  id and the backend retires the renderer before the previous.
- A user with no changes gets the shared `/chat-app/`, the Rune build since the website's
  `build:chat` switched to it.
