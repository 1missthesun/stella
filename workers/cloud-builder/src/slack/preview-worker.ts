/**
 * Stella previews of Worker apps: a server-rendered app (TanStack Start,
 * Astro, Remix, Hono… on Cloudflare Workers) runs here as a Dynamic Worker
 * (`LOADER`), never on the client's Cloudflare account.
 *
 * `stella-publish` builds the app in the agent's container and uploads its
 * server modules (`stella-worker.json`), its static files (`assets/`) and a
 * snapshot of each D1 database's schema and rows (`d1/<binding>.json`,
 * from the container's local database or the repository's migrations).
 * Requests for a file in `assets/` are served from R2; everything else goes
 * to the app's own `fetch`.
 *
 * The app sees only what this module gives it:
 *  - its plain `vars` (never secrets: the client's secrets stay theirs);
 *  - per-preview stand-ins for D1 (a SQLite Durable Object per database,
 *    seeded from the snapshot), KV (the same object's storage) and R2
 *    (a prefix of APP_BUILDS with a size cap), so writes stay in the preview;
 *  - its ASSETS binding (the uploaded files);
 *  - email, queues and Durable Object namespaces that do nothing (or say
 *    they aren't available), so a preview never sends mail or runs jobs.
 * Service bindings, AI, Hyperdrive and the rest are left out, so an app
 * falls back the way it does in local development. Its outbound fetches may
 * reach the public internet, but none of Stella's own hosts. It runs on the
 * preview's own stellasites.app origin and never sees Stella's cookies.
 */

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { KEY_PREFIX, cleanPath, extensionOf, previewBucket, servingHeaders, decodePath } from "./previews.js";

export const WORKER_MANIFEST = "stella-worker.json";
export const WORKER_CODE = "stella-worker-code.json";
export const ASSETS_DIR = "assets/";
const D1_DIR = "d1/";
const DATA_DIR = "__data/";
const MB = 1024 * 1024;
const R2_LIMIT_BYTES = 50 * MB;
const R2_LIMIT_OBJECTS = 2_000;
const KV_VALUE_LIMIT = 2 * MB;
const RESERVED_COOKIES = ["__Host-stella_preview_view", "__Host-stella_preview_site"];

type ModuleSpec = { js?: string; cjs?: string; text?: string; json?: unknown; data64?: string; wasm64?: string };

export type WorkerManifest = {
  version: 1;
  main: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
  /** The host the app is shown requests on (it never sees the preview's own); `localhost` unless set. */
  host: string;
  vars: Record<string, unknown>;
  bindings: {
    assets: string | null;
    d1: string[];
    kv: string[];
    r2: string[];
    durableObjects: string[];
    email: string[];
    queues: string[];
  };
  assets: {
    htmlHandling: "auto-trailing-slash" | "force-trailing-slash" | "drop-trailing-slash" | "none";
    notFoundHandling: "none" | "single-page-application" | "404-page";
    runWorkerFirst: boolean | string[];
  };
};

const NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/u;
const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && NAME.test(item)).slice(0, 32) : [];

/** A manifest from the upload, or a reason it can't run. */
export const parseWorkerManifest = (raw: unknown): WorkerManifest | string => {
  if (!raw || typeof raw !== "object") return "stella-worker.json isn't valid JSON.";
  const value = raw as Record<string, unknown>;
  if (typeof value.main !== "string" || !cleanPath(value.main)) return "stella-worker.json names no main module.";
  const date = typeof value.compatibilityDate === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value.compatibilityDate)
    ? value.compatibilityDate
    : "2025-09-01";
  const bindings = (value.bindings && typeof value.bindings === "object" ? value.bindings : {}) as Record<string, unknown>;
  const assets = (value.assets && typeof value.assets === "object" ? value.assets : {}) as Record<string, unknown>;
  const html = assets.htmlHandling;
  const notFound = assets.notFoundHandling;
  const vars: Record<string, unknown> = {};
  if (value.vars && typeof value.vars === "object") {
    for (const [key, item] of Object.entries(value.vars as Record<string, unknown>)) {
      if (NAME.test(key) && !key.startsWith("__STELLA")) vars[key] = item;
    }
  }
  return {
    version: 1,
    main: value.main,
    compatibilityDate: date,
    compatibilityFlags: Array.isArray(value.compatibilityFlags)
      ? value.compatibilityFlags.filter((flag): flag is string => typeof flag === "string" && /^[a-z0-9_]+$/u.test(flag)).slice(0, 32)
      : [],
    host:
      typeof value.host === "string" && /^[a-z0-9.-]{1,253}$/u.test(value.host.toLowerCase())
        ? value.host.toLowerCase()
        : "localhost",
    vars,
    bindings: {
      assets: typeof bindings.assets === "string" && NAME.test(bindings.assets) ? bindings.assets : null,
      d1: names(bindings.d1),
      kv: names(bindings.kv),
      r2: names(bindings.r2),
      durableObjects: names(bindings.durableObjects),
      email: names(bindings.email),
      queues: names(bindings.queues),
    },
    assets: {
      htmlHandling:
        html === "force-trailing-slash" || html === "drop-trailing-slash" || html === "none" ? html : "auto-trailing-slash",
      notFoundHandling: notFound === "single-page-application" || notFound === "404-page" ? notFound : "none",
      runWorkerFirst:
        assets.runWorkerFirst === true
          ? true
          : Array.isArray(assets.runWorkerFirst)
            ? assets.runWorkerFirst.filter((item): item is string => typeof item === "string").slice(0, 50)
            : false,
    },
  };
};

