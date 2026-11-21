import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { oauthErrorHtml, oauthSuccessHtml } from "@earendil-works/pi-ai/utils/oauth-page";
import { ANTIGRAVITY_ENDPOINTS, antigravityUserAgent } from "./models.ts";
import { encodeAntigravityKey } from "./stream.ts";
import { agyFetch } from "./transport.ts";

/** Antigravity's own installed-app OAuth client, the one the official app and CLI sign in with. */
const CLIENT_ID = atob("MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==");
const CLIENT_SECRET = atob("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");
const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL="https:...oken";
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
/** The project Antigravity itself falls back to when an account has none of its own. */
const DEFAULT_PROJECT_ID = "rising-fact-p41fc";
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export type AntigravityCredential = OAuthCredential & {
  projectId: string;
  email?: string;
  tier?: string;
  paidTier?: string;
};

const base64Url = (bytes: Buffer) => bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");

const cancelled = () => new Error("Google Antigravity sign-in was canceled.");

type Callback = { server: Server; code: Promise<string> };

const startCallback = (state: string, signal: AbortSignal): Promise<Callback> =>
  new Promise((resolve, reject) => {
    let settle: { ok: (code: string) => void; fail: (error: Error) => void } | undefined;
    const code = new Promise<string>((ok, fail) => (settle = { ok, fail }));
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }).end(oauthErrorHtml("Not found."));
        return;
      }
      const error = url.searchParams.get("error");
      const received = url.searchParams.get("code");
      if (error || !received || url.searchParams.get("state") !== state) {
        response
          .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          .end(oauthErrorHtml("Google sign-in didn't finish.", error ? `Error: ${error}` : undefined));
        settle?.fail(new Error(error ? `Google sign-in failed: ${error}` : "Google sign-in didn't finish."));
        return;
      }
      response
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(oauthSuccessHtml("Signed in to Google Antigravity. You can close this tab and go back to Stella."));
      settle?.ok(received);
    });
    const timer = setTimeout(() => settle?.fail(new Error("Google sign-in timed out.")), LOGIN_TIMEOUT_MS);
    const onAbort = () => settle?.fail(cancelled());
    signal.addEventListener("abort", onAbort, { once: true });
    void code
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      });
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `Port ${CALLBACK_PORT} is busy, so Google can't hand the sign-in back to Stella. Quit the Antigravity app or another sign-in that's waiting, then try again.`,
            )
          : error,
      ),
    );
    server.listen(CALLBACK_PORT, "127.0.0.1", () => resolve({ server, code }));
  });

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

const tokenRequest = async (params: Record<string, string>, signal?: AbortSignal): Promise<TokenResponse> => {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
    ...(signal ? { signal } : {}),
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(
      `Google didn't issue a token (${response.status}${body.error ? `, ${body.error}` : ""})${body.error_description ? `: ${body.error_description}` : ""}`,
    );
  }
  return body;
};

const bootstrapHeaders = (token: string) => ({
  "User-Agent": antigravityUserAgent(),
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
});

type LoadCodeAssist = {
  cloudaicompanionProject?: string | { id?: string };
  currentTier?: { id?: string };
  paidTier?: string | { id?: string };
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
};

const loadCodeAssist = async (token: string, signal?: AbortSignal): Promise<LoadCodeAssist | undefined> => {
  for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
    try {
      const response = await agyFetch(`${endpoint}/v1internal:loadCodeAssist`, {
        headers: bootstrapHeaders(token),
        body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
        ...(signal ? { signal } : {}),
      });
      if (response.ok) return (await response.json()) as LoadCodeAssist;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return undefined;
};

const onboard = async (token: string, tierId: string, signal: AbortSignal): Promise<string | undefined> => {
  for (const endpoint of [...ANTIGRAVITY_ENDPOINTS].reverse()) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const response = await agyFetch(`${endpoint}/v1internal:onboardUser`, {
          headers: bootstrapHeaders(token),
          body: JSON.stringify({ tierId }),
          signal,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          break;
        }
        const payload = (await response.json()) as {
          done?: boolean;
          response?: { cloudaicompanionProject?: { id?: string } };
        };
        if (payload.done && payload.response?.cloudaicompanionProject?.id) return payload.response.cloudaicompanionProject.id;
      } catch (error) {
        if (signal.aborted) throw error;
        break;
      }
      await new Promise((done) => setTimeout(done, 5_000));
    }
  }
  return undefined;
};

