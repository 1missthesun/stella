/**
 * Stella previews for Slack: static sites a workspace's agents build and
 * Stella hosts, for when the repository publishes no preview of its own.
 *
 * Every Slack agent container gets a publish capability (`sp1`, 12 hours,
 * one workspace and conversation) and `stella-publish`, which builds the
 * project and uploads its output as a gzipped tar to `POST /api/slack/previews`.
 * The files go to APP_BUILDS under `slack-previews/<id>/`; a D1 row
 * (`slack_previews`) is the link. Ids are 128-bit random, so links can't be
 * guessed, and each upload gets a new one.
 *
 * Sites are served on their own origin, never stella.sh or an app origin:
 * the `preview-host` Worker forwards every request to `SlackPreviewHost`
 * below over a service binding. With `SLACK_PREVIEW_HOST_SUFFIX` each preview
 * is `https://<id>.<suffix>/`; without it (dev on workers.dev) all previews
 * share `SLACK_PREVIEW_ORIGIN`, and `/__stella/open/<id>` picks the one a
 * browser sees through a cookie.
 *
 * Access is the workspace owner's choice (`slack_preview_settings`):
 * anyone with the link, or members only. A members-only preview sends the
 * visitor to Sign in with Slack (OpenID) restricted to the workspace; the
 * callback hands the preview origin a short grant, which it trades for an
 * HttpOnly `__Host-` cookie. Links expire `ttl_days` after they were made
 * (the current setting, so shortening it expires older links too); the daily
 * cron deletes their files.
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import {
  SLACK_PREVIEW_ACCESS_DEFAULT,
  SLACK_PREVIEW_TTL_DAYS_CHOICES,
  SLACK_PREVIEW_TTL_DAYS_DEFAULT,
  type SlackPreviewAccess,
  type SlackWorkspacePreviews,
} from "@stella/contracts/slack-workspace";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import type { ExecutionSession } from "../sandbox-client.js";
import { ownerGateStub } from "../rpc-release.js";
import { SLACK_PATHS, slackPublicOrigin, slackSecret } from "./config.js";
import { signToken, verifyToken, type TokenKind } from "./signed-token.js";
import { loadInstallation } from "./store.js";
import { isSlackConversationId } from "./workspace.js";
import publishScript from "./stella-publish.cjs.txt";

export const SLACK_PREVIEWS_PATH = "/api/slack/previews";
const SIGNIN_PATH = `${SLACK_PREVIEWS_PATH}/signin`;
/** A subdirectory of the Slack app's registered redirect URL, so no app change is needed. */
const OIDC_CALLBACK_PATH = `${SLACK_PATHS.oauthCallback}/preview`;
const KEY_PREFIX = "slack-previews";

const DAY_MS = 24 * 60 * 60_000;
const MB = 1024 * 1024;
export const MAX_PREVIEW_BYTES = 100 * MB;
const MAX_FILE_BYTES = 25 * MB;
const MAX_UPLOAD_BYTES = 95 * MB;
const MAX_FILES = 5_000;
const MAX_LIVE_PREVIEWS = 500;
const QUOTA_BYTES: Record<ManagedModelAudience, number> = {
  anonymous: 0,
  free: 250 * MB,
  go: 1024 * MB,
  pro: 5 * 1024 * MB,
  go_fallback: 1024 * MB,
  pro_fallback: 5 * 1024 * MB,
};

const PUBLISH: TokenKind = { prefix: "sp1", domain: "stella.slack-preview-publish.v1" };
const SIGNIN_STATE: TokenKind = { prefix: "ss1", domain: "stella.slack-preview-signin.v1" };
const GRANT: TokenKind = { prefix: "sg1", domain: "stella.slack-preview-grant.v1" };
const VIEW: TokenKind = { prefix: "sv1", domain: "stella.slack-preview-view.v1" };
const MEMBER: TokenKind = { prefix: "sm1", domain: "stella.slack-preview-member.v1" };

const PUBLISH_TTL_MS = 12 * 60 * 60_000;
const VIEW_TTL_MS = 7 * DAY_MS;
const MEMBER_TTL_MS = 30 * DAY_MS;
const VIEW_COOKIE = "__Host-stella_preview_view";
const SITE_COOKIE = "__Host-stella_preview_site";
const MEMBER_COOKIE = "stella_slack_member";

const ID_PATTERN = /^[a-z2-7]{26}$/u;

const d1 = (env: Cloudflare.Env): D1Database => {
  if (!env.DB) throw new Error("The DB binding is missing.");
  return env.DB;
};

