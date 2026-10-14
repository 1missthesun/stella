/**
 * `GET /.well-known/stella`: what this server is and what it can do, for the
 * apps to connect to it and gate features. Served by every server, hosted
 * Stella included. Features are computed from the configured secrets and
 * vars; the model gateway reports its own (`ModelGatewayControl.capabilities`).
 */

import {
  MIN_SUPPORTED_SERVER_API,
  SERVER_API_VERSION,
  type ServerDiscovery,
  type ServerFeatures,
} from "@stella/contracts/self-host";
import { authUrl, backendUrl } from "../auth/auth.js";
import { billingConfig } from "../billing/plans.js";
import { json } from "../http/response.js";
import { ownerModeEnabled, signInAllowed } from "./owner-mode.js";
import { readServerIdentity } from "./owner.js";
import { serverRelease } from "./release.js";
import { webSearchBackend } from "../web-search.js";

type GatewayCapabilities = { managedModels: boolean; webSearch: boolean };

const read = (env: unknown, name: string): string => {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
};

const has = (env: unknown, ...names: string[]): boolean => names.some((name) => read(env, name) !== "");

const origin = (value: string): string | null => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const GATEWAY_TIMEOUT_MS = 2_000;
const CAPABILITY_CACHE_MS = 60_000;
let gatewayCache: { at: number; value: GatewayCapabilities | null } | undefined;

export const gatewayCapabilities = async (env: unknown): Promise<GatewayCapabilities | null> => {
  if (gatewayCache && Date.now() - gatewayCache.at < CAPABILITY_CACHE_MS) return gatewayCache.value;
  const control = (env as { MODEL_GATEWAY_CONTROL?: { capabilities?: () => Promise<GatewayCapabilities> } })
    .MODEL_GATEWAY_CONTROL;
  let value: GatewayCapabilities | null = null;
  try {
    if (control?.capabilities) {
      value = await Promise.race([
        control.capabilities(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), GATEWAY_TIMEOUT_MS)),
      ]);
    }
  } catch {
    value = null;
  }
  gatewayCache = { at: Date.now(), value };
  return value;
};

const billingEnabled = (env: Cloudflare.Env): boolean => {
  try {
    return billingConfig(env).enabled;
  } catch {
    return false;
  }
};

const sitesUrl = (env: Cloudflare.Env): string | null => {
  const shared = origin(read(env, "SITES_SHARED_ORIGIN"));
  if (shared) return shared;
  const pattern = read(env, "SITES_HOST").replace(/^https?:\/\//u, "").replace(/\/.*$/u, "");
  return pattern.includes("*") ? `https://${pattern}` : null;
};

export const serverFeatures = async (env: Cloudflare.Env): Promise<ServerFeatures> => {
  const owner = ownerModeEnabled(env);
  const gateway = await gatewayCapabilities(env);
  const managedModels = gateway?.managedModels ?? !owner;
  const emailTransport = has(env, "RESEND_API_KEY") || (Boolean((env as { EMAIL?: unknown }).EMAIL) && has(env, "STELLA_EMAIL_FROM"));
  const social =
    has(env, "GOOGLE_CLIENT_SECRET") ||
    has(env, "APPLE_PRIVATE_KEY");
  return {
    billing: !owner && billingEnabled(env),
    push: !owner,
    cloudAgents: Boolean((env as { Sandbox?: unknown }).Sandbox),
    managedModels,
    media: has(env, "FAL_KEY"),
    readAloud: has(env, "OPENROUTER_API_KEY", "FAL_KEY", "OPENAI_API_KEY"),
    dictation: has(env, "META_MODEL_API_KEY", "OPENROUTER_API_KEY"),
    realtimeVoice: has(env, "OPENAI_API_KEY"),
    webSearch: webSearchBackend(env) !== "off",
    maps: has(env, "GOOGLE_MAPS_SERVER_API_KEY"),
    integrationsStore: has(env, "COMPOSIO_API_KEY"),
    emailSignIn: emailTransport && signInAllowed(env, "email"),
    socialSignIn: social && signInAllowed(env, "social"),
  };
};

const hostedServerId = (env: Cloudflare.Env): string => {
  const configured = read(env, "STELLA_SERVER_ID");
  if (configured) return configured;
  try {
    return new URL(authUrl(env)).hostname;
  } catch {
    return "stella";
  }
};

export const serverDiscovery = async (env: Cloudflare.Env): Promise<ServerDiscovery> => {
  const owner = ownerModeEnabled(env);
  const identity = owner ? await readServerIdentity(env).catch(() => null) : null;
  const release = serverRelease(env);
  const backend = backendUrl(env);
  return {
    kind: "stella-server",
    serverId: identity?.serverId ?? hostedServerId(env),
    name: read(env, "STELLA_SERVER_NAME") || identity?.name || "Stella",
    ownerMode: owner,
    version: release.version,
    releasedAt: release.releasedAt,
    commit: release.commit,
    api: { version: SERVER_API_VERSION, min: MIN_SUPPORTED_SERVER_API },
    features: await serverFeatures(env),
    urls: {
      backend,
      auth: authUrl(env),
      canvasShare: origin(read(env, "CANVAS_SHARE_BASE_URL")),
      sites: sitesUrl(env),
      appsHost: origin(read(env, "APPS_HOST_BASE_URL")),
      appsAuthHost: origin(read(env, "TRUSTED_APPS_HOST_BASE_URL")),
    },
  };
};

export const discoveryRoute = async (env: Cloudflare.Env): Promise<Response> => {
  const response = json(await serverDiscovery(env));
  response.headers.set("access-control-allow-origin", "*");
  return response;
};
