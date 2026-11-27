/// <reference path="../natives.d.ts" />
const enc = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function createHash(alg: string) {
  const parts: Uint8Array[] = [];
  const name = alg.toLowerCase() === "sha1" ? "SHA-1" : alg.toLowerCase() === "sha512" ? "SHA-512" : "SHA-256";
  const h = {
    update(d: string | Uint8Array) { parts.push(typeof d === "string" ? enc.encode(d) : d); return h; },
    digest(format?: string) {
      const n = parts.reduce((a, p) => a + p.length, 0);
      const all = new Uint8Array(n);
      let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      const out = __native.digest(name, all);
      if (format === "hex") return hex(out);
      if (format === "base64") return btoa(String.fromCharCode(...out));
      return out;
    },
  };
  return h;
}
export const randomUUID = () => crypto.randomUUID();
export const randomBytes = (n: number) => __native.random(n);
export const webcrypto = globalThis.crypto;
export default { createHash, randomUUID, randomBytes, webcrypto };