const bucket = (env: Cloudflare.Env): R2Bucket => {
  if (!env.APP_BUILDS) throw new Error("The APP_BUILDS binding is missing.");
  return env.APP_BUILDS;
};

const readVar = (env: Cloudflare.Env, name: string): string => {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
};

const newId = (): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  let id = "";
  for (const byte of bytes) id += alphabet[byte & 31];
  return id;
};

// ── Settings ──────────────────────────────────────────────────────────────

export type PreviewSettings = { access: SlackPreviewAccess; ttlDays: number };

const isAccess = (value: unknown): value is SlackPreviewAccess => value === "public" || value === "members";

export const isPreviewTtl = (value: unknown): value is number =>
  (SLACK_PREVIEW_TTL_DAYS_CHOICES as readonly number[]).includes(value as number);

export const loadPreviewSettings = async (env: Cloudflare.Env, teamId: string): Promise<PreviewSettings> => {
  const row = await d1(env)
    .prepare("SELECT access, ttl_days FROM slack_preview_settings WHERE team_id = ?")
    .bind(teamId)
    .first<{ access: string; ttl_days: number }>();
  return {
    access: isAccess(row?.access) ? row.access : SLACK_PREVIEW_ACCESS_DEFAULT,
    ttlDays: row && row.ttl_days > 0 ? row.ttl_days : SLACK_PREVIEW_TTL_DAYS_DEFAULT,
  };
};

export const savePreviewSettings = async (
  env: Cloudflare.Env,
  teamId: string,
  patch: Partial<PreviewSettings>,
): Promise<void> => {
  const current = await loadPreviewSettings(env, teamId);
  await d1(env)
    .prepare(
      `INSERT INTO slack_preview_settings (team_id, access, ttl_days, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (team_id) DO UPDATE SET access = excluded.access, ttl_days = excluded.ttl_days,
         updated_at = excluded.updated_at`,
    )
    .bind(teamId, patch.access ?? current.access, patch.ttlDays ?? current.ttlDays, Date.now())
    .run();
};

const usage = async (
  env: Cloudflare.Env,
  teamId: string,
  ttlDays: number,
): Promise<{ bytes: number; live: number }> => {
  const row = await d1(env)
    .prepare(
      `SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS live FROM slack_previews
       WHERE team_id = ? AND deleted_at IS NULL AND created_at > ?`,
    )
    .bind(teamId, Date.now() - ttlDays * DAY_MS)
    .first<{ bytes: number; live: number }>();
  return { bytes: row?.bytes ?? 0, live: row?.live ?? 0 };
};

const quotaFor = async (env: Cloudflare.Env, ownerId: string | null): Promise<number> => {
  if (!ownerId) return 0;
  const access = await ownerGateStub(env.OWNER_GATES, ownerId).billingAccess();
  return QUOTA_BYTES[access.audience as ManagedModelAudience] ?? 0;
};

/** The workspace's preview settings and usage, for stella.sh/slack. */
export const describePreviews = async (
  env: Cloudflare.Env,
  teamId: string,
  ownerId: string | null,
): Promise<SlackWorkspacePreviews> => {
  const settings = await loadPreviewSettings(env, teamId);
  const [used, quotaBytes] = await Promise.all([
    usage(env, teamId, settings.ttlDays),
    quotaFor(env, ownerId).catch(() => 0),
  ]);
  return {
    access: settings.access,
    ttlDays: settings.ttlDays,
    usedBytes: used.bytes,
    quotaBytes,
    live: used.live,
    maxPreviewBytes: MAX_PREVIEW_BYTES,
  };
};

// ── Links ─────────────────────────────────────────────────────────────────

const hostSuffix = (env: Cloudflare.Env): string =>
  readVar(env, "SLACK_PREVIEW_HOST_SUFFIX").replace(/^\.+|\.+$/gu, "").toLowerCase();

const sharedOrigin = (env: Cloudflare.Env): string => readVar(env, "SLACK_PREVIEW_ORIGIN").replace(/\/+$/u, "");

/** The preview's origin; in shared-origin mode, the one origin every preview uses. */
const previewOrigin = (env: Cloudflare.Env, id: string): string | null => {
  const suffix = hostSuffix(env);
  if (suffix) return `https://${id}.${suffix}`;
  return sharedOrigin(env) || null;
};

const previewLink = (env: Cloudflare.Env, id: string): string | null => {
  const suffix = hostSuffix(env);
  if (suffix) return `https://${id}.${suffix}/`;
  const origin = sharedOrigin(env);
  return origin ? `${origin}/__stella/open/${id}` : null;
};

