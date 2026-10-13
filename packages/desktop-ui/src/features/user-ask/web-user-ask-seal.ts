import {
  USER_ASK_SEAL_ALGORITHM,
  USER_ASK_SEAL_IV_BYTES,
  USER_ASK_SEAL_KEY_BYTES,
  USER_ASK_SEAL_MAX_PLAINTEXT_BYTES,
  USER_ASK_SEAL_PUBLIC_KEY_BYTES,
  userAskSealAad,
  userAskSealSalt,
  type UserAskRecipientKey,
  type UserAskSealedValue,
} from "@stella/contracts/user-ask";

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
};

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const owned = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(bytes);

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const canSealUserAskValueOnWeb = (
  recipientKey: UserAskRecipientKey | undefined,
): recipientKey is UserAskRecipientKey => {
  if (!recipientKey || recipientKey.algorithm !== USER_ASK_SEAL_ALGORITHM) {
    return false;
  }
  if (!recipientKey.keyId || !/^[A-Za-z0-9_-]+$/u.test(recipientKey.publicKey)) {
    return false;
  }
  return (
    fromBase64Url(recipientKey.publicKey).byteLength ===
    USER_ASK_SEAL_PUBLIC_KEY_BYTES
  );
};

export const sealUserAskValueOnWeb = async (args: {
  askId: string;
  fieldId: string;
  value: string;
  recipientKey: UserAskRecipientKey | undefined;
}): Promise<UserAskSealedValue> => {
  const { recipientKey } = args;
  if (!canSealUserAskValueOnWeb(recipientKey)) {
    throw new Error("This ask has no key to encrypt that value for.");
  }
  const plaintext = new TextEncoder().encode(args.value);
  if (
    plaintext.byteLength === 0 ||
    plaintext.byteLength > USER_ASK_SEAL_MAX_PLAINTEXT_BYTES
  ) {
    throw new Error("That value is too large to send.");
  }
  const subtle = globalThis.crypto.subtle;
  const ephemeral = (await subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const recipient = await subtle.importKey(
    "raw",
    fromBase64Url(recipientKey.publicKey),
    { name: "X25519" },
    false,
    [],
  );
  const agreed = await subtle.deriveBits(
    { name: "X25519", public: recipient },
    ephemeral.privateKey,
    USER_ASK_SEAL_PUBLIC_KEY_BYTES * 8,
  );
  const aad = owned(
    userAskSealAad({
      askId: args.askId,
      keyId: recipientKey.keyId,
      fieldId: args.fieldId,
    }),
  );
  const salt = owned(userAskSealSalt(hex(await subtle.digest("SHA-256", aad))));
  const base = await subtle.importKey("raw", agreed, "HKDF", false, [
    "deriveKey",
  ]);
  const key = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: aad },
    base,
    { name: "AES-GCM", length: USER_ASK_SEAL_KEY_BYTES * 8 },
    false,
    ["encrypt"],
  );
  const iv = globalThis.crypto.getRandomValues(
    new Uint8Array(USER_ASK_SEAL_IV_BYTES),
  );
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    plaintext,
  );
  const clientPublicKey = await subtle.exportKey("raw", ephemeral.publicKey);
  return {
    algorithm: USER_ASK_SEAL_ALGORITHM,
    keyId: recipientKey.keyId,
    clientPublicKey: toBase64Url(new Uint8Array(clientPublicKey)),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
};
