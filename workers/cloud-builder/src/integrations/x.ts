export const X_STATE_KIND = "x";
export const X_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const X_API_BASE_URL = "https://api.x.com";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";

export const X_OAUTH_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "dm.read",
  "dm.write",
  "offline.access",
] as const;

export type XClient = { clientId: string; clientSecret: string };

export type XTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
};

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
};

export const xClient = (env: Cloudflare.Env): XClient | null => {
  const values = env as unknown as Record<string, unknown>;
  const clientId = typeof values.X_CLIENT_ID === "string" ? values.X_CLIENT_ID.trim() : "";
  const clientSecret = typeof values.X_CLIENT_SECRET === "string" ? values.X_CLIENT_SECRET.trim() : "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};

export const generateCodeVerifier = (): string => base64Url(crypto.getRandomValues(new Uint8Array(32)));

export const buildXAuthorizationUrl = async (args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
}): Promise<string> => {
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(args.codeVerifier))),
  );
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", X_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
};

export const requestXToken = async (
  client: XClient,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: XTokenResponse }> => {
  const response = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const body = ((await response.json().catch(() => ({}))) ?? {}) as XTokenResponse;
  return { ok: response.ok, status: response.status, body };
};

export const parseXScope = (scope: unknown): string[] =>
  Array.isArray(scope)
    ? scope.filter((item): item is string => typeof item === "string")
    : typeof scope === "string"
      ? scope.split(/\s+/u).filter(Boolean)
      : [];

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const xResultPage = (success: boolean, message: string, status: number): Response =>
  xPage(success ? "X connected" : "X connection failed", message, status, success ? "ok" : "error");

/**
 * The callback page for a connection waiting on its one-time code. The code
 * goes back to the Stella that started the connection, the same way a CLI
 * sign-in shows a code to paste into the terminal.
 */
export const xConnectCodePage = (username: string, code: string): Response =>
  xPage(
    "Almost done",
    `Paste this code into your Stella chat to finish connecting @${username}.`,
    200,
    "pending",
    code,
  );

const xPage = (
  title: string,
  message: string,
  status: number,
  tone: "ok" | "error" | "pending",
  code?: string,
): Response => {
  const color = tone === "ok" ? "#22c55e" : tone === "error" ? "#ef4444" : "#e5e5e5";
  const icon = tone === "ok" ? "&#10003;" : tone === "error" ? "&#10007;" : "";
  const codeBlock = code
    ? `<div class="code" id="code">${escapeHtml(code)}</div>
<button type="button" id="copy">Copy code</button>
<p class="note">Works for 10 minutes. Only paste it into your own Stella.</p>
<script>
document.getElementById("copy").addEventListener("click", function () {
  var button = this;
  navigator.clipboard.writeText(document.getElementById("code").textContent).then(function () {
    button.textContent = "Copied";
  });
});
</script>`
    : "";
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
  .card { text-align: center; padding: 3rem 1.5rem; max-width: 420px; }
  .icon { font-size: 4rem; color: ${color}; margin-bottom: 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p { color: #a3a3a3; line-height: 1.6; margin: 0 0 1.5rem; }
  .code { font: 600 1.6rem/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .12em; color: #e5e5e5; user-select: all; margin-bottom: 1.25rem; }
  button { padding: .7rem 1.6rem; border: 0; border-radius: 999px; background: #e5e5e5; color: #0a0a0a; font-family: inherit; font-size: .95rem; font-weight: 600; cursor: pointer; }
  .note { font-size: .85rem; margin-top: 1.25rem; }
</style>
</head>
<body><div class="card">${icon ? `<div class="icon">${icon}</div>` : ""}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${codeBlock}</div></body>
</html>`,
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
};