const authOrigin = (env: Cloudflare.Env, request?: Request): string =>
  slackPublicOrigin(env, request) || readVar(env, "CLOUD_BUILDER_PUBLIC_URL").replace(/\/+$/u, "");

const safePath = (value: string | null): string =>
  value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") && value.length < 2_000
    ? value
    : "/";

// ── Pages ─────────────────────────────────────────────────────────────────

const escapeHtml = (value: string): string =>
  value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");

const page = (status: number, title: string, body: string, extra?: HeadersInit): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f7f6f3;color:#1f1f1d}main{max-width:440px;padding:32px 24px;text-align:center}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{margin:0 0 12px;color:#6b6a66}a.button{display:inline-block;margin-top:12px;padding:10px 18px;border-radius:999px;background:#1f1f1d;color:#f7f6f3;text-decoration:none;font-weight:500}@media (prefers-color-scheme:dark){body{background:#161615;color:#ecebe8}p{color:#a3a29e}a.button{background:#ecebe8;color:#161615}}</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        ...extra,
      },
    },
  );

const missing = (): Response =>
  page(404, "This preview isn't here", "<p>The link is wrong, or the preview expired. Ask Stella in Slack for a fresh one.</p>");

// ── Cookies ───────────────────────────────────────────────────────────────

const cookieValues = (request: Request, name: string): string[] => {
  const header = request.headers.get("cookie");
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) values.push(part.slice(index + 1).trim());
  }
  return values;
};

const hostCookie = (name: string, value: string, ttlMs: number): string =>
  `${name}=${value}; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}; HttpOnly; Secure; SameSite=Lax`;

// ── Publish capability and the container helper ───────────────────────────

type PublishClaims = { team: string; conv: string };

const HELPER_DIR = "/opt/stella-preview";
const PUBLISH_HELPER = "/usr/local/bin/stella-publish";
const TOOL_UID = 42424;

