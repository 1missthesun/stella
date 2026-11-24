import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = "packages/contracts/turn-plane/pairing-proof.ts";

export async function check(root) {
  const source = readFileSync(path.join(root, FILE), "utf8");
  const fields = source.match(/export const DISPATCH_PAYLOAD_WIRE_FIELDS = \{([\s\S]*?)\} as const/)?.[1];
  const canonical = source.match(/export const canonicalDispatchPayloadJson = [\s\S]*?\n};/)?.[0];
  if (!fields || !canonical) return [`${FILE}: DISPATCH_PAYLOAD_WIRE_FIELDS or canonicalDispatchPayloadJson not found`];
  const crossing = [...fields.matchAll(/^\s*(\w+): true,?$/gm)].map((m) => m[1]);
  if (crossing.length === 0) return [`${FILE}: no wire fields read from DISPATCH_PAYLOAD_WIRE_FIELDS`];
  return crossing
    .filter((field) => !new RegExp(`\\b${field}\\b`).test(canonical))
    .map((field) => `${FILE}: DispatchPayload.${field} is marked as crossing the wire but canonicalDispatchPayloadJson never writes it`);
}
