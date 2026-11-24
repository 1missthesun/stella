import { readFileSync } from "node:fs";
import path from "node:path";
import { trackedSources } from "./lib/tracked-sources.mjs";

const FORCED = /INDEXED\s+BY\s+(?:idx_entry_search_conv_created\b|\$\{\s*SEARCH_TEXT_INDEX_NAME\s*\})/;
const MIGRATED = /SEARCH_TEXT_INDEX_SQL/;

const SCHEMA = "packages/node-shared/storage/schema.ts";
const BUILDER = "packages/runtime/kernel/storage/maintenance.ts";

export async function check(root) {
  const problems = [];
  for (const top of ["packages", "workers"]) {
    for (const file of trackedSources(root, [top])) {
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
