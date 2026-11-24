import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = "packages/node-shared/shared/process-identity.ts";

export async function check(root) {
  const source = readFileSync(path.join(root, FILE), "utf8");
  const specifiers = [
    ...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm),
    ...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
    ...source.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  return specifiers
    .filter((specifier) => !specifier.startsWith("node:"))
    .map((specifier) => `${FILE}: imports "${specifier}"; the verify-stella harness loads this file with Node's type stripping, so it may import only node: builtins`);
}