const shellQuote = (value: string): string => `'${value.replace(/'/gu, `'\\''`)}'`;

const writeFile = (path: string, content: string, mode: string, owner: string): string =>
  `printf '%s' ${shellQuote(btoa(content))} | base64 -d > ${shellQuote(path)} && chown ${owner} ${shellQuote(path)} && chmod ${mode} ${shellQuote(path)}`;

const teamForConversation = async (env: Cloudflare.Env, conversationId: string): Promise<string | null> =>
  (
    await d1(env)
      .prepare("SELECT team_id FROM slack_threads WHERE conversation_id = ? LIMIT 1")
      .bind(conversationId)
      .first<{ team_id: string }>()
  )?.team_id ?? null;

/**
 * Before a Slack conversation's agent starts: write its publish capability,
 * this deployment's origin and `stella-publish` into the container. Every
 * Slack agent gets them, with or without a repository.
 */
export const prepareSlackPreviews = async (
  env: Partial<Cloudflare.Env>,
  session: Pick<ExecutionSession, "exec">,
  conversationId: string,
  origin: string,
  log: (event: string, fields: Record<string, unknown>) => void,
): Promise<void> => {
  if (!isSlackConversationId(conversationId)) return;
  try {
    const teamId = await teamForConversation(env as Cloudflare.Env, conversationId);
    if (!teamId) return;
    const capability = await signToken<PublishClaims>(
      env as Cloudflare.Env,
      PUBLISH,
      { team: teamId, conv: conversationId },
      PUBLISH_TTL_MS,
    );
    const command = [
      "set -e",
      `mkdir -p ${HELPER_DIR}`,
      `chown root:${TOOL_UID} ${HELPER_DIR}`,
      `chmod 0750 ${HELPER_DIR}`,
      writeFile(`${HELPER_DIR}/capability`, capability, "0640", `root:${TOOL_UID}`),
      writeFile(`${HELPER_DIR}/origin`, origin, "0644", "root:root"),
      writeFile(PUBLISH_HELPER, publishScript, "0755", "root:root"),
    ].join("\n");
    const result = await session.exec(command, {
      origin: "internal",
      timeout: 30_000,
    } as Parameters<ExecutionSession["exec"]>[1]);
    log(result.success ? "slack_preview_helper_ready" : "slack_preview_helper_failed", {
      teamId,
      ...(result.success ? {} : { exitCode: result.exitCode }),
    });
  } catch (error) {
    log("slack_preview_helper_failed", { message: error instanceof Error ? error.message.slice(0, 200) : String(error) });
  }
};

// ── Upload ────────────────────────────────────────────────────────────────

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  rss: "application/rss+xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  pdf: "application/pdf",
  wasm: "application/wasm",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  zip: "application/zip",
};

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

const contentTypeOf = (path: string): string => CONTENT_TYPES[extensionOf(path)] ?? "application/octet-stream";

/** A clean relative path inside the site, or null for anything that could escape it. */
const cleanPath = (raw: string): string | null => {
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

class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Pulls exact byte counts out of a stream. */
class ByteReader {
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private done = false;
  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private async fill(count: number): Promise<boolean> {
    while (this.buffered < count && !this.done) {
      const { value, done } = await this.reader.read();
      if (done) this.done = true;
      else if (value?.byteLength) {
        this.chunks.push(value);
        this.buffered += value.byteLength;
      }
    }
    return this.buffered >= count;
  }

  async read(count: number): Promise<Uint8Array | null> {
    if (!(await this.fill(count))) return null;
    const out = new Uint8Array(count);
    let offset = 0;
    while (offset < count) {
      const head = this.chunks[0]!;
      const take = Math.min(head.byteLength, count - offset);
      out.set(head.subarray(0, take), offset);
      offset += take;
      if (take === head.byteLength) this.chunks.shift();
      else this.chunks[0] = head.subarray(take);
    }
    this.buffered -= count;
    return out;
  }

  async skip(count: number): Promise<boolean> {
    let left = count;
    while (left > 0) {
      const step = Math.min(left, 1024 * 1024);
      if (!(await this.read(step))) return false;
      left -= step;
    }
    return true;
  }
}

const cString = (bytes: Uint8Array): string => {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
};

const octal = (bytes: Uint8Array): number => {
  if (bytes[0]! & 0x80) throw new UploadError("A file in the upload is too large.");
  const text = cString(bytes).trim();
  return text ? parseInt(text, 8) : 0;
};

const paxRecords = (bytes: Uint8Array): Record<string, string> => {
  const text = new TextDecoder().decode(bytes);
  const records: Record<string, string> = {};
  let index = 0;
  while (index < text.length) {
    const space = text.indexOf(" ", index);
    if (space === -1) break;
    const length = parseInt(text.slice(index, space), 10);
    if (!length) break;
    const record = text.slice(space + 1, index + length - 1);
    const equals = record.indexOf("=");
    if (equals !== -1) records[record.slice(0, equals)] = record.slice(equals + 1);
    index += length;
  }
  return records;
};

type TarEntry = { path: string; data: Uint8Array };

/** Regular files from a tar stream; links, devices and directories are skipped. */
async function* tarFiles(stream: ReadableStream<Uint8Array>): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(stream.getReader());
  let longName: string | null = null;
  let paxPath: string | null = null;
  let paxSize: number | null = null;
  for (;;) {
    const header = await reader.read(512);
    if (!header || header.every((byte) => byte === 0)) return;
    const type = String.fromCharCode(header[156]!);
    const size = paxSize ?? octal(header.subarray(124, 136));
    const padded = Math.ceil(size / 512) * 512;
    if (type === "L" || type === "x" || type === "g") {
      if (size > 64 * 1024) throw new UploadError("The upload isn't a valid archive.");
      const body = await reader.read(padded);
      if (!body) throw new UploadError("The upload ended early.");
      if (type === "L") longName = cString(body.subarray(0, size));
      else if (type === "x") {
        const records = paxRecords(body.subarray(0, size));
        paxPath = records.path ?? null;
        paxSize = records.size ? Number(records.size) : null;
      }
      continue;
    }
    const prefix = cString(header.subarray(345, 500));
    const name = paxPath ?? longName ?? (prefix ? `${prefix}/${cString(header.subarray(0, 100))}` : cString(header.subarray(0, 100)));
    longName = null;
    paxPath = null;
    paxSize = null;
    if (type !== "0" && type !== "\0" && type !== "7") {
      if (!(await reader.skip(padded))) throw new UploadError("The upload ended early.");
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      throw new UploadError(`${name.replace(/^\.\//u, "")} is larger than ${MAX_FILE_BYTES / MB} MB.`, 413);
    }
    const body = await reader.read(padded);
    if (!body) throw new UploadError("The upload ended early.");
    yield { path: name, data: body.subarray(0, size) };
  }
}

const publishFailure = (error: unknown): Response => {
  if (error instanceof UploadError) return Response.json({ error: error.message }, { status: error.status });
  console.error(
    JSON.stringify({
      event: "slack_preview_upload_failed",
      message: error instanceof Error ? error.message.slice(0, 300) : String(error),
    }),
  );
  return Response.json({ error: "Stella couldn't store the preview. Try again." }, { status: 502 });
};

