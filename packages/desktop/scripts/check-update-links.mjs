// Self-check of how Stella links an app checkout's packages into the scratch
// copies it uses to take a change, and how it removes them again — run for
// real, against a real installed checkout, on the platform at hand.
//
// It runs the app's own code (bundled from packages/desktop/electron/services/
// app-source with esbuild, the way main is), so run it with the runtime
// Stella uses, Electron as Node:
//
//   ELECTRON_RUN_AS_NODE=1 <app>/node_modules/electron/dist/electron[.exe] \
//     <app>/packages/desktop/scripts/check-update-links.mjs [options]
//
//   --app <dir>       the checkout under test (default: this script's checkout)
//   --scratch <dir>   where scratch copies go (default: <tmp>/stella-update-links-check);
//                     Stella itself uses <userData>/update-merge*
//   --draft           also make a draft worktree, prepare its packages as a
//                     task would (draft-deps.ts), and remove it
//   --change <ref>    take this commit (e.g. refs/remotes/stella-fork/main, a
//                     change from another computer) instead of a made-up one,
//                     planned and merged the way Get does
//   --apply           finally fast-forward the checkout to the merged change
//                     (throwaway installs only: it moves the checkout's HEAD)
//
// Steps: the update check's build on a scratch copy (packages linked in), the
// background merge on a scratch worktree (linked, typechecked, removed), a
// leftover scratch with live links cleared, linking refused (the check falls
// back to a task), and with --draft / --apply the rest. After each, the
// checkout's packages must all still be there: on Windows a junction followed
// by `git worktree remove` or fs.rmSync deletes them. Exit code 0 = all passed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const app = path.resolve(arg("--app") ?? path.join(here, "..", "..", ".."));
const scratchBase = path.resolve(arg("--scratch") ?? path.join(os.tmpdir(), "stella-update-links-check"));
const withDraft = process.argv.includes("--draft");
const withApply = process.argv.includes("--apply");
const changeRef = arg("--change");

const results = [];
const report = (step, ok, data = {}) => {
  results.push({ step, ok });
  console.log(JSON.stringify({ step, ok, ...data }));
};

