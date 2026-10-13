import openNext from "./.open-next/worker.js";

const SHARED_CACHE_ONLY = /^s-maxage=\d+(, stale-while-revalidate=\d+)?$/;
const BROWSER_CACHE = "public, max-age=0, must-revalidate";
const IMAGE_CACHE =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";

const GOOGLE_TAG_SOURCES = [
  "https://www.googletagmanager.com",
  "https://googleads.g.doubleclick.net",
  "https://www.googleadservices.com",
  "https://www.google.com",
];
const GOOGLE_TAG_CONNECT = [
  "https://www.googletagmanager.com",
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://www.google.com",
  "https://*.doubleclick.net",
  "https://www.googleadservices.com",
];
const GOOGLE_TAG_FRAMES = [
  "https://www.googletagmanager.com",
  "https://td.doubleclick.net",
  "https://*.doubleclick.net",
  "https://www.google.com",
];
const TURNSTILE = "https://challenges.cloudflare.com";
const CLOUDFLARE_INSIGHTS_SCRIPT = "https://static.cloudflareinsights.com";
const CLOUDFLARE_INSIGHTS_CONNECT = "https://cloudflareinsights.com";
const GOOGLE_MAPS = {
  script: [
    "https://maps.googleapis.com",
    "https://*.googleapis.com",
    "https://*.gstatic.com",
    "https://*.google.com",
    "https://*.ggpht.com",
    "https://*.googleusercontent.com",
  ],
  connect: ["https://*.googleapis.com", "https://*.google.com", "https://*.gstatic.com"],
  frame: ["https://*.google.com"],
};
const DESKTOP_RENDERER = "stella-app:";

const backendOrigins = (env) =>
  String(env?.CSP_BACKEND_ORIGINS ?? "")
    .split(/\s+/)
    .filter((value) => /^https:\/\/[a-z0-9.-]+$/i.test(value));

const policy = (directives) =>
  Object.entries(directives)
    .map(([name, sources]) => (sources.length ? `${name} ${sources.join(" ")}` : name))
    .join("; ");

const sitePolicy = (env, frameAncestors) => {
  const backends = backendOrigins(env);
  return policy({
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...GOOGLE_TAG_SOURCES, CLOUDFLARE_INSIGHTS_SCRIPT, TURNSTILE],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "media-src": ["'self'", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...backends,
      ...backends.map((origin) => origin.replace(/^https:/, "wss:")),
      ...GOOGLE_TAG_CONNECT,
      CLOUDFLARE_INSIGHTS_CONNECT,
      TURNSTILE,
    ],
    "frame-src": ["'self'", TURNSTILE, ...GOOGLE_TAG_FRAMES],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...backends],
    "frame-ancestors": frameAncestors,
  });
};

const mapsEmbedPolicy = () =>
  policy({
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", ...GOOGLE_MAPS.script, ...GOOGLE_TAG_SOURCES, CLOUDFLARE_INSIGHTS_SCRIPT],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "connect-src": ["'self'", "data:", "blob:", ...GOOGLE_MAPS.connect, ...GOOGLE_TAG_CONNECT, CLOUDFLARE_INSIGHTS_CONNECT],
    "frame-src": [...GOOGLE_MAPS.frame, ...GOOGLE_TAG_FRAMES],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'", DESKTOP_RENDERER],
  });

const chatShellPolicy = () =>
  policy({
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...GOOGLE_TAG_SOURCES, CLOUDFLARE_INSIGHTS_SCRIPT],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...GOOGLE_TAG_CONNECT, CLOUDFLARE_INSIGHTS_CONNECT],
    "frame-src": ["'self'", ...GOOGLE_TAG_FRAMES],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
  });

const chatAppPolicy = () =>
  policy({
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://js.stripe.com", TURNSTILE, CLOUDFLARE_INSIGHTS_SCRIPT],
    "worker-src": ["'self'", "blob:"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "http:", "https:"],
    "media-src": ["'self'", "blob:", "data:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", "http:", "https:", "ws:", "wss:"],
    "frame-src": ["'self'", "http:", "https:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
  });

const securityHeaders = (pathname, env) => {
  if (pathname === "/maps/embed" || pathname.startsWith("/maps/embed/")) {
    return { "Content-Security-Policy": mapsEmbedPolicy() };
  }
  if (pathname === "/chat" || pathname === "/chat/") {
    return { "Content-Security-Policy": chatShellPolicy(), "X-Frame-Options": "SAMEORIGIN" };
  }
  if (pathname === "/chat-app" || pathname.startsWith("/chat-app/")) {
    return { "Content-Security-Policy": chatAppPolicy(), "X-Frame-Options": "SAMEORIGIN" };
  }
  if (pathname === "/challenge" || pathname.startsWith("/challenge/")) {
    return { "Content-Security-Policy": sitePolicy(env, ["'none'"]), "X-Frame-Options": "DENY" };
  }
  return { "Content-Security-Policy": sitePolicy(env, ["'self'"]), "X-Frame-Options": "SAMEORIGIN" };
};

const withHeaders = (response, changes, removals = []) => {
  const headers = new Headers(response.headers);
  for (const name of removals) headers.delete(name);
  for (const [name, value] of Object.entries(changes)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const imageCacheKey = (request) => {
  const accept = request.headers.get("Accept") ?? "";
  const format = accept.includes("image/avif")
    ? "avif"
    : accept.includes("image/webp")
      ? "webp"
      : "original";
  const url = new URL(request.url);
  url.searchParams.set("_format", format);
  return new Request(url.toString(), { method: "GET" });
};

const optimizedImage = async (request, env, ctx) => {
  const cache = caches.default;
  const key = imageCacheKey(request);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await openNext.fetch(request, env, ctx);
  if (response.status !== 200 || response.headers.has("Cache-Control")) {
    return response;
  }
  const cacheable = withHeaders(response, { "Cache-Control": IMAGE_CACHE });
  ctx.waitUntil(cache.put(key, cacheable.clone()));
  return cacheable;
};

const worker = {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/_next/image") {
      return optimizedImage(request, env, ctx);
    }
    const response = await openNext.fetch(request, env, ctx);
    if (response.status === 101) return response;
    const changes = securityHeaders(pathname, env);
    const cacheControl = response.headers.get("Cache-Control");
    if (!cacheControl || SHARED_CACHE_ONLY.test(cacheControl)) {
      changes["Cache-Control"] = BROWSER_CACHE;
    }
    if (
      pathname.startsWith("/chat-app/") &&
      !response.headers.has("X-Content-Type-Options")
    ) {
      changes["X-Content-Type-Options"] = "nosniff";
    }
    return withHeaders(response, changes, ["X-Powered-By"]);
  },
};

export default worker;