const deletePrefix = async (env: Cloudflare.Env, prefix: string): Promise<void> => {
  let cursor: string | undefined;
  do {
    const listed = await bucket(env).list({ prefix, ...(cursor ? { cursor } : {}), limit: 1000 });
    const keys = listed.objects.map((object) => object.key);
    if (keys.length) await bucket(env).delete(keys);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
};

const formatMb = (bytes: number): string => `${Math.round((bytes / MB) * 10) / 10} MB`;

const publish = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const header = request.headers.get("authorization") ?? "";
  const claims = header.startsWith("Bearer ")
    ? await verifyToken<PublishClaims>(env, PUBLISH, header.slice(7).trim())
    : null;
  if (!claims) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const install = await loadInstallation(env, claims.team);
  if (!install?.ownerId || (await teamForConversation(env, claims.conv)) !== claims.team) {
    return Response.json({ error: "This workspace no longer has Stella installed." }, { status: 403 });
  }
  if (!hostSuffix(env) && !sharedOrigin(env)) return Response.json({ error: "Previews aren't set up on this deployment." }, { status: 503 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES) {
    return Response.json({ error: `The upload is larger than ${formatMb(MAX_UPLOAD_BYTES)}.` }, { status: 413 });
  }
  if (!request.body) return Response.json({ error: "Send the site as a gzipped tar." }, { status: 400 });

  const settings = await loadPreviewSettings(env, claims.team);
  const [used, quota] = await Promise.all([usage(env, claims.team, settings.ttlDays), quotaFor(env, install.ownerId)]);
  if (used.live >= MAX_LIVE_PREVIEWS) {
    return Response.json(
      { error: `This workspace has ${used.live} live previews, the most it can hold. Older ones free up as they expire.` },
      { status: 429 },
    );
  }
  const room = Math.min(MAX_PREVIEW_BYTES, quota - used.bytes);
  if (room <= 0) {
    return Response.json(
      {
        error: `This workspace's previews use ${formatMb(used.bytes)} of its ${formatMb(quota)} on the owner's plan. Older previews free up space as they expire, or the owner can shorten how long they last on stella.sh/slack.`,
      },
      { status: 413 },
    );
  }

  const url = new URL(request.url);
  const commit = (url.searchParams.get("commit") ?? "").slice(0, 40);
  const repo = (url.searchParams.get("repo") ?? "").slice(0, 200);
  const id = newId();
  const prefix = `${KEY_PREFIX}/${id}/`;
  const seen = new Set<string>();
  let bytes = 0;
  const pending = new Set<Promise<unknown>>();
  let pendingBytes = 0;
  let firstError: unknown = null;
  try {
    const stream =
      request.headers.get("content-type") === "application/x-tar"
        ? request.body
        : request.body.pipeThrough(new DecompressionStream("gzip"));
    for await (const entry of tarFiles(stream)) {
      const path = cleanPath(entry.path);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      bytes += entry.data.byteLength;
      if (seen.size > MAX_FILES) throw new UploadError(`The site has more than ${MAX_FILES} files.`, 413);
      if (bytes > MAX_PREVIEW_BYTES) {
        throw new UploadError(`The site is larger than ${formatMb(MAX_PREVIEW_BYTES)}, the most one preview can be.`, 413);
      }
      if (bytes > room) {
        throw new UploadError(
          `The site doesn't fit: this workspace has ${formatMb(Math.max(0, quota - used.bytes))} left of ${formatMb(quota)} for previews.`,
          413,
        );
      }
      const size = entry.data.byteLength;
      const put = bucket(env)
        .put(`${prefix}${path}`, entry.data, { httpMetadata: { contentType: contentTypeOf(path) } })
        .catch((error: unknown) => {
          firstError ??= error;
        })
        .finally(() => {
          pending.delete(put);
          pendingBytes -= size;
        });
      pending.add(put);
      pendingBytes += size;
      while (pending.size >= 8 || pendingBytes > 24 * MB) await Promise.race(pending);
      if (firstError) throw firstError;
    }
    await Promise.all(pending);
    if (firstError) throw firstError;
    if (!seen.has("index.html")) throw new UploadError("The site has no index.html at its top level.");
  } catch (error) {
    await Promise.allSettled(pending);
    await deletePrefix(env, prefix).catch(() => {});
    return publishFailure(error instanceof TypeError && /gzip|decompress|header/iu.test(error.message)
      ? new UploadError("The upload isn't a gzipped tar.")
      : error);
  }

  const now = Date.now();
  await d1(env)
    .prepare(
      `INSERT INTO slack_previews (id, team_id, conversation_id, created_at, bytes, files, spa, repo, commit_sha)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, claims.team, claims.conv, now, bytes, seen.size, seen.has("404.html") ? 0 : 1, repo || null, commit || null)
    .run();
  console.log(
    JSON.stringify({ event: "slack_preview_published", teamId: claims.team, id, bytes, files: seen.size, access: settings.access }),
  );
  return Response.json(
    {
      id,
      url: previewLink(env, id),
      access: settings.access,
      expiresAt: now + settings.ttlDays * DAY_MS,
      bytes,
      files: seen.size,
    },
    { headers: { "cache-control": "no-store" } },
  );
};

// ── Sign in with Slack (members-only previews) ────────────────────────────

type PreviewRow = { id: string; team_id: string; created_at: number; spa: number; deleted_at: number | null };

const loadPreview = async (env: Cloudflare.Env, id: string): Promise<PreviewRow | null> => {
  if (!ID_PATTERN.test(id)) return null;
  const row = await d1(env)
    .prepare("SELECT id, team_id, created_at, spa, deleted_at FROM slack_previews WHERE id = ?")
    .bind(id)
    .first<PreviewRow>();
  return row && !row.deleted_at ? row : null;
};

type SigninState = { p: string; r: string; n: string };
type GrantClaims = { p: string; t: string; r: string };
type ViewClaims = { t: string };
type MemberClaims = { t: string; u: string };

const grantRedirect = async (env: Cloudflare.Env, preview: PreviewRow, path: string, extra?: HeadersInit) => {
  const origin = previewOrigin(env, preview.id);
  if (!origin) return missing();
  const grant = await signToken<GrantClaims>(env, GRANT, { p: preview.id, t: preview.team_id, r: path }, 2 * 60_000);
  const headers = new Headers(extra);
  headers.set("location", `${origin}/__stella/auth?g=${encodeURIComponent(grant)}`);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  return new Response(null, { status: 302, headers });
};

const signin = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const url = new URL(request.url);
  const preview = await loadPreview(env, url.searchParams.get("p") ?? "");
  if (!preview) return missing();
  const path = safePath(url.searchParams.get("r"));
  for (const value of cookieValues(request, MEMBER_COOKIE)) {
    const member = await verifyToken<MemberClaims>(env, MEMBER, value);
    if (member?.t === preview.team_id) return await grantRedirect(env, preview, path);
  }
  const clientId = slackSecret(env, "SLACK_CLIENT_ID");
  if (!clientId) return page(503, "Sign-in isn't available", "<p>Slack sign-in isn't set up on this deployment.</p>");
  const nonce = newId();
  const state = await signToken<SigninState>(env, SIGNIN_STATE, { p: preview.id, r: path, n: nonce }, 10 * 60_000);
  const authorize = new URL("https://slack.com/openid/connect/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid profile");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("team", preview.team_id);
  authorize.searchParams.set("redirect_uri", `${authOrigin(env, request)}${OIDC_CALLBACK_PATH}`);
  return new Response(null, { status: 302, headers: { location: authorize.toString(), "cache-control": "no-store" } });
};

const jwtPayload = (token: string): Record<string, unknown> | null => {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
};

const signinCallback = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const url = new URL(request.url);
  const state = await verifyToken<SigninState>(env, SIGNIN_STATE, url.searchParams.get("state") ?? "");
  if (!state) return page(400, "That sign-in link expired", "<p>Open the preview link again to sign in.</p>");
  const preview = await loadPreview(env, state.p);
  if (!preview) return missing();
  const code = url.searchParams.get("code");
  if (!code) return page(403, "Sign-in canceled", "<p>Open the preview link again to sign in with Slack.</p>");
  const clientId = slackSecret(env, "SLACK_CLIENT_ID");
  const clientSecret = slackSecret(env, "SLACK_CLIENT_SECRET");
  if (!clientId || !clientSecret) return page(503, "Sign-in isn't available", "<p>Slack sign-in isn't set up here.</p>");
  const exchanged = await fetch("https://slack.com/api/openid.connect.token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${authOrigin(env, request)}${OIDC_CALLBACK_PATH}`,
    }),
  })
    .then(async (response) => (await response.json()) as { ok?: boolean; id_token?: string; error?: string })
    .catch(() => ({ ok: false, error: "network" }) as { ok?: boolean; id_token?: string; error?: string });
  const claims = exchanged.ok && exchanged.id_token ? jwtPayload(exchanged.id_token) : null;
  const team = claims?.["https://slack.com/team_id"];
  const user = claims?.["https://slack.com/user_id"];
  if (!claims || claims.nonce !== state.n || typeof team !== "string" || typeof user !== "string") {
    console.error(JSON.stringify({ event: "slack_preview_signin_failed", error: exchanged.error ?? "claims" }));
    return page(502, "Slack didn't confirm the sign-in", "<p>Open the preview link again to retry.</p>");
  }
  if (team !== preview.team_id) {
    return page(
      403,
      "This preview is for another workspace",
      "<p>You signed in to a different Slack workspace. Only members of the workspace the preview was made in can open it.</p>",
    );
  }
  const member = await signToken<MemberClaims>(env, MEMBER, { t: team, u: user }, MEMBER_TTL_MS);
  return await grantRedirect(env, preview, state.r, {
    "set-cookie": `${MEMBER_COOKIE}=${member}; Path=${SLACK_PREVIEWS_PATH}/; Max-Age=${Math.floor(MEMBER_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`,
  });
};

