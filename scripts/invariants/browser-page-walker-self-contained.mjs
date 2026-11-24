import { readFileSync } from "node:fs";
import path from "node:path";

const WALKER = "packages/stella-browser/extension/lib/snapshot.js";
const EMBEDDER = "packages/stella-browser/cli/src/native/snapshot.rs";

export async function check(root) {
  const problems = [];
  const lines = readFileSync(path.join(root, WALKER), "utf8").split("\n");
  const topLevel = lines.filter((line) => /^\S/.test(line));
  if (topLevel[0] !== "export function executeSnapshot(options) {" || topLevel.at(-1) !== "}" || topLevel.length !== 2) {
    problems.push(
      `${WALKER}: must be exactly one top-level \`export function executeSnapshot(options) { … }\` with nothing else at top level, because ${EMBEDDER} inlines its source into the page`,
    );
  }
  const embedder = readFileSync(path.join(root, EMBEDDER), "utf8");
  if (!embedder.includes('replacen("export function", "function", 1)') || !embedder.includes("executeSnapshot(")) {
    problems.push(`${EMBEDDER}: no longer inlines ${WALKER} as \`executeSnapshot\`; update this check`);
  }
  return problems;
}
