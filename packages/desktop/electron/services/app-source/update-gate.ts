import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { git, gitRaw, run } from "./git.js";

/**
 * The check a merged update has to pass before it is applied by itself, and
 * the build that gets a relaunch ready.
 *
 * Both are the build the launcher already runs on every start: Electron main
 * and the sandboxed preload, esbuild bundles over `packages/desktop/electron`,
 * `packages/contracts` and `packages/runtime`. That is deliberately the one
 * check worth gating on here — a main or preload that does not build is a
 * Stella that does not start, which is the only outcome a user cannot ask
 * Stella to fix. It costs about a second and needs no install.
 *
 * It runs on a scratch copy of the version, never on the checkout, so an
 * abort leaves nothing half-merged: the checkout is only touched by the final
 * fast-forward, after this returns. The copy is written from git's objects
 * through a private index (`read-tree` and `checkout-index`), which leaves no
 * worktree for git or anyone listing worktrees to see.
 *
 * `node_modules` is symlinked in rather than installed. The root directory
 * holds no workspace packages (bun puts `@stella/*` in each package's own
 * `node_modules`), and the bundle resolves `@stella/contracts` and
 * `@stella/runtime` through esbuild aliases computed from the tree it is
 * building — so the sources under test are the merged ones, while third-party
 * packages come from the checkout. A merge that needs dependencies the
 * checkout does not have yet therefore fails the gate rather than passing it
 * blindly, and the failure goes to an agent.
 *
 * What it does not cover: the renderer, which is served from source and
 * type-checked nowhere on this path. A renderer that breaks is recoverable
 * from inside the running app; main and preload are not.
 */

export type GateResult = { ok: true } | { ok: false; output: string };

type Log = (event: string, data: Record<string, unknown>) => void;

const BUILD_TIMEOUT_MS = 5 * 60_000;
/** Enough of the build's complaint to act on, without a brief made of noise. */
const OUTPUT_LIMIT = 4_000;
const RUNNER = "stella-update-gate.mjs";
/**
 * Written into the scratch copy and run there, rather than running the build
 * script as the entry point.
 *
 * Any entry-point guard decides whether to work from the shape of
 * `process.argv[1]`, and this gate was where one got that wrong: a scratch
 * path under a symlinked directory made the comparison fail, and the build
 * exited 0 having built nothing. The guard is fixed (`scripts/lib/
 * entry-point.mjs`), but a gate should not be taking anyone's word for it:
 * importing the export and asserting both `built` and the outputs cannot
 * pass vacuously, whatever the guard decides.
 */
