/**
 * Stella's own Google connection for the cloud: a Web OAuth client in
 * Stella's Google project, tokens kept in the owner's store, and plain
 * Google REST calls instead of Composio. One Google sign-in covers Gmail,
 * Calendar, Drive, Docs, Sheets and Tasks.
 */
import type { IntegrationAction, IntegrationCatalogEntry } from "@stella/contracts/backend/integrations";

export const GOOGLE_STATE_KIND = "google";
export const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const REQUEST_TIMEOUT_MS = 30_000;

/** Only the scopes approved for Stella's Google app. */
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/tasks",
] as const;

export type GoogleClient = { clientId: string; clientSecret: string };

export type GoogleTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  id_token?: unknown;
  error?: unknown;
};

const readString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** `GOOGLE_CLOUD_OAUTH_CLIENT_JSON` = {"clientId":"…","clientSecret":"…"} (a worker secret). */
export const googleClient = (env: Cloudflare.Env): GoogleClient | null => {
  const raw = (env as unknown as Record<string, unknown>).GOOGLE_CLOUD_OAUTH_CLIENT_JSON;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clientId = readString(parsed.clientId);
    const clientSecret = readString(parsed.clientSecret);
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  } catch {
    return null;
  }
};

export const buildGoogleAuthorizationUrl = (args: {
  clientId: string;
  redirectUri: string;
  state: string;
  loginHint?: string;
}): string => {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", args.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  if (args.loginHint) url.searchParams.set("login_hint", args.loginHint);
  return url.toString();
};

export const requestGoogleToken = async (
  client: GoogleClient,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: GoogleTokenResponse }> => {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      ...params,
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = ((await response.json().catch(() => ({}))) ?? {}) as GoogleTokenResponse;
  return { ok: response.ok, status: response.status, body };
};

export const revokeGoogleToken = async (token: string): Promise<void> => {
  await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);
};

