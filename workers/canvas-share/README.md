# canvas-share Worker

Serves published canvas documents from the `stella-canvas-shares` R2 bucket at
`GET /c/:slug`. cloud-builder's `shares` owner domain (`workers/cloud-builder/src/owner-store/domains/shares.ts`)
writes and deletes the objects; this Worker is the read-only public serving
layer.

## Behavior

- `GET /c/<slug>` → fetches `shares/<slug>.html` from R2.
  - Missing object → `404`.
  - `expires-at` custom metadata in the past → `404` (object is lazily deleted).
  - `visibility: private` custom metadata → served only to its owner:
    - `?grant=<token>` minted by the backend's `shares.viewLink` for this slug
      and this object's `owner` tag → `302` to the clean `/c/<slug>` with an
      HttpOnly `stella_canvas_view` cookie (24 hours, `Path=/c/`).
    - That cookie for the object's owner → the HTML, `Cache-Control: private, no-store`.
    - Anything else → `403` "This canvas is private" page, with a link for the
      owner to `<site>/canvas/open?c=<slug>` on the website (the object's
      `owner-site` metadata, else the `OWNER_SITE_URL` var). Signed in there
      as the owner, the site fetches a grant from `shares.viewLink` and sends
      the browser back here with it; anyone else is told it isn't theirs.
    - Needs the `CANVAS_SHARE_VIEW_SECRET` secret, the same value cloud-builder
      signs grants with (`workers/shared/canvas-view-grant.ts`). Without it no
      private canvas opens here.
  - Otherwise (public, or written before visibility existed) → the HTML with:
    - `Content-Type: text/html; charset=utf-8`
    - `X-Content-Type-Options: nosniff`
    - `X-Robots-Tag: noindex, nofollow`
    - `Referrer-Policy: no-referrer`
    - `Cache-Control: public, max-age=60`
    - `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms allow-downloads;`
- Pages published from Drive with files beside them (`shares.saveDriveDocument`)
  carry `assets: 1` metadata; their files are copied to `shares/<slug>/<path>`.
  - `GET /c/<slug>` → `308` to `/c/<slug>/`, so the page's relative URLs resolve.
  - `GET /c/<slug>/<path>` → that file, with range requests (video seeking),
    under the page's expiry and visibility. Public: `Access-Control-Allow-Origin: *`.
    Private: the page sets a second view cookie (`stella_canvas_asset`,
    `SameSite=None`, `Path=/c/<slug>/`), because a sandboxed page's own
    subresource requests are cross-site and never carry the Lax view cookie.
- `GET /f/<slug>/<name>` → a shared Drive file from `files/<slug>`, with range
  requests (206) so media streams and seeks.
  - Video/audio opened by a person (`Sec-Fetch-Dest: document`, or no Sec-Fetch
    headers and an `Accept` with `text/html`) → a small script-free player
    page (`<video controls playsinline preload="metadata">`, full width, first
    frame as poster, file name, Download). The player loads the bytes from
    `?raw=1`; `?download=1` forces an attachment. Both carry
    `Vary: Sec-Fetch-Dest, Accept`.
  - Video/audio bytes are served without the CSP `sandbox` flag: WebKit's
    built-in player needs its own scripts, and a sandbox without
    `allow-scripts` collapsed shared videos on iPhone to a tiny box with a
    spinner. Every other type keeps `sandbox`.
- `SHARES_DISABLED` var truthy (`1`/`true`/`yes`) → `503` for every share (kill-switch).

### CSP note (important)

The sandbox CSP includes `allow-scripts` (canvases run JS: Chart.js/D3/etc.) but
deliberately **omits `allow-same-origin`**. That combination is the classic
sandbox escape; omitting it gives every share an opaque origin so shares can't
read cookies/localStorage or touch each other. Do not add `allow-same-origin`.

## Go-live checklist (not done here — no deploy)

1. Provision the `stella-canvas-shares` R2 bucket (in progress).
2. Confirm the `stellashare.app` custom domain in `wrangler.jsonc` is active.
3. Set the backend `CANVAS_SHARE_BASE_URL` env to the same origin (e.g.
   `https://share.example.com`) so returned URLs match what this Worker serves.
4. `bun install` here, run the verification commands below, then deliberately
   run `bun run deploy`.

## Local dev

This Worker is part of the repository's root Bun workspace. A root
`bun install --frozen-lockfile` installs its pinned toolchain, and the
`cloud_workers` CI matrix runs its type-generation check, typecheck, and
production bundle dry-run.

```sh
bun install
bun run types
bun run typecheck
bun run build:dry-run
bun run dev -- --local # requires Wrangler login for non-local resources
```
