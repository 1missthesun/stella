import { GoogleApiError, type Fetcher } from "../../integrations/google.js";
import type { OwnerDb, OwnerDbReader } from "../registry.js";

export const FAKE_GMAIL_MIGRATION = {
  id: "email.8-fake-gmail",
  statements: [
    `CREATE TABLE email_fake_inboxes (
       email TEXT PRIMARY KEY,
       history_id INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE email_fake_messages (
       id TEXT PRIMARY KEY,
       inbox TEXT NOT NULL,
       thread_id TEXT NOT NULL,
       draft_id TEXT,
       raw TEXT NOT NULL,
       labels TEXT NOT NULL,
       internal_date INTEGER NOT NULL,
       history_id INTEGER NOT NULL
     )`,
    `CREATE INDEX email_fake_messages_inbox ON email_fake_messages (inbox, history_id)`,
  ],
};

export const FAKE_GMAIL_DOMAIN = "fake-gmail.test";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export const fakeGmailEnabled = (env: unknown): boolean => {
  const value = (env as Record<string, unknown>).STELLA_TEST_ACCOUNTS;
  return typeof value === "string" && value.trim() === "1";
};

export const fakeGmailInboxes = (ctx: { db: OwnerDbReader; env: unknown }): string[] =>
  fakeGmailEnabled(ctx.env)
    ? ctx.db.all<{ email: string }>("SELECT email FROM email_fake_inboxes ORDER BY created_at").map((row) => row.email)
    : [];

export const addFakeGmailInbox = (db: OwnerDb, email: string, now: number): void => {
  db.run("INSERT INTO email_fake_inboxes (email, history_id, created_at) VALUES (?, 1, ?) ON CONFLICT (email) DO NOTHING", email, now);
};

export const removeFakeGmailInbox = (db: OwnerDb, email: string): void => {
  db.run("DELETE FROM email_fake_messages WHERE inbox = ?", email);
  db.run("DELETE FROM email_fake_inboxes WHERE email = ?", email);
};

type Part = { headers: { name: string; value: string }[]; mimeType: string; text: string; parts: Part[] };

const decodeWords = (value: string): string =>
  value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/gu, (_match, _charset: string, kind: string, data: string) => {
    try {
      const bytes =
        kind.toLowerCase() === "b"
          ? Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
          : qpBytes(data.replace(/_/gu, " "));
      return new TextDecoder().decode(bytes);
    } catch {
      return data;
    }
  });

const qpBytes = (text: string): Uint8Array => {
  const out: number[] = [];
  const source = text.replace(/=\r?\n/gu, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "=" && /^[0-9A-Fa-f]{2}$/u.test(source.slice(index + 1, index + 3))) {
      out.push(parseInt(source.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      out.push(...new TextEncoder().encode(char));
    }
  }
  return Uint8Array.from(out);
};

const parsePart = (raw: string): Part => {
  const text = raw.replace(/\r\n/gu, "\n");
  const split = text.indexOf("\n\n");
  const head = split === -1 ? text : text.slice(0, split);
  const body = split === -1 ? "" : text.slice(split + 2);
  const headers: { name: string; value: string }[] = [];
  for (const line of head.split("\n")) {
    if (/^[ \t]/u.test(line) && headers.length > 0) headers[headers.length - 1]!.value += ` ${line.trim()}`;
    else {
      const colon = line.indexOf(":");
      if (colon > 0) headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
    }
  }
  for (const header of headers) header.value = decodeWords(header.value);
  const find = (name: string) => headers.find((header) => header.name.toLowerCase() === name)?.value ?? "";
  const type = find("content-type") || "text/plain";
  const mimeType = type.split(";")[0]!.trim().toLowerCase();
  const boundary = /boundary="?([^";]+)"?/iu.exec(type)?.[1];
  if (mimeType.startsWith("multipart/") && boundary) {
    const parts = body
      .split(`--${boundary}`)
      .slice(1)
      .filter((chunk) => !chunk.startsWith("--"))
      .map((chunk) => parsePart(chunk.replace(/^\n/u, "")));
    return { headers, mimeType, text: "", parts };
  }
  const encoding = find("content-transfer-encoding").toLowerCase();
  let decoded = body;
  try {
    if (encoding === "base64") decoded = new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s+/gu, "")), (char) => char.charCodeAt(0)));
    else if (encoding === "quoted-printable") decoded = new TextDecoder().decode(qpBytes(body));
  } catch {
    decoded = body;
  }
  return { headers, mimeType, text: decoded, parts: [] };
};

const base64Url = (text: string): string => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
};

const fromBase64Url = (data: string): string => {
  const padded = data.replace(/-/gu, "+").replace(/_/gu, "/");
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)), (char) => char.charCodeAt(0)),
  );
};

