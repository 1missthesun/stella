import {
  CANVAS_VIEW_COOKIE,
  CANVAS_VIEW_COOKIE_TTL_MS,
  CANVAS_VIEW_GRANT_PARAM,
  signCanvasViewToken,
  verifyCanvasViewToken,
} from "../../shared/canvas-view-grant.js";
import { buildCanvasOwnerOpenUrl } from "../../../packages/contracts/canvas-share.js";
import {
  parseSharedViewPayload,
  sharedViewPayloadScript,
  VIEW_SHARE_KIND,
  VIEW_SHARE_PAGE_PATH,
  VIEW_SHARE_PAYLOAD_MARKER,
  VIEW_SHARE_TITLE_MARKER,
} from "../../../packages/contracts/view-share.js";

const KEY_PREFIX = "shares";
// A sandboxed page has an opaque origin, so its subresource requests never carry the Lax view cookie.
const CANVAS_ASSET_COOKIE = "stella_canvas_asset";
const SLUG_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

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

type CanvasPath = { slug: string; slash: boolean; asset: string | null };

const parseCanvasPath = (pathname: string): CanvasPath | null => {
  const match = /^\/c\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  let slug: string;
  let segments: string[];
  try {
    slug = decodeURIComponent(match[1]);
    segments = (match[2] ?? "").split("/").slice(1).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (!SLUG_PATTERN.test(slug)) return null;
  if (segments.length === 0) return { slug, slash: false, asset: null };
  if (segments.length === 1 && segments[0] === "") return { slug, slash: true, asset: null };
  if (segments.some((segment) => !segment || segment.startsWith(".") || /[\\\0]/.test(segment))) {
    return null;
  }
  return { slug, slash: true, asset: segments.join("/") };
};

// A shared Stella View: our own page (static assets under /_view/) runs the view's program in
// PsychoScript's WebAssembly inside a worker, so the page itself isn't sandboxed (it needs its
// origin's IndexedDB for the view's storage, and module workers). The view reaches only what the
// page's capabilities give it; fetch goes to the public internet.
const VIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self' https:",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const serveView = async (
  request: Request,
  env: Env,
  object: R2ObjectBody,
  url: URL,
  isPrivate: boolean,
): Promise<Response> => {
  let payload: ReturnType<typeof parseSharedViewPayload> = null;
  try {
    payload = parseSharedViewPayload(JSON.parse(await object.text()));
  } catch {
    payload = null;
  }
  if (!payload) return notFound();
  const template = await env.ASSETS.fetch(new Request(new URL(VIEW_SHARE_PAGE_PATH, url.origin)));
  if (!template.ok) return textResponse(503, "Shared views aren't available here yet.");
  const html = (await template.text())
    .replace(VIEW_SHARE_TITLE_MARKER, () => escapeHtml(payload.title || "Stella View"))
    .replace(VIEW_SHARE_PAYLOAD_MARKER, () => sharedViewPayloadScript(JSON.stringify(payload)));
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
    "cache-control": isPrivate ? "private, no-store" : "public, max-age=60",
    "content-security-policy": VIEW_CSP,
  });
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
};

const FILE_CSP = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";
// WebKit's built-in media player runs its own scripts, which `sandbox` without allow-scripts blocks.
const MEDIA_FILE_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";
const MEDIA_TYPE = /^(?:video|audio)\/[a-z0-9.+-]+$/;

const fileCspFor = (contentType: string): string =>
  MEDIA_TYPE.test(contentType) ? MEDIA_FILE_CSP : FILE_CSP;

const bareContentType = (value: string | undefined): string =>
  (value ?? "").split(";")[0]!.trim().toLowerCase();

