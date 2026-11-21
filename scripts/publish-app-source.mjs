#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM_REPO = "upstream";

// An installed Stella is the desktop app's source: what a task on the
// user's computer can change and see take effect. The phone app, the cloud
// backend, the website, the launchers and this repo's own tooling and docs
// stay out, so a task asked for a change never goes looking in them. (A
// self-hoster deploys the backend from a clone of this repo, not from here.)
const EXCLUDED_PATHS = [
  ".agents",
  ".codex",
  ".github",
  "infra",
  "launcher",
  "workers",
  "packaging",
  "packages/executor-cloud",
  "packages/mobile",
  "packages/mobile-screenshots",
  "packages/website",
  // OfficeCLI's source: installs download its build.
  "packages/stella-office/vendor/officecli/src",
  "AGENTS.md",
  "CLAUDE.md",
  "DEPLOY.md",
  "SELF_HOSTING.md",
  "TESTING.md",
  "eslint.workers.config.js",
];
/** Of the repo's own scripts, only what the app's scripts import. */
const KEPT_ROOT_SCRIPTS = new Set(["lib/entry-point.mjs"]);
const INSTALL_GUIDE = "scripts/app-source/install-guide.md";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const namespace = option("namespace", "stella-app-dev");
const ref = option("ref", "HEAD");
/** Writes the tree an install would get to this folder and publishes nothing. */
const outDir = option("out", "");

const NAMESPACE_BACKENDS = {
  "stella-app-dev": "https://stella-v2-cloud-builder-dev.fromyou.workers.dev",
  "stella-app-prod": "https://stella-v2-cloud-builder-prod.fromyou.workers.dev",
  "stella-app-acceptance": "https://stella-v2-cloud-builder-basic-nightingale-118.fromyou.workers.dev",
};
const backend = option("backend", NAMESPACE_BACKENDS[namespace]);

