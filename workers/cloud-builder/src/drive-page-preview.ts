import { canvasPolicyDirectives } from "@stella/contracts/canvas-host";
import {
  PAGE_PREVIEW_CONTENT_TYPE,
  PAGE_PREVIEW_JPEG_QUALITY,
  PAGE_PREVIEW_LAYOUTS,
  PAGE_PREVIEW_MAX_BYTES,
  PAGE_PREVIEW_SOURCE_MAX_BYTES,
  type PagePreviewShape,
} from "@stella/contracts/page-preview";
import { meteredCapture } from "./browser-billing.js";
import { builderServiceSecret, builderServiceSecrets } from "./secret-rotation.js";

type PagePreviewEnv = Cloudflare.Env;

export type RenderedPagePreview =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; reason: "unavailable" | "budget"; message: string };

const PAGE_TOKEN_TTL_MS = 2 * 60_000;
const CAPTURE_TIMEOUT_MS = 45_000;
const PAGE_ROUTE = /^\/drive-pages\/([A-Za-z0-9_-]{1,2048})\.([A-Za-z0-9_-]{43})\/page\.html$/;

const PAGE_CSP = ["sandbox allow-scripts", ...canvasPolicyDirectives({ self: false })].join("; ");

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0),
  );

const signingKey = (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(`stella.drive-page.v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const mintPageUrl = async (env: PagePreviewEnv, r2Key: string): Promise<string> => {
  const payload = base64Url(
    encoder.encode(JSON.stringify({ k: r2Key, e: Date.now() + PAGE_TOKEN_TTL_MS })),
  );
  const signature = base64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await signingKey(builderServiceSecret(env)),
        encoder.encode(payload),
      ),
    ),
  );
  const origin = String(env.CLOUD_BUILDER_PUBLIC_URL).replace(/\/+$/, "");
  return `${origin}/drive-pages/${payload}.${signature}/page.html`;
};

const verifiedKey = async (env: PagePreviewEnv, pathname: string): Promise<string | null> => {
  const match = PAGE_ROUTE.exec(pathname);
  if (!match) return null;
  const [, payload, signature] = match as unknown as [string, string, string];
  let verified = false;
  for (const secret of builderServiceSecrets(env)) {
    if (
      await crypto.subtle.verify(
        "HMAC",
        await signingKey(secret),
        fromBase64(signature),
        encoder.encode(payload),
      )
    ) {
      verified = true;
      break;
    }
  }
  if (!verified) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64(payload))) as {
      k?: unknown;
      e?: unknown;
    };
    const now = Date.now();
    if (
      typeof claims.k !== "string" ||
      !claims.k.startsWith("drive/") ||
      typeof claims.e !== "number" ||
      claims.e <= now ||
      claims.e > now + PAGE_TOKEN_TTL_MS
    ) {
      return null;
    }
    return claims.k;
  } catch {
    return null;
  }
};

const pageHeaders = (contentType: string): Headers =>
  new Headers({
    "content-type": contentType,
    "content-security-policy": PAGE_CSP,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex",
  });

export const serveDrivePage = async (request: Request, env: PagePreviewEnv): Promise<Response> => {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: pageHeaders("text/plain") });
  }
  const key = await verifiedKey(env, new URL(request.url).pathname);
  if (!key || !env.DRIVE) {
    return new Response("Not found", { status: 404, headers: pageHeaders("text/plain") });
  }
  const object = await env.DRIVE.get(key);
  if (!object) return new Response("Not found", { status: 404, headers: pageHeaders("text/plain") });
  if (object.size > PAGE_PREVIEW_SOURCE_MAX_BYTES) {
    await object.body.cancel().catch(() => undefined);
    return new Response("Too large", { status: 413, headers: pageHeaders("text/plain") });
  }
  return new Response(object.body, { headers: pageHeaders("text/html; charset=utf-8") });
};

const shotBytes = async (response: Response): Promise<Uint8Array | null> => {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const body = (await response.json().catch(() => null)) as {
    shots?: Array<{ data?: unknown }>;
  } | null;
  const data = body?.shots?.[0]?.data;
  return typeof data === "string" && data.length > 0 ? fromBase64(data) : null;
};

const fitShot = async (
  env: PagePreviewEnv,
  png: Uint8Array,
  image: { width: number; height: number },
): Promise<{ bytes: Uint8Array; contentType: string }> => {
  if (!env.IMAGES) return { bytes: png, contentType: "image/png" };
  try {
    const result = await env.IMAGES.input(new Response(png).body as ReadableStream<Uint8Array>)
      .transform({ width: image.width, height: image.height, fit: "cover" })
      .output({ format: PAGE_PREVIEW_CONTENT_TYPE, quality: PAGE_PREVIEW_JPEG_QUALITY });
    const bytes = new Uint8Array(await result.response().arrayBuffer());
    if (bytes.byteLength > 0) return { bytes, contentType: PAGE_PREVIEW_CONTENT_TYPE };
  } catch {}
  return { bytes: png, contentType: "image/png" };
};

export const renderDrivePagePreview = async (
  env: PagePreviewEnv,
  ownerId: string,
  r2Key: string,
  shape: PagePreviewShape,
): Promise<RenderedPagePreview> => {
  const layout = PAGE_PREVIEW_LAYOUTS[shape];
  const gateway = env.BROWSER_GATEWAY;
  const unavailable = {
    ok: false as const,
    reason: "unavailable" as const,
    message: "Page previews are unavailable right now.",
  };
  if (!gateway || !env.CLOUD_BUILDER_PUBLIC_URL) return unavailable;
  const url = await mintPageUrl(env, r2Key);
  let metered: Awaited<ReturnType<typeof meteredCapture>>;
  try {
    metered = await meteredCapture(env, ownerId, "browser-page-preview", () =>
      gateway.fetch("https://browser-gateway/internal/sites/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          views: [{ name: "preview", ...layout.viewport, scale: layout.scale }],
        }),
        signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
      }),
    );
  } catch {
    return unavailable;
  }
  if (!metered.ok) return { ok: false, reason: "budget", message: metered.message };
  const png = await shotBytes(metered.response);
  if (!png) return unavailable;
  const fitted = await fitShot(env, png, layout.image);
  const limit = PAGE_PREVIEW_MAX_BYTES * (fitted.contentType === "image/png" ? 4 : 1);
  if (fitted.bytes.byteLength > limit) return unavailable;
  return { ok: true, ...fitted };
};
