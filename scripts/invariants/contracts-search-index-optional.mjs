import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SKIP = new Set(["node_modules", "dist", "build", "out", ".turbo", ".expo", "Pods"]);
const FORCED = /INDEXED\s+BY\s+(?:idx_entry_search_conv_created\b|\$\{\s*SEARCH_TEXT_INDEX_NAME\s*\})/;
const MIGRATED = /SEARCH_TEXT_INDEX_SQL/;

const sources = function* (dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full);
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) yield full;
  }
};

const SCHEMA = "packages/node-shared/storage/schema.ts";
const BUILDER = "packages/runtime/kernel/storage/maintenance.ts";

export async function check(root) {
  const problems = [];
  for (const top of ["packages", "workers"]) {
    for (const file of sources(path.join(root, top))) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      const text = readFileSync(file, "utf8");
      if (FORCED.test(text)) {
        problems.push(`${rel}: queries must not force the search-text index (INDEXED BY); it is built only in the idle window and may be missing`);
      }
      if (rel !== SCHEMA && rel !== BUILDER && MIGRATED.test(text)) {
        problems.push(`${rel}: SEARCH_TEXT_INDEX_SQL is built only by ${BUILDER} in the idle window, never at open or in a migration`);
      }
    }
  }
  return problems;
}
