import { PUBLIC_SITE } from "./site-url";

const RELEASES_URL = (
  process.env.NEXT_PUBLIC_STELLA_RELEASES_URL?.trim() || "https://pub-a319aaada8144dc9be5a83625033769c.r2.dev"
).replace(/\/+$/, "");

export const LAUNCHER_STABLE_BASE = `${RELEASES_URL}/launcher/stable`;

export const LAUNCHER_CHECKSUMS_URL = `${LAUNCHER_STABLE_BASE}/SHA256SUMS`;

export const SITE_ORIGIN = PUBLIC_SITE;

export const RELEASE_ASSETS = {
  windows: `${LAUNCHER_STABLE_BASE}/Stella.exe`,
  "mac-arm64": `${LAUNCHER_STABLE_BASE}/Stella-macos.dmg`,
  "mac-x64": `${LAUNCHER_STABLE_BASE}/Stella-macos.dmg`,
  linux: `${LAUNCHER_STABLE_BASE}/stella-launcher-linux-x64`,
  "linux-arm64": `${LAUNCHER_STABLE_BASE}/stella-launcher-linux-arm64`,
  arch: `${LAUNCHER_STABLE_BASE}/stella-launcher-linux-x64`,
} as const satisfies Record<string, string>;

export const MAC_APP_ZIP = `${LAUNCHER_STABLE_BASE}/Stella-macos.zip`;

export const INSTALL_COMMAND = `curl -fsSL ${SITE_ORIGIN}/install.sh | sh`;