const rangedObjectResponse = async (
  request: Request,
  bucket: R2Bucket,
  key: string,
  size: number,
  headers: Headers,
): Promise<Response> => {
  if (request.method === "HEAD") {
    headers.set("content-length", String(size));
    return new Response(null, { status: 200, headers });
  }
  const object = await bucket.get(key, {
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

const hasOwnerViewCookie = async (
  request: Request,
  secret: string,
  owner: string,
  name: string = CANVAS_VIEW_COOKIE,
): Promise<boolean> => {
  const cookie = readCookie(request, name);
  const claims = cookie ? await verifyCanvasViewToken(secret, cookie, Date.now()) : null;
  return claims?.k === "view" && claims.o === owner;
};

const serveCanvasAsset = async (
  request: Request,
  env: Env,
  page: R2Object,
  slug: string,
  asset: string,
): Promise<Response> => {
  if (page.customMetadata?.assets !== "1") return notFound();
  const isPrivate = page.customMetadata?.visibility === "private";
  if (isPrivate) {
    const owner = page.customMetadata?.owner;
    const secret = viewSecretOf(env);
    if (
      !owner ||
      !secret ||
      !(
        (await hasOwnerViewCookie(request, secret, owner, CANVAS_ASSET_COOKIE)) ||
        (await hasOwnerViewCookie(request, secret, owner))
      )
    ) {
      return notFound();
    }
  }
  const key = `${KEY_PREFIX}/${slug}/${asset}`;
  const head = await env.SHARES_BUCKET.head(key);
  if (!head) return notFound();
  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set("content-type", head.httpMetadata?.contentType || "application/octet-stream");
  headers.delete("content-disposition");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("referrer-policy", "no-referrer");
  headers.set("content-security-policy", fileCspFor(bareContentType(head.httpMetadata?.contentType)));
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", isPrivate ? "private, no-store" : "public, max-age=60");
  if (!isPrivate) headers.set("access-control-allow-origin", "*");
  headers.set("etag", head.httpEtag);
  return rangedObjectResponse(request, env.SHARES_BUCKET, key, head.size, headers);
};

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

const fileNameOf = (head: R2Object): string | null => {
  const encoded = head.httpMetadata?.contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
};

const wantsPlayerPage = (request: Request, url: URL): boolean => {
  if (url.searchParams.has("raw") || url.searchParams.has("download")) return false;
  if (request.headers.has("range")) return false;
  const dest = request.headers.get("sec-fetch-dest");
  if (dest) return dest === "document";
  return (request.headers.get("accept") ?? "").includes("text/html");
};

const PLAYER_CSP =
  "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const playerPageHtml = (
  kind: "video" | "audio",
  name: string,
  size: number,
  rawPath: string,
  rawUrl: string,
  contentType: string,
): string => {
  const title = escapeHtml(name);
  const src = escapeHtml(rawPath);
  const media =
    kind === "video"
      ? `<video controls playsinline preload="metadata" src="${src}#t=0.001"></video>`
      : `<audio controls preload="metadata" src="${src}"></audio>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:type" content="${kind === "video" ? "video.other" : "music.song"}">
<meta property="og:${kind}" content="${escapeHtml(rawUrl)}">
<meta property="og:${kind}:type" content="${escapeHtml(contentType)}">
<style>
  html, body { margin: 0; }
  body { background: #0e0e0d; color: #ecebe8; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; min-height: 100svh;
    font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-text-size-adjust: 100%; }
  figure { margin: 0; width: 100%; padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
    box-sizing: border-box; }
  video { display: block; width: 100%; height: auto; aspect-ratio: auto 16 / 9;
    max-height: calc(100vh - 72px); max-height: calc(100svh - 72px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    background: #000; object-fit: contain; }
  audio { display: block; width: min(640px, calc(100% - 32px)); margin: 0 auto; }
  figcaption { display: flex; align-items: center; gap: 12px; box-sizing: border-box; min-height: 72px;
    padding: 12px 16px max(12px, env(safe-area-inset-bottom)); }
  .meta { flex: 1; min-width: 0; }
  .name { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .size { display: block; font-size: 13px; color: #a3a29e; }
  a.download { flex: none; padding: 8px 14px; border-radius: 999px; background: #ecebe8;
    color: #161615; text-decoration: none; font-weight: 500; font-size: 14px; }
  @media (min-width: 900px) {
    figure { width: fit-content; max-width: calc(100% - 48px); padding: 24px 0 0; }
    figure.audio { width: 640px; }
    video { width: auto; max-width: 100%; min-width: min(100%, 720px);
      max-height: calc(100vh - 120px); max-height: calc(100svh - 120px); border-radius: 10px; }
    figcaption { padding: 12px 2px 16px; }
  }
</style>
</head>
<body>
<figure class="${kind}">${media}
<figcaption>
  <div class="meta"><span class="name">${title}</span><span class="size">${formatBytes(size)}</span></div>
  <a class="download" href="${escapeHtml(rawPath.replace(/\?raw=1$/, "?download=1"))}" download="${title}">Download</a>
</figcaption>
</figure>
</body>
</html>`;
};

const serveFile = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  slug: string,
  url: URL,
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

  const contentType = bareContentType(head.httpMetadata?.contentType);
  const isMedia = MEDIA_TYPE.test(contentType);
  const name = fileNameOf(head) ?? "file";

  if (isMedia && wantsPlayerPage(request, url)) {
    const rawPath = `${url.pathname}?raw=1`;
    const html = playerPageHtml(
      contentType.startsWith("audio/") ? "audio" : "video",
      name,
      head.size,
      rawPath,
      `${url.origin}${rawPath}`,
      contentType,
    );
    return new Response(request.method === "HEAD" ? null : html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
        "referrer-policy": "no-referrer",
        "cache-control": "public, max-age=60",
        "content-security-policy": PLAYER_CSP,
        vary: "Sec-Fetch-Dest, Accept",
      },
    });
  }

  const headers = new Headers({
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
    "cache-control": "public, max-age=60",
    "content-security-policy": fileCspFor(contentType),
    "accept-ranges": "bytes",
  });
  head.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=60");
  headers.set("x-content-type-options", "nosniff");
  if (isMedia) headers.set("vary", "Sec-Fetch-Dest, Accept");
  if (!INLINE_FILE_TYPE.test(contentType) || url.searchParams.has("download")) {
    const encoded = head.httpMetadata?.contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    headers.set("content-disposition", `attachment${encoded ? `; filename*=UTF-8''${encoded}` : ""}`);
    if (!contentType || /html|svg|xml|javascript/.test(contentType)) {
      headers.set("content-type", "application/octet-stream");
    }
  }
  headers.set("etag", head.httpEtag);
  return rangedObjectResponse(request, env.SHARES_BUCKET, key, head.size, headers);
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
    if (fileSlug) return serveFile(request, env, ctx, fileSlug, url);

    const canvasPath = parseCanvasPath(url.pathname);
    if (!canvasPath) return notFound();
    const { slug } = canvasPath;

    const key = `${KEY_PREFIX}/${slug}.html`;
    if (canvasPath.asset) {
      const page = await env.SHARES_BUCKET.head(key);
      if (!page) return notFound();
      const expiresAt = Number(page.customMetadata?.["expires-at"]);
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return notFound();
      return serveCanvasAsset(request, env, page, slug, canvasPath.asset);
    }
    const object = await env.SHARES_BUCKET.get(key);
    if (!object) return notFound();

    const expiresAtRaw = object.customMetadata?.["expires-at"];
    if (expiresAtRaw) {
      const expiresAt = Number(expiresAtRaw);
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        ctx.waitUntil(env.SHARES_BUCKET.delete(key).catch(() => {}));
        return notFound();
      }
    }

    const isView = object.customMetadata?.kind === VIEW_SHARE_KIND;
    const pagePath = `/c/${slug}${!isView && object.customMetadata?.assets === "1" ? "/" : ""}`;
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
              location: pagePath,
              "set-cookie": `${CANVAS_VIEW_COOKIE}=${view}; Path=/c/; Max-Age=${Math.floor(CANVAS_VIEW_COOKIE_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`,
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            },
          });
        }
        return privatePage(request.method, ownerOpenUrl);
      }
      if (!(await hasOwnerViewCookie(request, secret, owner))) {
        object.body.cancel().catch(() => {});
        return privatePage(request.method, ownerOpenUrl);
      }
    }

    if (isView) return serveView(request, env, object, url, isPrivate);

    if (!canvasPath.slash && pagePath.endsWith("/")) {
      object.body.cancel().catch(() => {});
      return new Response(null, {
        status: 308,
        headers: {
          location: `${pagePath}${url.search}`,
          "cache-control": isPrivate ? "no-store" : "public, max-age=60",
          "referrer-policy": "no-referrer",
        },
      });
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
    const owner = object.customMetadata?.owner;
    const secret = viewSecretOf(env);
    if (isPrivate && pagePath.endsWith("/") && owner && secret) {
      const assetView = await signCanvasViewToken(secret, {
        k: "view",
        o: owner,
        e: Date.now() + CANVAS_VIEW_COOKIE_TTL_MS,
      });
      headers.append(
        "set-cookie",
        `${CANVAS_ASSET_COOKIE}=${assetView}; Path=${pagePath}; Max-Age=${Math.floor(CANVAS_VIEW_COOKIE_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=None`,
      );
    }

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  },
} satisfies ExportedHandler<Env>;
