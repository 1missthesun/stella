import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = "packages/mobile/src/lib/saved-values-device.ts";

export async function check(root) {
  const source = readFileSync(path.join(root, FILE), "utf8");
  const problems = [];
  for (const [, name] of source.matchAll(/\bSecureStore\.(\w+)/g)) {
    if (!/DeviceOnly/.test(name)) {
      problems.push(
        `${FILE}: SecureStore.${name} — this phone's saved-value keys must use the device-only (no backup, no restore) SecureStore calls`,
      );
    }
  }
  for (const banned of ["AsyncStorage", "fetch(", "cloudRequest"]) {
    if (source.includes(banned)) {
      problems.push(`${FILE}: uses ${banned}; this phone's saved-value keys never leave the device keychain`);
    }
  }
  return problems;
}
