/**
 * Lists the hash of every earlier version of each bundled skill in a ref's
 * history, so the desktop recognises an untouched old copy in a user's home
 * and updates it (packages/runtime/kernel/home/skills-sync.ts).
 *
 *   bun scripts/shipped-skill-hashes.ts [--ref <rev>] [--out <file>]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hashBundledUnitFiles } from "../packages/runtime/kernel/home/bundled-sync.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = "packages/home-seed/skills";
const EARLIER_SKILLS_DIRS = ["runtime/home-seed/skills", "state/skills"];

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const ref = option("ref") ?? "HEAD";
const out = option("out");

const git = (gitArgs: string[]) =>
  execFileSync("git", gitArgs, { cwd: repoRoot, maxBuffer: 1 << 28 });
const gitText = (gitArgs: string[]) => git(gitArgs).toString("utf8");

const blobs = new Map<string, Buffer>();
const readBlob = (id: string) => {
  let content = blobs.get(id);
  if (!content) {
    content = git(["cat-file", "blob", id]);
    blobs.set(id, content);
  }
  return content;
};

/** Regular files only: the desktop's hash skips symlinks, and git has no other kinds. */
const unitFiles = (commit: string, dir: string): Map<string, string> | null => {
  let listing: string;
  try {
    listing = execFileSync("git", ["ls-tree", "-r", "-z", `${commit}:${dir}`], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1 << 24,
    }).toString("utf8");
  } catch {
    return null;
  }
  const files = new Map<string, string>();
  for (const line of listing.split("\0")) {
    const match = /^(\d+) blob ([0-9a-f]+)\t(.+)$/s.exec(line);
    if (match && match[1] !== "120000") files.set(match[3]!, match[2]!);
  }
  return files.size > 0 ? files : null;
};

const ids = gitText(["ls-tree", "--name-only", `${ref}:${SKILLS_DIR}`])
  .split("\n")
  .filter((id) => id && !id.startsWith("."));

const shipped: Record<string, string[]> = {};
for (const id of ids) {
  const hashes = new Set<string>();
  for (const dir of [SKILLS_DIR, ...EARLIER_SKILLS_DIRS]) {
    const unit = `${dir}/${id}`;
    const commits = gitText(["log", "--format=%H", ref, "--", unit]).split("\n").filter(Boolean);
    for (const commit of commits) {
      const files = unitFiles(commit, unit);
      if (!files) continue;
      hashes.add(await hashBundledUnitFiles([...files.keys()], async (rel) => readBlob(files.get(rel)!)));
    }
  }
  shipped[id] = [...hashes].sort();
}

const serialized = `${JSON.stringify(shipped, null, 1)}\n`;
if (out) {
  writeFileSync(out, serialized);
  const total = Object.values(shipped).reduce((sum, hashes) => sum + hashes.length, 0);
  console.log(`${total} versions of ${ids.length} skills -> ${out}`);
} else {
  process.stdout.write(serialized);
}
