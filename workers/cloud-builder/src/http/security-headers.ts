const JSON_POLICY = "default-src 'none'; frame-ancestors 'none'";
const PAGE_POLICY = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

const mediaType = (response: Response): string =>
  (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();

const securityHeadersFor = (pathname: string, response: Response): Record<string, string> | null => {
  if (response.status === 101 || response.webSocket) return null;
  if (response.headers.has("content-security-policy") || response.headers.has("x-frame-options")) return null;
  const type = mediaType(response);
  if (type === "application/json" || type.endsWith("+json")) {
    return { "content-security-policy": JSON_POLICY, "x-frame-options": "DENY", "x-content-type-options": "nosniff" };
  }
  const page = type === "text/html" || (type === "" && pathname.startsWith("/api/auth/"));
  if (page && pathname.startsWith("/api/") && !pathname.startsWith("/api/media/")) {
    return { "content-security-policy": PAGE_POLICY, "x-frame-options": "DENY" };
  }
  return null;
};

const isAuthPath = (pathname: string): boolean =>
  pathname.startsWith("/api/auth/") || pathname.startsWith("/api/slack/link");

export const withSecurityHeaders = (request: Request, response: Response): Response => {
  const pathname = new URL(request.url).pathname;
  const changes = securityHeadersFor(pathname, response);
  if (isAuthPath(pathname) && response.status !== 101 && !response.webSocket) {
    // Auth responses carry or lead to credentials: never send a Referer from them, and
    // never let a browser or proxy cache them. The public JWKS stays cacheable.
    const needsReferrer = !response.headers.has("referrer-policy");
    const needsNoStore = !response.headers.has("cache-control") && pathname !== "/api/auth/jwks";
    if (needsReferrer || needsNoStore) {
      const secured = new Response(response.body, response);
      for (const [name, value] of Object.entries(changes ?? {})) secured.headers.set(name, value);
      if (needsReferrer) secured.headers.set("referrer-policy", "no-referrer");
      if (needsNoStore) secured.headers.set("cache-control", "no-store");
      return secured;
    }
  }
  if (!changes) return response;
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(changes)) secured.headers.set(name, value);
  return secured;
};
