import { webcrypto } from "node:crypto";

export const generateCapabilityKeyPair = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
  const { kty, crv, x, y } = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  return { privateKeyPem, publicJwk: { kty, crv, x, y, alg: "ES256", use: "sig" } };
};
