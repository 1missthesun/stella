import { createRemoteJWKSet, jwtVerify } from "jose";
import { fail } from "../http/response.js";

type AccessEnv = {
  TELEMETRY_ENVIRONMENT?: string;
  ADMIN_ACCESS_TEAM_DOMAIN?: string;
  ADMIN_ACCESS_AUD?: string;
};

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const OFF = "off";

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const keySet = (issuer: string): ReturnType<typeof createRemoteJWKSet> => {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
      cacheMaxAge: 10 * 60_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });
    keySets.set(issuer, keys);
  }
  return keys;
};

const issuerOf = (teamDomain: string): string | null => {
  const host = teamDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!host) return null;
  const full = host.includes(".") ? host : `${host}.cloudflareaccess.com`;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(full) ? `https://${full}` : null;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const denied = (status: number, error: string, reason: string, path: string): Response => {
  console.warn(JSON.stringify({ event: "admin_access_denied", path, reason }));
  return fail(status, error);
};

export const adminAccessDenied = async (request: Request, env: unknown): Promise<Response | null> => {
  const vars = env as AccessEnv;
  if (vars.TELEMETRY_ENVIRONMENT !== "production") return null;
  const path = new URL(request.url).pathname;
  const teamDomain = text(vars.ADMIN_ACCESS_TEAM_DOMAIN);
  const audience = text(vars.ADMIN_ACCESS_AUD);
  if (teamDomain === OFF && audience === OFF) return null;
  const issuer = teamDomain === OFF ? null : issuerOf(teamDomain);
  if (!issuer || !audience || audience === OFF) {
    return denied(503, "Admin API disabled.", "access_not_configured", path);
  }
  const token = text(request.headers.get(ACCESS_JWT_HEADER));
  if (!token) return denied(403, "Cloudflare Access sign-in required.", "missing_access_jwt", path);
  try {
    await jwtVerify(token, keySet(issuer), { issuer, audience, algorithms: ["RS256"] });
    return null;
  } catch (error) {
    const reason = error instanceof Error && "code" in error ? String(error.code) : "invalid_access_jwt";
    return denied(403, "Invalid Cloudflare Access token.", reason, path);
  }
};
