export const SELF_HOST_DISCOVERY_PATH = "/.well-known/stella";

export const SERVER_API_VERSION = 1;

export const MIN_SUPPORTED_SERVER_API = 1;

export const SERVER_SUPPORT_WINDOW_DAYS = 90;

export const PAIRING_PROTOCOL = "stella";
export const PAIRING_HOST = "pair";
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRING_MAX_ATTEMPTS = 5;

export type ServerFeatures = {
  billing: boolean;
  push: boolean;
  cloudAgents: boolean;
  managedModels: boolean;
  media: boolean;
  readAloud: boolean;
  dictation: boolean;
  realtimeVoice: boolean;
  webSearch: boolean;
  maps: boolean;
  integrationsStore: boolean;
  emailSignIn: boolean;
  socialSignIn: boolean;
};

export type ServerUrls = {
  backend: string;
  auth: string;
  canvasShare: string | null;
  sites: string | null;
  appsHost: string | null;
  appsAuthHost: string | null;
};

export type ServerDiscovery = {
  kind: "stella-server";
  serverId: string;
  name: string;
  ownerMode: boolean;
  version: string | null;
  releasedAt: string | null;
  commit: string | null;
  api: { version: number; min: number };
  features: ServerFeatures;
  urls: ServerUrls;
};

export type PairingLink = {
  server: string;
  pairingId: string;
  secret: string;
};

export type PairingStartRequest = {
  review?: boolean;
  days?: number;
};

export const REVIEW_PAIRING_DEFAULT_DAYS = 30;
export const REVIEW_PAIRING_MAX_DAYS = 90;

export type PairingStartResponse = {
  pairingId: string;
  secret: string;
  expiresAt: number;
  link: string;
  reusable?: boolean;
};

export type PairingStatusResponse = {
  status: "pending" | "claimed" | "expired" | "canceled";
  deviceName: string | null;
  claimedAt: number | null;
  reusable?: boolean;
  uses?: number;
};

export type PairingClaimRequest = {
  pairingId: string;
  secret: string;
  deviceName?: string;
  platform?: "ios" | "android" | "macos" | "windows" | "linux" | "web" | "cli";
};

export type PairingClaimResponse = {
  sessionToken: string;
  userId: string;
  server: ServerDiscovery;
};

const trimOrigin = (value: string): string => value.trim().replace(/\/+$/, "");

export const normalizeServerOrigin = (value: string): string | null => {
  try {
    const url = new URL(trimOrigin(value));
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
};

export const formatPairingLink = (link: PairingLink): string => {
  const params = new URLSearchParams({ server: link.server, code: `${link.pairingId}.${link.secret}` });
  return `${PAIRING_PROTOCOL}://${PAIRING_HOST}?${params.toString()}`;
};

export const parsePairingLink = (raw: string): PairingLink | null => {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(/:$/, "");
  if (scheme !== PAIRING_PROTOCOL && scheme !== "stella-mobile") return null;
  const host = url.hostname || url.pathname.replace(/^\/+/, "").split("/")[0];
  if (host !== PAIRING_HOST) return null;
  const server = normalizeServerOrigin(url.searchParams.get("server") ?? "");
  const code = url.searchParams.get("code") ?? "";
  const dot = code.indexOf(".");
  if (!server || dot <= 0) return null;
  const pairingId = code.slice(0, dot);
  const secret = code.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(pairingId) || !/^[A-Za-z0-9_-]{32,128}$/.test(secret)) return null;
  return { server, pairingId, secret };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const FEATURE_KEYS: Array<keyof ServerFeatures> = [
  "billing",
  "push",
  "cloudAgents",
  "managedModels",
  "media",
  "readAloud",
  "dictation",
  "realtimeVoice",
  "webSearch",
  "maps",
  "integrationsStore",
  "emailSignIn",
  "socialSignIn",
];

export const parseServerDiscovery = (value: unknown): ServerDiscovery | null => {
  if (!isRecord(value) || value.kind !== "stella-server") return null;
  if (typeof value.serverId !== "string" || !value.serverId) return null;
  const api = isRecord(value.api) ? value.api : {};
  const features = isRecord(value.features) ? value.features : {};
  const urls = isRecord(value.urls) ? value.urls : {};
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const backend = str(urls.backend);
  if (!backend) return null;
  return {
    kind: "stella-server",
    serverId: value.serverId,
    name: str(value.name) ?? "Stella",
    ownerMode: value.ownerMode === true,
    version: str(value.version),
    releasedAt: str(value.releasedAt),
    commit: str(value.commit),
    api: {
      version: typeof api.version === "number" ? api.version : 0,
      min: typeof api.min === "number" ? api.min : 0,
    },
    features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, features[key] === true])) as ServerFeatures,
    urls: {
      backend,
      auth: str(urls.auth) ?? backend,
      canvasShare: str(urls.canvasShare),
      sites: str(urls.sites),
      appsHost: str(urls.appsHost),
      appsAuthHost: str(urls.appsAuthHost),
    },
  };
};

export type ServerCompatibility = "ok" | "server_too_old" | "app_too_old";

export const serverCompatibility = (
  server: Pick<ServerDiscovery, "api" | "releasedAt">,
  appReleasedAt: string | null,
  now = Date.now(),
): ServerCompatibility => {
  if (server.api.version < MIN_SUPPORTED_SERVER_API) return "server_too_old";
  if (server.api.min > SERVER_API_VERSION) return "app_too_old";
  const released = server.releasedAt ? Date.parse(server.releasedAt) : NaN;
  const reference = appReleasedAt ? Date.parse(appReleasedAt) : now;
  if (Number.isFinite(released) && Number.isFinite(reference)) {
    const ageDays = (reference - released) / 86_400_000;
    if (ageDays > SERVER_SUPPORT_WINDOW_DAYS) return "server_too_old";
  }
  return "ok";
};
