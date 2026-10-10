const cleanUrl = (value: string | undefined): string =>
  (value ?? "").trim().replace(/\/+$/, "");

export const env = {
  /** The Stella backend worker: auth, backend calls, live views, sockets. */
  backendUrl: cleanUrl(process.env.EXPO_PUBLIC_STELLA_BACKEND_URL),
  /** The website: map embeds and the billing return page. */
  siteUrl: cleanUrl(process.env.EXPO_PUBLIC_STELLA_SITE_URL) || "https://stella.sh",
  authUrl: cleanUrl(process.env.EXPO_PUBLIC_STELLA_AUTH_URL),
  /** Where canvas links live: `<this>/c/<slug>`. */
  canvasShareBaseUrl:
    cleanUrl(process.env.EXPO_PUBLIC_CANVAS_SHARE_BASE_URL) ||
    "https://stellashare.app",
  playIntegrityProjectNumber:
    process.env.EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER?.trim() ?? "",
  mobileScheme:
    process.env.EXPO_PUBLIC_STELLA_MOBILE_SCHEME?.trim() || "stella-mobile",
};

export const hasMobileConfig = Boolean(env.backendUrl);
