/**
 * Stella account for Stella Security: the same sign-in handoff Stella's desktop app uses
 * (the browser finishes Google or email sign-in, the app claims the session with a secret
 * only it holds), and model calls through Stella's gateway as that person.
 */
import { createHash, generateKeyPairSync, createPrivateKey, randomBytes, sign } from "node:crypto";
import { desktopGatewayAccess } from "../../../agent/src/host/desktop-gateway.ts";
import { stellaGatewayClient, type ModelClient } from "../engine/model.ts";

export const PROD_BACKEND = "https://auth.stella.sh";
export const DEV_BACKEND = "https://stella-v2-cloud-builder-dev.fromyou.workers.dev";

export type Vault = {
  get(name: string): string | undefined;
  set(name: string, value: string | undefined): void;
};

const b64url = (b: Buffer) => b.toString("base64url");

export type Account = { email?: string; name?: string };

export const createStellaAccount = (backendUrl: string, vault: Vault) => {
  let jwt: { token: string; exp: number } | undefined;
  let gateway: { origin: string; access: ReturnType<typeof desktopGatewayAccess> } | undefined;

  const session = () => vault.get("stella-session");

  const deviceSigner = () => {
    let pkcs8 = vault.get("device-key");
    if (!pkcs8) {
      const { privateKey } = generateKeyPairSync("ed25519");
      pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
      vault.set("device-key", pkcs8);
    }
    const key = createPrivateKey({ key: Buffer.from(pkcs8, "base64"), format: "der", type: "pkcs8" });
    const jwk = key.export({ format: "jwk" }) as { x: string };
    return { alg: "ed25519" as const, rawPublicKey: new Uint8Array(Buffer.from(jwk.x, "base64url")), sign: async (input: string) => sign(null, Buffer.from(input, "utf8"), key).toString("base64url") };
  };

  /** Short-lived JWT from the session (what the gateway and APIs accept). */
  const authToken = async (force = false): Promise<string | undefined> => {
    const s = session();
    if (!s) return undefined;
    if (!force && jwt && jwt.exp - 60_000 > Date.now()) return jwt.token;
    const r = await fetch(`${backendUrl}/api/auth/token`, { headers: { authorization: `Bearer ${s}` }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 401) {
      vault.set("stella-session", undefined);
      return undefined;
    }
    if (!r.ok) throw new Error(`Stella sign-in: HTTP ${r.status}`);
    const { token } = (await r.json()) as { token: string };
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    jwt = { token, exp: (payload.exp ?? Date.now() / 1000 + 240) * 1000 };
    return token;
  };

  return {
    backendUrl,
    signedIn: () => Boolean(session()),

    /** Start Google sign-in in the browser; resolves when the person finishes there. */
    async signInWithGoogle(openUrl: (url: string) => void, signal?: AbortSignal): Promise<void> {
      const secret = b64url(randomBytes(32));
      const claimHash = b64url(createHash("sha256").update(secret).digest());
      const start = await fetch(`${backendUrl}/api/auth/desktop-social/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "google", claimHash }) });
      const s = (await start.json().catch(() => ({}))) as { requestId?: string; callbackURL?: string; error?: string };
      if (!start.ok || !s.requestId || !s.callbackURL) throw new Error(s.error ?? `Couldn't start sign-in (HTTP ${start.status})`);
      const social = await fetch(`${backendUrl}/api/auth/sign-in/social`, { method: "POST", headers: { "content-type": "application/json", origin: backendUrl }, body: JSON.stringify({ provider: "google", callbackURL: s.callbackURL, disableRedirect: true }) });
      const g = (await social.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!social.ok || !g.url) throw new Error(g.message ?? `Couldn't start Google sign-in (HTTP ${social.status})`);
      openUrl(g.url);
      await this.waitForClaim(s.requestId, secret, signal);
    },

    /** Email a sign-in link; resolves when the person opens it and confirms. */
    async signInWithEmail(email: string, signal?: AbortSignal): Promise<void> {
      const secret = b64url(randomBytes(32));
      const claimHash = b64url(createHash("sha256").update(secret).digest());
      const r = await fetch(`${backendUrl}/api/auth/link/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, claimHash }) });
      const d = (await r.json().catch(() => ({}))) as { requestId?: string; error?: string };
      if (!r.ok || !d.requestId) throw new Error(d.error ?? `Couldn't send the sign-in email (HTTP ${r.status})`);
      await this.waitForClaim(d.requestId, secret, signal);
    },

    async waitForClaim(requestId: string, secret: string, signal?: AbortSignal) {
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        if (signal?.aborted) throw new Error("Sign-in cancelled");
        await new Promise((r) => setTimeout(r, 1500));
        const st = await fetch(`${backendUrl}/api/auth/link/status?requestId=${encodeURIComponent(requestId)}`).then((r) => r.json() as Promise<{ status?: string }>).catch(() => ({}) as { status?: string });
        if (st.status === "expired") throw new Error("The sign-in link expired. Try again.");
        if (st.status !== "completed") continue;
        const c = await fetch(`${backendUrl}/api/auth/link/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, claimSecret: secret }) });
        const { token } = (await c.json().catch(() => ({}))) as { token?: string };
        if (!c.ok || !token) throw new Error("Couldn't finish signing in.");
        vault.set("stella-session", token);
        return;
      }
      throw new Error("Sign-in timed out.");
    },

    /** For development: use an existing session token (e.g. a dev test account). */
    useSession(token: string) {
      vault.set("stella-session", token);
      jwt = undefined;
    },

    signOut() {
      vault.set("stella-session", undefined);
      jwt = undefined;
      gateway = undefined;
    },

    async account(): Promise<Account | undefined> {
      const s = session();
      if (!s) return undefined;
      const r = await fetch(`${backendUrl}/api/auth/get-session`, { headers: { authorization: `Bearer ${s}` }, signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
      if (!r?.ok) return undefined;
      const d = (await r.json().catch(() => null)) as { user?: { email?: string; name?: string } } | null;
      return d?.user ? { ...(d.user.email ? { email: d.user.email } : {}), ...(d.user.name ? { name: d.user.name } : {}) } : undefined;
    },

    authToken,

    /** Model calls as this person through Stella's gateway (their plan pays and limits). */
    async model(modelId: string): Promise<ModelClient | undefined> {
      if (!session()) return undefined;
      if (!gateway) {
        const catalog = (await (await fetch(`${backendUrl}/api/stella/models`)).json()) as { gateway?: { origin?: string } };
        const origin = catalog.gateway?.origin;
        if (!origin) throw new Error("Stella's model service isn't available right now.");
        const signer = deviceSigner();
        gateway = { origin, access: desktopGatewayAccess({ gatewayOrigin: origin, getAuthToken: () => authToken(), refreshAuthToken: () => authToken(true), getDeviceSigner: () => signer }) };
      }
      const g = gateway;
      return stellaGatewayClient(modelId, (url, init) => g.access.fetch(url, init), g.access.relayBaseUrl);
    },
  };
};

export type StellaAccount = ReturnType<typeof createStellaAccount>;