// ── The app's environment, inside its isolate ─────────────────────────────

/**
 * Runs before the app's own modules: puts the stand-in bindings on the env
 * (the object `cloudflare:workers` exports and every handler receives).
 */
const ENV_MODULE = String.raw`import { env } from "cloudflare:workers";
const host = env.__STELLA_PREVIEW;
const spec = JSON.parse(env.__STELLA_BINDINGS || "{}");
delete env.__STELLA_BINDINGS;
const fail = (message) => { throw new Error(message); };
const norm = (value) => {
  if (value === undefined) fail("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return value;
};
const d1Error = (error) => new Error(String(error && error.message || error).startsWith("D1_") ? String(error.message) : "D1_ERROR: " + String(error && error.message || error));
const toObjects = (out) => out.rows.map((row) => { const item = {}; out.columns.forEach((column, i) => { item[column] = row[i]; }); return item; });
class Statement {
  constructor(db, sql, params) { this.db = db; this.sql = sql; this.params = params || []; }
  bind(...values) { return new Statement(this.db, this.sql, values.map(norm)); }
  async first(column) {
    const [out] = await this.db.__run([this]);
    const row = toObjects(out)[0];
    if (!row) return null;
    if (column === undefined) return row;
    if (!(column in row)) fail("D1_COLUMN_NOTFOUND: Column not found (" + column + ")");
    return row[column];
  }
  async all() { const [out] = await this.db.__run([this]); return { results: toObjects(out), success: true, meta: out.meta }; }
  async run() { return await this.all(); }
  async raw(options) { const [out] = await this.db.__run([this]); return options && options.columnNames ? [out.columns, ...out.rows] : out.rows; }
}
class Database {
  constructor(name) { this.name = name; }
  prepare(sql) { return new Statement(this, String(sql), []); }
  async __run(statements) {
    try { return await host.d1(this.name, statements.map((s) => ({ sql: s.sql, params: s.params }))); }
    catch (error) { throw d1Error(error); }
  }
  async batch(statements) {
    const outs = await this.__run(statements);
    return outs.map((out) => ({ results: toObjects(out), success: true, meta: out.meta }));
  }
  async exec(query) {
    try { return await host.d1Exec(this.name, String(query)); } catch (error) { throw d1Error(error); }
  }
  withSession() { return Object.assign(Object.create(this), { getBookmark: () => null }); }
  async dump() { fail("D1 dump isn't available in Stella previews."); }
}
const bytesOf = async (value) => {
  if (value === null || value === undefined) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  return new TextEncoder().encode(String(value));
};
const typed = (bytes, type) => {
  if (bytes === null) return null;
  const kind = typeof type === "string" ? type : (type && type.type) || "text";
  if (kind === "arrayBuffer") return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (kind === "stream") return new Response(bytes).body;
  const text = new TextDecoder().decode(bytes);
  return kind === "json" ? JSON.parse(text) : text;
};
class KV {
  constructor(name) { this.name = name; }
  async get(key, type) {
    if (Array.isArray(key)) { const map = new Map(); for (const k of key) map.set(k, await this.get(k, type)); return map; }
    const out = await host.kvGet(this.name, String(key));
    return out ? typed(out.value, type) : null;
  }
  async getWithMetadata(key, type) {
    const out = await host.kvGet(this.name, String(key));
    return out ? { value: typed(out.value, type), metadata: out.metadata, cacheStatus: null } : { value: null, metadata: null, cacheStatus: null };
  }
  async put(key, value, options) {
    const opts = options || {};
    const expires = opts.expiration ? opts.expiration * 1000 : opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    await host.kvPut(this.name, String(key), await bytesOf(value), opts.metadata === undefined ? null : JSON.stringify(opts.metadata), expires);
  }
  async delete(key) { await host.kvDelete(this.name, String(key)); }
  async list(options) { return await host.kvList(this.name, options || {}); }
}
const r2Object = (meta, bytes) => {
  if (!meta) return null;
  const object = {
    key: meta.key, version: meta.etag, size: meta.size, etag: meta.etag, httpEtag: '"' + meta.etag + '"',
    uploaded: new Date(meta.uploaded), httpMetadata: meta.httpMetadata || {}, customMetadata: meta.customMetadata || {},
    checksums: {}, storageClass: "Standard", range: undefined,
    writeHttpMetadata(headers) { for (const [k, v] of Object.entries(this.httpMetadata)) { const name = k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()); if (typeof v === "string") headers.set(name, v); } },
  };
  if (bytes) {
    object.body = new Response(bytes).body;
    object.bodyUsed = false;
    object.arrayBuffer = async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    object.bytes = async () => bytes;
    object.text = async () => new TextDecoder().decode(bytes);
    object.json = async () => JSON.parse(new TextDecoder().decode(bytes));
    object.blob = async () => new Blob([bytes]);
  }
  return object;
};
class Bucket {
  constructor(name) { this.name = name; }
  async head(key) { return r2Object(await host.r2Head(this.name, String(key)), null); }
  async get(key) { const out = await host.r2Get(this.name, String(key)); return out ? r2Object(out.meta, out.bytes) : null; }
  async put(key, value, options) {
    const opts = options || {};
    let http = opts.httpMetadata || {};
    if (http instanceof Headers) { const h = http; http = {}; for (const [k, v] of h) http[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; }
    return r2Object(await host.r2Put(this.name, String(key), await bytesOf(value), http, opts.customMetadata || {}), null);
  }
  async delete(keys) { await host.r2Delete(this.name, Array.isArray(keys) ? keys.map(String) : [String(keys)]); }
  async list(options) {
    const out = await host.r2List(this.name, options || {});
    return { ...out, objects: out.objects.map((meta) => r2Object(meta, null)) };
  }
  async createMultipartUpload() { fail("R2 multipart uploads aren't available in Stella previews."); }
}
const namespace = (name) => {
  const nope = () => Promise.reject(new Error(name + ": Durable Objects don't run in Stella previews."));
  const stub = new Proxy({}, { get: (_t, prop) => (prop === "then" ? undefined : prop === "id" ? id : prop === "name" ? undefined : nope) });
  const id = { toString: () => "0".repeat(64), equals: () => true, name: undefined };
  const ns = { idFromName: () => id, idFromString: () => id, newUniqueId: () => id, get: () => stub, getByName: () => stub, jurisdiction: () => ns };
  return ns;
};
for (const name of spec.d1 || []) env[name] = new Database(name);
for (const name of spec.kv || []) env[name] = new KV(name);
for (const name of spec.r2 || []) env[name] = new Bucket(name);
for (const name of spec.durableObjects || []) env[name] = namespace(name);
for (const name of spec.email || []) env[name] = { send: async () => { console.log("[stella preview] " + name + ": email isn't sent from previews"); } };
for (const name of spec.queues || []) env[name] = { send: async () => {}, sendBatch: async () => {} };
`;