export const readGoogleIdentity = async (
  accessToken: string,
): Promise<{ email: string; googleUserId: string | null } | null> => {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const body = ((await response.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const email = readString(body.email).toLowerCase();
  if (!email.includes("@")) return null;
  return { email, googleUserId: readString(body.sub) || null };
};

export const parseGoogleScope = (scope: unknown): string[] =>
  typeof scope === "string" ? scope.split(/\s+/u).filter(Boolean) : [];

// ---------------------------------------------------------------------------
// Catalog: the Google integrations Stella connects itself.

type GoogleService = {
  id: string;
  name: string;
  category: string;
  description: string;
  iconUrl: string;
  /** Scope the user must have granted for this integration's tools. */
  scope: string;
};

export const GOOGLE_SERVICES: readonly GoogleService[] = [
  {
    id: "gmail",
    name: "Gmail",
    category: "email",
    description: "Read, search, send and organize email in Gmail.",
    iconUrl: "https://logos.composio.dev/api/gmail",
    scope: "https://www.googleapis.com/auth/gmail.modify",
  },
  {
    id: "googlecalendar",
    name: "Google Calendar",
    category: "productivity",
    description: "See, create and change events in Google Calendar.",
    iconUrl: "https://logos.composio.dev/api/googlecalendar",
    scope: "https://www.googleapis.com/auth/calendar",
  },
  {
    id: "googledrive",
    name: "Google Drive",
    category: "productivity",
    description: "Find, read, create and share files in Google Drive.",
    iconUrl: "https://logos.composio.dev/api/googledrive",
    scope: "https://www.googleapis.com/auth/drive",
  },
  {
    id: "googledocs",
    name: "Google Docs",
    category: "productivity",
    description: "Read, create and edit Google Docs.",
    iconUrl: "https://logos.composio.dev/api/googledocs",
    scope: "https://www.googleapis.com/auth/documents",
  },
  {
    id: "googlesheets",
    name: "Google Sheets",
    category: "productivity",
    description: "Read and write Google Sheets.",
    iconUrl: "https://logos.composio.dev/api/googlesheets",
    scope: "https://www.googleapis.com/auth/spreadsheets",
  },
  {
    id: "googletasks",
    name: "Google Tasks",
    category: "productivity",
    description: "See, add and complete items in Google Tasks.",
    iconUrl: "https://logos.composio.dev/api/googletasks",
    scope: "https://www.googleapis.com/auth/tasks",
  },
];

export const isStellaGoogleIntegration = (id: string): boolean =>
  GOOGLE_SERVICES.some((service) => service.id === id);

export const googleServiceOf = (id: string): GoogleService | undefined =>
  GOOGLE_SERVICES.find((service) => service.id === id);

const CATALOG_UPDATED_AT = Date.UTC(2026, 10, 8);

export const stellaGoogleCatalogEntry = (id: string): IntegrationCatalogEntry | null => {
  const service = googleServiceOf(id);
  if (!service) return null;
  return {
    id: service.id,
    name: service.name,
    provider: "stella",
    category: service.category,
    auth: ["OAUTH2"],
    catalogToolCount: googleActionsFor(service.id).length,
    description: service.description,
    iconUrl: service.iconUrl,
    status: "ready",
    enabled: true,
    updatedAt: CATALOG_UPDATED_AT,
    connector: { type: "stella", toolkit: service.id },
  };
};

// ---------------------------------------------------------------------------
// Actions.

type JsonObject = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export class GoogleApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Fetcher = (url: string, init?: { method?: string; body?: unknown; raw?: BodyInit; contentType?: string }) => Promise<unknown>;

const fetcherFor = (accessToken: string): Fetcher => async (url, init = {}) => {
  const method = init.method ?? "GET";
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.contentType ? { "content-type": init.contentType } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    ...(init.raw !== undefined ? { body: init.raw } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 204) return { ok: true };
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json")
    ? await response.json().catch(() => null)
    : { text: await response.text().catch(() => "") };
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const message =
      (error && typeof error.message === "string" && error.message) ||
      (isRecord(payload) && typeof payload.error_description === "string" && payload.error_description) ||
      `Google answered ${response.status}.`;
    throw new GoogleApiError(response.status, message.slice(0, 500));
  }
  return payload;
};

const str = (input: JsonObject, key: string): string | undefined => {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const num = (input: JsonObject, key: string, fallback: number, max: number): number => {
  const value = Number(input[key]);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
};

const strList = (input: JsonObject, key: string): string[] => {
  const value = input[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
};

const need = (input: JsonObject, key: string): string => {
  const value = str(input, key);
  if (!value) throw new GoogleApiError(400, `\`${key}\` is required.`);
  return value;
};

const enc = encodeURIComponent;

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

// Gmail helpers ------------------------------------------------------------

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

const base64UrlDecode = (data: string): string => {
  const padded = data.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

const base64UrlEncode = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
};

const headerOf = (headers: unknown, name: string): string | undefined => {
  if (!Array.isArray(headers)) return undefined;
  const found = headers.find(
    (header) => isRecord(header) && typeof header.name === "string" && header.name.toLowerCase() === name.toLowerCase(),
  ) as JsonObject | undefined;
  return typeof found?.value === "string" ? found.value : undefined;
};

const stripHtml = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s*\n+/gu, "\n\n")
    .trim();

const MAX_BODY_CHARS = 20_000;

const messageBody = (payload: unknown): { text: string; attachments: JsonObject[] } => {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: JsonObject[] = [];
  const walk = (part: unknown) => {
    if (!isRecord(part)) return;
    const mime = typeof part.mimeType === "string" ? part.mimeType : "";
    const body = isRecord(part.body) ? part.body : {};
    const filename = typeof part.filename === "string" ? part.filename : "";
    if (filename && typeof body.attachmentId === "string") {
      attachments.push({ filename, mimeType: mime, size: body.size, attachmentId: body.attachmentId });
    } else if (typeof body.data === "string") {
      if (mime === "text/plain") plain.push(base64UrlDecode(body.data));
      else if (mime === "text/html") html.push(base64UrlDecode(body.data));
    }
    if (Array.isArray(part.parts)) part.parts.forEach(walk);
  };
  walk(payload);
  const text = plain.length > 0 ? plain.join("\n") : stripHtml(html.join("\n"));
  return { text: text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text, attachments };
};

const summarizeMessage = (message: JsonObject): JsonObject => {
  const payload = isRecord(message.payload) ? message.payload : {};
  const headers = payload.headers;
  const internal = Number(message.internalDate);
  return {
    id: message.id,
    threadId: message.threadId,
    from: headerOf(headers, "From"),
    to: headerOf(headers, "To"),
    subject: headerOf(headers, "Subject") ?? "(no subject)",
    date: Number.isFinite(internal) ? new Date(internal).toISOString() : headerOf(headers, "Date"),
    snippet: message.snippet,
    labelIds: message.labelIds,
  };
};

const buildMime = (input: JsonObject, extraHeaders: Record<string, string> = {}): string => {
  const to = strList(input, "to");
  if (to.length === 0) throw new GoogleApiError(400, "`to` is required.");
  const cc = strList(input, "cc");
  const bcc = strList(input, "bcc");
  const subject = str(input, "subject") ?? "";
  const body = typeof input.body === "string" ? input.body : "";
  const html = input.is_html === true;
  const encodedSubject = /^[\x20-\x7e]*$/u.test(subject) ? subject : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`;
  const lines = [
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${encodedSubject}`,
    ...Object.entries(extraHeaders).map(([key, value]) => `${key}: ${value}`),
    "MIME-Version: 1.0",
    `Content-Type: ${html ? "text/html" : "text/plain"}; charset="UTF-8"`,
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ];
  return lines.join("\r\n");
};

const replyHeaders = async (get: Fetcher, input: JsonObject): Promise<{ headers: Record<string, string>; threadId?: string }> => {
  const replyTo = str(input, "reply_to_message_id");
  if (!replyTo) return { headers: {}, ...(str(input, "thread_id") ? { threadId: str(input, "thread_id")! } : {}) };
  const original = (await get(
    `${GMAIL}/messages/${enc(replyTo)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
  )) as JsonObject;
  const headers = isRecord(original.payload) ? original.payload.headers : undefined;
  const messageId = headerOf(headers, "Message-ID");
  const references = headerOf(headers, "References");
  return {
    headers: messageId
      ? { "In-Reply-To": messageId, References: references ? `${references} ${messageId}` : messageId }
      : {},
    ...(typeof original.threadId === "string" ? { threadId: original.threadId } : {}),
  };
};

// Drive helpers ------------------------------------------------------------

const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_FILE_FIELDS = "id,name,mimeType,modifiedTime,size,webViewLink,owners(emailAddress),parents";
const MAX_FILE_CHARS = 60_000;

const EXPORT_TYPES: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.drawing": "image/svg+xml",
};

const readDriveFile = async (accessToken: string, get: Fetcher, fileId: string): Promise<JsonObject> => {
  const meta = (await get(`${DRIVE}/files/${enc(fileId)}?fields=${enc(DRIVE_FILE_FIELDS)}&supportsAllDrives=true`)) as JsonObject;
  const mime = typeof meta.mimeType === "string" ? meta.mimeType : "";
  const exportType = EXPORT_TYPES[mime];
  const textLike = /^(text\/|application\/(json|xml|javascript|x-yaml|csv))/u.test(mime);
  if (!exportType && !textLike) {
    return { file: meta, content: null, note: "This file isn't text. Use its webViewLink to open it." };
  }
  const url = exportType
    ? `${DRIVE}/files/${enc(fileId)}/export?mimeType=${enc(exportType)}`
    : `${DRIVE}/files/${enc(fileId)}?alt=media&supportsAllDrives=true`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new GoogleApiError(response.status, `Could not read the file (${response.status}).`);
  const text = await response.text();
  return {
    file: meta,
    content: text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}…` : text,
    ...(text.length > MAX_FILE_CHARS ? { truncated: true } : {}),
  };
};

// Docs helpers -------------------------------------------------------------

const DOCS = "https://docs.googleapis.com/v1/documents";

const docText = (doc: JsonObject): string => {
  const out: string[] = [];
  const walk = (content: unknown) => {
    if (!Array.isArray(content)) return;
    for (const element of content) {
      if (!isRecord(element)) continue;
      if (isRecord(element.paragraph) && Array.isArray(element.paragraph.elements)) {
        for (const run of element.paragraph.elements) {
          if (isRecord(run) && isRecord(run.textRun) && typeof run.textRun.content === "string") out.push(run.textRun.content);
        }
      }
      if (isRecord(element.table) && Array.isArray(element.table.tableRows)) {
        for (const row of element.table.tableRows) {
          if (!isRecord(row) || !Array.isArray(row.tableCells)) continue;
          for (const cell of row.tableCells) if (isRecord(cell)) walk(cell.content);
        }
      }
    }
  };
  walk(isRecord(doc.body) ? doc.body.content : undefined);
  const text = out.join("");
  return text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}…` : text;
};

const docEndIndex = (doc: JsonObject): number => {
  const content = isRecord(doc.body) && Array.isArray(doc.body.content) ? doc.body.content : [];
  const last = content[content.length - 1];
  const end = isRecord(last) ? Number(last.endIndex) : 1;
  return Math.max(1, (Number.isFinite(end) ? end : 1) - 1);
};

// Calendar helpers ---------------------------------------------------------

const CALENDAR = "https://www.googleapis.com/calendar/v3";

const timeOf = (value: unknown, timeZone?: string, allDay?: boolean): JsonObject | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value.trim();
  if (allDay || /^\d{4}-\d{2}-\d{2}$/u.test(text)) return { date: text.slice(0, 10) };
  return { dateTime: text, ...(timeZone ? { timeZone } : {}) };
};

const eventBody = (input: JsonObject): JsonObject => {
  const timeZone = str(input, "time_zone");
  const allDay = input.all_day === true;
  const attendees = strList(input, "attendees");
  const start = timeOf(input.start, timeZone, allDay);
  const end = timeOf(input.end, timeZone, allDay);
  return {
    ...(str(input, "summary") ? { summary: str(input, "summary") } : {}),
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(typeof input.location === "string" ? { location: input.location } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
    ...(input.add_meet_link === true
      ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : {}),
  };
};

const summarizeEvent = (event: unknown): JsonObject | null => {
  if (!isRecord(event)) return null;
  const start = isRecord(event.start) ? (event.start.dateTime ?? event.start.date) : undefined;
  const end = isRecord(event.end) ? (event.end.dateTime ?? event.end.date) : undefined;
  return {
    id: event.id,
    summary: event.summary,
    start,
    end,
    location: event.location,
    description: typeof event.description === "string" ? event.description.slice(0, 2_000) : undefined,
    attendees: Array.isArray(event.attendees)
      ? event.attendees.flatMap((attendee) =>
          isRecord(attendee) ? [{ email: attendee.email, responseStatus: attendee.responseStatus }] : [],
        )
      : undefined,
    hangoutLink: event.hangoutLink,
    htmlLink: event.htmlLink,
    status: event.status,
  };
};

// Sheets / Tasks -----------------------------------------------------------

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const TASKS = "https://tasks.googleapis.com/tasks/v1";

// Generic request: the full REST API of one service, for anything the named
// actions don't cover.
const SERVICE_HOSTS: Record<string, { base: string; prefixes: string[] }> = {
  gmail: { base: "https://gmail.googleapis.com", prefixes: ["/gmail/v1/users/me/"] },
  googlecalendar: { base: "https://www.googleapis.com", prefixes: ["/calendar/v3/"] },
  googledrive: { base: "https://www.googleapis.com", prefixes: ["/drive/v3/", "/upload/drive/v3/"] },
  googledocs: { base: "https://docs.googleapis.com", prefixes: ["/v1/documents"] },
  googlesheets: { base: "https://sheets.googleapis.com", prefixes: ["/v4/spreadsheets"] },
  googletasks: { base: "https://tasks.googleapis.com", prefixes: ["/tasks/v1/"] },
};

type ActionSpec = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  destructive?: boolean;
  schema: JsonObject;
  run: (ctx: { get: Fetcher; accessToken: string; input: JsonObject }) => Promise<unknown>;
};

const obj = (properties: JsonObject, required: string[] = []): JsonObject => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const S = (description: string): JsonObject => ({ type: "string", description });
const N = (description: string): JsonObject => ({ type: "integer", description });
const B = (description: string): JsonObject => ({ type: "boolean", description });
const SA = (description: string): JsonObject => ({ type: "array", items: { type: "string" }, description });

const requestAction = (id: string, label: string, example: string): ActionSpec => ({
  name: `${id.toUpperCase()}_API_REQUEST`,
  title: `${label} API request`,
  description: `Call any ${label} REST endpoint the other tools don't cover. path is relative to ${SERVICE_HOSTS[id]!.base}, e.g. ${example}.`,
  readOnly: false,
  schema: obj(
    {
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      path: S(`API path starting with ${SERVICE_HOSTS[id]!.prefixes.join(" or ")}`),
      query: { type: "object", additionalProperties: true, description: "Query parameters." },
      body: { type: "object", additionalProperties: true, description: "JSON body." },
    },
    ["path"],
  ),
  run: async ({ get, input }) => {
    const host = SERVICE_HOSTS[id]!;
    const path = need(input, "path");
    if (!host.prefixes.some((prefix) => path.startsWith(prefix)) || path.includes("..")) {
      throw new GoogleApiError(400, `path must start with ${host.prefixes.join(" or ")}.`);
    }
    const url = new URL(path, host.base);
    if (isRecord(input.query)) {
      for (const [key, value] of Object.entries(input.query)) {
        if (value === undefined || value === null) continue;
        for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
      }
    }
    const method = (str(input, "method") ?? "GET").toUpperCase();
    return await get(url.toString(), { method, ...(isRecord(input.body) ? { body: input.body } : {}) });
  },
});

