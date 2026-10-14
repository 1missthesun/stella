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
  "accounts.google.com",
  "accounts.youtube.com",
  "gds.google.com",
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

export const isAuthOrigin = (value) => {
  const host = value ? urlHost(String(value)) : null;
  if (!host) return false;
  return AUTH_ORIGIN_HOST_SUFFIXES.some((suffix) =>
    hostMatchesSuffix(host, suffix),
  );
};

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

export const isAuthPermission = (permission) =>
  AUTH_DEVICE_PERMISSIONS.has(String(permission || ""));

export const shouldAllowAuthDevice = (details) => {
  if (!details) return false;
  if (!AUTH_DEVICE_PERMISSIONS.has(String(details.deviceType || ""))) {
    return false;
  }
  return isAuthOrigin(details.origin);
};