const plainOf = (part: Part): string =>
  part.parts.length > 0 ? part.parts.map(plainOf).filter(Boolean).join("\n") : part.mimeType === "text/plain" ? part.text : "";

const headerValue = (part: Part, name: string): string =>
  part.headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";

const payloadOf = (part: Part, withBody: boolean): Record<string, unknown> => ({
  mimeType: part.mimeType,
  headers: part.headers,
  body: withBody && part.parts.length === 0 ? { size: part.text.length, data: base64Url(part.text) } : { size: 0 },
  ...(withBody && part.parts.length > 0 ? { parts: part.parts.map((child) => payloadOf(child, true)) } : {}),
});

type Row = {
  id: string;
  inbox: string;
  thread_id: string;
  draft_id: string | null;
  raw: string;
  labels: string;
  internal_date: number;
  history_id: number;
};

const labelsOf = (row: Row): string[] => JSON.parse(row.labels) as string[];

const newId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const bumpHistory = (db: OwnerDb, inbox: string): number => {
  db.run("UPDATE email_fake_inboxes SET history_id = history_id + 1 WHERE email = ?", inbox);
  return db.one<{ history_id: number }>("SELECT history_id FROM email_fake_inboxes WHERE email = ?", inbox)?.history_id ?? 1;
};

const messageJson = (row: Row, format: string): Record<string, unknown> => {
  const part = parsePart(row.raw);
  const snippet = plainOf(part).replace(/\s+/gu, " ").trim().slice(0, 200);
  return {
    id: row.id,
    threadId: row.thread_id,
    labelIds: labelsOf(row),
    snippet,
    historyId: String(row.history_id),
    internalDate: String(row.internal_date),
    ...(format === "minimal" ? {} : { payload: payloadOf(part, format !== "metadata") }),
  };
};

