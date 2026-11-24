import { readFileSync } from "node:fs";
import path from "node:path";

const WORKERD_IMPORTED = "packages/runtime/kernel/tools/url-guard.ts";
const ESBUILD_LAZY = "packages/runtime/kernel/browser-use/worker-api-source.ts";

export async function check(root) {
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  const problems = [];

  for (const match of read(WORKERD_IMPORTED).matchAll(/^\s*(import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
    problems.push(`${WORKERD_IMPORTED}: imports "${match[2]}"; it must stay import-free because workers/cloud-builder runs it on workerd`);
  }
  if (/\bimport\s*\(\s*["']/.test(read(WORKERD_IMPORTED))) {
    problems.push(`${WORKERD_IMPORTED}: dynamic import; it must stay import-free because workers/cloud-builder runs it on workerd`);
  }

  const lazy = read(ESBUILD_LAZY);
  if (/^\s*import\s+(?!type\b)[^;]*?from\s+["']esbuild["']/m.test(lazy) || /(?<!typeof\s)\bimport\s*\(\s*(\/\*[^*]*\*\/\s*)?["']esbuild["']/.test(lazy)) {
    problems.push(`${ESBUILD_LAZY}: esbuild must be imported through a variable specifier, or the cloud image (traced from static imports by workers/cloud-builder/scripts/prepare-image.mjs) pulls it in`);
  }
  return problems;
}