const mainModule = (main: string): string =>
  `import "./__stella_env.js";\nexport * from ${JSON.stringify(`./${main}`)};\nexport { default } from ${JSON.stringify(`./${main}`)};\n`;

const fromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/** The app's modules, for its isolate; read only when the loader starts one. */
const loadModules = async (env: Cloudflare.Env, id: string, manifest: WorkerManifest): Promise<Record<string, WorkerLoaderModule | string>> => {
  const object = await previewBucket(env).get(`${KEY_PREFIX}/${id}/${WORKER_CODE}`);
  if (!object) throw new Error("The preview's server code is missing.");
  const code = (await object.json()) as { modules?: Record<string, ModuleSpec> };
  const specs = code.modules && typeof code.modules === "object" ? code.modules : {};
  if (!specs[manifest.main]) throw new Error(`The preview's server code has no ${manifest.main}.`);
  const modules: Record<string, WorkerLoaderModule | string> = {};
  for (const [name, spec] of Object.entries(specs)) {
    if (!cleanPath(name) || name.startsWith("__stella")) continue;
    if (typeof spec.js === "string") modules[name] = { js: spec.js };
    else if (typeof spec.cjs === "string") modules[name] = { cjs: spec.cjs };
    else if (typeof spec.text === "string") modules[name] = { text: spec.text };
    else if (spec.json !== undefined) modules[name] = { json: spec.json };
    else if (typeof spec.data64 === "string") modules[name] = { data: fromBase64(spec.data64).buffer as ArrayBuffer };
    else if (typeof spec.wasm64 === "string") modules[name] = { wasm: fromBase64(spec.wasm64) };
  }
  modules["__stella_env.js"] = { js: ENV_MODULE };
  modules["__stella_main.js"] = { js: mainModule(manifest.main) };
  return modules;
};

// ── Serving ───────────────────────────────────────────────────────────────

type Exports = {
  SlackPreviewBindings: (options: { props: BindingProps }) => Fetcher;
  SlackPreviewAssets: (options: { props: AssetProps }) => Fetcher;
  SlackPreviewOutbound: (options: { props: OutboundProps }) => Fetcher;
};

type BindingProps = { id: string };
type AssetProps = { id: string; notFound: WorkerManifest["assets"]["notFoundHandling"] };
type OutboundProps = { id: string; blocked: string[]; appHost: string; previewOrigin: string };

const manifests = new Map<string, WorkerManifest>();

