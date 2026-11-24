import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFINED_IN = "packages/contracts/stella-api.ts";
const SKIP = new Set(["node_modules", "dist", "build", "out", ".turbo", ".expo", "Pods"]);

const sources = function* (dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full);
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) yield full;
  }
};

export async function check(root) {
  const problems = [];
  for (const file of sources(path.join(root, "packages"))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel === DEFINED_IN) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes("STELLA_PROMPTS_LEGACY_PATH")) {
      problems.push(`${rel}: only the backend serves the legacy prompts path; desktops read STELLA_PROMPTS_PATH`);
    }
  }
  return problems;
}