const idOf = (value: string | { id?: string } | undefined) => (typeof value === "string" ? value : value?.id) || undefined;

const describeAccount = async (token: string, signal: AbortSignal) => {
  const loaded = await loadCodeAssist(token, signal);
  const tier = loaded?.currentTier?.id;
  const paidTier = idOf(loaded?.paidTier);
  const project =
    idOf(loaded?.cloudaicompanionProject) ??
    (await onboard(
      token,
      loaded?.allowedTiers?.find((entry) => entry.isDefault)?.id ?? loaded?.allowedTiers?.[0]?.id ?? "free-tier",
      signal,
    ));
  return { projectId: project ?? DEFAULT_PROJECT_ID, ...(tier ? { tier } : {}), ...(paidTier ? { paidTier } : {}) };
};

const userEmail = async (token: string, signal: AbortSignal): Promise<string | undefined> => {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    return response.ok ? ((await response.json()) as { email?: string }).email : undefined;
  } catch {
    return undefined;
  }
};

/** A plain name for the Google plan an Antigravity tier id belongs to. */
export const antigravityPlanName = (credential: Readonly<Record<string, unknown>>): string | undefined => {
  const id = [credential.paidTier, credential.tier].find((value): value is string => typeof value === "string" && !!value);
  if (!id) return undefined;
  const lower = id.toLowerCase();
  if (lower.includes("ultra")) return "Google AI Ultra";
  if (lower.includes("pro")) return "Google AI Pro";
  if (lower.includes("plus")) return "Google AI Plus";
  if (lower.includes("free") || lower === "standard-tier") return "Free";
  return id;
};

async function login(interaction: ProviderAuthInteraction): Promise<AntigravityCredential> {
  const { signal } = interaction;
  if (signal.aborted) throw cancelled();
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(24));
  const callback = await startCallback(state, signal);
  try {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent",
    }).toString();
    interaction.notify({ type: "auth_url", url: url.toString(), instructions: "Finish signing in to Google in your browser." });
    const code = await callback.code;
    interaction.notify({ type: "progress", message: "Finishing Google sign-in…" });
    const tokens = await tokenRequest(
      { code, grant_type: "authorization_code", redirect_uri: REDIRECT_URI, code_verifier: verifier },
      signal,
    );
    if (!tokens.refresh_token) throw new Error("Google didn't grant lasting access. Try signing in again.");
    const [email, account] = await Promise.all([
      userEmail(tokens.access_token!, signal),
      describeAccount(tokens.access_token!, signal),
    ]);
    return {
      type: "oauth",
      access: tokens.access_token!,
      refresh: tokens.refresh_token,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000 - EXPIRY_SKEW_MS,
      ...account,
      ...(email ? { email } : {}),
    };
  } finally {
    callback.server.close();
  }
}

async function refresh(credential: OAuthCredential, signal: AbortSignal): Promise<AntigravityCredential> {
  const tokens = await tokenRequest({ refresh_token: credential.refresh, grant_type: "refresh_token" }, signal);
  const current = credential as AntigravityCredential;
  return {
    ...current,
    type: "oauth",
    access: tokens.access_token!,
    refresh: tokens.refresh_token || credential.refresh,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000 - EXPIRY_SKEW_MS,
    projectId: current.projectId || DEFAULT_PROJECT_ID,
  };
}

export const antigravityOAuth = (): OAuthAuth => ({
  name: "Google Antigravity",
  isSubscription: true,
  loginLabel: "Sign in with Google",
  login,
  refresh,
  toAuth: async (credential) => ({
    apiKey: encodeAntigravityKey({
      token: credential.access,
      projectId: typeof credential.projectId === "string" && credential.projectId ? credential.projectId : DEFAULT_PROJECT_ID,
    }),
  }),
});