const insert = (db: OwnerDb, inbox: string, raw: string, labels: string[], now: number, threadId?: string, draftId?: string): Row => {
  const part = parsePart(raw);
  const date = Date.parse(headerValue(part, "Date"));
  const referenced: string[] = `${headerValue(part, "In-Reply-To")} ${headerValue(part, "References")}`.match(/<[^>]+>/gu) ?? [];
  let thread = threadId ?? "";
  if (!thread && referenced.length > 0) {
    for (const row of db.all<Row>("SELECT * FROM email_fake_messages WHERE inbox = ?", inbox)) {
      if (referenced.includes(headerValue(parsePart(row.raw), "Message-ID"))) {
        thread = row.thread_id;
        break;
      }
    }
  }
  const id = newId();
  const withId = /^message-id:/imu.test(raw.split(/\r?\n\r?\n/u)[0] ?? "") ? raw : `Message-ID: <${id}@${FAKE_GMAIL_DOMAIN}>\r\n${raw}`;
  const historyId = bumpHistory(db, inbox);
  db.run(
    `INSERT INTO email_fake_messages (id, inbox, thread_id, draft_id, raw, labels, internal_date, history_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    inbox,
    thread || id,
    draftId ?? null,
    withId,
    JSON.stringify([...new Set(labels)]),
    Number.isFinite(date) && date > 0 ? date : now,
    historyId,
  );
  return db.one<Row>("SELECT * FROM email_fake_messages WHERE id = ?", id)!;
};

const modify = (db: OwnerDb, row: Row, add: string[], remove: string[]): void => {
  const labels = new Set(labelsOf(row));
  for (const label of remove) labels.delete(label);
  for (const label of add) labels.add(label);
  const historyId = add.length > 0 ? bumpHistory(db, row.inbox) : row.history_id;
  db.run("UPDATE email_fake_messages SET labels = ?, history_id = ? WHERE id = ?", JSON.stringify([...labels]), historyId, row.id);
};

const searchable = (row: Row): { labels: string[]; from: string; to: string; subject: string; text: string } => {
  const part = parsePart(row.raw);
  const from = headerValue(part, "From").toLowerCase();
  const to = `${headerValue(part, "To")} ${headerValue(part, "Cc")}`.toLowerCase();
  const subject = headerValue(part, "Subject").toLowerCase();
  return { labels: labelsOf(row), from, to, subject, text: `${from} ${to} ${subject} ${plainOf(part).toLowerCase()}` };
};

const matches = (row: Row, query: string, now: number): boolean => {
  const tokens = query.match(/-?(?:\w+:)?(?:"[^"]*"|\([^)]*\)|\S+)/gu) ?? [];
  const fields = searchable(row);
  let explicitFolder = false;
  const check = (token: string): boolean => {
    const negate = token.startsWith("-");
    const body = negate ? token.slice(1) : token;
    const colon = /^(\w+):(.*)$/u.exec(body);
    const unquote = (value: string) => value.replace(/^["(]|[")]$/gu, "").toLowerCase();
    let result: boolean;
    if (!colon) result = fields.text.includes(unquote(body));
    else {
      const [, key, rawValue] = colon;
      const value = unquote(rawValue!);
      const alternatives = value.split(/\s+or\s+/u);
      switch (key!.toLowerCase()) {
        case "in":
          explicitFolder = true;
          result = value === "anywhere" || fields.labels.includes(value === "drafts" ? "DRAFT" : value.toUpperCase());
          break;
        case "is":
          result = value === "unread" ? fields.labels.includes("UNREAD") : value === "read" ? !fields.labels.includes("UNREAD") : fields.labels.includes(value.toUpperCase());
          break;
        case "label":
          result = fields.labels.includes(value.toUpperCase());
          break;
        case "from":
          result = alternatives.some((entry) => fields.from.includes(entry.replace(/^\*/u, "")));
          break;
        case "to":
          result = alternatives.some((entry) => fields.to.includes(entry));
          break;
        case "subject":
          result = alternatives.some((entry) => fields.subject.includes(entry));
          break;
        case "newer_than":
        case "older_than": {
          const amount = /^(\d+)([dhmy])$/u.exec(value);
          const unit = amount ? { h: 3_600_000, d: 86_400_000, m: 30 * 86_400_000, y: 365 * 86_400_000 }[amount[2] as "h"] : 0;
          const edge = now - (amount ? Number(amount[1]) * unit : 0);
          result = key === "newer_than" ? row.internal_date >= edge : row.internal_date < edge;
          break;
        }
        default:
          result = fields.text.includes(value);
      }
    }
    return negate ? !result : result;
  };
  const groups: string[][] = [[]];
  for (const token of tokens) {
    if (token === "OR") groups.push([]);
    else groups[groups.length - 1]!.push(token);
  }
  const ok = groups.some((group) => group.every(check));
  if (!explicitFolder && (fields.labels.includes("TRASH") || fields.labels.includes("SPAM"))) return false;
  return ok;
};

type Init = Parameters<Fetcher>[1];

const notFound = (what: string): never => {
  throw new GoogleApiError(404, `${what} not found.`);
};

const bodyOf = (init: Init): Record<string, unknown> =>
  init?.body && typeof init.body === "object" ? (init.body as Record<string, unknown>) : {};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

export const fakeGmailFetcher = (db: OwnerDb, inbox: string, clock: () => number = Date.now): Fetcher => {
  return async (url, init) => {
    if (!url.startsWith(GMAIL)) throw new GoogleApiError(400, `The fake Gmail only answers Gmail calls, not ${url.slice(0, 80)}.`);
    const parsed = new URL(url);
    const path = parsed.pathname.slice(new URL(GMAIL).pathname.length);
    const method = (init?.method ?? "GET").toUpperCase();
    const now = clock();
    const row = (id: string): Row =>
      db.one<Row>("SELECT * FROM email_fake_messages WHERE inbox = ? AND id = ?", inbox, decodeURIComponent(id)) ?? notFound("Message");
    const historyNow = (): string =>
      String(db.one<{ history_id: number }>("SELECT history_id FROM email_fake_inboxes WHERE email = ?", inbox)?.history_id ?? 1);
    let match: RegExpExecArray | null;

    if (path === "/profile") return { emailAddress: inbox, historyId: historyNow(), messagesTotal: 0 };
    if (path === "/watch" && method === "POST") return { historyId: historyNow(), expiration: String(now + 7 * 86_400_000) };
    if (path === "/stop") return {};
    if (path === "/history") {
      const start = Number(parsed.searchParams.get("startHistoryId") ?? 0);
      const rows = db.all<Row>(
        "SELECT * FROM email_fake_messages WHERE inbox = ? AND history_id > ? ORDER BY history_id",
        inbox,
        start,
      );
      return {
        historyId: historyNow(),
        history: rows.map((entry) => ({
          id: String(entry.history_id),
          messagesAdded: [{ message: { id: entry.id, threadId: entry.thread_id, labelIds: labelsOf(entry) } }],
        })),
      };
    }
    if (path === "/messages" && method === "GET") {
      const q = parsed.searchParams.get("q") ?? "";
      const max = Math.min(Number(parsed.searchParams.get("maxResults") ?? 100) || 100, 500);
      const found = db
        .all<Row>("SELECT * FROM email_fake_messages WHERE inbox = ? ORDER BY internal_date DESC", inbox)
        .filter((entry) => matches(entry, q, now))
        .slice(0, max);
      return { messages: found.map((entry) => ({ id: entry.id, threadId: entry.thread_id })), resultSizeEstimate: found.length };
    }
    if (path === "/messages/import" || (path === "/messages" && method === "POST")) {
      const body = bodyOf(init);
      const labels = strings(body.labelIds);
      const created = insert(db, inbox, fromBase64Url(String(body.raw ?? "")), labels.length > 0 ? labels : ["INBOX", "UNREAD"], now);
      return { id: created.id, threadId: created.thread_id, labelIds: labelsOf(created) };
    }
    if (path === "/messages/send" && method === "POST") {
      const body = bodyOf(init);
      const raw = fromBase64Url(String(body.raw ?? ""));
      const withFrom = /^from:/imu.test(raw) ? raw : `From: ${inbox}\r\n${raw}`;
      const sent = insert(db, inbox, withFrom, ["SENT"], now, typeof body.threadId === "string" ? body.threadId : undefined);
      return { id: sent.id, threadId: sent.thread_id, labelIds: labelsOf(sent) };
    }
    if (path === "/messages/batchModify" && method === "POST") {
      const body = bodyOf(init);
      for (const id of strings(body.ids)) {
        const target = db.one<Row>("SELECT * FROM email_fake_messages WHERE inbox = ? AND id = ?", inbox, id);
        if (target) modify(db, target, strings(body.addLabelIds), strings(body.removeLabelIds));
      }
      return {};
    }
    if ((match = /^\/messages\/([^/]+)\/modify$/u.exec(path)) && method === "POST") {
      const body = bodyOf(init);
      const target = row(match[1]!);
      modify(db, target, strings(body.addLabelIds), strings(body.removeLabelIds));
      return messageJson(row(match[1]!), "minimal");
    }
    if ((match = /^\/messages\/([^/]+)\/attachments\/[^/]+$/u.exec(path))) return notFound("Attachment");
    if ((match = /^\/messages\/([^/]+)$/u.exec(path)) && method === "GET") {
      return messageJson(row(match[1]!), parsed.searchParams.get("format") ?? "full");
    }
    if ((match = /^\/threads\/([^/]+)$/u.exec(path)) && method === "GET") {
      const id = decodeURIComponent(match[1]!);
      const rows = db.all<Row>("SELECT * FROM email_fake_messages WHERE inbox = ? AND thread_id = ? ORDER BY internal_date", inbox, id);
      if (rows.length === 0) notFound("Thread");
      return { id, messages: rows.map((entry) => messageJson(entry, parsed.searchParams.get("format") ?? "full")) };
    }
    if ((match = /^\/threads\/([^/]+)\/modify$/u.exec(path)) && method === "POST") {
      const body = bodyOf(init);
      const rows = db.all<Row>("SELECT * FROM email_fake_messages WHERE inbox = ? AND thread_id = ?", inbox, decodeURIComponent(match[1]!));
      if (rows.length === 0) notFound("Thread");
      for (const entry of rows) modify(db, entry, strings(body.addLabelIds), strings(body.removeLabelIds));
      return { id: match[1] };
    }
    if (path === "/drafts" && method === "POST") {
      const message = (bodyOf(init).message ?? {}) as Record<string, unknown>;
      const raw = fromBase64Url(String(message.raw ?? ""));
      const draftId = `r${newId()}`;
      const draft = insert(
        db,
        inbox,
        /^from:/imu.test(raw) ? raw : `From: ${inbox}\r\n${raw}`,
        ["DRAFT"],
        now,
        typeof message.threadId === "string" ? message.threadId : undefined,
        draftId,
      );
      return { id: draftId, message: { id: draft.id, threadId: draft.thread_id, labelIds: labelsOf(draft) } };
    }
    if ((match = /^\/drafts\/([^/]+)$/u.exec(path)) && method === "DELETE") {
      const id = decodeURIComponent(match[1]!);
      if (!db.one("SELECT 1 AS present FROM email_fake_messages WHERE inbox = ? AND draft_id = ?", inbox, id)) notFound("Draft");
      db.run("DELETE FROM email_fake_messages WHERE inbox = ? AND draft_id = ?", inbox, id);
      return init?.text ? "" : {};
    }
    throw new GoogleApiError(400, `The fake Gmail doesn't answer ${method} ${path}.`);
  };
};

export const fakeGmailList = (db: OwnerDbReader, inbox: string): { id: string; threadId: string; labels: string[]; from: string; to: string; subject: string; at: number }[] =>
  db.all<Row>("SELECT * FROM email_fake_messages WHERE inbox = ? ORDER BY internal_date DESC", inbox).map((row) => {
    const part = parsePart(row.raw);
    return {
      id: row.id,
      threadId: row.thread_id,
      labels: labelsOf(row),
      from: headerValue(part, "From"),
      to: headerValue(part, "To"),
      subject: headerValue(part, "Subject"),
      at: row.internal_date,
    };
  });
