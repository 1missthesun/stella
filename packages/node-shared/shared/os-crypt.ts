// safeStorage with Chromium os_crypt's formats, so values Electron Stella encrypted stay readable
// outside Electron (Rune's host, the launcher's Repair runner):
// Linux "v11" (AES-128-CBC, key from the Secret Service item "<app> Safe Storage"),
// macOS "v10" (AES-128-CBC, key from the Keychain item "<app> Safe Storage" / "<app> Key"),
// Windows "v10" (AES-256-GCM, key in userData/Local State protected with DPAPI).

import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const SALT = "saltysalt";
const CBC_IV = Buffer.alloc(16, 0x20);
const LIBSECRET_SCHEMA = "chrome_libsecret_os_crypt_password_v2";
const MAC_ITEM_NOT_FOUND = 44;
const UNAVAILABLE_RETRY_MS = 60_000;

type Backend = { prefix: string; encrypt(plain: Buffer): Buffer; decrypt(data: Buffer): Buffer };

export type OsCryptIdentity = {
  /** The app name Electron's safeStorage used: "<name> Safe Storage" names the key. */
  getName(): string;
  /** Electron's userData folder (Windows keeps the key in its "Local State"). */
  getUserData(): string;
};

export type OsCryptSafeStorage = {
  isEncryptionAvailable(): boolean;
  isAsyncEncryptionAvailable(): Promise<boolean>;
  getSelectedStorageBackend(): string;
  setUsePlainTextEncryption(): void;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
  encryptStringAsync(plaintext: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
};

const run = (cmd: string[], stdin?: string) => {
  const result = spawnSync(cmd[0]!, cmd.slice(1), {
    input: stdin === undefined ? undefined : Buffer.from(stdin),
    stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    env: process.env,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    /** null when the command couldn't run or was killed. */
    status: result.error ? null : result.status,
    out: result.stdout ? result.stdout.toString() : "",
    err: result.stderr ? result.stderr.toString().trim() : "",
  };
};

/**
 * The key's store only gets a new key when it definitely has none. Any other failure to read it
 * (a locked or unreachable keyring, a dismissed unlock prompt, a damaged Local State) leaves
 * encryption unavailable instead: a new key under the same name would replace the one every
 * saved value is encrypted with, and those values could never be read again.
 */
const cbc = (key: Buffer): Omit<Backend, "prefix"> => ({
  encrypt: (plain) => {
    const c = createCipheriv("aes-128-cbc", key, CBC_IV);
    return Buffer.concat([c.update(plain), c.final()]);
  },
  decrypt: (data) => {
    const d = createDecipheriv("aes-128-cbc", key, CBC_IV);
    return Buffer.concat([d.update(data), d.final()]);
  },
});

const linuxBackend = (name: string): Backend | null => {
  const attrs = ["xdg:schema", LIBSECRET_SCHEMA, "application", name];
  const lookup = () => run(["secret-tool", "lookup", ...attrs]);
  const found = lookup();
  const existing = found.ok ? found.out.replace(/\n$/, "") : "";
  let password = existing;
  if (!password) {
    // `secret-tool lookup` exits 1 both when nothing matches and when the Secret Service fails;
    // only the failure prints an error. A locked item (an unlock prompt dismissed) reads as
    // nothing found, so a search, which lists locked items too, has to come back empty as well.
    if (found.status !== 0 && (found.status !== 1 || found.err)) return null;
    const search = run(["secret-tool", "search", ...attrs]);
    if (search.status === null || search.err || /^\[\//m.test(search.out)) return null;
    password = randomBytes(16).toString("base64");
    const stored = run(["secret-tool", "store", `--label=${name} Safe Storage`, ...attrs], password);
    if (!stored.ok) return null;
    const check = lookup();
    if (!check.ok || check.out.replace(/\n$/, "") !== password) return null;
  }
  return { prefix: "v11", ...cbc(pbkdf2Sync(password, SALT, 1, 16, "sha1")) };
};

/** `STELLA_RUNE_KEYCHAIN`: a keychain file of its own for test roots, so proofs never read the user's "<app> Safe Storage". */
const macBackend = (name: string): Backend | null => {
  const service = `${name} Safe Storage`;
  const account = `${name} Key`;
  const keychain = process.env.STELLA_RUNE_KEYCHAIN?.trim();
  const inKeychain = keychain ? [keychain] : [];
  const find = () =>
    run(["/usr/bin/security", "find-generic-password", "-w", "-s", service, "-a", account, ...inKeychain]);
  const found = find();
  let password = found.ok ? found.out.replace(/\n$/, "") : "";
  if (!password) {
    // 44 is errSecItemNotFound; anything else (denied, locked, no keychain) is a failure to read.
    if (found.status !== MAC_ITEM_NOT_FOUND) return null;
    password = randomBytes(16).toString("base64");
    if (!run(["/usr/bin/security", "add-generic-password", "-s", service, "-a", account, "-w", password, ...inKeychain]).ok)
      return null;
    const check = find();
    if (!check.ok || check.out.replace(/\n$/, "") !== password) return null;
  }
  return { prefix: "v10", ...cbc(pbkdf2Sync(password, SALT, 1003, 16, "sha1")) };
};

const dpapi = (mode: "Protect" | "Unprotect", data: Buffer): Buffer | null => {
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${mode}($b,$null,'CurrentUser'))`;
  const result = run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], data.toString("base64"));
  return result.ok ? Buffer.from(result.out.trim(), "base64") : null;
};

type LocalState = { os_crypt?: { encrypted_key?: string } } & Record<string, unknown>;

/** Local State as it is on disk: {} when there is none yet, null when it can't be read or parsed. */
const readLocalState = (file: string): LocalState | null => {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? {} : null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as LocalState) : null;
  } catch {
    return null;
  }
};

const unprotectKey = (encoded: string): Buffer | null => {
  const raw = Buffer.from(encoded, "base64");
  if (raw.subarray(0, 5).toString() !== "DPAPI") return null;
  const key = dpapi("Unprotect", raw.subarray(5));
  return key && key.length === 32 ? key : null;
};

/** Written beside it and renamed over it, so a crash never leaves Local State half written. */
const writeLocalState = (file: string, state: LocalState) => {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(state));
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
};

const windowsBackend = (userData: string): Backend | null => {
  const localState = path.join(userData, "Local State");
  const state = readLocalState(localState);
  if (!state) return null;
  let key: Buffer | null = null;
  const encoded = state.os_crypt?.encrypted_key;
  if (encoded) {
    // A key that is there but won't unprotect stays: replacing it would strand every saved value.
    key = unprotectKey(encoded);
    if (!key) return null;
  } else {
    key = randomBytes(32);
    const protectedKey = dpapi("Protect", key);
    if (!protectedKey) return null;
    // Stella (Chromium) may have written a key since the read above: use that one instead.
    const latest = readLocalState(localState);
    if (!latest) return null;
    const raced = latest.os_crypt?.encrypted_key;
    if (raced) {
      key = unprotectKey(raced);
      if (!key) return null;
    } else {
      latest.os_crypt = {
        ...latest.os_crypt,
        encrypted_key: Buffer.concat([Buffer.from("DPAPI"), protectedKey]).toString("base64"),
      };
      writeLocalState(localState, latest);
    }
  }
  const k = key;
  return {
    prefix: "v10",
    encrypt(plain) {
      const nonce = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", k, nonce);
      const body = Buffer.concat([c.update(plain), c.final()]);
      return Buffer.concat([nonce, body, c.getAuthTag()]);
    },
    decrypt(data) {
      const nonce = data.subarray(0, 12);
      const tag = data.subarray(data.length - 16);
      const d = createDecipheriv("aes-256-gcm", k, nonce);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(data.subarray(12, data.length - 16)), d.final()]);
    },
  };
};

const basicText = { prefix: "v10", ...cbc(pbkdf2Sync("peanuts", SALT, 1, 16, "sha1")) };

export const createOsCryptSafeStorage = (identity: OsCryptIdentity): OsCryptSafeStorage => {
  let backend: Backend | null | undefined;
  let backendName = "";
  let unavailableAt = 0;
  const resolveBackend = (): Backend | null => {
    const name = identity.getName();
    // An unreadable key is asked for again after a while: the keyring may not have been up yet.
    const retry = backend === null && Date.now() - unavailableAt >= UNAVAILABLE_RETRY_MS;
    if (backend !== undefined && backendName === name && !retry) return backend;
    backendName = name;
    try {
      backend =
        process.platform === "darwin"
          ? macBackend(name)
          : process.platform === "win32"
            ? windowsBackend(identity.getUserData())
            : linuxBackend(name);
    } catch {
      backend = null;
    }
    if (backend === null) unavailableAt = Date.now();
    return backend;
  };
  const safeStorage: OsCryptSafeStorage = {
    isEncryptionAvailable: () => resolveBackend() !== null,
    isAsyncEncryptionAvailable: async () => resolveBackend() !== null,
    getSelectedStorageBackend: () =>
      process.platform === "linux" ? (resolveBackend() ? "gnome_libsecret" : "basic_text") : "unknown",
    setUsePlainTextEncryption: () => {},
    encryptString(plaintext: string): Buffer {
      const b = resolveBackend();
      if (!b)
        throw new Error(
          "Error while encrypting the text provided to safeStorage.encryptString. Encryption is not available.",
        );
      return Buffer.concat([Buffer.from(b.prefix), b.encrypt(Buffer.from(plaintext, "utf8"))]);
    },
    decryptString(encrypted: Buffer): string {
      const prefix = encrypted.subarray(0, 3).toString();
      const body = encrypted.subarray(3);
      const b = resolveBackend();
      if (b && prefix === b.prefix) return b.decrypt(body).toString("utf8");
      if (process.platform === "linux" && prefix === "v10") return basicText.decrypt(body).toString("utf8");
      throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
    },
    async encryptStringAsync(plaintext: string) {
      return safeStorage.encryptString(plaintext);
    },
    async decryptStringAsync(encrypted: Buffer) {
      return { result: safeStorage.decryptString(encrypted), shouldReEncrypt: false };
    },
  };
  return safeStorage;
};
