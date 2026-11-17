/**
 * Optional Gmail connection. Uses Stella's Google client (consent screen says Stella), with the
 * token exchange done by Stella's server so no secret ships in the app. Mail is read on this
 * computer; only the short facts of suspicious-looking emails go to the model.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { MailCheck } from "../scan.ts";
import { triageEmails, type EmailFacts } from "../judge.ts";
import type { Finding, HandledLine } from "../types.ts";
import { DAY, baseDomain } from "../util.ts";

export type GmailTokens = { access: string; refresh: string; expiresAt: number; email: string; connectedAt?: number };

export type GmailDeps = {
  backendUrl: string;
  authToken: () => Promise<string | undefined>;
  openUrl: (url: string) => void;
  load: () => GmailTokens | undefined;
  save: (t: GmailTokens | undefined) => void;
};

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify", "openid", "email"];
const PROVIDER = "google-workspace";

const exchange = async (deps: GmailDeps, body: Record<string, string>) => {
  const auth = await deps.authToken();
  if (!auth) throw new Error("Sign in to Stella first.");
  const r = await fetch(`${deps.backendUrl}/api/native-oauth/token`, { method: "POST", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: JSON.stringify({ provider: PROVIDER, ...body }) });
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string };
  if (!r.ok || !d.access_token) throw new Error(d.error ?? `Google didn't give access (HTTP ${r.status})`);
  return d;
};

const clientId = async (deps: GmailDeps): Promise<string> => {
  const auth = await deps.authToken();
  if (!auth) throw new Error("Sign in to Stella first.");
  const r = await fetch(`${deps.backendUrl}/api/native-oauth/providers`, { headers: { authorization: `Bearer ${auth}` } });
  const d = (await r.json().catch(() => ({}))) as { providers?: { id: string; clientId: string }[] };
  const id = d.providers?.find((p) => p.id === PROVIDER)?.clientId;
  if (!id) throw new Error("Email connection isn't available right now.");
  return id;
};

/** Opens Google's consent page; resolves once the person allows access. */
export const connectGmail = async (deps: GmailDeps, loginHint?: string): Promise<GmailTokens> => {
  const cid = await clientId(deps);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") return void res.writeHead(404).end();
      const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta name=viewport content="width=device-width"><body style="font:16px system-ui;margin:20vh auto;max-width:28em;text-align:center;color:#0a0a0b">${ok ? "<h2 style='font-weight:600'>Email connected</h2><p style='color:#6e6e73'>You can close this tab. Stella Security takes it from here.</p>" : "<h2>That didn't work</h2><p>Go back to Stella Security and try again.</p>"}</body>`);
      const addr = server.address();
      server.close();
      if (!ok) return reject(new Error(url.searchParams.get("error") ?? "Google didn't give access."));
      resolve({ code: url.searchParams.get("code")!, redirectUri: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}` });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({
        client_id: cid,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: "code",
        scope: SCOPES.join(" "),
        code_challenge: challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "select_account consent",
        state,
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();
      deps.openUrl(auth.toString());
    });
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Google."));
    }, 10 * 60_000).unref?.();
  });
  const t = await exchange(deps, { client_id: cid, code, redirect_uri: redirectUri, code_verifier: verifier, grant_type: "authorization_code" });
  const email = t.id_token ? (JSON.parse(Buffer.from(t.id_token.split(".")[1] ?? "", "base64url").toString()) as { email?: string }).email ?? "" : "";
  const tokens = { access: t.access_token!, refresh: t.refresh_token ?? "", expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000, email, connectedAt: Date.now() };
  deps.save(tokens);
  return tokens;
};

const accessToken = async (deps: GmailDeps): Promise<GmailTokens> => {
  const t = deps.load();
  if (!t) throw new Error("Email isn't connected.");
  if (t.expiresAt - 60_000 > Date.now()) return t;
  const cid = await clientId(deps);
  const r = await exchange(deps, { client_id: cid, refresh_token: t.refresh, grant_type: "refresh_token" });
  const next = { ...t, access: r.access_token!, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 };
  deps.save(next);
  return next;
};

