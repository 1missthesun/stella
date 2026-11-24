import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = "workers/cloud-builder/src";

const expectations = [
  { file: "build-session/owner-purge-transfer.ts", needle: "prefix: `agent-home/${ownerHash}/`" },
  { file: "build-session/owner-purge-transfer.ts", needle: "prefix: `conversations/${ownerHash}/`" },
  { file: "archive.ts", needle: "`conversations/${this.ownerHashCache.hash}/" },
  { file: "cloud-home-store.ts", needle: "`agent-home/${await this.ownerHash()}/`" },
];

export async function check(root) {
  const problems = [];
  for (const { file, needle } of expectations) {
    const text = readFileSync(path.join(root, SRC, file), "utf8");
    if (!text.includes(needle)) {
      problems.push(
        `${SRC}/${file} no longer contains ${needle}; the owner purge (build-session/owner-purge-transfer.ts) must sweep the same owner-hash prefixes that archive.ts and cloud-home-store.ts write under`,
      );
    }
  }
  return problems;
}
