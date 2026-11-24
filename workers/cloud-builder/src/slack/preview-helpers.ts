export const KEY_PREFIX = "slack-previews";

export const PREVIEW_CSP = "base-uri 'self'; object-src 'none'; form-action 'self' https:";

export const previewBucket = (env: Cloudflare.Env): R2Bucket => {
  if (!env.APP_BUILDS) throw new Error("The APP_BUILDS binding is missing.");
  return env.APP_BUILDS;
};

export const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export const cleanPath = (raw: string): string | null => {
  const parts: string[] = [];
  for (const part of raw.replace(/\\/gu, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." || part.includes("\0")) return null;
    parts.push(part);
  }
  const path = parts.join("/");
  if (!path || path.length > 900) return null;
  if (parts.some((part) => part === ".git" || part === "node_modules")) return null;
  return path;
};

export const servingHeaders = (object: R2Object, isPublic: boolean, html: boolean): Headers => {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("content-security-policy", PREVIEW_CSP);
  headers.set(
    "cache-control",
    html ? "no-cache" : isPublic ? "public, max-age=300" : "private, max-age=300",
  );
  return headers;
};

export const decodePath = (pathname: string): string | null => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
};
