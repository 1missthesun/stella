import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = "workers/cloud-builder/src/owner-gate/gate-base.ts";

export async function check(root) {
  const source = readFileSync(path.join(root, FILE), "utf8");
  const body =
    /protected async beginOwnerFence\([\s\S]*?const body = \{\s*mode: input\.mode,\s*requestId: input\.requestId,\s*ownerId: input\.ownerId,\s*\};[\s\S]*?sha256Hex\(\s*JSON\.stringify\(\{ path: "begin", body \}\),?\s*\)/;
  if (body.test(source)) return [];
  return [
    `${FILE}: beginOwnerFence must hash the body { mode, requestId, ownerId } in that key order; the operation id of a fence barrier left durable by an earlier Worker is this hash.`,
  ];
}