const loadManifest = async (env: Cloudflare.Env, id: string): Promise<WorkerManifest> => {
  const cached = manifests.get(id);
  if (cached) return cached;
  const object = await previewBucket(env).get(`${KEY_PREFIX}/${id}/${WORKER_MANIFEST}`);
  if (!object) throw new Error("The preview's server code is missing.");
  const parsed = parseWorkerManifest(await object.json());
  if (typeof parsed === "string") throw new Error(parsed);
  if (manifests.size > 20) manifests.delete(manifests.keys().next().value!);
  manifests.set(id, parsed);
  return parsed;
};

/** Hosts a preview's code may not reach: Stella's own. */
const blockedHosts = (env: Cloudflare.Env): string[] => {
  const hosts = new Set(["stella.sh", "fromyou.workers.dev", "stellasites.app", "fromyou.ai"]);
  for (const name of ["CLOUD_BUILDER_PUBLIC_URL", "SLACK_PUBLIC_ORIGIN", "SITES_SHARED_ORIGIN"]) {
    const value = (env as unknown as Record<string, unknown>)[name];
    if (typeof value === "string" && value) {
      try {
        hosts.add(new URL(value).hostname.toLowerCase());
      } catch {}
    }
  }
  return [...hosts];
};

/**
 * Requests reach the app as if on its own host (`https://localhost`, the host
 * every app accepts in development, unless the project names another), so
 * host checks, origin checks and absolute links work; responses are mapped
 * back to the preview's origin.
 */
type Origins = { app: string; preview: string };

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const appOriginPattern = (origins: Origins): RegExp => {
  const host = escapeRegex(new URL(origins.app).hostname);
  return new RegExp(`(?:https?:)?(?:\\\\?/){2}${host}(?::\\d+)?(?=[/"'?#\\\\\\s<)]|$)`, "gu");
};

const toApp = (request: Request, origins: Origins): Request => {
  const url = new URL(request.url);
  const target = new URL(`${url.pathname}${url.search}`, origins.app);
  const headers = new Headers(request.headers);
  const cookie = headers.get("cookie");
  if (cookie) {
    const kept = cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !RESERVED_COOKIES.some((name) => part.startsWith(`${name}=`)));
    if (kept.length) headers.set("cookie", kept.join("; "));
    else headers.delete("cookie");
  }
  for (const name of ["origin", "referer"]) {
    const value = headers.get(name);
    if (value && value.startsWith(origins.preview)) headers.set(name, origins.app + value.slice(origins.preview.length));
  }
  headers.set("x-forwarded-host", new URL(origins.preview).host);
  headers.set("x-forwarded-proto", "https");
  return new Request(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
    redirect: "manual",
  });
};

const REWRITE_TYPES = /^(text\/html|application\/json|text\/x-component|application\/javascript|text\/javascript|text\/plain)/u;

/** Swap the app's origin for the preview's in a text stream, chunk by chunk. */
const rewriteStream = (body: ReadableStream<Uint8Array>, origins: Origins): ReadableStream<Uint8Array> => {
  const pattern = appOriginPattern(origins);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const KEEP = 80;
  let carry = "";
  const emit = (text: string, upTo: number): string => {
    let out = "";
    let at = 0;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (match.index + match[0].length > upTo) break;
      out += text.slice(at, match.index) + origins.preview;
      at = match.index + match[0].length;
    }
    if (upTo < text.length) {
      pattern.lastIndex = 0;
      let cut = upTo;
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        if (match.index < upTo && match.index + match[0].length > upTo) cut = Math.min(cut, match.index);
      }
      cut = Math.max(cut, at);
      carry = text.slice(cut);
      return out + text.slice(at, cut);
    }
    carry = "";
    return out + text.slice(at);
  };
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = carry + decoder.decode(chunk, { stream: true });
        const ready = emit(text, Math.max(0, text.length - KEEP));
        if (ready) controller.enqueue(encoder.encode(ready));
      },
      flush(controller) {
        const text = carry + decoder.decode();
        const rest = emit(text, text.length);
        if (rest) controller.enqueue(encoder.encode(rest));
      },
    }),
  );
};

const fromApp = (response: Response, origins: Origins): Response => {
  const type = response.headers.get("content-type") ?? "";
  const rewrite = Boolean(response.body) && REWRITE_TYPES.test(type) && !response.headers.get("content-encoding");
  const out = new Response(rewrite ? rewriteStream(response.body!, origins) : response.body, response);
  if (rewrite) out.headers.delete("content-length");
  const location = out.headers.get("location");
  if (location) out.headers.set("location", location.replace(appOriginPattern(origins), origins.preview));
  const cookies = out.headers.getSetCookie();
  if (cookies.length) {
    out.headers.delete("set-cookie");
    for (const cookie of cookies) {
      if (RESERVED_COOKIES.some((name) => cookie.trim().startsWith(`${name}=`))) continue;
      out.headers.append("set-cookie", cookie.replace(/;\s*domain=[^;]*/giu, ""));
    }
  }
  out.headers.set("x-robots-tag", "noindex, nofollow");
  return out;
};