const RUNNER_SOURCE = `import {
  ensureElectronBundlesFresh,
  requiredOutputsExist,
} from "./packages/desktop/scripts/dev-electron-build.mjs";

try {
  const result = await ensureElectronBundlesFresh({
    log: (message) => console.log(message),
  });
  if (!result.built || !requiredOutputsExist()) {
    console.error("The update check did not build Electron main and preload.");
    process.exit(1);
  }
} catch (error) {
  // esbuild's message is already the list of files and reasons; its thrown
  // object dumped whole is noise an agent would have to read past.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;

/**
 * What main and preload are built from: the build's source roots, the
 * directories of every file the checkout's last build read, and the files
 * that steer resolution (the top of the repo, package manifests, tsconfigs).
 * About a quarter of the tree. A build that fails on just these is tried
 * again on the whole tree, so leaving something out only costs time.
 */
const BUILD_ROOTS = [
  "packages/contracts/",
  "packages/desktop/",
  "packages/runtime/",
  "packages/desktop-ui/src/shared/i18n/",
];
const RESOLUTION_FILE = /(^|\/)(package\.json|tsconfig[^/]*\.json)$/;

const buildReads = (inputs: Set<string>) => {
  const dirs = [...new Set([...inputs].map((input) => `${path.posix.dirname(input)}/`))];
  return (file: string) =>
    !file.includes("/") ||
    RESOLUTION_FILE.test(file) ||
    BUILD_ROOTS.some((root) => file.startsWith(root)) ||
    dirs.some((dir) => file.startsWith(dir));
};

const DESKTOP_DIR = path.join("packages", "desktop");
const BUNDLE_OUTDIR = path.join(DESKTOP_DIR, "dist-electron");
const FINGERPRINT_FILE = ".dev-electron-bundle-fingerprint.json";

type ScratchOptions = { background?: boolean; signal?: AbortSignal };

/** Write `commit`'s tree into `scratch` from git's objects alone. */
const writeTree = async (
  cwd: string,
  commit: string,
  scratch: string,
  whole: boolean,
  options: ScratchOptions,
) => {
  await fs.rm(scratch, { recursive: true, force: true });
  await fs.mkdir(scratch, { recursive: true });
  const index = `${scratch}.index`;
  const env = { GIT_INDEX_FILE: index };
  const gitOptions = { env, ...options };
  try {
    await git(cwd, ["read-tree", commit], gitOptions);
    const prefix = `--prefix=${scratch}${path.sep}`;
    if (whole) {
      await git(cwd, ["checkout-index", "-a", "-f", prefix], gitOptions);
    } else {
      const reads = buildReads(await recordedBundleInputs(cwd));
      const files = (await git(cwd, ["ls-files", "-z"], gitOptions))
        .split("\0")
        .filter((file) => file && reads(file));
      await git(cwd, ["checkout-index", "-f", "-z", "--stdin", prefix], {
        ...gitOptions,
        input: `${files.join("\0")}\0`,
      });
    }
  } finally {
    await fs.rm(index, { force: true });
  }
};

/** Packages whose `node_modules` the bundle build resolves through. */
const linkNodeModules = async (cwd: string, scratch: string) => {
  await fs.symlink(
    path.join(cwd, "node_modules"),
    path.join(scratch, "node_modules"),
    "dir",
  );
  const packages = await fs
    .readdir(path.join(scratch, "packages"), { withFileTypes: true })
    .catch(() => []);
  for (const entry of packages) {
    if (!entry.isDirectory()) continue;
    const from = path.join(cwd, "packages", entry.name, "node_modules");
    if (!(await fs.stat(from).catch(() => null))) continue;
    await fs.symlink(
      from,
      path.join(scratch, "packages", entry.name, "node_modules"),
      "dir",
    );
  }
};

/**
 * desktop-ui's env files are untracked, and main bakes a key from them: the
 * scratch build reads the checkout's, as the checkout's own build would.
 */
const copyEnvFiles = async (cwd: string, scratch: string) => {
  const dir = path.join("packages", "desktop-ui");
  const names = await fs.readdir(path.join(cwd, dir)).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.startsWith(".env")) continue;
    const target = path.join(scratch, dir, name);
    if (await fs.stat(target).catch(() => null)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(cwd, dir, name), target).catch(() => undefined);
  }
};

/** The repo files the checkout's last build of main and preload read. */
const recordedBundleInputs = async (cwd: string) => {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(cwd, DESKTOP_DIR, FINGERPRINT_FILE), "utf8"),
    ) as { inputs?: unknown };
    return new Set(
      Array.isArray(parsed.inputs)
        ? parsed.inputs.filter((input): input is string => typeof input === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
};

/**
 * Whether any of `files` can change what main and preload build into: a file
 * the last build read (that is how a shared file elsewhere in the repo, like
 * the browser extension's, counts), the build's source roots and config, the
 * build scripts, any package manifest or lockfile, and anything at the top of
 * the repo. Broader than the build's own list on purpose; erring here only
 * costs the check.
 */
export const touchesBundleInputs = async (cwd: string, files: string[]) => {
  const recorded = await recordedBundleInputs(cwd);
  return files.some(
    (file) =>
      recorded.has(file) ||
      !file.includes("/") ||
      file.startsWith("packages/contracts/") ||
      file.startsWith("packages/desktop/") ||
      file.startsWith("packages/runtime/") ||
      file.startsWith("packages/desktop-ui/src/shared/i18n/") ||
      file.startsWith("packages/desktop-ui/.env") ||
      path.posix.basename(file) === "package.json" ||
      path.posix.basename(file).startsWith("tsconfig") ||
      path.posix.basename(file) === "bun.lock",
  );
};

const changedFiles = async (cwd: string, from: string, to: string) => {
  const changed = await gitRaw(cwd, ["diff", "--name-only", "-z", "--no-renames", from, to]);
  return changed.code === 0 ? changed.stdout.split("\0").filter(Boolean) : null;
};

export type ScratchBuild =
  | { ok: true; ms: number }
  | { ok: false; ms: number; output: string };

/**
 * Build main and preload from `commit` in `scratch`. With `keep`, the outputs
 * and the inputs they read are copied there (`adoptElectronBundles` takes
 * them into the checkout once it holds `commit`). Always removes the scratch
 * copy, including when the build throws.
 */
export const buildOnScratch = async (args: {
  cwd: string;
  commit: string;
  scratch: string;
  keep?: string;
  background?: boolean;
  signal?: AbortSignal;
}): Promise<ScratchBuild> => {
  const { cwd, commit, scratch, keep } = args;
  const options = { background: args.background, signal: args.signal };
  const startedAt = Date.now();
  const attempt = async (whole: boolean) => {
    await writeTree(cwd, commit, scratch, whole, options);
    await linkNodeModules(cwd, scratch);
    await copyEnvFiles(cwd, scratch);
    await fs.writeFile(path.join(scratch, RUNNER), RUNNER_SOURCE);
    return await run(process.execPath, [path.join(scratch, RUNNER)], {
      cwd: scratch,
      // Electron's binary is the only Node this app is sure to have, and it
      // is what builds these bundles on a normal launch.
      env: { ELECTRON_RUN_AS_NODE: "1" },
      timeoutMs: BUILD_TIMEOUT_MS,
      ...options,
    });
  };
  try {
    let result = await attempt(false);
    if (result.code !== 0) result = await attempt(true);
    if (result.code !== 0) {
      const output = `${result.stdout}\n${result.stderr}`.trim();
      return { ok: false, ms: Date.now() - startedAt, output: output.slice(-OUTPUT_LIMIT) };
    }
    if (keep) {
      await fs.rm(keep, { recursive: true, force: true });
      await fs.mkdir(keep, { recursive: true });
      await fs.cp(path.join(scratch, BUNDLE_OUTDIR), path.join(keep, "dist-electron"), {
        recursive: true,
      });
      await fs.copyFile(
        path.join(scratch, DESKTOP_DIR, FINGERPRINT_FILE),
        path.join(keep, FINGERPRINT_FILE),
      );
    }
    return { ok: true, ms: Date.now() - startedAt };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
};

/**
 * Build Electron main and preload from `commit` on a scratch copy, as the
 * check a merge passes before it applies. Passes at once when `commit`
 * changes nothing the build reads from the checkout's HEAD: its main and
 * preload are then the ones this process was started from.
 */
export const checkMergedUpdate = async (
  cwd: string,
  commit: string,
  scratch: string,
  log: Log,
  options: { background?: boolean; signal?: AbortSignal; keep?: string } = {},
): Promise<GateResult> => {
  const files = await changedFiles(cwd, "HEAD", commit);
  if (files && !options.keep && !(await touchesBundleInputs(cwd, files))) {
    log("app-source.update-gate", { code: 0, ms: 0, skipped: "no build inputs changed" });
    return { ok: true };
  }
  const result = await buildOnScratch({ cwd, commit, scratch, ...options });
  log("app-source.update-gate", { code: result.ok ? 0 : 1, ms: result.ms });
  return result.ok ? { ok: true } : { ok: false, output: result.output };
};

/**
 * Get main and preload ready in the checkout itself, ahead of a relaunch, so
 * the next process finds them fresh and only has to start. With `prepared`
 * (outputs built from this same tree before it was applied), they are taken
 * as they are; otherwise, or when that fails, it is the same build the next
 * launch would run, from the same tree. A failure is logged and left to that
 * launch. Never throws.
 */
export const prebuildElectronBundles = async (
  cwd: string,
  runner: string,
  log: Log,
  prepared?: string,
): Promise<void> => {
  const startedAt = Date.now();
  try {
    const script = pathToFileURL(
      path.join(cwd, "packages", "desktop", "scripts", "dev-electron-build.mjs"),
    ).href;
    await fs.mkdir(path.dirname(runner), { recursive: true });
    await fs.writeFile(
      runner,
      `const build = await import(${JSON.stringify(script)});\n` +
        `const from = ${JSON.stringify(prepared ?? "")};\n` +
        `const adopted = from && build.adoptElectronBundles ? build.adoptElectronBundles(from).adopted : false;\n` +
        `if (!adopted) await build.ensureElectronBundlesFresh();\n` +
        `console.log(adopted ? "adopted" : "built");\n`,
    );
    const result = await run(process.execPath, [runner], {
      cwd,
      env: { ELECTRON_RUN_AS_NODE: "1" },
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    log("app-source.prebuild", {
      code: result.code,
      ms: Date.now() - startedAt,
      how: result.stdout.trim().split("\n").at(-1) ?? "",
    });
  } catch (error) {
    log("app-source.prebuild", {
      code: -1,
      ms: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Run the launcher's own setup step (native helpers, the browser, office
 * previews) for the checkout as it now stands, ahead of a relaunch. It notes
 * the commit it prepared, so the launcher's run of it on the way back up
 * returns at once instead of holding the restart. Never throws: the launcher
 * runs it again regardless.
 */
export const prepareInstallAhead = async (cwd: string, log: Log): Promise<boolean> => {
  const startedAt = Date.now();
  const bun = process.env.STELLA_BUN_PATH?.trim() || "bun";
  try {
    const result = await run(
      bun,
      [path.join(cwd, "packages", "desktop", "scripts", "prepare-install.mjs")],
      { cwd, timeoutMs: 10 * 60_000 },
    );
    log("app-source.prepare-install", { code: result.code, ms: Date.now() - startedAt });
    return result.code === 0;
  } catch (error) {
    log("app-source.prepare-install", {
      code: -1,
      ms: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

/** `name@version` for every registry package a `bun.lock` pins. */
const lockedPackages = (text: string) => {
  const found = new Set<string>();
  try {
    const parsed = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1")) as {
      packages?: Record<string, unknown>;
    };
    for (const entry of Object.values(parsed.packages ?? {})) {
      if (!Array.isArray(entry)) continue;
      const [spec, registry] = entry as unknown[];
      if (typeof spec !== "string" || registry !== "") continue;
      const at = spec.lastIndexOf("@");
      if (at <= 0 || !/^\d/.test(spec.slice(at + 1))) continue;
      found.add(spec);
    }
  } catch {
    // An unreadable lockfile warms nothing.
  }
  return found;
};

const ELECTRON_WARM_SOURCE = `import { createRequire } from "node:module";
const require = createRequire(process.argv[2]);
const { version } = require("./package.json");
const { downloadArtifact } = require("@electron/get");
let checksums;
try { checksums = require("./checksums.json"); } catch {}
await downloadArtifact({
  version,
  artifactName: "electron",
  cacheRoot: process.env.electron_config_cache,
  checksums,
  platform: process.platform,
  arch: process.arch,
});
`;

/**
 * Download the packages an update's lockfile adds into bun's own cache, and
 * Electron's archive into Electron's when the update moves it, so the install
 * the update needs when it is applied only has to link them. Nothing here
 * touches the checkout: the packages land in a scratch project of their own,
 * installed without scripts and removed afterwards. Never throws.
 */
export const warmDependencies = async (args: {
  cwd: string;
  from: string;
  to: string;
  scratch: string;
  log: Log;
  signal?: AbortSignal;
}): Promise<void> => {
  const { cwd, from, to, scratch, log, signal } = args;
  const startedAt = Date.now();
  const lock = async (commit: string) =>
    (await gitRaw(cwd, ["show", `${commit}:bun.lock`], { signal })).stdout;
  try {
    const before = lockedPackages(await lock(from));
    const added = [...lockedPackages(await lock(to))].filter((spec) => !before.has(spec));
    if (added.length === 0) return;
    const dependencies: Record<string, string> = {};
    for (const [index, spec] of added.entries()) {
      const at = spec.lastIndexOf("@");
      const name = spec.slice(0, at);
      const version = spec.slice(at + 1);
      dependencies[name in dependencies ? `stella-warm-${index}` : name] =
        name in dependencies ? `npm:${name}@${version}` : version;
    }
    await fs.rm(scratch, { recursive: true, force: true });
    await fs.mkdir(scratch, { recursive: true });
    await fs.writeFile(
      path.join(scratch, "package.json"),
      JSON.stringify({ name: "stella-update-warm", private: true, dependencies }),
    );
    const bun = process.env.STELLA_BUN_PATH?.trim() || "bun";
    const install = await run(bun, ["install", "--ignore-scripts", "--no-summary"], {
      cwd: scratch,
      timeoutMs: 10 * 60_000,
      background: true,
      signal,
    });
    let electron: number | null = null;
    if (install.code === 0 && "electron" in dependencies) {
      const runner = path.join(scratch, "warm-electron.mjs");
      await fs.writeFile(runner, ELECTRON_WARM_SOURCE);
      electron = (
        await run(
          process.execPath,
          [runner, path.join(scratch, "node_modules", "electron", "install.js")],
          {
            cwd: scratch,
            env: { ELECTRON_RUN_AS_NODE: "1" },
            timeoutMs: 10 * 60_000,
            background: true,
            signal,
          },
        )
      ).code;
    }
    log("app-source.prepare-deps", {
      packages: added.length,
      code: install.code,
      ...(electron !== null ? { electron } : {}),
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    log("app-source.prepare-deps", {
      code: -1,
      ms: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
};
