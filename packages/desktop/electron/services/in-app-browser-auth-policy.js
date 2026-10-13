// Centralized authentication policy for the in-app (managed) browser.
//
// The managed browser is an Electron WebContentsView on a persistent session
// that is auto-seeded from the user's real browser cookies, so login is
// seamless by default. High-security sites (Google, etc.) still run step-up /
// reauth challenges — "confirm it's you", passkeys, security keys — that need a
// real window.open popup and WebAuthn device access to complete. This module is
// the single, maintainable place that decides WHERE those relaxations apply.
//
// Guiding rule: relax the otherwise-strict popup / permission policy ONLY for an
// explicit allowlist of authentication origins. Everything else keeps the strict
// "no junk tabs / deny permissions" behavior. Add new providers to the lists
// below — do not scatter host checks through the service.

const fallbackPlatformToken = (platform) => {
  switch (platform) {
    case "win32":
      return "Windows NT 10.0; Win64; x64";
    case "linux":
      return "X11; Linux x86_64";
    default:
      // Chrome uses this frozen platform token on both Intel and Apple Silicon.
      return "Macintosh; Intel Mac OS X 10_15_7";
  }
};

/**
 * Remove Electron/Stella product tokens from Electron's own runtime UA while
 * retaining its real OS and Chromium major version. This must be derived at
 * runtime: a static Chrome version disagrees with UA client hints as soon as
 * Electron's embedded Chromium advances, which is a high-signal client
 * inconsistency for Google and other risk engines.
 */
export const buildInAppBrowserUserAgent = (
  runtimeUserAgent,
  chromiumVersion = process.versions.chrome,
  platform = process.platform,
) => {
  const sanitized = String(runtimeUserAgent || "")
    .replace(/(?:^|\s)(?:Electron|Stella)\/[^\s]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (/\b(?:Chrome|Chromium)\/\d+/i.test(sanitized)) {
    // Match Chrome's UA reduction while client hints retain the full runtime
    // version. The major remains identical across both surfaces.
    return sanitized.replace(
      /\b(Chrome|Chromium)\/(\d+)(?:\.\d+){0,3}/i,
      "$1/$2.0.0.0",
    );
  }

  const major = String(chromiumVersion || "").match(/^\d+/)?.[0] || "0";
  return (
    `Mozilla/5.0 (${fallbackPlatformToken(platform)}) ` +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    `Chrome/${major}.0.0.0 Safari/537.36`
  );
};

/**
 * Host suffixes whose window.open popups are genuine auth / reauth / OAuth flows
 * and must be allowed to open as a real child window that KEEPS its opener, so
 * the challenge can postMessage / redirect back to the page that spawned it.
 *
 * Kept intentionally tight and focused on the providers that actually run
 * step-up popups. Extend deliberately.
 */
export const AUTH_ORIGIN_HOST_SUFFIXES = [
  // Google account / gaia / reauth / signin-challenge / passkey / account
  // chooser, plus the YouTube gaia mirror and Google device flow.
  "accounts.google.com",
  "accounts.youtube.com",
  "gds.google.com",
  // Other major federated identity providers that also step up via popups.
  "login.microsoftonline.com",
  "login.live.com",
  "login.microsoft.com",
  "appleid.apple.com",
];

/**
 * Device transports a WebAuthn / passkey / security-key reauth legitimately
 * needs (external FIDO keys are HID/USB; a few are serial). Scoped tightly:
 * these are only ever allowed on an auth origin (see shouldAllowAuthDevice).
 *
 * Sensitive, auth-irrelevant permissions — geolocation, camera, microphone,
 * notifications, etc. — are deliberately NOT here and stay denied everywhere.
 */
export const AUTH_DEVICE_PERMISSIONS = new Set(["hid", "usb", "serial"]);

const urlHost = (value) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const hostMatchesSuffix = (host, suffix) =>
  host === suffix || host.endsWith(`.${suffix}`);

/**
 * True when a URL / origin string belongs to a trusted authentication origin.
 * Accepts full URLs and bare origins (both parse via URL()).
 */
export const isAuthOrigin = (value) => {
  const host = value ? urlHost(String(value)) : null;
  if (!host) return false;
  return AUTH_ORIGIN_HOST_SUFFIXES.some((suffix) =>
    hostMatchesSuffix(host, suffix),
  );
};

/**
 * True when a would-be popup should open as a REAL child window (opener
 * retained) because it targets an auth origin over http/https. Non-auth popups
 * fall back to the strict anti-junk-tab handling in the service.
 */
export const isAuthPopupUrl = (value) => {
  if (!value) return false;
  const raw = String(value);
  let protocol;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    return false;
  }
  if (protocol !== "http:" && protocol !== "https:") return false;
  return isAuthOrigin(raw);
};

/**
 * True for the narrow set of WebAuthn / security-key permission strings. Callers
 * additionally gate on isAuthOrigin, so these are only ever granted on an auth
 * origin. (The request handler's permission union excludes these device types,
 * so this naturally leaves camera/mic/geolocation/notifications denied there.)
 */
export const isAuthPermission = (permission) =>
  AUTH_DEVICE_PERMISSIONS.has(String(permission || ""));

/**
 * Decide whether to allow a device (WebHID/WebUSB/serial) selection. Allow ONLY
 * a security-key transport, and ONLY on a trusted auth origin, so passkey /
 * security-key reauth can run. Every other device request is denied.
 */
export const shouldAllowAuthDevice = (details) => {
  if (!details) return false;
  if (!AUTH_DEVICE_PERMISSIONS.has(String(details.deviceType || ""))) {
    return false;
  }
  return isAuthOrigin(details.origin);
};