const matchesRule = (pattern: string, pathname: string): boolean => {
  const negated = pattern.startsWith("!");
  const body = negated ? pattern.slice(1) : pattern;
  const regex = new RegExp(`^${body.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*")}$`, "u");
  return regex.test(pathname);
};

const workerFirst = (manifest: WorkerManifest, pathname: string): boolean => {
  const rule = manifest.assets.runWorkerFirst;
  if (rule === true) return true;
  if (!Array.isArray(rule) || rule.length === 0) return false;
  let first = false;
  for (const pattern of rule) {
    if (pattern.startsWith("!")) {
      if (matchesRule(pattern, pathname)) return false;
    } else if (matchesRule(pattern, pathname)) first = true;
  }
  return first;
};

/** A file of the preview's static assets for this path, or null. */
export const findAsset = async (
  env: Cloudflare.Env,
  id: string,
  request: Request,
  isPublic: boolean,
): Promise<Response | null> => {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const decoded = decodePath(new URL(request.url).pathname);
  if (decoded === null) return null;
  const prefix = `${KEY_PREFIX}/${id}/${ASSETS_DIR}`;
  const candidates: string[] = [];
  const trimmed = decoded.replace(/\/+$/u, "");
  if (decoded.endsWith("/")) candidates.push(`${trimmed}/index.html`, `${trimmed}.html`);
  else {
    candidates.push(decoded);
    if (!extensionOf(decoded)) candidates.push(`${decoded}.html`, `${decoded}/index.html`);
  }
  for (const candidate of candidates) {
    const path = cleanPath(candidate || "index.html");
    if (!path || path.startsWith("_worker") || path === "_headers" || path === "_redirects" || path === ".assetsignore") continue;
    const object = await previewBucket(env).get(`${prefix}${path}`, { onlyIf: request.headers });
    if (!object) continue;
    const html = (object.httpMetadata?.contentType ?? "").startsWith("text/html");
    const headers = servingHeaders(object, isPublic, html);
    headers.delete("content-security-policy");
    if (!("body" in object)) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  }
  return null;
};

const errorPage = (status: number, message: string): Response =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview error</title><body style="font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:12vh auto;padding:0 20px;color:#1f1f1d"><h1 style="font-size:20px">This preview couldn't run</h1><p>The app's server code failed in Stella's preview:</p><pre style="white-space:pre-wrap;background:#f3f2ee;padding:12px;border-radius:8px">${message.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`)}</pre></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } },
  );

/** Serve one request of a Worker preview: its static files, else its own code. */
export const serveWorkerPreview = async (
  request: Request,
  env: Cloudflare.Env,
  exports: unknown,
  id: string,
  isPublic: boolean,
): Promise<Response> => {
  let manifest: WorkerManifest;
  try {
    manifest = await loadManifest(env, id);
  } catch (error) {
    return errorPage(502, error instanceof Error ? error.message : String(error));
  }
  const pathname = new URL(request.url).pathname;
  if (!workerFirst(manifest, pathname)) {
    const asset = await findAsset(env, id, request, isPublic);
    if (asset) return asset;
  }
  if (!env.LOADER) return errorPage(503, "Worker previews aren't available on this deployment.");
  const origins = { app: `https://${manifest.host}`, preview: new URL(request.url).origin };
  try {
    const response = await previewWorker(env, exports as Exports, id, origins).getEntrypoint().fetch(toApp(request, origins));
    return fromApp(response, origins);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "slack_preview_worker_failed",
        id,
        message: error instanceof Error ? error.message.slice(0, 300) : String(error),
      }),
    );
    return errorPage(502, error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error));
  }
};

/** The preview's app in its own isolate (one per preview, kept warm by the loader). */
const previewWorker = (env: Cloudflare.Env, bound: Exports, id: string, origins: Origins) =>
  env.LOADER.get(`slack-preview:${id}`, async () => {
    const loaded = await loadManifest(env, id);
    const appEnv: Record<string, unknown> = {
      ...loaded.vars,
      __STELLA_PREVIEW: bound.SlackPreviewBindings({ props: { id } }),
      __STELLA_BINDINGS: JSON.stringify(loaded.bindings),
    };
    if (loaded.bindings.assets) {
      appEnv[loaded.bindings.assets] = bound.SlackPreviewAssets({ props: { id, notFound: loaded.assets.notFoundHandling } });
    }
    return {
      compatibilityDate: loaded.compatibilityDate,
      compatibilityFlags: loaded.compatibilityFlags,
      mainModule: "__stella_main.js",
      modules: await loadModules(env, id, loaded),
      env: appEnv,
      globalOutbound: bound.SlackPreviewOutbound({
        props: { id, blocked: blockedHosts(env), appHost: new URL(origins.app).hostname, previewOrigin: origins.preview },
      }),
      limits: { cpuMs: 30_000, subRequests: 1_000 },
    };
  });

// ── The stand-in bindings, on Stella's side ───────────────────────────────

type Statement = { sql: string; params: unknown[] };
type StatementResult = {
  columns: string[];
  rows: unknown[][];
  meta: Record<string, unknown>;
};

