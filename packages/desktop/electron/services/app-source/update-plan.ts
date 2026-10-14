import { git, gitRaw } from "./git.js";

const RESTART_PREFIX = "packages/desktop/electron/";
export const installs = (paths: string[]) =>
  paths.some((file) => file === "bun.lock" || file.endsWith("package.json"));
const RUNTIME_PREFIXES = ["packages/runtime/", "packages/contracts/", "packages/agent/"];
export const restartsRuntime = (paths: string[]) =>
  paths.some((file) => RUNTIME_PREFIXES.some((prefix) => file.startsWith(prefix)));
export const relaunches = (paths: string[]) =>
  installs(paths) || paths.some((file) => file.startsWith(RESTART_PREFIX));

export type UpdatePlan =
  | { kind: "none" }
  | {
      kind: "fast-forward";
      tip: string;
      count: number;
      subject: string;
    }
  | {
      kind: "clean";
      tip: string;
      count: number;
      subject: string;
      base: string;
      tree: string;
      identical: boolean;
      localChanges: boolean;
    }
  | {
      kind: "conflict";
      tip: string;
      count: number;
      subject: string;
      base: string;
      conflicts: string[];
      localChanges: boolean;
    };

/**
 * `merge-tree --write-tree` prints the result tree, then (on conflict) one
 * `<mode> <object> <stage>\t<path>` line per conflicted stage, then a blank
 * line and git's own messages. Three stages name the same file, so the paths
 * are de-duplicated.
 */
export const conflictedPaths = (stdout: string): string[] => {
  const [stages = ""] = stdout.split("\n\n");
  const paths: string[] = [];
  for (const line of stages.split("\n").slice(1)) {
    const path = line.split("\t")[1]?.trim();
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
};

export const classifyUpdate = async (
  cwd: string,
  head: string,
  ref: string,
): Promise<UpdatePlan> => {
  const found = await gitRaw(cwd, ["log", "-1", "--format=%H%x00%s", `${ref}^{commit}`, "--"]);
  const [tip = "", subject = ""] = found.code === 0 ? found.stdout.trim().split("\0") : [];
  if (!tip || tip === head) return { kind: "none" };
  const [ours = 0, count = 0] = (
    await git(cwd, ["rev-list", "--left-right", "--count", `${head}...${tip}`])
  )
    .split(/\s+/)
    .map(Number);
  if (count === 0) return { kind: "none" };
  if (ours === 0) return { kind: "fast-forward", tip, count, subject };
  const base = await git(cwd, ["merge-base", head, tip]);
  const localChanges =
    (await gitRaw(cwd, ["diff", "--quiet", base, head])).code !== 0;
  const merge = await gitRaw(cwd, [
    "merge-tree",
    "--write-tree",
    "--merge-base",
    base,
    head,
    tip,
  ]);
  if (merge.code === 1) {
    return {
      kind: "conflict",
      tip,
      count,
      subject,
      base,
      conflicts: conflictedPaths(merge.stdout),
      localChanges,
    };
  }
  if (merge.code !== 0) {
    throw new Error(merge.stderr.trim() || "Could not work out the merge.");
  }
  const tree = merge.stdout.split("\n")[0]!.trim();
  const upstreamTree = await git(cwd, ["rev-parse", `${tip}^{tree}`]);
  return {
    kind: "clean",
    tip,
    count,
    subject,
    base,
    tree,
    identical: tree === upstreamTree,
    localChanges,
  };
};