// The app's own modules, bundled from the checkout under test.
const { build } = await import(pathToFileURL(path.join(app, "node_modules", "esbuild", "lib", "main.js")).href);
const source = path.join(app, "packages", "desktop", "electron", "services", "app-source");
// Never fs.rmSync here: on Windows it follows a junction a failed run left
// behind into the checkout's packages. Links first, then the async rm.
const clearScratchBase = async () => {
  if (m) {
    for (const name of fs.existsSync(scratchBase) ? fs.readdirSync(scratchBase) : []) {
      await m.removeModuleLinks(path.join(scratchBase, name));
    }
    await m.removeTree(scratchBase);
  } else {
    await fs.promises.rm(scratchBase, { recursive: true, force: true });
  }
};
let m = null;
await clearScratchBase().catch(() => undefined);
if (fs.existsSync(scratchBase)) {
  console.log(JSON.stringify({ step: "scratch folder", ok: false, error: `${scratchBase} is left from an earlier run; remove its links and it by hand.` }));
  process.exit(1);
}
fs.mkdirSync(scratchBase, { recursive: true });
const bundle = path.join(scratchBase, "app-source-check.mjs");
await build({
  stdin: {
    contents: ["dir-links", "update-gate", "update-merge", "update-plan", "draft-deps", "git"]
      .map((name) => `export * from ${JSON.stringify(path.join(source, `${name}.ts`).replaceAll("\\", "/"))};`)
      .join("\n"),
    resolveDir: source,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: bundle,
  logLevel: "error",
});
m = await import(pathToFileURL(bundle).href);

// What has to survive every step: the checkout's packages and the sources its
// workspace links point at.
const sentinels = [
  "node_modules/typescript-7/package.json",
  "node_modules/esbuild/package.json",
  "node_modules/electron/package.json",
  "packages/desktop/node_modules/@stella/contracts/package.json",
  "packages/contracts/package.json",
  "packages/desktop/package.json",
].map((file) => path.join(app, file));
const countEntries = (dir) => {
  try {
    return fs.readdirSync(dir).length;
  } catch {
    return -1;
  }
};
const moduleCount = countEntries(path.join(app, "node_modules"));
const bunStore = countEntries(path.join(app, "node_modules", ".bun"));
const intact = () => {
  const missing = sentinels.filter((file) => !fs.existsSync(file));
  const count = countEntries(path.join(app, "node_modules"));
  const store = countEntries(path.join(app, "node_modules", ".bun"));
  return { intact: missing.length === 0 && count === moduleCount && store === bunStore, missing, count, store };
};

const git = (args, cwd = app) => m.git(cwd, args).then((out) => out.trim());
const head = await git(["rev-parse", "HEAD"]);

// Whether this process could make the plain directory symlink that used to
// fail (needs admin rights or Developer Mode on Windows), and the link Stella
// makes now.
const probeDir = path.join(scratchBase, "probe");
fs.mkdirSync(path.join(probeDir, "target"), { recursive: true });
let plainSymlink;
try {
  fs.symlinkSync(path.join(probeDir, "target"), path.join(probeDir, "plain"), "dir");
  plainSymlink = "allowed";
  fs.unlinkSync(path.join(probeDir, "plain"));
} catch (error) {
  plainSymlink = error.code ?? String(error);
}
report("environment", true, {
  platform: process.platform,
  runtime: process.versions.electron ? `electron ${process.versions.electron} (node ${process.versions.node})` : `node ${process.versions.node}`,
  app,
  scratchBase,
  head: head.slice(0, 12),
  plainDirectorySymlink: plainSymlink,
  linkType: m.directoryLinkType(),
  ...intact(),
});
if (!intact().intact) {
  report("checkout has its packages", false, intact());
  process.exit(1);
}

// A change the way another computer's arrives: a commit on top of HEAD
// (or the one --change names).
const identity = ["-c", "user.name=Stella", "-c", "user.email=contact@fromyou.ai"];
const makeChange = () => {
  const index = path.join(scratchBase, "change.index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const gitEnv = (args) => {
    const result = spawnSync(process.env.STELLA_GIT_BIN?.trim() || "git", args, { cwd: app, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  gitEnv(["read-tree", head]);
  const blob = spawnSync(process.env.STELLA_GIT_BIN?.trim() || "git", ["hash-object", "-w", "--stdin"], {
    cwd: app,
    input: `Taken on ${process.platform} by check-update-links.\n`,
    encoding: "utf8",
  }).stdout.trim();
  gitEnv(["update-index", "--add", "--cacheinfo", `100644,${blob},stella-update-links-check.txt`]);
  const tree = gitEnv(["write-tree"]);
  const change = gitEnv([...identity, "commit-tree", tree, "-p", head, "-m", "Update links check: a change from another computer"]);
  fs.rmSync(index, { force: true });
  return change;
};
const change = changeRef ? await git(["rev-parse", "--verify", `${changeRef}^{commit}`]) : makeChange();

// What Get does first: plan it, and for a clean merge make the merge commit
// the check then builds.
const plan = await m.classifyUpdate(app, head, change);
let target = plan.kind === "fast-forward" ? plan.tip : null;
if (plan.kind === "clean") {
  target = await git([...identity, "commit-tree", plan.tree, "-p", head, "-p", plan.tip, "-m", "Merge the changes from another computer (links check)"]);
}
report("change planned", plan.kind !== "none", {
  change: change.slice(0, 12),
  ...(changeRef ? { ref: changeRef, subject: plan.subject } : {}),
  kind: plan.kind,
  ...(plan.kind === "conflict" ? { conflicts: plan.conflicts } : {}),
});

// 1. The update check: build main and preload on a scratch copy with the
//    packages linked in, then remove it.
{
  const scratch = path.join(scratchBase, "update-merge");
  const startedAt = Date.now();
  let sawLink = false;
  const watch = setInterval(() => {
    sawLink ||= m.isDirectoryLink(path.join(scratch, "node_modules"));
  }, 100);
  const result = await m.buildOnScratch({ cwd: app, commit: target ?? change, scratch });
  clearInterval(watch);
  const state = intact();
  report("update check builds on a linked scratch copy", result.ok && !fs.existsSync(scratch) && state.intact, {
    built: result.ok,
    linkSeen: sawLink,
    scratchLeft: fs.existsSync(scratch),
    ms: Date.now() - startedAt,
    ...(result.ok ? {} : { output: result.output.slice(-1500) }),
    ...state,
  });
}

// 2. The merge prepared before a change is offered: a scratch git worktree,
//    packages linked, typechecked, then removed links first.
let merged = target;
{
  const dir = path.join(scratchBase, "update-merge-prepare-merge");
  const startedAt = Date.now();
  let sawLink = false;
  const watch = setInterval(() => {
    sawLink ||= m.isDirectoryLink(path.join(dir, "node_modules"));
  }, 100);
  const result = await m.mergeInBackground({
    cwd: app,
    head,
    tip: change,
    subject: "Merge the changes from another computer (links check)",
    dir,
    identityEnv: { GIT_AUTHOR_NAME: "Stella", GIT_AUTHOR_EMAIL: "contact@fromyou.ai", GIT_COMMITTER_NAME: "Stella", GIT_COMMITTER_EMAIL: "contact@fromyou.ai" },
    model: null,
    log: (event, data) => console.log(JSON.stringify({ log: event, ...data })),
  });
  clearInterval(watch);
  const listed = (await git(["worktree", "list", "--porcelain"])).replaceAll("\\", "/").includes(dir.replaceAll("\\", "/"));
  const state = intact();
  if (result.ok && !merged) merged = result.to;
  report("background merge on a linked scratch worktree", result.ok && !fs.existsSync(dir) && !listed && state.intact, {
    merged: result.ok,
    linkSeen: sawLink,
    scratchLeft: fs.existsSync(dir),
    worktreeListed: listed,
    ms: Date.now() - startedAt,
    ...(result.ok ? {} : { result }),
    ...state,
  });
}

// 3. A scratch copy left with live links (Stella quit mid-check) is cleared
//    without touching what the links point at.
{
  const dir = path.join(scratchBase, "update-merge-leftover");
  const target = path.join(scratchBase, "leftover-target");
  fs.mkdirSync(path.join(target, "pkg"), { recursive: true });
  fs.writeFileSync(path.join(target, "pkg", "keep.txt"), "keep");
  fs.mkdirSync(path.join(dir, "packages", "desktop"), { recursive: true });
  await m.linkDirectory(target, path.join(dir, "node_modules"));
  await m.linkDirectory(target, path.join(dir, "packages", "desktop", "node_modules"));
  await m.removeScratchDir(dir);
  const kept = fs.existsSync(path.join(target, "pkg", "keep.txt"));
  report("leftover links removed, never followed", kept && !fs.existsSync(dir), { kept, scratchLeft: fs.existsSync(dir) });
}

// 4. Linking refused (another drive, a policy, antivirus): the check says so
//    and the change goes to a task instead of failing with EPERM.
{
  const scratch = path.join(scratchBase, "update-merge-refused");
  const symlink = fs.promises.symlink;
  fs.promises.symlink = async (target, link) => {
    const error = new Error(`EPERM: operation not permitted, symlink '${target}' -> '${link}'`);
    error.code = "EPERM";
    throw error;
  };
  let result;
  try {
    result = await m.buildOnScratch({ cwd: app, commit: change, scratch });
  } finally {
    fs.promises.symlink = symlink;
  }
  const state = intact();
  report("linking refused falls back to a task", !result.ok && /couldn't run on this computer/.test(result.output) && !fs.existsSync(scratch) && state.intact, {
    output: result.ok ? "" : result.output.split("\n")[0],
    scratchLeft: fs.existsSync(scratch),
    ...state,
  });
}

// 5. A draft as a task makes one: worktree, packages prepared (linked where
//    that is safe, its own install on Windows), removed the way Stella does.
if (withDraft) {
  const draft = path.join(scratchBase, "draft-links-check");
  const startedAt = Date.now();
  await git(["worktree", "add", "--detach", "--force", draft, change]);
  let deps;
  try {
    deps = await m.prepareDraftDependencies({ draftRoot: draft, appRoot: app, bun: process.env.STELLA_BUN_PATH?.trim() || undefined, timeoutMs: 20 * 60_000 });
  } catch (error) {
    deps = { mode: "failed", error: String(error?.message ?? error).slice(-800) };
  }
  const linked = m.isDirectoryLink(path.join(draft, "node_modules"));
  let removeError;
  await m.removeWorktree(app, draft).catch((error) => {
    removeError = String(error?.message ?? error).slice(0, 800);
  });
  const listed = (await git(["worktree", "list", "--porcelain"])).replaceAll("\\", "/").includes(draft.replaceAll("\\", "/"));
  const state = intact();
  report("draft prepared and removed", deps.mode !== "failed" && !removeError && !fs.existsSync(draft) && !listed && state.intact, {
    deps,
    linked,
    ...(removeError ? { removeError } : {}),
    draftLeft: fs.existsSync(draft),
    worktreeListed: listed,
    ms: Date.now() - startedAt,
    ...state,
  });
}

// 6. Apply: the checkout moves to the merged change (throwaway installs only).
if (withApply && merged) {
  await git(["merge", "--ff-only", "-q", merged]);
  const now = await git(["rev-parse", "HEAD"]);
  const status = await git(["status", "--porcelain", "--untracked-files=no"]);
  const state = intact();
  report("checkout fast-forwarded to the merged change", now === merged && status === "" && (changeRef || fs.existsSync(path.join(app, "stella-update-links-check.txt"))) && state.intact, {
    head: now.slice(0, 12),
    clean: status === "",
    ...state,
  });
}

await clearScratchBase();
const failed = results.filter((result) => !result.ok).map((result) => result.step);
console.log(JSON.stringify({ done: true, passed: results.length - failed.length, failed }));
process.exit(failed.length === 0 ? 0 : 1);
