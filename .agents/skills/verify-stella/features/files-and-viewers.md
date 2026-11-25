# Files, viewers and Drive

**Files** lists what Stella and its tasks produced and what the conversation links; the file viewer shows one file at a time. Drive is the account's cloud storage (`stella://drive/<path>` links), opened by the same viewer on desktop, web and phone.

## Sub-features

- `files-tab`: + menu › **Files** (`shell/sidebar-sections/FilesSection.jsx`); loading, grouped and empty ("No files yet · Files from Stella show up here."). The + menu's **Search anything** searches the same index.
- `trash-tab`: + menu › **Trash** (`shell/display/TrashTabContent.tsx`), files Stella moved to the Trash with restore.
- `file-viewer` (`features/workspace-display/file-viewer-store.ts`, `shell/workspace-stage/WorkspaceStage.tsx`): one file at a time, either floating over the chat (movable, resizable, never over the composer) or filling the stage; the choice persists (`stella.fileViewer.mode`). Its header has the title (path in the tooltip), **More** (open, copy link, public link…), and previous/next arrows through the set of files the item came with (a reply's files, a task's files: "viewer sets", `viewer-siblings.ts`).
- `viewer-windows` (`shell/workspace-stage/viewer-drag.ts`, `viewer-windows.ts`; main `windows/viewer-windows.ts`): every kind (files, HTML, apps) uses the same viewer. Dragging it past the window edge meets resistance and then tears it into a native window of its own (also the header's **Open in its own window**); **Move back into Stella** docks it. The window is a blank popup in the full window's renderer, so its CDP target is a `page` at `about:blank` and no process is added. Desktop only: web has the viewer without the window.
- `viewer-kinds`: text, code, Markdown, HTML documents (sandboxed canvas; side panel `clamp(380px, 34vw, 520px)`, expanded `min(960px, 100% - 48px)`), image, audio, video, PDF, CSV (parsed off the UI thread, capped), Office documents, source diffs, and an explicit fallback for anything else.
- `drive-files`: a `stella://drive/` link (or a cloud-world path `/workspace/world/drive/...`) opens the Drive file in the viewer; Drive HTML is read by main (`display:canvasDriveUrl`, ≤48 MB) and served as `stella-canvas://memory/<id>/<name>` with its assets. A file's content identity is its `version` (every write gets a fresh key): `drive.fileUrl` returns it and the live view `drive.versions {paths}` pushes changes, so an open viewer, tiles and previews update when the file is replaced under the same name (`createDriveFileVersionStore`, `packages/contracts/drive-file-versions.ts`). New Drive caches must key on `version`, never path or size.
- `canvas-links`: a link inside a canvas (desktop, web chat, phone) opens the way the same link opens from chat: pages in Stella's browser (web: new tab; phone: in-app Safari sheet), `stella://drive/` files and canvases and relative links to the canvas's siblings in the viewer (phone: pushed onto the viewer with Back), absolute/`file://` paths on a computer in the viewer, `stella://app/` in Apps, `#fragment` scrolls. One resolver for all: `resolveCanvasLink` (`packages/contracts/canvas-links.ts`); the canvas only posts the raw `href` (`stella:canvas-link`, bridge in `packages/contracts/canvas-bridge.ts`; phone `canvasBridgeScript`), and desktop/web act only while the window has user activation. On the web a canvas loads `canvas-host.html` (beside the web build's index.html; `packages/contracts/canvas-host.ts`) in a sandboxed opaque-origin frame, which takes the canvas HTML by postMessage and writes it under the canvas policy (stella.sh sends that policy as a header through the website's `_headers`), so a canvas's own scripts run on the web as on desktop (`stella-canvas:` with its own CSP). Verify web locally per the web-chat recipe (build-web-renderer `--out`, serve on 127.0.0.1:57314). A canvas never launches a computer file with its default app: a file Stella can't preview is revealed in its folder instead. Phone links inside the canvas WebView aren't in the accessibility tree: tap them by coordinates.
- `canvas-actions`: a canvas that declares actions (`<!--stella-actions [...]-->` at the very start; `packages/contracts/canvas-actions.ts`) sends a tapped control or submitted form to the chat as a `<canvas-action>` message (chip with the canvas title plus the action's label), and Stella updates the same canvas. Desktop/web pass a MessagePort to the frame and accept only declared ids while the window has user activation (a scripted click sends nothing); the phone uses the WebView channel plus a per-load token. Verify by asking Stella for a small canvas with buttons, tapping one (`drive click-xy`; phone by coordinates) and checking the chip, her reply and the updated canvas.
- `right-click`: files, links and images have native context menus drawn by Electron main (`desktop/electron/services/context-menu-service.ts`); renderer screenshots don't show them.

## How to get to it (user POV)

- + menu › **Files** or **Trash**; or click a file pill, inline link or tile in the chat.
- Use the viewer's arrows to step through a reply's files; drag the floating viewer, or fill the stage.

## Driving it with control-stella

Preconditions: a safe fixture or an existing artifact; never browse the user's unrelated files for one.

- **Open.** `node .agents/skills/verify-stella/control-stella.mjs nav files`; classify the list with `inspect aria`.
- **Select.** `inspect components` for a named row, then `drive click` it; require the viewer with the right kind and header.
- **Drive fixture.** Upload into the run's account with `backend-call.mjs call drive.prepareUpload` → PUT → `drive.finalizeUpload` (or `scripts/upload-drive-fixtures.ts <token> <file> <drivePath>`), then have the chat link `stella://drive/<path>` and open it.
- **Freshness.** With the viewer open, upload a new version under the same name and require the viewer to change without a reopen.
- **Large data.** `performance metrics` and a bounded `performance trace` around opening and scrolling a big CSV or long text.

## Gotchas

- Empty Files is the default in a fresh run.
- File preview proof must go through the real selection path, not `display:readFile` directly.
- Drive has no delete handler; overwrite a test file with a tombstone instead.
- Public links: only image, video, audio and PDF render inline at stellashare.app; HTML documents publish through `shares.saveDriveDocument`.
- The viewer replaced the old right-panel file tabs; there is no "Close panel".
