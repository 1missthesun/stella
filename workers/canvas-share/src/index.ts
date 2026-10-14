/**
 * canvas-share serving Worker.
 *
 * Serves published canvas HTML documents from the `stella-canvas-shares` R2
 * bucket at `GET /c/:slug`.
 *
 * Security model: every share is served with a `Content-Security-Policy:
 * sandbox` header. `allow-scripts` is REQUIRED (canvases run JS — Chart.js,
 * D3, etc.), but `allow-same-origin` is deliberately OMITTED. Without
 * `allow-same-origin` the document gets an opaque origin, so shares cannot
 * read cookies/localStorage or reach across to each other. Never add
 * `allow-same-origin` alongside `allow-scripts` — that pairing is the classic
 * sandbox escape.
 *
 * Private canvases: an object whose metadata says `visibility: private` is
 * served only to its owner. The owner arrives with a `?grant=` minted by the
 * backend's `shares.viewLink`; a valid grant for this slug and this object's
 * owner is traded for an HttpOnly view cookie, and the browser is redirected
 * to the clean link (so the grant never sits where the canvas's scripts could
 * read it). After that the cookie opens the owner's private canvases until it
 * expires. Anyone else gets the "private" page, which links the owner to the
 * website's sign-in page for the link (`owner-site` metadata, else
 * `OWNER_SITE_URL`); signed in there as the owner, the site fetches a grant
 * and sends the browser back here with it. Without
 * `CANVAS_SHARE_VIEW_SECRET` no private canvas opens here at all. Objects
 * written before visibility existed carry none and stay public.
 *
 * Shared drive files: `GET /f/:slug/:name` serves `files/<slug>` with the
 * content type the backend stored on it, under a scriptless sandbox. Only
 * images (never SVG), video, audio and PDFs open inline; everything else is
 * always a download, whatever the stored metadata says. Range requests are honoured so videos play and seek. File links
 * are always public; the trailing name is cosmetic.
 */

import {
  CANVAS_VIEW_COOKIE,
  CANVAS_VIEW_COOKIE_TTL_MS,
  CANVAS_VIEW_GRANT_PARAM,
  signCanvasViewToken,
  verifyCanvasViewToken,
} from "../../shared/canvas-view-grant.js";
import { buildCanvasOwnerOpenUrl } from "../../../packages/contracts/canvas-share.js";

const KEY_PREFIX = "shares";
/** Slugs are 128-bit base64url tokens (~22 chars); be lenient but strict. */
const SLUG_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Content-Security-Policy applied to every served share. */
const SHARE_CSP =
  "sandbox allow-scripts allow-popups allow-forms allow-downloads;";

const isDisabled = (env: Env): boolean => {
  const flag = env.SHARES_DISABLED?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
};

const textResponse = (
  status: number,
  body: string,
): Response =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    },
  });

const notFound = (): Response => textResponse(404, "Not found");

const viewSecretOf = (env: Env): string | null => {
  const value = (env as unknown as Record<string, unknown>).CANVAS_SHARE_VIEW_SECRET;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
};

/** An http(s) origin; plain http only for a local site. */
const siteOrigin = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
};

