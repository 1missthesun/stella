import { betterAuthKeys } from "./secret-rotation.js";

export const R2_PROXY_PATH_PREFIX = "/api/r2/";
export const R2_PROXY_MAX_PUT_BYTES = 100 * 1024 * 1024 - 1;

export type R2ProxyBucket = "drive" | "media" | "backup";

export type R2ProxySigner = {
  kind: "proxy";
  origin: string;
  alias: R2ProxyBucket;
  binding: R2Bucket;
  keys: string[];
};

const BINDINGS: Record<R2ProxyBucket, { binding: string; nameVar: string }> = {
  drive: { binding: "DRIVE", nameVar: "R2_DRIVE_BUCKET" },
  media: { binding: "MEDIA", nameVar: "R2_MEDIA_BUCKET" },
  backup: { binding: "BACKUP_BUCKET", nameVar: "R2_BACKUP_BUCKET" },
};

const read = (env: unknown, name: string): string => {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
};

const encoder = new TextEncoder();

const base64url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

const proxyKeys = (env: unknown): string[] => {
  const keys = betterAuthKeys(env);
  return keys ? [keys.current, ...(keys.previous ? [keys.previous] : [])] : [];
};

const sign = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`stella-r2-proxy-v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
};

const payloadOf = (alias: string, key: string, method: string, expires: number, disposition: string): string =>
  [alias, key, method, String(expires), disposition].join("\n");

export const r2ProxySigner = (env: unknown, bucketName: string | undefined): R2ProxySigner | null => {
  const origin = read(env, "CLOUD_BUILDER_PUBLIC_URL").replace(/\/+$/u, "");
  const keys = proxyKeys(env);
  if (!origin || keys.length === 0) return null;
  const name = bucketName?.trim() ?? "";
  for (const [alias, { binding, nameVar }] of Object.entries(BINDINGS) as Array<
    [R2ProxyBucket, (typeof BINDINGS)[R2ProxyBucket]]
  >) {
    if (name !== alias && name !== read(env, nameVar)) continue;
    const bucket = (env as Record<string, unknown>)[binding] as R2Bucket | undefined;
    if (!bucket) return null;
    return { kind: "proxy", origin, alias, binding: bucket, keys };
  }
  return null;
};

const encodeKey = (key: string): string => key.split("/").map((segment) => encodeURIComponent(segment)).join("/");

export const presignR2ProxyUrl = async (
  signer: R2ProxySigner,
  args: { method: "GET" | "PUT"; key: string; expiresInSeconds: number; now?: number; contentDisposition?: string },
): Promise<string> => {
  const expires = Math.floor((args.now ?? Date.now()) / 1000) + args.expiresInSeconds;
  const disposition = args.contentDisposition ?? "";
  const url = new URL(`${signer.origin}${R2_PROXY_PATH_PREFIX}${signer.alias}/${encodeKey(args.key)}`);
  url.searchParams.set("m", args.method);
  url.searchParams.set("e", String(expires));
  if (disposition) url.searchParams.set("d", disposition);
  url.searchParams.set("s", await sign(signer.keys[0]!, payloadOf(signer.alias, args.key, args.method, expires, disposition)));
  return url.toString();
};

export const copyR2ProxyObject = async (signer: R2ProxySigner, args: { from: string; to: string }): Promise<void> => {
  const source = await signer.binding.get(args.from);
  if (!source) throw new Error("R2 copy source is missing.");
  await signer.binding.put(args.to, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: source.customMetadata,
  });
};

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, PUT, OPTIONS",
  "access-control-allow-headers": "content-type, range",
  "access-control-expose-headers": "content-length, content-range, content-type, etag, accept-ranges",
  "access-control-max-age": "600",
};

const problem = (status: number, message: string): Response =>
  new Response(message, { status, headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

const objectHeaders = (object: R2Object, disposition: string): Headers => {
  const headers = new Headers(CORS);
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  if (disposition) headers.set("content-disposition", disposition);
  return headers;
};

const rangeOf = (
  range: R2Range | undefined,
  size: number,
): { offset: number; length: number } | null => {
  if (!range) return null;
  if ("suffix" in range && range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = "offset" in range && range.offset !== undefined ? range.offset : 0;
  const length = "length" in range && range.length !== undefined ? range.length : size - offset;
  return { offset, length: Math.min(length, size - offset) };
};

export const handleR2ProxyRoute = async (request: Request, env: unknown): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(R2_PROXY_PATH_PREFIX)) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const rest = url.pathname.slice(R2_PROXY_PATH_PREFIX.length);
  const slash = rest.indexOf("/");
  const alias = slash > 0 ? rest.slice(0, slash) : "";
  let key: string;
  try {
    key = rest
      .slice(slash + 1)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return problem(400, "Bad key.");
  }
  if (!(alias in BINDINGS) || !key) return problem(404, "Not found.");
  const method = url.searchParams.get("m") ?? "";
  const expires = Number(url.searchParams.get("e"));
  const disposition = url.searchParams.get("d") ?? "";
  const signature = url.searchParams.get("s") ?? "";
  const verb = request.method === "HEAD" ? "GET" : request.method;
  if (verb !== method || (method !== "GET" && method !== "PUT")) return problem(405, "Method not allowed.");
  if (!Number.isSafeInteger(expires) || expires * 1000 < Date.now()) return problem(403, "This link expired.");
  const signer = r2ProxySigner(env, alias);
  if (!signer) return problem(503, "File storage is unavailable.");
  const payload = payloadOf(alias, key, method, expires, disposition);
  let valid = false;
  for (const secret of signer.keys) {
    if (constantTimeEqual(await sign(secret, payload), signature)) valid = true;
  }
  if (!valid) return problem(403, "Invalid link.");

  if (method === "PUT") {
    const length = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(length) || length < 0) return problem(411, "Content-Length is required.");
    if (length > R2_PROXY_MAX_PUT_BYTES) return problem(413, "File too large for this server's storage link.");
    const contentType = request.headers.get("content-type") ?? undefined;
    const stored = await signer.binding.put(key, request.body ?? new Uint8Array(0), {
      ...(contentType ? { httpMetadata: { contentType } } : {}),
    });
    const headers = new Headers(CORS);
    if (stored) headers.set("etag", stored.httpEtag);
    return new Response(null, { status: 200, headers });
  }

  if (request.method === "HEAD") {
    const head = await signer.binding.head(key);
    if (!head) return problem(404, "Not found.");
    const headers = objectHeaders(head, disposition);
    headers.set("content-length", String(head.size));
    return new Response(null, { status: 200, headers });
  }
  const object = await signer.binding.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) return problem(404, "Not found.");
  const headers = objectHeaders(object, disposition);
  if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers });
  const range = request.headers.has("range") ? rangeOf(object.range, object.size) : null;
  if (range) {
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    headers.set("content-length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
};
