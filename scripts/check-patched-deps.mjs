#!/usr/bin/env node
// Every installed copy of a patchedDependencies package must carry its patch.
// `bun install --omit peer` (the runtime and backend kinds of `bun run deps`)
// skips patchedDependencies, and a bundle that mixes patched and unpatched
// copies broke every cloud chat turn ("Not a Harness", 2026-10-15).
// `--fix` applies a missing patch in place; without it the script refuses.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const patchedSpecs = () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return Object.entries(manifest.patchedDependencies ?? {}).map(([spec, patchFile]) => {
    const at = spec.lastIndexOf("@");
    return { spec, name: spec.slice(0, at), version: spec.slice(at + 1), patchFile: path.join(root, patchFile) };
  });
};

const installedCopies = ({ name, version }) => {
  const store = path.join(root, "node_modules", ".bun");
  if (!existsSync(store)) return [];
  const prefix = `${name.replace("/", "+")}@${version}`;
  return readdirSync(store)
    .filter((entry) => entry === prefix || entry.startsWith(`${prefix}+`))
    .map((entry) => path.join(store, entry, "node_modules", name))
    .filter((dir) => existsSync(dir))
    .map((dir) => realpathSync(dir));
};

// git apply outside any repository, so paths resolve against the package dir.
const gitApply = (dir, patchFile, args) =>
  spawnSync("git", ["apply", ...args, patchFile], {
    cwd: dir,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) },
    encoding: "utf8",
  });

const isPatched = (dir, patchFile) => gitApply(dir, patchFile, ["--reverse", "--check"]).status === 0;

// Store files are hardlinks into bun's global cache; replace each touched file
// with its own copy so the patch never edits the cache.
const detachTouchedFiles = (dir, patchFile) => {
  const touched = new Set();
  for (const line of readFileSync(patchFile, "utf8").split("\n")) {
    const match = /^(?:---|\+\+\+) [ab]\/(.+)$/.exec(line);
    if (match) touched.add(match[1]);
  }
  for (const file of touched) {
    const target = path.join(dir, file);
    if (!existsSync(target)) continue;
    const copy = `${target}.stella-detach`;
    writeFileSync(copy, readFileSync(target));
    renameSync(copy, target);
  }
};

const workspaceDirs = () => {
  const dirs = [root];
  for (const group of ["packages", "workers"]) {
    const dir = path.join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.join(dir, entry.name));
    }
  }
  return dirs;
};

// Two copies of one patched package in a bundle break identity checks
// (`instanceof`, brands), so every workspace must link the same copy.
const splitLinks = ({ spec, name }) => {
  const byTarget = new Map();
  for (const workspace of workspaceDirs()) {
    const link = path.join(workspace, "node_modules", name);
    if (!existsSync(link)) continue;
    const target = realpathSync(link);
    byTarget.set(target, [...(byTarget.get(target) ?? []), path.relative(root, workspace) || "."]);
  }
  if (byTarget.size <= 1) return [];
  return [
    `${spec} is linked from more than one copy: ` +
      [...byTarget].map(([target, users]) => `${users.join(", ")} -> ${path.relative(root, target)}`).join("; "),
  ];
};

export const ensurePatchedDeps = ({ fix }) => {
  const problems = [];
  for (const dep of patchedSpecs()) {
    problems.push(...splitLinks(dep));
    for (const dir of installedCopies(dep)) {
      if (isPatched(dir, dep.patchFile)) continue;
      if (fix) {
        detachTouchedFiles(dir, dep.patchFile);
        const applied = gitApply(dir, dep.patchFile, []);
        if (applied.status === 0 && isPatched(dir, dep.patchFile)) {
          console.log(`[patched-deps] applied ${path.relative(root, dep.patchFile)} to ${path.relative(root, dir)}`);
          continue;
        }
        problems.push(`${path.relative(root, dir)}: patch failed to apply: ${applied.stderr.trim()}`);
        continue;
      }
      problems.push(`${path.relative(root, dir)} is missing ${dep.spec}'s patch`);
    }
  }
  return problems;
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fix = process.argv.includes("--fix");
  const problems = ensurePatchedDeps({ fix });
  if (problems.length > 0) {
    console.error("[patched-deps] Refusing: patched dependencies are not installed as the repo expects:");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("[patched-deps] Run `bun run deps <kind>` again; if it persists, a full `bun install --frozen-lockfile` at the repo root.");
    process.exit(1);
  }
}
