import { launchServer } from "../lib/server-registry";

const cleanUrl = (value: string | undefined): string =>
  (value ?? "").trim().replace(/\/+$/, "");

/** The build's own backend: Stella's hosted service. */
const hostedBackendUrl = cleanUrl(process.env.EXPO_PUBLIC_STELLA_BACKEND_URL);

/**
 * A self-hosted server, when this launch talks to one (Settings → Server).
 * Its discovery document names its own auth and share hosts.
 */
const selfHosted = launchServer.kind === "self-hosted" ? launchServer : null;

export const env = {
  /** The Stella backend worker: auth, backend calls, live views, sockets. */
  backendUrl: selfHosted ? selfHosted.origin : hostedBackendUrl,
  /** Stella's hosted backend, whatever server is active. */
  hostedBackendUrl,
  /** The website: map embeds, legal pages and the billing return page. */
  siteUrl: cleanUrl(process.env.EXPO_PUBLIC_STELLA_SITE_URL) || "https://stella.sh",
  authUrl: selfHosted
    ? cleanUrl(selfHosted.discovery?.urls.auth ?? selfHosted.origin)
    : cleanUrl(process.env.EXPO_PUBLIC_STELLA_AUTH_URL),
  /** Where canvas links live: `<this>/c/<slug>`. */
  canvasShareBaseUrl: selfHosted
    ? cleanUrl(selfHosted.discovery?.urls.canvasShare ?? selfHosted.origin)
    : cleanUrl(process.env.EXPO_PUBLIC_CANVAS_SHARE_BASE_URL) ||
      "https://stellashare.app",
  playIntegrityProjectNumber:
    process.env.EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER?.trim() ?? "",
  mobileScheme:
    process.env.EXPO_PUBLIC_STELLA_MOBILE_SCHEME?.trim() || "stella-mobile",
};

export const hasMobileConfig = Boolean(env.backendUrl);
