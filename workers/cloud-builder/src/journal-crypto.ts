/**
 * Per-conversation envelope encryption for the journal, synchronous because
 * the journal's writes and reads are synchronous SQLite transactions.
 *
 * Each conversation holds a random data-encryption key (DEK), wrapped with
 * the deployment key-encryption key (`OWNER_SECRETS_KEK`, the same secret
 * that wraps owner credentials) and stored beside the data it protects.
 * A database or R2 snapshot without the KEK is unreadable, and deleting a
 * conversation destroys its wrapped DEK with the rest of its storage, which
 * crypto-shreds any copy that survives elsewhere.
 *
 * Encoded form: `enc1.<iv>.<tag>.<ciphertext>` (base64), AES-256-GCM. A DEK
 * wrapped under OWNER_SECRETS_KEK_V2 carries a `kek2.` prefix in front.
 * Anything without the prefix is a pre-encryption plaintext row and reads
 * back unchanged, so old segments and spills keep working.
 */

import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { ownerKekFor, type OwnerKeks } from "./secret-rotation.js";

const PREFIX = "enc1.";
const WRAPPED_V2_PREFIX = "kek2.";
const AAD = Buffer.from("stella-journal-v1", "utf8");
/** First byte of `sealBytes` output; a plain (unsealed) blob starts with 0x00. */
export const SEALED_BYTES_V1 = 0x01;
export const PLAIN_BYTES_V1 = 0x00;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const keyFromBase64 = (value: string): Buffer | null => {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.byteLength === 32) return decoded;
  } catch {
    // Fall through to hashing the configured string.
  }
  return createHash("sha256").update(raw, "utf8").digest();
};

const encryptWith = (key: Buffer, plaintext: Buffer): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${bytesToBase64(iv)}.${bytesToBase64(tag)}.${bytesToBase64(ciphertext)}`;
};

const decryptWith = (key: Buffer, stored: string): Buffer => {
  const parts = stored.slice(PREFIX.length).split(".");
  if (parts.length !== 3) throw new Error("Unreadable encrypted journal value.");
  const [iv, tag, ciphertext] = parts as [string, string, string];
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64"),
  );
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
};

export const isEncryptedJournalValue = (value: string): boolean =>
  value.startsWith(PREFIX);

/** The light stem the shared history vocabulary uses, so hashed search keeps `reports` finding `report`. */
const stem = (token: string): string => {
  if (token.length <= 3) return token;
  for (const suffix of ["ations", "ation", "ingly", "ings", "ing", "edly", "ies", "ied", "ed", "es", "ly", "s"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      const base = token.slice(0, -suffix.length);
      return suffix === "ies" || suffix === "ied" ? `${base}y` : base;
    }
  }
  return token;
};

export class JournalCrypto {
  private constructor(private readonly dek: Buffer) {}

  static randomDek(): Buffer {
    return randomBytes(32);
  }

  static wrapDek(keks: OwnerKeks, dek: Buffer): string | null {
    const raw = ownerKekFor(keks, keks.current);
    const kek = raw ? keyFromBase64(raw) : null;
    if (!kek) return null;
    const wrapped = encryptWith(kek, dek);
    return keks.current === "v2" ? `${WRAPPED_V2_PREFIX}${wrapped}` : wrapped;
  }

  static fromWrappedDek(
    keks: OwnerKeks,
    wrapped: string,
  ): JournalCrypto | null {
    const v2 = wrapped.startsWith(WRAPPED_V2_PREFIX);
    const sealed = v2 ? wrapped.slice(WRAPPED_V2_PREFIX.length) : wrapped;
    const raw = ownerKekFor(keks, v2 ? "v2" : "v1");
    const kek = raw ? keyFromBase64(raw) : null;
    if (!kek || !isEncryptedJournalValue(sealed)) return null;
    return new JournalCrypto(decryptWith(kek, sealed));
  }

  static isCurrentWrap(keks: OwnerKeks, wrapped: string): boolean {
    return wrapped.startsWith(WRAPPED_V2_PREFIX) === (keks.current === "v2");
  }

  rewrap(keks: OwnerKeks): string | null {
    return JournalCrypto.wrapDek(keks, this.dek);
  }

  static fromDek(dek: Buffer): JournalCrypto {
    return new JournalCrypto(dek);
  }

  encryptText(plaintext: string): string {
    if (isEncryptedJournalValue(plaintext)) return plaintext;
    return encryptWith(this.dek, Buffer.from(plaintext, "utf8"));
  }

  decryptText(stored: string): string {
    if (!isEncryptedJournalValue(stored)) return stored;
    return new TextDecoder().decode(decryptWith(this.dek, stored));
  }

  /**
   * Binary envelope for bytes kept as BLOBs or R2 objects:
   * `0x01 | iv(12) | tag(16) | ciphertext`, AES-256-GCM under the same DEK
   * and AAD as the text form, without its base64 overhead.
   */
  sealBytes(plain: Uint8Array): Uint8Array {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.dek, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return new Uint8Array(
      Buffer.concat([Buffer.from([SEALED_BYTES_V1]), iv, tag, ciphertext]),
    );
  }

  openBytes(sealed: Uint8Array): Uint8Array {
    if (sealed[0] !== SEALED_BYTES_V1 || sealed.byteLength < 29) {
      throw new Error("Unreadable sealed journal bytes.");
    }
    const bytes = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
    const decipher = createDecipheriv("aes-256-gcm", this.dek, bytes.subarray(1, 13));
    decipher.setAAD(AAD);
    decipher.setAuthTag(bytes.subarray(13, 29));
    return new Uint8Array(
      Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]),
    );
  }

  /** One searchable word as its keyed, stemmed index token. */
  searchToken(word: string): string {
    const digest = createHmac("sha256", this.dek)
      .update(`stella-fts-v1\0${stem(word.toLowerCase())}`, "utf8")
      .digest("hex");
    return `t${digest.slice(0, 24)}`;
  }
}
