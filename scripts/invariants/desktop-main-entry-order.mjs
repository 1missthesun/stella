import { readFileSync } from "node:fs";
import path from "node:path";

const EXPECTED_STATIC_IMPORTS = [
  'import "./bootstrap/windows-hidden-spawns.js";',
  'import "@stella/node-shared/shared/http-proxy.js";',
];
const DEFERRED_MAIN = 'await import("./main-process.js");';

export async function check(root) {
  const file = "packages/desktop/electron/main.ts";
  const source = readFileSync(path.join(root, file), "utf8");
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));
  const problems = [];
  const staticImports = lines.filter((line) => /^import\b/.test(line));
  if (JSON.stringify(staticImports) !== JSON.stringify(EXPECTED_STATIC_IMPORTS)) {
    problems.push(
      `${file} must statically import only the Windows hidden-spawn patch, then the fetch proxy, in that order; found ${JSON.stringify(staticImports)}`,
    );
  }
  if (lines[0] !== EXPECTED_STATIC_IMPORTS[0]) {
    problems.push(`${file} must start with ${EXPECTED_STATIC_IMPORTS[0]} so nothing spawns before the patch`);
  }
  if (!lines.includes(DEFERRED_MAIN)) {
    problems.push(`${file} must load main-process through ${DEFERRED_MAIN} so it runs after the patch in its own chunk`);
  }
  return problems;
}
