// Process-wide settings Electron main would get from being Electron, applied before it loads:
// protected storage on the shim's safeStorage (node-shared refuses anything but Electron), the
// runtime's node-compatible host executable, and a launcher's isolated root for every path.

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setProtectedStorageProviderOverride } from "../../../node-shared/shared/protected-storage";
import { safeStorage } from "../electron/safe-storage";

const requireAvailable = () => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS protected storage is unavailable.");
};

/** Electron's `process.getSystemVersion()`: the macOS product version, else the kernel release. */
const systemVersion = () => {
  if (process.platform === "darwin") {
    try {
      const plist = readFileSync("/System/Library/CoreServices/SystemVersion.plist", "utf8");
      const version = plist.match(/<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
      if (version) return version;
    } catch {}
  }
  return os.release();
};

export function applyRuneProcessEnv() {
  const electronProcess = process as typeof process & { getSystemVersion?: () => string };
  electronProcess.getSystemVersion ??= systemVersion;

  setProtectedStorageProviderOverride({
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plaintext) => { requireAvailable(); return safeStorage.encryptString(plaintext); },
    decryptString: (ciphertext) => { requireAvailable(); return safeStorage.decryptString(ciphertext); },
  });

  process.env.STELLA_HOST_EXECUTABLE_PATH = process.execPath;

  const isolatedData = process.env.STELLA_LAUNCHER_USER_DATA_DIR?.trim() ? process.env.STELLA_DATA_DIR?.trim() : undefined;
  if (isolatedData) {
    process.env.STELLA_RUNTIME_STATE_DIR ??= isolatedData;
    process.env.STELLA_BROWSER_BRIDGE ??= "isolated";
    process.env.STELLA_BROWSER_SOCKET_DIR ??= path.join(isolatedData, "b");
  }
}
