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
 * Encoded form: `enc1.<iv>.<tag>.<ciphertext>` (base64), AES-256-GCM.
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

const PREFIX = "enc1.";
const AAD = Buffer.from("stella-journal-v1", "utf8");

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

  static wrapDek(kekBase64: string, dek: Buffer): string | null {
    const kek = keyFromBase64(kekBase64);
    return kek ? encryptWith(kek, dek) : null;
  }

  static fromWrappedDek(
    kekBase64: string,
    wrapped: string,
  ): JournalCrypto | null {
    const kek = keyFromBase64(kekBase64);
    if (!kek || !isEncryptedJournalValue(wrapped)) return null;
    return new JournalCrypto(decryptWith(kek, wrapped));
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

  /** One searchable word as its keyed, stemmed index token. */
  searchToken(word: string): string {
    const digest = createHmac("sha256", this.dek)
      .update(`stella-fts-v1\0${stem(word.toLowerCase())}`, "utf8")
      .digest("hex");
    return `t${digest.slice(0, 24)}`;
  }
}
