// safeStorage with Chromium os_crypt's formats, so values Electron Stella encrypted stay readable:
// Linux "v11" (AES-128-CBC, key from the Secret Service item "<app> Safe Storage"),
// macOS "v10" (AES-128-CBC, key from the Keychain item "<app> Safe Storage" / "<app> Key"),
// Windows "v10" (AES-256-GCM, key in userData/Local State protected with DPAPI).

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "./app";

const SALT = "saltysalt";
const CBC_IV = Buffer.alloc(16, 0x20);
const LIBSECRET_SCHEMA = "chrome_libsecret_os_crypt_password_v2";

type Backend = { prefix: string; encrypt(plain: Buffer): Buffer; decrypt(data: Buffer): Buffer };

const run = (cmd: string[], stdin?: string) => {
  const result = Bun.spawnSync(cmd, { stdin: stdin === undefined ? "ignore" : Buffer.from(stdin), stdout: "pipe", stderr: "ignore" });
  return { ok: result.exitCode === 0, out: result.stdout.toString() };
};

const cbc = (key: Buffer): Omit<Backend, "prefix"> => ({
  encrypt: (plain) => { const c = createCipheriv("aes-128-cbc", key, CBC_IV); return Buffer.concat([c.update(plain), c.final()]); },
  decrypt: (data) => { const d = createDecipheriv("aes-128-cbc", key, CBC_IV); return Buffer.concat([d.update(data), d.final()]); },
});

const linuxBackend = (name: string): Backend | null => {
  const attrs = ["xdg:schema", LIBSECRET_SCHEMA, "application", name];
  let found = run(["secret-tool", "lookup", ...attrs]);
  let password = found.ok ? found.out.replace(/\n$/, "") : "";
  if (!password) {
    password = randomBytes(16).toString("base64");
    const stored = run(["secret-tool", "store", `--label=${name} Safe Storage`, ...attrs], password);
    if (!stored.ok) return null;
    found = run(["secret-tool", "lookup", ...attrs]);
    if (!found.ok || found.out.replace(/\n$/, "") !== password) return null;
  }
  return { prefix: "v11", ...cbc(pbkdf2Sync(password, SALT, 1, 16, "sha1")) };
};

const macBackend = (name: string): Backend | null => {
  const service = `${name} Safe Storage`;
  const account = `${name} Key`;
  let found = run(["/usr/bin/security", "find-generic-password", "-w", "-s", service, "-a", account]);
  let password = found.ok ? found.out.replace(/\n$/, "") : "";
  if (!password) {
    password = randomBytes(16).toString("base64");
    if (!run(["/usr/bin/security", "add-generic-password", "-s", service, "-a", account, "-w", password]).ok) return null;
    found = run(["/usr/bin/security", "find-generic-password", "-w", "-s", service, "-a", account]);
    if (!found.ok) return null;
  }
  return { prefix: "v10", ...cbc(pbkdf2Sync(password, SALT, 1003, 16, "sha1")) };
};

const dpapi = (mode: "Protect" | "Unprotect", data: Buffer): Buffer | null => {
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${mode}($b,$null,'CurrentUser'))`;
  const result = run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], data.toString("base64"));
  return result.ok ? Buffer.from(result.out.trim(), "base64") : null;
};

const windowsBackend = (): Backend | null => {
  const localState = path.join(app.getPath("userData"), "Local State");
  let state: { os_crypt?: { encrypted_key?: string } } = {};
  try { state = JSON.parse(readFileSync(localState, "utf8")); } catch {}
  let key: Buffer | null = null;
  const encoded = state.os_crypt?.encrypted_key;
  if (encoded) {
    const raw = Buffer.from(encoded, "base64");
    if (raw.subarray(0, 5).toString() === "DPAPI") key = dpapi("Unprotect", raw.subarray(5));
  }
  if (!key) {
    key = randomBytes(32);
    const protectedKey = dpapi("Protect", key);
    if (!protectedKey) return null;
    state.os_crypt = { ...state.os_crypt, encrypted_key: Buffer.concat([Buffer.from("DPAPI"), protectedKey]).toString("base64") };
    writeFileSync(localState, JSON.stringify(state));
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

let backend: Backend | null | undefined;
let backendName = "";

const resolveBackend = (): Backend | null => {
  const name = app.getName();
  if (backend !== undefined && backendName === name) return backend;
  backendName = name;
  try {
    backend = process.platform === "darwin" ? macBackend(name)
      : process.platform === "win32" ? windowsBackend()
      : linuxBackend(name);
  } catch {
    backend = null;
  }
  return backend;
};

const basicText = { prefix: "v10", ...cbc(pbkdf2Sync("peanuts", SALT, 1, 16, "sha1")) };

export const safeStorage = {
  isEncryptionAvailable: () => resolveBackend() !== null,
  isAsyncEncryptionAvailable: async () => resolveBackend() !== null,
  getSelectedStorageBackend: () => process.platform === "linux" ? (resolveBackend() ? "gnome_libsecret" : "basic_text") : "unknown",
  setUsePlainTextEncryption: () => {},
  encryptString(plaintext: string): Buffer {
    const b = resolveBackend();
    if (!b) throw new Error("Error while encrypting the text provided to safeStorage.encryptString. Encryption is not available.");
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
  async encryptStringAsync(plaintext: string) { return safeStorage.encryptString(plaintext); },
  async decryptStringAsync(encrypted: Buffer) { return { result: safeStorage.decryptString(encrypted), shouldReEncrypt: false }; },
};