/** Where this object's owner signs in to open it, if anywhere. */
const ownerOpenUrlOf = (
  env: Env,
  metadata: Record<string, string> | undefined,
  slug: string,
): string | null => {
  const site =
    siteOrigin(metadata?.["owner-site"]) ??
    siteOrigin(env.OWNER_SITE_URL);
  return site ? buildCanvasOwnerOpenUrl(site, slug) : null;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const readCookie = (request: Request, name: string): string | null => {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
};

const privatePageHtml = (ownerOpenUrl: string | null): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Private canvas</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #f7f6f3; color: #1f1f1d; }
  main { max-width: 420px; padding: 32px 24px; text-align: center; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
  p { margin: 0; color: #6b6a66; }
  a.open { display: inline-block; margin: 24px 0 16px; padding: 10px 18px;
    border-radius: 999px; background: #1f1f1d; color: #f7f6f3;
    text-decoration: none; font-weight: 500; }
  p.note { font-size: 14px; }
  @media (prefers-color-scheme: dark) {
    body { background: #161615; color: #ecebe8; }
    p { color: #a3a29e; }
    a.open { background: #ecebe8; color: #161615; }
  }
</style>
</head>
<body>
<main>
  <h1>This canvas is private</h1>
  <p>Only its owner can open it.</p>
${ownerOpenUrl ? `  <a class="open" href="${escapeHtml(ownerOpenUrl)}">It's mine, sign in to open it</a>\n` : ""}  <p class="note">To let others see it, its owner can make it public from the canvas's Share menu in Stella.</p>
</main>
</body>
</html>`;

const privatePage = (method: string, ownerOpenUrl: string | null): Response =>
  new Response(method === "HEAD" ? null : privatePageHtml(ownerOpenUrl), {
    status: 403,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });

const parseSlug = (pathname: string): string | null => {
  // Expect exactly `/c/<slug>`.
  const match = /^\/c\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    // Malformed percent-encoding is an invalid public route, not a Worker
    // failure. Keep the response indistinguishable from every other invalid
    // or missing share slug.
    return null;
  }
  return SLUG_PATTERN.test(slug) ? slug : null;
};

/** No scripts at all for a shared file, unlike a canvas. */
const FILE_CSP = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";

const INLINE_FILE_TYPE = /^(?:image\/(?!svg)[a-z0-9.+-]+|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|application\/pdf)$/;

const parseFileSlug = (pathname: string): string | null => {
  const match = /^\/f\/([^/]+)(?:\/[^/]*)?$/.exec(pathname);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return SLUG_PATTERN.test(slug) ? slug : null;
};

const serveFile = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  slug: string,
): Promise<Response> => {
  const key = `files/${slug}`;
  const head = await env.SHARES_BUCKET.head(key);
  if (!head) return notFound();
  const expiresAt = Number(head.customMetadata?.["expires-at"]);
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    ctx.waitUntil(env.SHARES_BUCKET.delete(key).catch(() => {}));
    return notFound();
  }
  if (head.customMetadata?.visibility === "private") return notFound();

  const headers = new Headers({
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
    "cache-control": "public, max-age=60",
    "content-security-policy": FILE_CSP,
    "accept-ranges": "bytes",
  });
  head.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=60");
  headers.set("x-content-type-options", "nosniff");
  const contentType = (head.httpMetadata?.contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (!INLINE_FILE_TYPE.test(contentType)) {
    const name = head.httpMetadata?.contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    headers.set("content-disposition", `attachment${name ? `; filename*=UTF-8''${name}` : ""}`);
    if (!contentType || /html|svg|xml|javascript/.test(contentType)) {
      headers.set("content-type", "application/octet-stream");
    }
  }
  headers.set("etag", head.httpEtag);

  if (request.method === "HEAD") {
    headers.set("content-length", String(head.size));
    return new Response(null, { status: 200, headers });
  }
  const object = await env.SHARES_BUCKET.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) return notFound();
  if (!("body" in object)) {
    return new Response(null, { status: 304, headers });
  }
  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && request.headers.has("range")) {
    const offset =
      range.suffix !== undefined ? Math.max(0, object.size - range.suffix) : (range.offset ?? 0);
    const length =
      range.suffix !== undefined
        ? Math.min(range.suffix, object.size)
        : (range.length ?? object.size - offset);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (isDisabled(env)) {
      return textResponse(503, "Canvas sharing is temporarily disabled.");
    }

    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse(405, "Method not allowed");
    }

    const fileSlug = parseFileSlug(url.pathname);
    if (fileSlug) return serveFile(request, env, ctx, fileSlug);

    const slug = parseSlug(url.pathname);
    if (!slug) return notFound();

    const key = `${KEY_PREFIX}/${slug}.html`;
    const object = await env.SHARES_BUCKET.get(key);
    if (!object) return notFound();

    // Enforce expiry from custom metadata (epoch-ms string). Past-due objects
    // 404 and are lazily deleted so storage doesn't linger before the cron.
    const expiresAtRaw = object.customMetadata?.["expires-at"];
    if (expiresAtRaw) {
      const expiresAt = Number(expiresAtRaw);
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        ctx.waitUntil(env.SHARES_BUCKET.delete(key).catch(() => {}));
        return notFound();
      }
    }

    const isPrivate = object.customMetadata?.visibility === "private";
    if (isPrivate) {
      const owner = object.customMetadata?.owner;
      const secret = viewSecretOf(env);
      if (!owner || !secret) {
        object.body.cancel().catch(() => {});
        return privatePage(request.method, null);
      }
      const ownerOpenUrl = ownerOpenUrlOf(env, object.customMetadata, slug);
      const now = Date.now();
      const grant = url.searchParams.get(CANVAS_VIEW_GRANT_PARAM);
      if (grant) {
        const claims = await verifyCanvasViewToken(secret, grant, now);
        object.body.cancel().catch(() => {});
        if (claims?.k === "grant" && claims.s === slug && claims.o === owner) {
          const view = await signCanvasViewToken(secret, {
            k: "view",
            o: owner,
            e: now + CANVAS_VIEW_COOKIE_TTL_MS,
          });
          return new Response(null, {
            status: 302,
            headers: {
              location: `/c/${slug}`,
              "set-cookie": `${CANVAS_VIEW_COOKIE}=${view}; Path=/c/; Max-Age=${Math.floor(CANVAS_VIEW_COOKIE_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`,
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            },
          });
        }
        return privatePage(request.method, ownerOpenUrl);
      }
      const cookie = readCookie(request, CANVAS_VIEW_COOKIE);
      const claims = cookie ? await verifyCanvasViewToken(secret, cookie, now) : null;
      if (claims?.k !== "view" || claims.o !== owner) {
        object.body.cancel().catch(() => {});
        return privatePage(request.method, ownerOpenUrl);
      }
    }

    const headers = new Headers({
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
      "cache-control": isPrivate ? "private, no-store" : "public, max-age=60",
      "content-security-policy": SHARE_CSP,
    });
    if (object.httpEtag) headers.set("etag", object.httpEtag);

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  },
} satisfies ExportedHandler<Env>;