const ACTIONS: Record<string, ActionSpec[]> = {
  gmail: [
    {
      name: "GMAIL_GET_PROFILE",
      title: "Get Gmail profile",
      description: "The connected Gmail address and mailbox totals.",
      readOnly: true,
      schema: obj({}),
      run: async ({ get }) => await get(`${GMAIL}/profile`),
    },
    {
      name: "GMAIL_SEARCH_EMAILS",
      title: "Search emails",
      description:
        "Search Gmail with Gmail search syntax (e.g. `from:alex is:unread newer_than:7d`). Returns sender, subject, date and snippet for each match, newest first.",
      readOnly: true,
      schema: obj({
        query: S("Gmail search query. Empty lists the newest mail."),
        max_results: N("How many (1-50, default 10)."),
        label_ids: SA("Only messages with all these label ids, e.g. INBOX, UNREAD."),
        page_token: S("nextPageToken from a previous call."),
        include_spam_trash: B("Include Spam and Trash."),
      }),
      run: async ({ get, input }) => {
        const labels = strList(input, "label_ids");
        const list = (await get(
          `${GMAIL}/messages${qs({
            q: str(input, "query"),
            maxResults: num(input, "max_results", 10, 50),
            pageToken: str(input, "page_token"),
            includeSpamTrash: input.include_spam_trash === true ? true : undefined,
          })}${labels.map((label) => `&labelIds=${enc(label)}`).join("")}`,
        )) as JsonObject;
        const ids = Array.isArray(list.messages) ? list.messages : [];
        const messages = await Promise.all(
          ids.map(async (entry) =>
            summarizeMessage(
              (await get(
                `${GMAIL}/messages/${enc(String((entry as JsonObject).id))}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
              )) as JsonObject,
            ),
          ),
        );
        return {
          messages,
          ...(list.nextPageToken ? { nextPageToken: list.nextPageToken } : {}),
          resultSizeEstimate: list.resultSizeEstimate,
        };
      },
    },
    {
      name: "GMAIL_GET_EMAIL",
      title: "Read an email",
      description: "One email's headers, plain-text body and attachment list.",
      readOnly: true,
      schema: obj({ message_id: S("Message id from a search.") }, ["message_id"]),
      run: async ({ get, input }) => {
        const message = (await get(`${GMAIL}/messages/${enc(need(input, "message_id"))}?format=full`)) as JsonObject;
        const { text, attachments } = messageBody(message.payload);
        return { ...summarizeMessage(message), cc: headerOf(isRecord(message.payload) ? message.payload.headers : undefined, "Cc"), body: text, attachments };
      },
    },
    {
      name: "GMAIL_GET_THREAD",
      title: "Read a thread",
      description: "Every email in a conversation, oldest first, with plain-text bodies.",
      readOnly: true,
      schema: obj({ thread_id: S("Thread id.") }, ["thread_id"]),
      run: async ({ get, input }) => {
        const thread = (await get(`${GMAIL}/threads/${enc(need(input, "thread_id"))}?format=full`)) as JsonObject;
        const messages = Array.isArray(thread.messages) ? thread.messages : [];
        return {
          id: thread.id,
          messages: messages.map((message) => {
            const record = message as JsonObject;
            const body = messageBody(record.payload).text;
            return { ...summarizeMessage(record), body: body.slice(0, 6_000) };
          }),
        };
      },
    },
    {
      name: "GMAIL_SEND_EMAIL",
      title: "Send an email",
      description:
        "Send an email. To reply in a thread, pass reply_to_message_id (the message being answered); the subject should usually start with Re:.",
      readOnly: false,
      schema: obj(
        {
          to: SA("Recipients."),
          cc: SA("Cc."),
          bcc: SA("Bcc."),
          subject: S("Subject."),
          body: S("Body text (or HTML when is_html)."),
          is_html: B("Body is HTML."),
          reply_to_message_id: S("Message id this replies to."),
        },
        ["to", "body"],
      ),
      run: async ({ get, input }) => {
        const reply = await replyHeaders(get, input);
        return await get(`${GMAIL}/messages/send`, {
          method: "POST",
          body: { raw: base64UrlEncode(buildMime(input, reply.headers)), ...(reply.threadId ? { threadId: reply.threadId } : {}) },
        });
      },
    },
    {
      name: "GMAIL_CREATE_DRAFT",
      title: "Create a draft",
      description: "Save an email as a draft without sending it. reply_to_message_id threads it as a reply.",
      readOnly: false,
      schema: obj(
        {
          to: SA("Recipients."),
          cc: SA("Cc."),
          bcc: SA("Bcc."),
          subject: S("Subject."),
          body: S("Body text (or HTML when is_html)."),
          is_html: B("Body is HTML."),
          reply_to_message_id: S("Message id this replies to."),
        },
        ["to", "body"],
      ),
      run: async ({ get, input }) => {
        const reply = await replyHeaders(get, input);
        return await get(`${GMAIL}/drafts`, {
          method: "POST",
          body: {
            message: {
              raw: base64UrlEncode(buildMime(input, reply.headers)),
              ...(reply.threadId ? { threadId: reply.threadId } : {}),
            },
          },
        });
      },
    },
    {
      name: "GMAIL_MODIFY_LABELS",
      title: "Label, archive or mark emails",
      description:
        "Add or remove labels on emails. Mark read: remove UNREAD. Archive: remove INBOX. Star: add STARRED.",
      readOnly: false,
      schema: obj(
        { message_ids: SA("Message ids."), add_label_ids: SA("Labels to add."), remove_label_ids: SA("Labels to remove.") },
        ["message_ids"],
      ),
      run: async ({ get, input }) => {
        const ids = strList(input, "message_ids");
        if (ids.length === 0) throw new GoogleApiError(400, "`message_ids` is required.");
        await get(`${GMAIL}/messages/batchModify`, {
          method: "POST",
          body: { ids, addLabelIds: strList(input, "add_label_ids"), removeLabelIds: strList(input, "remove_label_ids") },
        });
        return { ok: true, modified: ids.length };
      },
    },
    {
      name: "GMAIL_TRASH_EMAIL",
      title: "Move an email to Trash",
      description: "Move one email to Trash (recoverable for 30 days).",
      readOnly: false,
      destructive: true,
      schema: obj({ message_id: S("Message id.") }, ["message_id"]),
      run: async ({ get, input }) => await get(`${GMAIL}/messages/${enc(need(input, "message_id"))}/trash`, { method: "POST" }),
    },
    {
      name: "GMAIL_LIST_LABELS",
      title: "List labels",
      description: "All Gmail labels with their ids.",
      readOnly: true,
      schema: obj({}),
      run: async ({ get }) => await get(`${GMAIL}/labels`),
    },
    requestAction("gmail", "Gmail", "/gmail/v1/users/me/settings/filters"),
  ],
  googlecalendar: [
    {
      name: "GOOGLECALENDAR_LIST_CALENDARS",
      title: "List calendars",
      description: "Every calendar the account can see, with ids.",
      readOnly: true,
      schema: obj({}),
      run: async ({ get }) => {
        const list = (await get(`${CALENDAR}/users/me/calendarList?maxResults=250`)) as JsonObject;
        return {
          calendars: (Array.isArray(list.items) ? list.items : []).map((item) => {
            const calendar = item as JsonObject;
            return { id: calendar.id, summary: calendar.summary, primary: calendar.primary === true, accessRole: calendar.accessRole, timeZone: calendar.timeZone };
          }),
        };
      },
    },
    {
      name: "GOOGLECALENDAR_LIST_EVENTS",
      title: "List events",
      description:
        "Events in a time range, soonest first. Times are RFC 3339 (e.g. 2026-11-08T00:00:00-08:00). Defaults to the primary calendar from now on.",
      readOnly: true,
      schema: obj({
        calendar_id: S("Calendar id (default primary)."),
        time_min: S("Start of range, RFC 3339 (default now)."),
        time_max: S("End of range, RFC 3339."),
        query: S("Free-text search."),
        max_results: N("How many (1-250, default 25)."),
        page_token: S("nextPageToken from a previous call."),
      }),
      run: async ({ get, input }) => {
        const list = (await get(
          `${CALENDAR}/calendars/${enc(str(input, "calendar_id") ?? "primary")}/events${qs({
            timeMin: str(input, "time_min") ?? new Date().toISOString(),
            timeMax: str(input, "time_max"),
            q: str(input, "query"),
            maxResults: num(input, "max_results", 25, 250),
            pageToken: str(input, "page_token"),
            singleEvents: true,
            orderBy: "startTime",
          })}`,
        )) as JsonObject;
        return {
          timeZone: list.timeZone,
          events: (Array.isArray(list.items) ? list.items : []).map(summarizeEvent).filter(Boolean),
          ...(list.nextPageToken ? { nextPageToken: list.nextPageToken } : {}),
        };
      },
    },
    {
      name: "GOOGLECALENDAR_CREATE_EVENT",
      title: "Create an event",
      description:
        "Create an event. start/end are RFC 3339 date-times, or YYYY-MM-DD with all_day. Attendees get invites when send_updates is true.",
      readOnly: false,
      schema: obj(
        {
          calendar_id: S("Calendar id (default primary)."),
          summary: S("Title."),
          start: S("Start."),
          end: S("End."),
          time_zone: S("IANA time zone, e.g. America/Los_Angeles."),
          all_day: B("All-day event."),
          description: S("Description."),
          location: S("Location."),
          attendees: SA("Attendee emails."),
          add_meet_link: B("Add a Google Meet link."),
          send_updates: B("Email invites to attendees."),
        },
        ["summary", "start", "end"],
      ),
      run: async ({ get, input }) => {
        const event = await get(
          `${CALENDAR}/calendars/${enc(str(input, "calendar_id") ?? "primary")}/events${qs({
            sendUpdates: input.send_updates === true ? "all" : "none",
            conferenceDataVersion: input.add_meet_link === true ? 1 : undefined,
          })}`,
          { method: "POST", body: eventBody(input) },
        );
        return summarizeEvent(event);
      },
    },
    {
      name: "GOOGLECALENDAR_UPDATE_EVENT",
      title: "Change an event",
      description: "Change only the fields you pass on an existing event.",
      readOnly: false,
      schema: obj(
        {
          calendar_id: S("Calendar id (default primary)."),
          event_id: S("Event id."),
          summary: S("Title."),
          start: S("Start."),
          end: S("End."),
          time_zone: S("IANA time zone."),
          all_day: B("All-day event."),
          description: S("Description."),
          location: S("Location."),
          attendees: SA("Attendee emails (replaces the list)."),
          send_updates: B("Email attendees about the change."),
        },
        ["event_id"],
      ),
      run: async ({ get, input }) =>
        summarizeEvent(
          await get(
            `${CALENDAR}/calendars/${enc(str(input, "calendar_id") ?? "primary")}/events/${enc(need(input, "event_id"))}${qs({
              sendUpdates: input.send_updates === true ? "all" : "none",
            })}`,
            { method: "PATCH", body: eventBody(input) },
          ),
        ),
    },
    {
      name: "GOOGLECALENDAR_DELETE_EVENT",
      title: "Delete an event",
      description: "Delete an event.",
      readOnly: false,
      destructive: true,
      schema: obj(
        { calendar_id: S("Calendar id (default primary)."), event_id: S("Event id."), send_updates: B("Tell attendees.") },
        ["event_id"],
      ),
      run: async ({ get, input }) =>
        await get(
          `${CALENDAR}/calendars/${enc(str(input, "calendar_id") ?? "primary")}/events/${enc(need(input, "event_id"))}${qs({
            sendUpdates: input.send_updates === true ? "all" : "none",
          })}`,
          { method: "DELETE" },
        ),
    },
    {
      name: "GOOGLECALENDAR_FREE_BUSY",
      title: "Check free/busy",
      description: "Busy times for calendars (yours or others') in a range.",
      readOnly: true,
      schema: obj(
        { time_min: S("Start, RFC 3339."), time_max: S("End, RFC 3339."), calendar_ids: SA("Calendar ids or emails (default primary).") },
        ["time_min", "time_max"],
      ),
      run: async ({ get, input }) => {
        const ids = strList(input, "calendar_ids");
        return await get(`${CALENDAR}/freeBusy`, {
          method: "POST",
          body: {
            timeMin: need(input, "time_min"),
            timeMax: need(input, "time_max"),
            items: (ids.length ? ids : ["primary"]).map((id) => ({ id })),
          },
        });
      },
    },
    requestAction("googlecalendar", "Google Calendar", "/calendar/v3/colors"),
  ],
  googledrive: [
    {
      name: "GOOGLEDRIVE_SEARCH_FILES",
      title: "Search files",
      description:
        "Find files by name or content. `query` is plain text; `q` is raw Drive query syntax (e.g. mimeType='application/pdf'). Newest first by default.",
      readOnly: true,
      schema: obj({
        query: S("Words to find in the name or content."),
        q: S("Raw Drive query (overrides query)."),
        max_results: N("How many (1-100, default 20)."),
        order_by: S("e.g. modifiedTime desc (default), name."),
        page_token: S("nextPageToken from a previous call."),
      }),
      run: async ({ get, input }) => {
        const words = str(input, "query");
        const q =
          str(input, "q") ??
          [words ? `fullText contains '${words.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'")}'` : "", "trashed = false"]
            .filter(Boolean)
            .join(" and ");
        return await get(
          `${DRIVE}/files${qs({
            q,
            pageSize: num(input, "max_results", 20, 100),
            orderBy: words && !str(input, "order_by") ? undefined : (str(input, "order_by") ?? "modifiedTime desc"),
            pageToken: str(input, "page_token"),
            fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          })}`,
        );
      },
    },
    {
      name: "GOOGLEDRIVE_READ_FILE",
      title: "Read a file",
      description: "A file's details and its text. Docs come back as text, Sheets as CSV.",
      readOnly: true,
      schema: obj({ file_id: S("File id.") }, ["file_id"]),
      run: async ({ get, accessToken, input }) => await readDriveFile(accessToken, get, need(input, "file_id")),
    },
    {
      name: "GOOGLEDRIVE_CREATE_FILE",
      title: "Create a file",
      description:
        "Create a file from text. Set as_google_doc to make it a Google Doc (or as_google_sheet with CSV content for a Sheet).",
      readOnly: false,
      schema: obj(
        {
          name: S("File name."),
          content: S("Text content."),
          mime_type: S("Content type of `content` (default text/plain)."),
          parent_id: S("Folder id."),
          as_google_doc: B("Convert to a Google Doc."),
          as_google_sheet: B("Convert CSV content to a Google Sheet."),
        },
        ["name"],
      ),
      run: async ({ get, input }) => {
        const target = input.as_google_doc === true
          ? "application/vnd.google-apps.document"
          : input.as_google_sheet === true
            ? "application/vnd.google-apps.spreadsheet"
            : undefined;
        const contentType = str(input, "mime_type") ?? (input.as_google_sheet === true ? "text/csv" : "text/plain");
        const metadata = {
          name: need(input, "name"),
          ...(target ? { mimeType: target } : {}),
          ...(str(input, "parent_id") ? { parents: [str(input, "parent_id")] } : {}),
        };
        const boundary = `stella-${crypto.randomUUID()}`;
        const body = [
          `--${boundary}`,
          "Content-Type: application/json; charset=UTF-8",
          "",
          JSON.stringify(metadata),
          `--${boundary}`,
          `Content-Type: ${contentType}`,
          "",
          typeof input.content === "string" ? input.content : "",
          `--${boundary}--`,
        ].join("\r\n");
        return await get(
          `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${enc(DRIVE_FILE_FIELDS)}`,
          { method: "POST", raw: body, contentType: `multipart/related; boundary=${boundary}` },
        );
      },
    },
    {
      name: "GOOGLEDRIVE_CREATE_FOLDER",
      title: "Create a folder",
      description: "Create a folder.",
      readOnly: false,
      schema: obj({ name: S("Folder name."), parent_id: S("Parent folder id.") }, ["name"]),
      run: async ({ get, input }) =>
        await get(`${DRIVE}/files?supportsAllDrives=true&fields=${enc(DRIVE_FILE_FIELDS)}`, {
          method: "POST",
          body: {
            name: need(input, "name"),
            mimeType: "application/vnd.google-apps.folder",
            ...(str(input, "parent_id") ? { parents: [str(input, "parent_id")] } : {}),
          },
        }),
    },
    {
      name: "GOOGLEDRIVE_SHARE_FILE",
      title: "Share a file",
      description: "Give someone access to a file. role is reader, commenter or writer.",
      readOnly: false,
      schema: obj(
        { file_id: S("File id."), email: S("Who to share with."), role: S("reader, commenter or writer."), notify: B("Email them.") },
        ["file_id", "email"],
      ),
      run: async ({ get, input }) =>
        await get(
          `${DRIVE}/files/${enc(need(input, "file_id"))}/permissions${qs({
            sendNotificationEmail: input.notify === false ? false : true,
            supportsAllDrives: true,
          })}`,
          { method: "POST", body: { type: "user", role: str(input, "role") ?? "reader", emailAddress: need(input, "email") } },
        ),
    },
    {
      name: "GOOGLEDRIVE_TRASH_FILE",
      title: "Move a file to Trash",
      description: "Move a file to Trash (recoverable).",
      readOnly: false,
      destructive: true,
      schema: obj({ file_id: S("File id.") }, ["file_id"]),
      run: async ({ get, input }) =>
        await get(`${DRIVE}/files/${enc(need(input, "file_id"))}?supportsAllDrives=true&fields=id,name,trashed`, {
          method: "PATCH",
          body: { trashed: true },
        }),
    },
    requestAction("googledrive", "Google Drive", "/drive/v3/about?fields=user,storageQuota"),
  ],
  googledocs: [
    {
      name: "GOOGLEDOCS_GET_DOCUMENT",
      title: "Read a document",
      description: "A Google Doc's title and full text.",
      readOnly: true,
      schema: obj({ document_id: S("Document id (from its URL).") }, ["document_id"]),
      run: async ({ get, input }) => {
        const doc = (await get(`${DOCS}/${enc(need(input, "document_id"))}`)) as JsonObject;
        return { documentId: doc.documentId, title: doc.title, text: docText(doc) };
      },
    },
    {
      name: "GOOGLEDOCS_CREATE_DOCUMENT",
      title: "Create a document",
      description: "Create a Google Doc, optionally with starting text.",
      readOnly: false,
      schema: obj({ title: S("Title."), text: S("Starting text.") }, ["title"]),
      run: async ({ get, input }) => {
        const doc = (await get(DOCS, { method: "POST", body: { title: need(input, "title") } })) as JsonObject;
        const text = typeof input.text === "string" ? input.text : "";
        if (text) {
          await get(`${DOCS}/${enc(String(doc.documentId))}:batchUpdate`, {
            method: "POST",
            body: { requests: [{ insertText: { location: { index: 1 }, text } }] },
          });
        }
        return { documentId: doc.documentId, title: doc.title, url: `https://docs.google.com/document/d/${doc.documentId}/edit` };
      },
    },
    {
      name: "GOOGLEDOCS_APPEND_TEXT",
      title: "Add text to the end",
      description: "Append text to the end of a Google Doc.",
      readOnly: false,
      schema: obj({ document_id: S("Document id."), text: S("Text to add.") }, ["document_id", "text"]),
      run: async ({ get, input }) => {
        const id = need(input, "document_id");
        const doc = (await get(`${DOCS}/${enc(id)}`)) as JsonObject;
        return await get(`${DOCS}/${enc(id)}:batchUpdate`, {
          method: "POST",
          body: { requests: [{ insertText: { location: { index: docEndIndex(doc) }, text: need(input, "text") } }] },
        });
      },
    },
    {
      name: "GOOGLEDOCS_REPLACE_TEXT",
      title: "Find and replace",
      description: "Replace every match of some text in a Google Doc.",
      readOnly: false,
      schema: obj(
        { document_id: S("Document id."), find: S("Text to find."), replace: S("Replacement."), match_case: B("Match case.") },
        ["document_id", "find"],
      ),
      run: async ({ get, input }) =>
        await get(`${DOCS}/${enc(need(input, "document_id"))}:batchUpdate`, {
          method: "POST",
          body: {
            requests: [
              {
                replaceAllText: {
                  containsText: { text: need(input, "find"), matchCase: input.match_case === true },
                  replaceText: typeof input.replace === "string" ? input.replace : "",
                },
              },
            ],
          },
        }),
    },
    requestAction("googledocs", "Google Docs", "/v1/documents/<id>:batchUpdate"),
  ],
  googlesheets: [
    {
      name: "GOOGLESHEETS_GET_SPREADSHEET",
      title: "Spreadsheet details",
      description: "A spreadsheet's title and its sheets (tabs) with sizes.",
      readOnly: true,
      schema: obj({ spreadsheet_id: S("Spreadsheet id (from its URL).") }, ["spreadsheet_id"]),
      run: async ({ get, input }) =>
        await get(
          `${SHEETS}/${enc(need(input, "spreadsheet_id"))}?fields=${enc("spreadsheetId,properties.title,sheets.properties(sheetId,title,gridProperties)")}`,
        ),
    },
    {
      name: "GOOGLESHEETS_GET_VALUES",
      title: "Read cells",
      description: "Values in a range in A1 notation, e.g. Sheet1!A1:D20.",
      readOnly: true,
      schema: obj({ spreadsheet_id: S("Spreadsheet id."), range: S("A1 range.") }, ["spreadsheet_id", "range"]),
      run: async ({ get, input }) =>
        await get(`${SHEETS}/${enc(need(input, "spreadsheet_id"))}/values/${enc(need(input, "range"))}`),
    },
    {
      name: "GOOGLESHEETS_UPDATE_VALUES",
      title: "Write cells",
      description: "Write rows of values into a range. Formulas work (USER_ENTERED).",
      readOnly: false,
      schema: obj(
        {
          spreadsheet_id: S("Spreadsheet id."),
          range: S("A1 range where writing starts."),
          values: { type: "array", items: { type: "array", items: {} }, description: "Rows of cell values." },
        },
        ["spreadsheet_id", "range", "values"],
      ),
      run: async ({ get, input }) =>
        await get(
          `${SHEETS}/${enc(need(input, "spreadsheet_id"))}/values/${enc(need(input, "range"))}?valueInputOption=USER_ENTERED`,
          { method: "PUT", body: { values: Array.isArray(input.values) ? input.values : [] } },
        ),
    },
    {
      name: "GOOGLESHEETS_APPEND_ROWS",
      title: "Add rows",
      description: "Add rows after the last row of a table, e.g. range Sheet1!A1.",
      readOnly: false,
      schema: obj(
        {
          spreadsheet_id: S("Spreadsheet id."),
          range: S("A1 range of the table."),
          values: { type: "array", items: { type: "array", items: {} }, description: "Rows to add." },
        },
        ["spreadsheet_id", "range", "values"],
      ),
      run: async ({ get, input }) =>
        await get(
          `${SHEETS}/${enc(need(input, "spreadsheet_id"))}/values/${enc(need(input, "range"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: { values: Array.isArray(input.values) ? input.values : [] } },
        ),
    },
    {
      name: "GOOGLESHEETS_CREATE_SPREADSHEET",
      title: "Create a spreadsheet",
      description: "Create a new Google Sheet.",
      readOnly: false,
      schema: obj({ title: S("Title.") }, ["title"]),
      run: async ({ get, input }) => {
        const sheet = (await get(SHEETS, { method: "POST", body: { properties: { title: need(input, "title") } } })) as JsonObject;
        return { spreadsheetId: sheet.spreadsheetId, url: sheet.spreadsheetUrl };
      },
    },
    requestAction("googlesheets", "Google Sheets", "/v4/spreadsheets/<id>:batchUpdate"),
  ],
  googletasks: [
    {
      name: "GOOGLETASKS_LIST_TASK_LISTS",
      title: "List task lists",
      description: "All task lists with ids.",
      readOnly: true,
      schema: obj({}),
      run: async ({ get }) => await get(`${TASKS}/users/@me/lists?maxResults=100`),
    },
    {
      name: "GOOGLETASKS_LIST_TASKS",
      title: "List tasks",
      description: "Tasks in a list (default: the main list). Completed ones are hidden unless show_completed.",
      readOnly: true,
      schema: obj({ tasklist_id: S("Task list id (default @default)."), show_completed: B("Include completed tasks."), max_results: N("How many (1-100).") }),
      run: async ({ get, input }) =>
        await get(
          `${TASKS}/lists/${enc(str(input, "tasklist_id") ?? "@default")}/tasks${qs({
            showCompleted: input.show_completed === true,
            showHidden: input.show_completed === true ? true : undefined,
            maxResults: num(input, "max_results", 100, 100),
          })}`,
        ),
    },
    {
      name: "GOOGLETASKS_CREATE_TASK",
      title: "Add a task",
      description: "Add a task. due is a date (YYYY-MM-DD).",
      readOnly: false,
      schema: obj({ tasklist_id: S("Task list id (default @default)."), title: S("Title."), notes: S("Notes."), due: S("Due date.") }, ["title"]),
      run: async ({ get, input }) => {
        const due = str(input, "due");
        return await get(`${TASKS}/lists/${enc(str(input, "tasklist_id") ?? "@default")}/tasks`, {
          method: "POST",
          body: {
            title: need(input, "title"),
            ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
            ...(due ? { due: due.length === 10 ? `${due}T00:00:00.000Z` : due } : {}),
          },
        });
      },
    },
    {
      name: "GOOGLETASKS_UPDATE_TASK",
      title: "Change or complete a task",
      description: "Change a task's fields, or set completed true to tick it off.",
      readOnly: false,
      schema: obj(
        {
          tasklist_id: S("Task list id (default @default)."),
          task_id: S("Task id."),
          title: S("Title."),
          notes: S("Notes."),
          due: S("Due date."),
          completed: B("Done (true) or not done (false)."),
        },
        ["task_id"],
      ),
      run: async ({ get, input }) => {
        const due = str(input, "due");
        return await get(`${TASKS}/lists/${enc(str(input, "tasklist_id") ?? "@default")}/tasks/${enc(need(input, "task_id"))}`, {
          method: "PATCH",
          body: {
            ...(str(input, "title") ? { title: str(input, "title") } : {}),
            ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
            ...(due ? { due: due.length === 10 ? `${due}T00:00:00.000Z` : due } : {}),
            ...(input.completed === true ? { status: "completed" } : input.completed === false ? { status: "needsAction", completed: null } : {}),
          },
        });
      },
    },
    {
      name: "GOOGLETASKS_DELETE_TASK",
      title: "Delete a task",
      description: "Delete a task.",
      readOnly: false,
      destructive: true,
      schema: obj({ tasklist_id: S("Task list id (default @default)."), task_id: S("Task id.") }, ["task_id"]),
      run: async ({ get, input }) =>
        await get(`${TASKS}/lists/${enc(str(input, "tasklist_id") ?? "@default")}/tasks/${enc(need(input, "task_id"))}`, {
          method: "DELETE",
        }),
    },
    requestAction("googletasks", "Google Tasks", "/tasks/v1/users/@me/lists"),
  ],
};

const toAction = (spec: ActionSpec): IntegrationAction => ({
  name: spec.name,
  title: spec.title,
  description: spec.description,
  annotations: {
    readOnlyHint: spec.readOnly,
    destructiveHint: spec.destructive === true,
    idempotentHint: spec.readOnly,
    source: "composio_tool_tags",
  },
  revision: String(CATALOG_UPDATED_AT),
  inputSchema: spec.schema,
});

export const googleActionsFor = (id: string): IntegrationAction[] => (ACTIONS[id] ?? []).map(toAction);

export const googleAction = (id: string, name: string): IntegrationAction | null => {
  const spec = ACTIONS[id]?.find((action) => action.name === name);
  return spec ? toAction(spec) : null;
};

/** Runs one action with a live access token. Throws GoogleApiError (401 = token rejected). */
export const runGoogleAction = async (
  accessToken: string,
  id: string,
  name: string,
  input: JsonObject,
): Promise<unknown> => {
  const spec = ACTIONS[id]?.find((action) => action.name === name);
  if (!spec) throw new GoogleApiError(400, "This Google action is not available.");
  return await spec.run({ get: fetcherFor(accessToken), accessToken, input });
};

// Email digest -------------------------------------------------------------

/** The digest's Gmail page, fetched directly from Gmail. */
export const fetchGmailPageDirect = async (
  accessToken: string,
  query: string,
  maxResults: number,
  pageToken?: string,
): Promise<{ messages: JsonObject[]; nextPageToken?: string }> => {
  const get = fetcherFor(accessToken);
  const list = (await get(
    `${GMAIL}/messages${qs({ q: query, maxResults, pageToken })}`,
  )) as JsonObject;
  const ids = Array.isArray(list.messages) ? list.messages : [];
  const messages = await Promise.all(
    ids.map(async (entry) => {
      const message = (await get(
        `${GMAIL}/messages/${enc(String((entry as JsonObject).id))}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      )) as JsonObject;
      const headers = isRecord(message.payload) ? message.payload.headers : undefined;
      return {
        id: message.id,
        threadId: message.threadId,
        from: headerOf(headers, "From") ?? "",
        subject: headerOf(headers, "Subject") ?? "",
        snippet: typeof message.snippet === "string" ? message.snippet : "",
        internalDate: message.internalDate,
        labelIds: message.labelIds,
      };
    }),
  );
  return {
    messages,
    ...(typeof list.nextPageToken === "string" ? { nextPageToken: list.nextPageToken } : {}),
  };
};

// Callback page ------------------------------------------------------------

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);

export const googleResultPage = (success: boolean, title: string, message: string, status: number): Response =>
  new Response(
    `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
  .card { text-align: center; padding: 3rem 1.5rem; max-width: 420px; }
  .icon { font-size: 4rem; color: ${success ? "#22c55e" : "#ef4444"}; margin-bottom: 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p { color: #a3a3a3; line-height: 1.6; margin: 0; }
</style></head>
<body><div class="card"><div class="icon">${success ? "&#10003;" : "&#10007;"}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
      },
    },
  );

// Agent connector source ---------------------------------------------------

type ConnectorSourceLike = {
  catalog(): Promise<readonly IntegrationCatalogEntry[]>;
  actions(args: { id: string; action?: string; query?: string; cursor?: string; limit?: number }): Promise<
    import("@stella/contracts/backend/integrations").IntegrationActionsPage | null
  >;
};

/**
 * Wraps the agent's integration source so Google services that run on
 * Stella's own Google connection show Stella's entries and actions instead
 * of Composio's. `routes` says which do, per owner.
 */
export const withStellaGoogle = <Source extends ConnectorSourceLike>(
  base: Source,
  routes: () => Promise<Record<string, "stella" | "composio">>,
): Source => {
  let cached: Promise<Record<string, "stella" | "composio">> | undefined;
  const routesOnce = () =>
    (cached ??= routes().catch((error: unknown) => {
      cached = undefined;
      console.error(JSON.stringify({
        event: "google_routes_failed",
        message: error instanceof Error ? error.message : String(error),
      }));
      return {};
    }));
  const stellaIds = async () =>
    Object.entries(await routesOnce())
      .filter(([, route]) => route === "stella")
      .map(([id]) => id);
  return {
    ...base,
    catalog: async () => {
      const [entries, ids] = await Promise.all([base.catalog(), stellaIds()]);
      return [
        ...entries.filter((entry) => !ids.includes(entry.id)),
        ...ids.flatMap((id) => {
          const entry = stellaGoogleCatalogEntry(id);
          return entry ? [entry] : [];
        }),
      ];
    },
    actions: async (args) => {
      if (!(await stellaIds()).includes(args.id)) return await base.actions(args);
      const all = googleActionsFor(args.id);
      const words = (args.query ?? "").toLowerCase().split(/\s+/u).filter(Boolean);
      const actions = all.filter(
        (action) =>
          (!args.action || action.name === args.action) &&
          words.every((word) =>
            [action.name, action.title, action.description].join(" ").toLowerCase().includes(word),
          ),
      );
      return { id: args.id, actionCount: all.length, updatedAt: CATALOG_UPDATED_AT, actions, nextCursor: null };
    },
  };
};