export const handleSlackPreviewRoute = async (request: Request, env: Cloudflare.Env): Promise<Response | null> => {
  const { pathname } = new URL(request.url);
  if (pathname === SLACK_PREVIEWS_PATH && request.method === "POST") {
    try {
      return await publish(request, env);
    } catch (error) {
      return publishFailure(error);
    }
  }
  if (pathname === SIGNIN_PATH && request.method === "GET") return await signin(request, env);
  if (pathname === OIDC_CALLBACK_PATH && request.method === "GET") return await signinCallback(request, env);
  return null;
};

// ── Serving (through the preview-host Worker) ─────────────────────────────

const PREVIEW_CSP = "base-uri 'self'; object-src 'none'; form-action 'self' https:";

const servingHeaders = (object: R2Object, isPublic: boolean, html: boolean): Headers => {
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

const decodePath = (pathname: string): string | null => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
};

const serveFile = async (
  request: Request,
  env: Cloudflare.Env,
  preview: PreviewRow,
  pathname: string,
  isPublic: boolean,
): Promise<Response> => {
  const decoded = decodePath(pathname);
  if (decoded === null) return missing();
  const relative = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const path = cleanPath(relative);
  if (!path) return missing();
  const prefix = `${KEY_PREFIX}/${preview.id}/`;
  const options: R2GetOptions = { onlyIf: request.headers, range: request.headers };
  const respond = (object: R2Object | R2ObjectBody, status = 200): Response => {
    const html = (object.httpMetadata?.contentType ?? "").startsWith("text/html");
    const headers = servingHeaders(object, isPublic, html);
    if (!("body" in object)) return new Response(null, { status: 304, headers });
    if (object.range && "offset" in object.range && request.headers.has("range")) {
      const offset = object.range.offset ?? 0;
      const length = object.range.length ?? object.size - offset;
      headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      status = 206;
    }
    return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  };

  const direct = await bucket(env).get(`${prefix}${path}`, options);
  if (direct) return respond(direct);
  if (!extensionOf(path)) {
    const directory = await bucket(env).head(`${prefix}${path}/index.html`);
    if (directory) {
      const url = new URL(request.url);
      return new Response(null, {
        status: 301,
        headers: { location: `${url.pathname}/${url.search}`, "cache-control": "no-store" },
      });
    }
    const page = await bucket(env).get(`${prefix}${path}.html`, options);
    if (page) return respond(page);
  }
  const wantsHtml = !extensionOf(path) || extensionOf(path) === "html" || (request.headers.get("accept") ?? "").includes("text/html");
  if (preview.spa && wantsHtml) {
    const index = await bucket(env).get(`${prefix}index.html`);
    if (index) return respond(index);
  }
  if (!preview.spa) {
    const notFound = await bucket(env).get(`${prefix}404.html`);
    if (notFound) return respond(notFound, 404);
  }
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
};