/** Delete a preview's D1, KV and R2-cap objects (its R2 files go with its prefix). */
export const destroyPreviewData = async (env: Cloudflare.Env, id: string): Promise<void> => {
  const object = await previewBucket(env).get(`${KEY_PREFIX}/${id}/${WORKER_MANIFEST}`);
  if (!object) return;
  const parsed = parseWorkerManifest(await object.json().catch(() => null));
  if (typeof parsed === "string") return;
  const scopes = [
    ...parsed.bindings.d1.map((name) => `d1:${name}`),
    ...parsed.bindings.kv.map((name) => `kv:${name}`),
    ...(parsed.bindings.r2.length ? ["r2"] : []),
  ];
  for (const scope of scopes) await dataStub(env, id, scope).destroy();
};

const dataStub = (env: Cloudflare.Env, id: string, scope: string) => {
  const namespace = (env as unknown as { SLACK_PREVIEW_DATA?: DurableObjectNamespace<SlackPreviewData> }).SLACK_PREVIEW_DATA;
  if (!namespace) throw new Error("Preview data isn't available on this deployment.");
  return namespace.getByName(`${id}:${scope}`);
};

const r2Key = (id: string, binding: string, key: string): string => `${KEY_PREFIX}/${id}/${DATA_DIR}r2/${binding}/${key}`;

type R2Meta = {
  key: string;
  size: number;
  etag: string;
  uploaded: number;
  httpMetadata: Record<string, string>;
  customMetadata: Record<string, string>;
};

const r2Meta = (object: R2Object, key: string): R2Meta => {
  const http: Record<string, string> = {};
  for (const [name, value] of Object.entries(object.httpMetadata ?? {})) {
    if (typeof value === "string") http[name] = value;
  }
  return {
    key,
    size: object.size,
    etag: object.etag,
    uploaded: object.uploaded.getTime(),
    httpMetadata: http,
    customMetadata: object.customMetadata ?? {},
  };
};

