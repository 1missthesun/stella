#!/usr/bin/env node
// Refuses a deploy whose install links any workspace to an unpatched copy of a
// patchedDependencies package. A filtered `bun install` (`bun run deps backend`)
// can do that, and a bundle that mixes both copies breaks at runtime.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patched = Object.keys(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).patchedDependencies ?? {});

const workspaces = [root];
for (const group of ["packages", "workers"]) {
  const dir = path.join(root, group);
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) workspaces.push(path.join(dir, entry.name));
  }
}

const problems = [];
for (const spec of patched) {
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const unpatchedDir = `${path.sep}.bun${path.sep}${name.replace("/", "+")}@${spec.slice(at + 1)}${path.sep}`;
  for (const workspace of workspaces) {
    const link = path.join(workspace, "node_modules", name);
    try {
      lstatSync(link);
    } catch {
      continue;
    }
    if (realpathSync(link).includes(unpatchedDir)) {
      problems.push(`${path.relative(root, link)} -> unpatched ${spec}`);
    }
  }
}

if (problems.length > 0) {
  console.error("[patched-deps] Refusing to deploy: these links skip the repo's patches:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("[patched-deps] Run a full `bun install --frozen-lockfile` at the repo root, then deploy again.");
  process.exit(1);
}