/** The preview a request is for, from its host or (shared origin) the site cookie. */
const previewIdFor = (request: Request, env: Cloudflare.Env): string | null => {
  const host = new URL(request.url).hostname.toLowerCase();
  const suffix = hostSuffix(env);
  if (suffix && host.endsWith(`.${suffix}`)) {
    const label = host.slice(0, -suffix.length - 1);
    return ID_PATTERN.test(label) ? label : null;
  }
  const site = cookieValues(request, SITE_COOKIE).find((value) => ID_PATTERN.test(value));
  return site ?? null;
};

const hasView = async (request: Request, env: Cloudflare.Env, teamId: string): Promise<boolean> => {
  for (const value of cookieValues(request, VIEW_COOKIE)) {
    const claims = await verifyToken<ViewClaims>(env, VIEW, value);
    if (claims?.t === teamId) return true;
  }
  return false;
};

export const servePreview = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const shared = !hostSuffix(env);

  if (shared && url.pathname.startsWith("/__stella/open/")) {
    const id = url.pathname.slice("/__stella/open/".length).replace(/\/+$/u, "");
    if (!ID_PATTERN.test(id)) return missing();
    return new Response(null, {
      status: 302,
      headers: { location: "/", "set-cookie": hostCookie(SITE_COOKIE, id, VIEW_TTL_MS), "cache-control": "no-store" },
    });
  }

  if (url.pathname === "/__stella/auth") {
    const grant = await verifyToken<GrantClaims>(env, GRANT, url.searchParams.get("g") ?? "");
    const hostId = shared ? null : previewIdFor(request, env);
    if (!grant || (hostId && hostId !== grant.p)) {
      return page(403, "That sign-in link expired", "<p>Open the preview link again.</p>");
    }
    const view = await signToken<ViewClaims>(env, VIEW, { t: grant.t }, VIEW_TTL_MS);
    const headers = new Headers({ location: safePath(grant.r), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    headers.append("set-cookie", hostCookie(VIEW_COOKIE, view, VIEW_TTL_MS));
    if (shared) headers.append("set-cookie", hostCookie(SITE_COOKIE, grant.p, VIEW_TTL_MS));
    return new Response(null, { status: 302, headers });
  }

  const id = previewIdFor(request, env);
  const preview = id ? await loadPreview(env, id) : null;
  if (!preview) return missing();
  const [settings, install] = await Promise.all([
    loadPreviewSettings(env, preview.team_id),
    loadInstallation(env, preview.team_id),
  ]);
  if (!install || preview.created_at + settings.ttlDays * DAY_MS <= Date.now()) return missing();
  const isPublic = settings.access === "public";
  if (!isPublic && !(await hasView(request, env, preview.team_id))) {
    const target = new URL(`${authOrigin(env)}${SIGNIN_PATH}`);
    target.searchParams.set("p", preview.id);
    target.searchParams.set("r", `${url.pathname}${url.search}`);
    if (request.headers.get("sec-fetch-mode") === "navigate") {
      return new Response(null, { status: 302, headers: { location: target.toString(), "cache-control": "no-store" } });
    }
    return page(
      401,
      `Sign in to ${install.teamName}`,
      `<p>This preview is for members of the ${escapeHtml(install.teamName)} Slack workspace.</p><a class="button" href="${escapeHtml(target.toString())}">Sign in with Slack</a>`,
    );
  }
  return await serveFile(request, env, preview, url.pathname, isPublic);
};

/** What the preview-host Worker calls. Unreachable from the public internet. */
export class SlackPreviewHost extends WorkerEntrypoint<Cloudflare.Env> {
  override async fetch(request: Request): Promise<Response> {
    try {
      return await servePreview(request, this.env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "slack_preview_serve_failed",
          message: error instanceof Error ? error.message.slice(0, 300) : String(error),
        }),
      );
      return new Response("Preview unavailable. Try again.", { status: 503, headers: { "cache-control": "no-store" } });
    }
  }
}

// ── Expiry ────────────────────────────────────────────────────────────────

/** Daily: delete the files of expired links (and of uninstalled workspaces). */
export const sweepSlackPreviews = async (env: Cloudflare.Env): Promise<number> => {
  const now = Date.now();
  const { results } = await d1(env)
    .prepare(
      `SELECT p.id FROM slack_previews p
       LEFT JOIN slack_preview_settings s ON s.team_id = p.team_id
       LEFT JOIN slack_installations i ON i.team_id = p.team_id AND i.revoked_at IS NULL
       WHERE p.deleted_at IS NULL
         AND (i.team_id IS NULL OR p.created_at + COALESCE(s.ttl_days, ?) * ? <= ?)
       LIMIT 300`,
    )
    .bind(SLACK_PREVIEW_TTL_DAYS_DEFAULT, DAY_MS, now)
    .all<{ id: string }>();
  for (const { id } of results) {
    await deletePrefix(env, `${KEY_PREFIX}/${id}/`);
    await d1(env).prepare("UPDATE slack_previews SET deleted_at = ? WHERE id = ?").bind(now, id).run();
  }
  return results.length;
};
