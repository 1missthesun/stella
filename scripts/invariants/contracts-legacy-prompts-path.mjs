import { readFileSync } from "node:fs";
import path from "node:path";
import { trackedSources } from "./lib/tracked-sources.mjs";

const DEFINED_IN = "packages/contracts/stella-api.ts";

export async function check(root) {
  const problems = [];
  for (const file of trackedSources(root, ["packages"])) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel === DEFINED_IN) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes("STELLA_PROMPTS_LEGACY_PATH")) {
      problems.push(`${rel}: only the backend serves the legacy prompts path; desktops read STELLA_PROMPTS_PATH`);
    }
  }
  return problems;
}