/** What a preview's app calls for its D1, KV and R2 stand-ins; bound to one preview. */
export class SlackPreviewBindings extends WorkerEntrypoint<Cloudflare.Env, BindingProps> {
  #id(): string {
    return this.ctx.props.id;
  }

  async d1(binding: string, statements: Statement[]): Promise<StatementResult[]> {
    return await dataStub(this.env, this.#id(), `d1:${binding}`).query(this.#id(), binding, statements);
  }

  async d1Exec(binding: string, query: string): Promise<{ count: number; duration: number }> {
    return await dataStub(this.env, this.#id(), `d1:${binding}`).execMany(this.#id(), binding, query);
  }

  async kvGet(binding: string, key: string) {
    return await dataStub(this.env, this.#id(), `kv:${binding}`).kvGet(key);
  }

  async kvPut(binding: string, key: string, value: Uint8Array, metadata: string | null, expires: number | null) {
    await dataStub(this.env, this.#id(), `kv:${binding}`).kvPut(key, value, metadata, expires);
  }

  async kvDelete(binding: string, key: string) {
    await dataStub(this.env, this.#id(), `kv:${binding}`).kvDelete(key);
  }

  async kvList(binding: string, options: { prefix?: string; limit?: number; cursor?: string }) {
    return await dataStub(this.env, this.#id(), `kv:${binding}`).kvList(options);
  }

  async r2Head(binding: string, key: string): Promise<R2Meta | null> {
    const object = await previewBucket(this.env).head(r2Key(this.#id(), binding, key));
    return object ? r2Meta(object, key) : null;
  }

  async r2Get(binding: string, key: string): Promise<{ meta: R2Meta; bytes: Uint8Array } | null> {
    const object = await previewBucket(this.env).get(r2Key(this.#id(), binding, key));
    if (!object) return null;
    return { meta: r2Meta(object, key), bytes: new Uint8Array(await object.arrayBuffer()) };
  }

  async r2Put(
    binding: string,
    key: string,
    bytes: Uint8Array,
    httpMetadata: Record<string, string>,
    customMetadata: Record<string, string>,
  ): Promise<R2Meta> {
    if (!key || key.length > 900) throw new Error("R2 key is invalid.");
    await dataStub(this.env, this.#id(), "r2").reserve(`${binding}/${key}`, bytes.byteLength);
    const object = await previewBucket(this.env).put(r2Key(this.#id(), binding, key), bytes, { httpMetadata, customMetadata });
    return r2Meta(object, key);
  }

  async r2Delete(binding: string, keys: string[]): Promise<void> {
    const list = keys.slice(0, 1000);
    await previewBucket(this.env).delete(list.map((key) => r2Key(this.#id(), binding, key)));
    await dataStub(this.env, this.#id(), "r2").release(list.map((key) => `${binding}/${key}`));
  }

  async r2List(binding: string, options: { prefix?: string; limit?: number; cursor?: string; delimiter?: string }) {
    const base = r2Key(this.#id(), binding, "");
    const listed = await previewBucket(this.env).list({
      prefix: `${base}${options.prefix ?? ""}`,
      limit: Math.min(1000, Math.max(1, options.limit ?? 1000)),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.delimiter ? { delimiter: options.delimiter } : {}),
      include: ["httpMetadata", "customMetadata"],
    });
    return {
      objects: listed.objects.map((object) => r2Meta(object, object.key.slice(base.length))),
      truncated: listed.truncated,
      ...(listed.truncated ? { cursor: listed.cursor } : {}),
      delimitedPrefixes: listed.delimitedPrefixes.map((prefix) => prefix.slice(base.length)),
    };
  }
}

/** The app's ASSETS binding: its uploaded static files. */
export class SlackPreviewAssets extends WorkerEntrypoint<Cloudflare.Env, AssetProps> {
  override async fetch(request: Request): Promise<Response> {
    const { id, notFound } = this.ctx.props;
    const asset = await findAsset(this.env, id, request, false);
    if (asset) return asset;
    if (notFound === "single-page-application") {
      const index = await findAsset(this.env, id, new Request(new URL("/index.html", request.url)), false);
      if (index) return index;
    }
    if (notFound === "404-page") {
      const page = await findAsset(this.env, id, new Request(new URL("/404.html", request.url)), false);
      if (page) return new Response(page.body, { status: 404, headers: page.headers });
    }
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

/** Every fetch a preview's code makes: the public internet, but none of Stella's hosts. */
export class SlackPreviewOutbound extends WorkerEntrypoint<Cloudflare.Env, OutboundProps> {
  override async fetch(request: Request): Promise<Response> {
    let host = "";
    try {
      host = new URL(request.url).hostname.toLowerCase();
    } catch {
      return new Response("Invalid URL", { status: 400 });
    }
    const { id, appHost, previewOrigin } = this.ctx.props;
    if (host === appHost || host === new URL(previewOrigin).hostname) {
      const origins = { app: `https://${appHost}`, preview: previewOrigin };
      const self = new Request(new URL(`${new URL(request.url).pathname}${new URL(request.url).search}`, previewOrigin), request);
      const asset = await findAsset(this.env, id, self, false);
      if (asset) return asset;
      return await previewWorker(this.env, this.ctx.exports as unknown as Exports, id, origins)
        .getEntrypoint()
        .fetch(toApp(self, origins));
    }
    const blocked =
      host === "localhost" ||
      /^\d+\.\d+\.\d+\.\d+$/u.test(host) ||
      host.startsWith("[") ||
      this.ctx.props.blocked.some((item) => host === item || host.endsWith(`.${item}`));
    if (blocked) {
      return new Response(`Stella previews can't reach ${host}.`, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return await fetch(request);
  }
}

// ── Per-preview data (D1 and KV stand-ins, the R2 size cap) ───────────────

type SeedStatement = { sql: string; params?: unknown[] } | { exec: string };

const decodeParam = (value: unknown): unknown => {
  if (value && typeof value === "object" && typeof (value as { $b64?: unknown }).$b64 === "string") {
    return fromBase64((value as { $b64: string }).$b64);
  }
  return value;
};

const outValue = (value: unknown): unknown => (value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : value);

/**
 * One object per preview and database (`<id>:d1:<binding>`), KV namespace
 * (`<id>:kv:<binding>`) or the preview's R2 cap (`<id>:r2`). A database is
 * seeded from its snapshot on first use; its writes stay in the preview.
 */
export class SlackPreviewData extends DurableObject<Cloudflare.Env> {
  #seeded = false;

  async #seed(id: string, binding: string): Promise<void> {
    if (this.#seeded) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.#seeded) return;
      if (this.ctx.storage.kv.get("__stella_seeded")) {
        this.#seeded = true;
        return;
      }
      const object = await previewBucket(this.env).get(`${KEY_PREFIX}/${id}/${D1_DIR}${binding}.json`);
      const statements = object ? ((await object.json()) as SeedStatement[]) : [];
      const sql = this.ctx.storage.sql;
      const failures: string[] = [];
      this.ctx.storage.transactionSync(() => {
        try {
          sql.exec("PRAGMA defer_foreign_keys = ON");
        } catch {}
        for (const statement of Array.isArray(statements) ? statements : []) {
          try {
            if ("exec" in statement) sql.exec(statement.exec);
            else sql.exec(statement.sql, ...(statement.params ?? []).map(decodeParam));
          } catch (error) {
            if (failures.length < 5) failures.push(error instanceof Error ? error.message.slice(0, 200) : String(error));
          }
        }
      });
      if (failures.length) {
        console.warn(JSON.stringify({ event: "slack_preview_seed_partial", id, binding, failures }));
      }
      this.ctx.storage.kv.put("__stella_seeded", 1);
      this.#seeded = true;
    });
  }

  #run(statement: Statement): StatementResult {
    const sql = this.ctx.storage.sql;
    const started = Date.now();
    const cursor = sql.exec(statement.sql, ...statement.params.map(decodeParam));
    const rows = [...cursor.raw()].map((row) => row.map(outValue));
    const columns = cursor.columnNames;
    let changes = 0;
    let lastRowId = 0;
    if (cursor.rowsWritten > 0) {
      try {
        const row = sql.exec("SELECT changes() AS c, last_insert_rowid() AS r").one() as { c: number; r: number };
        changes = row.c;
        lastRowId = row.r;
      } catch {
        changes = cursor.rowsWritten;
      }
    }
    return {
      columns,
      rows,
      meta: {
        duration: Date.now() - started,
        changes,
        last_row_id: lastRowId,
        changed_db: cursor.rowsWritten > 0,
        rows_read: cursor.rowsRead,
        rows_written: cursor.rowsWritten,
        size_after: sql.databaseSize,
        served_by: "stella-preview",
      },
    };
  }

  async query(id: string, binding: string, statements: Statement[]): Promise<StatementResult[]> {
    await this.#seed(id, binding);
    if (statements.length === 1) return [this.#run(statements[0]!)];
    return this.ctx.storage.transactionSync(() => statements.map((statement) => this.#run(statement)));
  }

  async execMany(id: string, binding: string, query: string): Promise<{ count: number; duration: number }> {
    await this.#seed(id, binding);
    const started = Date.now();
    const cursor = this.ctx.storage.sql.exec(query);
    cursor.toArray();
    return { count: query.split(";").filter((part) => part.trim()).length, duration: Date.now() - started };
  }

  #kvTable(): void {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS __stella_kv (key TEXT PRIMARY KEY, value BLOB, metadata TEXT, expires INTEGER)",
    );
  }

  async kvGet(key: string): Promise<{ value: Uint8Array; metadata: unknown } | null> {
    this.#kvTable();
    const row = this.ctx.storage.sql
      .exec<{ value: ArrayBuffer; metadata: string | null; expires: number | null }>(
        "SELECT value, metadata, expires FROM __stella_kv WHERE key = ?",
        key,
      )
      .toArray()[0];
    if (!row) return null;
    if (row.expires && row.expires <= Date.now()) {
      this.ctx.storage.sql.exec("DELETE FROM __stella_kv WHERE key = ?", key);
      return null;
    }
    return { value: new Uint8Array(row.value), metadata: row.metadata ? JSON.parse(row.metadata) : null };
  }

  async kvPut(key: string, value: Uint8Array, metadata: string | null, expires: number | null): Promise<void> {
    if (value.byteLength > KV_VALUE_LIMIT) throw new Error("KV values in Stella previews can be at most 2 MB.");
    this.#kvTable();
    const count = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM __stella_kv").one().n;
    if (count > 20_000) throw new Error("This preview's KV namespace is full.");
    this.ctx.storage.sql.exec(
      "INSERT INTO __stella_kv (key, value, metadata, expires) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, expires = excluded.expires",
      key,
      value,
      metadata,
      expires,
    );
  }

  async kvDelete(key: string): Promise<void> {
    this.#kvTable();
    this.ctx.storage.sql.exec("DELETE FROM __stella_kv WHERE key = ?", key);
  }

  async kvList(options: { prefix?: string; limit?: number; cursor?: string }) {
    this.#kvTable();
    const limit = Math.min(1000, Math.max(1, options.limit ?? 1000));
    const prefix = options.prefix ?? "";
    const after = options.cursor ?? "";
    const rows = this.ctx.storage.sql
      .exec<{ key: string; metadata: string | null; expires: number | null }>(
        "SELECT key, metadata, expires FROM __stella_kv WHERE key >= ? AND key > ? AND (expires IS NULL OR expires > ?) ORDER BY key LIMIT ?",
        prefix,
        after,
        Date.now(),
        limit + 1,
      )
      .toArray()
      .filter((row) => row.key.startsWith(prefix));
    const page = rows.slice(0, limit);
    const complete = rows.length <= limit;
    return {
      keys: page.map((row) => ({
        name: row.key,
        ...(row.expires ? { expiration: Math.floor(row.expires / 1000) } : {}),
        ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
      })),
      list_complete: complete,
      ...(complete ? {} : { cursor: page[page.length - 1]?.key ?? "" }),
      cacheStatus: null,
    };
  }

  async reserve(key: string, bytes: number): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS __stella_r2 (key TEXT PRIMARY KEY, size INTEGER NOT NULL)");
    const totals = sql.exec<{ n: number; b: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM __stella_r2 WHERE key != ?", key).one();
    if (totals.n + 1 > R2_LIMIT_OBJECTS || totals.b + bytes > R2_LIMIT_BYTES) {
      throw new Error(`This preview's storage is full (${R2_LIMIT_OBJECTS} objects or ${R2_LIMIT_BYTES / MB} MB at most).`);
    }
    sql.exec("INSERT INTO __stella_r2 (key, size) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET size = excluded.size", key, bytes);
  }

  /** When the preview expires: everything this object holds. */
  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.#seeded = false;
  }

  async release(keys: string[]): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS __stella_r2 (key TEXT PRIMARY KEY, size INTEGER NOT NULL)");
    for (const key of keys) sql.exec("DELETE FROM __stella_r2 WHERE key = ?", key);
  }
}