const gmail = async <T>(deps: GmailDeps, path: string, init?: RequestInit): Promise<T> => {
  const t = await accessToken(deps);
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { ...init, headers: { authorization: `Bearer ${t.access}`, "content-type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Gmail: HTTP ${r.status}`);
  return (await r.json()) as T;
};

type Part = { mimeType?: string; body?: { data?: string; size?: number }; parts?: Part[]; filename?: string; headers?: { name: string; value: string }[] };
type Message = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part & { headers?: { name: string; value: string }[] } };

const header = (m: Message, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

const walk = (p: Part | undefined, out: { text: string[]; html: string[]; files: string[] }) => {
  if (!p) return;
  if (p.filename) out.files.push(p.filename);
  const data = p.body?.data ? Buffer.from(p.body.data, "base64url").toString("utf8") : "";
  if (data && p.mimeType === "text/plain") out.text.push(data);
  if (data && p.mimeType === "text/html") out.html.push(data);
  for (const c of p.parts ?? []) walk(c, out);
};

/** Turn a message into the short facts the judgment needs. */
export const factsOf = (m: Message): EmailFacts => {
  const parts = { text: [] as string[], html: [] as string[], files: [] as string[] };
  walk(m.payload, parts);
  const html = parts.html.join("\n");
  const links: { text: string; host: string }[] = [];
  for (const a of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const host = new URL(a[1]!).hostname;
      const text = a[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
      if (host && !links.some((l) => l.host === host && l.text === text)) links.push({ text, host });
    } catch {
      /* mailto: etc */
    }
  }
  const text = (parts.text.join("\n") || html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const ar = header(m, "Authentication-Results");
  const auth = ["spf", "dkim", "dmarc"].map((k) => `${k}=${ar.match(new RegExp(`${k}=(\\w+)`, "i"))?.[1] ?? "none"}`).join(" ");
  const replyTo = header(m, "Reply-To");
  return {
    key: m.id,
    from: header(m, "From"),
    ...(replyTo ? { replyTo } : {}),
    subject: header(m, "Subject"),
    date: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    auth,
    links: links.slice(0, 8),
    attachments: parts.files.slice(0, 6),
    snippet: text.slice(0, 600),
  };
};

const BIG_BRANDS = /paypal|apple|icloud|microsoft|outlook|office|google|gmail|amazon|netflix|bank|chase|wells|citi|capital one|amex|american express|venmo|zelle|cash app|coinbase|binance|metamask|ledger|trezor|usps|ups|fedex|dhl|irs|social security|docusign|dropbox|norton|mcafee|geek squad|facebook|meta|instagram|whatsapp|tiktok|steam|epic|walmart|costco|best buy|att|verizon|t-mobile|comcast|xfinity/i;
const URGENT = /verify|suspend|locked|limited|unusual|security alert|sign-in|signin|password|expire|invoice|payment|refund|renew|overdue|charged|confirm|action required|delivery|package|on hold|gift card|wire|urgent|immediately|24 hours|account/i;

/** Plain-code first pass: only emails about accounts, money, deliveries or security go to the model. */
export const worthJudging = (f: EmailFacts) => {
  const fromDomain = baseDomain(f.from.match(/@([^>\s]+)/)?.[1] ?? "");
  const linkOff = f.links.some((l) => baseDomain(l.host) !== fromDomain);
  const authBad = /fail|softfail|none/.test(f.auth.replace(/dkim=none/, ""));
  const risky = f.attachments.some((a) => /\.(html?|zip|iso|img|exe|js|vbs|lnk|scr|docm|xlsm|one)$/i.test(a));
  const brand = BIG_BRANDS.test(`${f.from} ${f.subject}`);
  const urgent = URGENT.test(`${f.subject} ${f.snippet.slice(0, 200)}`);
  return risky || (urgent && (brand || authBad || linkOff || Boolean(f.replyTo))) || (brand && authBad);
};

export const gmailCheck = (deps: GmailDeps): MailCheck => async (model, state) => {
  const findings: Finding[] = [];
  const handled: HandledLine[] = [];
  const tokens = deps.load();
  if (!tokens) return { findings, handled, usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, ms: 0 } };
  state.mail ??= { verdicts: {} };
  const since = Math.max(state.mail.checkedThrough ?? 0, Date.now() - 3 * DAY);
  const q = `in:inbox after:${Math.floor(since / 1000)}`;
  const list = await gmail<{ messages?: { id: string }[] }>(deps, `messages?q=${encodeURIComponent(q)}&maxResults=100`);
  const ids = (list.messages ?? []).map((m) => m.id).filter((id) => !state.mail!.verdicts[id]);
  const facts: EmailFacts[] = [];
  for (const id of ids) {
    const m = await gmail<Message>(deps, `messages/${id}?format=full`);
    const f = factsOf(m);
    if (worthJudging(f)) facts.push(f);
  }
  let usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, ms: 0 };
  for (let i = 0; i < facts.length; i += 25) {
    const connectedAt = tokens.connectedAt ?? (state.mail.connectedAt ??= Date.now());
    const context = `This mailbox (${tokens.email}) was connected to Stella Security at ${new Date(connectedAt).toISOString()} by its owner, through Google's consent screen for the app "Stella". Google's notices that Stella was given access around that time are the owner's own action: normal.`;
    const res = await triageEmails(model, facts.slice(i, i + 25), context);
    usage = { ...usage, inputTokens: usage.inputTokens + res.usage.inputTokens, outputTokens: usage.outputTokens + res.usage.outputTokens, costUsd: usage.costUsd + res.usage.costUsd, ms: usage.ms + res.usage.ms };
    for (const v of res.verdicts) {
      const f = facts.find((x) => x.key === v.key);
      if (f) state.mail.verdicts[v.key] = { ...v, at: Date.now(), from: f.from, subject: f.subject };
    }
  }
  state.mail.checkedThrough = Date.now();
  // Prune old verdicts; keep the last 14 days.
  for (const [id, v] of Object.entries(state.mail.verdicts)) if (Date.now() - v.at > 14 * DAY) delete state.mail.verdicts[id];
  let fakes = 0;
  const shownAlerts = new Set<string>();
  for (const [id, v] of Object.entries(state.mail.verdicts).sort((a, b) => b[1].at - a[1].at)) {
    if (v.verdict === "real_alert") {
      if (shownAlerts.has(v.title)) continue;
      shownAlerts.add(v.title);
    }
    if (v.verdict === "fake") {
      fakes++;
      findings.push({ id: `email:${id}`, kind: "email", title: v.title, detail: `${v.detail} (“${v.subject.slice(0, 60)}”)`, needsYou: true, urgency: 65, action: { kind: "email-spam", label: "Move to spam", account: tokens.email, messageId: id }, evidence: { from: v.from, subject: v.subject } });
    } else if (v.verdict === "real_alert") {
      findings.push({ id: `email:${id}`, kind: "email", title: v.title, detail: v.detail, needsYou: true, urgency: 75, action: { kind: "open", label: "Open the email", url: `https://mail.google.com/mail/u/${encodeURIComponent(tokens.email)}/#inbox/${id}` }, evidence: { from: v.from, subject: v.subject } });
    }
  }
  handled.push({ id: "email-checked", text: `Checked ${ids.length} new email${ids.length === 1 ? "" : "s"}${fakes ? "" : ", no fakes"}`, at: Date.now() });
  return { findings, handled, usage };
};

export const moveToSpam = async (deps: GmailDeps, messageId: string) => {
  await gmail(deps, `messages/${messageId}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] }) });
};
