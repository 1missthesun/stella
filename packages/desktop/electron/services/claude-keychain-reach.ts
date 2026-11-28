import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";

const SECURITY = "/usr/bin/security";
const LOOKUP_TIMEOUT_MS = 5_000;
const ITEM_NOT_FOUND = 44;

/**
 * - `reachable`: an ordinary Keychain lookup (the search list) finds the login.
 * - `unreachable`: the login keychain still holds it, but the search list
 *   doesn't lead there, so Claude Code reports "Not logged in".
 * - `absent`: the login keychain has no such item.
 */
export type ClaudeKeychainReach = "reachable" | "unreachable" | "absent" | "unknown";

/** Claude Code's item name: suffixed with the exact `CLAUDE_CONFIG_DIR` string's hash when one is set. */
const claudeCredentialService = (configDir: string | null): string =>
  configDir
    ? `Claude Code-credentials-${createHash("sha256").update(configDir).digest("hex").slice(0, 8)}`
    : "Claude Code-credentials";

/** From the account's real home: `$HOME` is overridden in some environments. */
const loginKeychainPath = (): string | null => {
  let home: string;
  try {
    home = userInfo().homedir;
  } catch {
    return null;
  }
  for (const name of ["login.keychain-db", "login.keychain"]) {
    const candidate = path.join(home, "Library", "Keychains", name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

/** Exit status of an attribute-only lookup: no secret is read, and all output is discarded. */
const lookUp = (service: string, keychain?: string): Promise<number | null> =>
  new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(SECURITY, ["find-generic-password", "-s", service, ...(keychain ? [keychain] : [])], {
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => child.kill(), LOOKUP_TIMEOUT_MS);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

/** Read-only: never changes Keychain settings or items. */
export const claudeKeychainReach = async (configDir: string | null): Promise<ClaudeKeychainReach> => {
  if (process.platform !== "darwin") return "unknown";
  const loginKeychain = loginKeychainPath();
  if (!loginKeychain) return "unknown";
  const service = claudeCredentialService(configDir);
  const [inLoginKeychain, viaSearchList] = await Promise.all([lookUp(service, loginKeychain), lookUp(service)]);
  if (viaSearchList === 0) return "reachable";
  if (viaSearchList !== ITEM_NOT_FOUND) return "unknown";
  if (inLoginKeychain === 0) return "unreachable";
  return inLoginKeychain === ITEM_NOT_FOUND ? "absent" : "unknown";
};
