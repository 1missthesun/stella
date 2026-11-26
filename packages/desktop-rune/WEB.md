# The web build of `ui/` (stella.sh/chat)

stella.sh/chat iframes `/chat-app/index.html`. Today that page is desktop-ui's web build
(`packages/desktop/scripts/build-web-renderer.ts`). `web/` builds the same page from the Rune
`ui/`: the host elements are implemented with react-dom and CSS (the DOM host, `web/dom/`), and
everything around the UI (index.html, `public/`, fonts, theme bootstrap, env) is desktop-ui's.

```
VITE_STELLA_BACKEND_URL=<backend> bun packages/desktop-rune/web/build.ts [--out DIR] [--script-src SRC]... [--no-minify]
```

The default `--out` is `packages/website/public/chat-app`, where the website's `build:chat`
writes today's build.

## Pieces

| File | Role |
|---|---|
| `web/entry.ts` | Installs the globals the UI reads (`stella.store`, `stella.engine`, `stella.on`), starts `web-renderer-switch` in web builds, renders `ui/App`'s root with react-dom. |
| `web/jsx-runtime.ts` | `rune-jsx` and `react/jsx-runtime` imported from `ui/` (and `web/replace/`) resolve here: host tags map to the DOM components, everything else is React's. Modules outside `ui/` (desktop-ui's own) keep React's runtime. |
| `web/dom/elements.ts`, `input.ts`, `markdown.ts` | The host elements: `row`/`col`/`box`, `text`, `input`, `image`, `icon`, `vector`, `surface`, `video`/`audio`, `list`, `markdown`, `webview` (an iframe), `window` (the main window is the page). |
| `web/dom/host.ts` | Props every element shares: layout and paint (`style.ts`), enter/exit/layout motion, scroll (pinning, edge fades, `onAtBottom`), anchored and modal top-layer content, press/hover/focus/keys/focus groups, drag, file drop, tooltips, `ref.set(patch)`. |
| `web/engine.ts` | `stella.engine`: scroll, focus, input selection, clipboard, file dialogs (a file input; picked files get virtual paths), downloads for saved files, notifications, popup menus (`dom/menu.ts`), fonts, page background, media and webview commands. |
| `web/globals.ts`, `web/shims/` | `process`, `Buffer`, a small `Bun` and `node:` stand-ins for the modules `ui/` reaches through shared code. |
| `web/replace/` | Stands in for a `packages/desktop-rune/<path>` module on the web: system fonts, font files, the backdrop PNG (an object URL) and `StellaCharacter` (desktop-ui's DOM rig, not the engine's SVG frames). |
| `web/build.ts` | `Bun.build` of `web/entry.ts` with `host/vite-compat.ts`, then desktop-ui's `index.html` with the built entry, fonts stylesheet, preconnect and CSP sources, `canvas-host.html` and `public/`. |

Behaviour that only the web has comes from the same desktop-ui modules the web build uses
today, because `ui/` imports them: `VITE_STELLA_WEB_BUILD=1` capabilities (cloud execution, no
local runtime), `#ott` sign-in handoff (`global/auth/services/auth-session.ts`),
`web-renderer-switch` (per-user renderers), the theme bootstrap (`public/stella-boot.js`, run
by index.html before the app). What the web can't do degrades as desktop-ui's web build does:
other windows render nothing, native menus are DOM menus, tray and window commands are no-ops.

Not on the web: `--static-home` (desktop-ui's pre-rendered home, which hands its textarea to
`textarea.chat-composer-textarea`). The Rune build shows the page's own launch background until
the app renders.

## Per-user renderers

A user's desktop builds their renderer when it pushes a change to their fork
(`packages/desktop/electron/services/app-source/web-renderer.ts`), uploads it to
`PUT /api/app-source/web-renderer/<id>`, and the backend serves it at
`/chat-app/u/<fork>/<id>/` (R2 `web-renderers/<fork>/<id>/`, immutable, current plus previous
kept). The web app asks `appSource.webRenderer` and switches to it.

Which UI is built follows the desktop the user runs, so the web shows the interface they changed:

- Electron (`STELLA_LAUNCHER_ENGINE` unset): desktop-ui, `build-web-renderer.ts`, inputs
  `packages/desktop-ui/`, `contracts/`, `theme/`, `bun.lock`, ref `refs/stella/web-renderer`,
  id = the tree SHA. Unchanged.
- Rune (`STELLA_LAUNCHER_ENGINE=rune`, and the checkout has `packages/desktop-rune/web/build.ts`):
  the Rune `ui/`, `packages/desktop-rune/web/build.ts`, the same inputs plus
  `packages/desktop-rune/` (not `engine/`), ref `refs/stella/web-renderer-rune`, id =
  `sha1("stella-rune-web\0" + treeSha)`. The backend serves ids as immutable, so a tree built both
  ways needs two ids.

Migration:

- Existing desktop-ui renderers stay where they are and keep serving; nothing on the backend or
  website changes (the id has the tree SHA's shape).
- A user who moves to Rune gets a Rune renderer on their next push: the Rune ref is missing, so
  the change is measured against upstream, which includes whatever they changed in desktop-ui.
  The record then points at the Rune id and the backend retires the renderer before the previous.
- A user with no changes keeps the shared `/chat-app/`. That switches to the Rune build when the
  website's `build:chat` runs `packages/desktop-rune/web/build.ts` instead of
  `build-web-renderer.ts`, a ship-time step together with making Rune the default desktop.