/** Tell the backend's connected desktops; never fails the publish. */
const announce = async (expected) => {
  if (!backend) {
    console.log(`No backend follows ${namespace}; pass --backend <url> to tell its desktops.`);
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${backend.replace(/\/+$/, "")}/api/app-source/releases`, {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        const { version } = await response.json();
        if (version === expected) {
          console.log(`Told ${backend}'s desktops about ${String(version).slice(0, 12)}.`);
          return;
        }
        console.warn(`${backend} still reports ${String(version).slice(0, 12)}, not ${expected.slice(0, 12)}.`);
      } else {
        console.warn(`Release notice to ${backend} failed (${response.status}).`);
      }
    } catch (error) {
      console.warn(`Release notice to ${backend} failed: ${error instanceof Error ? error.message : error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  console.warn("Desktops will see this version when they next connect.");
};

const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options }).trim();

const wrangler = (commandArgs) => {
  const result = spawnSync("bunx", ["wrangler", "artifacts", ...commandArgs, "--json"], {
    cwd: path.join(repoRoot, "workers/cloud-builder"),
    encoding: "utf8",
  });
  if (result.status !== 0) return { ok: false, output: `${result.stdout}\n${result.stderr}` };
  return { ok: true, value: JSON.parse(result.stdout) };
};


const pruneRootScripts = (dir) => {
  const walk = (relative) => {
    const full = path.join(dir, "scripts", relative);
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(child);
        if (readdirSync(path.join(dir, "scripts", child)).length === 0) rmSync(path.join(dir, "scripts", child), { recursive: true });
      } else if (!KEPT_ROOT_SCRIPTS.has(child)) {
        rmSync(path.join(dir, "scripts", child));
      }
    }
  };
  walk("");
};

const lockedVersions = (dir) => {
  const locked = new Set();
  const text = readFileSync(path.join(dir, "bun.lock"), "utf8");
  for (const match of text.matchAll(/^ {4}"[^"]+": \["((?:@[^@"/]+\/)?[^@"]+)@([^"]+)"/gm)) {
    locked.add(`${match[1]}@${match[2]}`);
    locked.add(match[1]);
  }
  return locked;
};

/**
 * The root manifest as an install needs it: workspaces, scripts, patches and
 * trusted install scripts for what the install has, nothing for what it
 * doesn't; the self-modification tools (devDependencies) left to the
 * package set a draft installs (packages/desktop/electron/services/app-source/draft-deps.ts).
 */
const shapeInstallManifest = (dir) => {
  const file = path.join(dir, "package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.workspaces = manifest.workspaces.filter((pattern) =>
    existsSync(path.join(dir, pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern)),
  );
  const scripts = manifest.scripts ?? {};
  const pathsIn = (command) => [...command.matchAll(/(?:^|[\s"'=(])((?:packages|workers|scripts|launcher|infra)\/[\w@.+\/-]+)/g)].map((m) => m[1]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, command] of Object.entries(scripts)) {
      const missingPath = pathsIn(command).some((ref) => !existsSync(path.join(dir, ref.replace(/[.,;:)]+$/, ""))));
      // `bun run x` names a root script unless the command moved into a package first.
      const missingScript =
        !/(^|&&|;)\s*cd\s/.test(command) &&
        [...command.matchAll(/bun run ([\w:.-]+)/g)].some((m) => !(m[1] in scripts));
      if (missingPath || missingScript) {
        delete scripts[name];
        changed = true;
      }
    }
  }
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  run("bun", ["install", "--lockfile-only"], { cwd: dir });

  const locked = lockedVersions(dir);
  for (const [spec, patch] of Object.entries(manifest.patchedDependencies ?? {})) {
    if (locked.has(spec)) continue;
    delete manifest.patchedDependencies[spec];
    rmSync(path.join(dir, patch), { force: true });
  }
  if (existsSync(path.join(dir, "patches")) && readdirSync(path.join(dir, "patches")).length === 0) {
    rmSync(path.join(dir, "patches"), { recursive: true });
  }
  // Electron's own install script would download a binary a Mac never runs
  // (the launcher's signed Stella.app does); the app's postinstall
  // (ensure-electron-binary.mjs) fetches it where it is needed.
  manifest.trustedDependencies = (manifest.trustedDependencies ?? []).filter(
    (name) => name !== "electron" && locked.has(name),
  );
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(dir, "bunfig.toml"), "[install]\n# The self-modification tools come with a draft's package set.\ndev = false\n");
  run("bun", ["install", "--lockfile-only"], { cwd: dir });
};

const sourceSha = run("git", ["rev-parse", ref], { cwd: repoRoot });
const workDir = mkdtempSync(path.join(tmpdir(), "stella-app-source-"));
let publishedTip;

try {
  const archive = spawnSync("git", ["archive", sourceSha], { cwd: repoRoot, maxBuffer: 1 << 30 });
  if (archive.status !== 0) throw new Error("git archive failed");
  const untar = spawnSync("tar", ["-x", "-C", workDir], { input: archive.stdout });
  if (untar.status !== 0) throw new Error("tar failed");
  for (const excluded of EXCLUDED_PATHS) {
    rmSync(path.join(workDir, excluded), { recursive: true, force: true });
  }
  const installGuide = readFileSync(path.join(workDir, INSTALL_GUIDE), "utf8");
  pruneRootScripts(workDir);
  if (run("git", ["rev-parse", "--is-shallow-repository"], { cwd: repoRoot }) === "true") {
    throw new Error("Publishing needs the full history to list earlier skill versions: git fetch --unshallow");
  }
  const shippedSkills = spawnSync("bun", [
    "scripts/shipped-skill-hashes.ts",
    "--ref", sourceSha,
    "--out", path.join(workDir, "packages/home-seed/shipped-skill-hashes.json"),
  ], { cwd: repoRoot, stdio: "inherit" });
  if (shippedSkills.status !== 0) throw new Error("Listing earlier skill versions failed");
  shapeInstallManifest(workDir);
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    writeFileSync(path.join(workDir, name), installGuide);
  }
  if (outDir) {
    cpSync(workDir, path.resolve(outDir), { recursive: true, verbatimSymlinks: true });
    console.log(`Wrote the install tree for ${sourceSha.slice(0, 12)} to ${path.resolve(outDir)}.`);
    rmSync(workDir, { recursive: true, force: true });
    process.exit(0);
  }

  let upstream = wrangler(["repos", "get", UPSTREAM_REPO, "--namespace", namespace]);
  if (!upstream.ok) {
    upstream = wrangler(["repos", "create", UPSTREAM_REPO, "--namespace", namespace, "--default-branch", "main"]);
    if (!upstream.ok) throw new Error(`Could not create the upstream repo:\n${upstream.output}`);
  }
  const remote = upstream.value.remote;
  const issued = wrangler(["repos", "issue-token", UPSTREAM_REPO, "--namespace", namespace, "--scope", "write", "--ttl", "900"]);
  if (!issued.ok) throw new Error(`Could not issue a token:\n${issued.output}`);
  const token = issued.value.plaintext ?? issued.value.token;
  const git = (gitArgs) =>
    run("git", ["-c", `http.extraHeader=Authorization: Bearer ${token}`, ...gitArgs], {
      cwd: workDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Stella",
        GIT_AUTHOR_EMAIL: "release@stella.sh",
        GIT_COMMITTER_NAME: "Stella",
        GIT_COMMITTER_EMAIL: "release@stella.sh",
      },
    });

  git(["init", "-q", "-b", "main"]);
  const fetched = spawnSync(
    "git",
    ["-c", `http.extraHeader=Authorization: Bearer ${token}`, "fetch", "-q", remote, "main"],
    { cwd: workDir, encoding: "utf8" },
  ).status === 0;
  if (fetched) git(["reset", "-q", "--soft", "FETCH_HEAD"]);
  git(["add", "-A"]);
  // The repo ignores AGENTS.md (each checkout's own); the install guide ships.
  git(["add", "-f", "AGENTS.md"]);
  if (fetched && spawnSync("git", ["diff", "--cached", "--quiet", "FETCH_HEAD"], { cwd: workDir }).status === 0) {
    console.log(`Upstream already matches ${sourceSha.slice(0, 12)}; nothing to publish.`);
    publishedTip = git(["rev-parse", "HEAD"]);
  } else {
    git(["commit", "-q", "-m", `Stella ${sourceSha.slice(0, 12)}`, "-m", `Stella-Source: ${sourceSha}`]);
    git(["push", "-q", remote, "HEAD:refs/heads/main"]);
    publishedTip = git(["rev-parse", "HEAD"]);
    console.log(`Published ${sourceSha.slice(0, 12)} to ${namespace}/${UPSTREAM_REPO} as ${publishedTip}.`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

// Also after "nothing to publish": a notice lost last time is sent again.
await announce(publishedTip);
