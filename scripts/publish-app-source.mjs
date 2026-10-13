#!/usr/bin/env node
/**
 * Publish the desktop app's source to an environment's upstream Artifacts
 * repo, where each owner's fork pulls updates from (v3).
 *
 *   node scripts/publish-app-source.mjs [--namespace stella-app-dev] [--ref HEAD] [--backend <url>]
 *
 * The published tree is the ref minus the server, the mobile app and repo
 * tooling, with `bun.lock` regenerated for the workspaces that remain so a
 * frozen install works. Each publish is one commit on upstream `main`,
 * parented on the previous publish, with the source commit in a
 * `Stella-Source:` trailer. An unchanged tree publishes nothing.
 *
 * Then it tells the namespace's backend (`--backend` for any other, such as a
 * Preview bound to a test namespace), which reads upstream itself and pushes
 * the new version to every connected desktop of that environment. Desktops
 * don't poll: without this notice they learn of the publish only when they
 * next connect.
 *
 * Needs a Wrangler login (or CLOUDFLARE_API_TOKEN) for the account.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM_REPO = "upstream";

/** Not part of the desktop app a user's agents can modify. */
const EXCLUDED_PATHS = [
  ".agents",
  ".github",
  "infra",
  "launcher",
  "workers",
  "packages/executor-cloud",
  "packages/mobile",
  "packages/mobile-screenshots",
  "packages/website",
];

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const namespace = option("namespace", "stella-app-dev");
const ref = option("ref", "HEAD");

/** The backend whose desktops follow each namespace. */
const NAMESPACE_BACKENDS = {
  "stella-app-dev": "https://stella-v2-cloud-builder-dev.fromyou.workers.dev",
  "stella-app-prod": "https://stella-v2-cloud-builder-prod.fromyou.workers.dev",
  "stella-app-acceptance": "https://stella-v2-cloud-builder-basic-nightingale-118.fromyou.workers.dev",
};
const backend = option("backend", NAMESPACE_BACKENDS[namespace]);

/** Tell the backend's connected desktops; never fails the publish. */
const announce = async () => {
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
        console.log(`Told ${backend}'s desktops about ${String(version).slice(0, 12)}.`);
        return;
      }
      console.warn(`Release notice to ${backend} failed (${response.status}).`);
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

const sourceSha = run("git", ["rev-parse", ref], { cwd: repoRoot });
const workDir = mkdtempSync(path.join(tmpdir(), "stella-app-source-"));

try {
  // 1. The app tree at the ref.
  const archive = spawnSync("git", ["archive", sourceSha], { cwd: repoRoot, maxBuffer: 1 << 30 });
  if (archive.status !== 0) throw new Error("git archive failed");
  const untar = spawnSync("tar", ["-x", "-C", workDir], { input: archive.stdout });
  if (untar.status !== 0) throw new Error("tar failed");
  for (const excluded of EXCLUDED_PATHS) {
    rmSync(path.join(workDir, excluded), { recursive: true, force: true });
  }
  run("bun", ["install", "--lockfile-only"], { cwd: workDir });

  // 2. The upstream repo and a short write token for it.
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

  // 3. One commit on top of the previous publish.
  git(["init", "-q", "-b", "main"]);
  const fetched = spawnSync(
    "git",
    ["-c", `http.extraHeader=Authorization: Bearer ${token}`, "fetch", "-q", remote, "main"],
    { cwd: workDir, encoding: "utf8" },
  ).status === 0;
  if (fetched) git(["reset", "-q", "--soft", "FETCH_HEAD"]);
  git(["add", "-A"]);
  if (fetched && spawnSync("git", ["diff", "--cached", "--quiet", "FETCH_HEAD"], { cwd: workDir }).status === 0) {
    console.log(`Upstream already matches ${sourceSha.slice(0, 12)}; nothing to publish.`);
  } else {
    git(["commit", "-q", "-m", `Stella ${sourceSha.slice(0, 12)}`, "-m", `Stella-Source: ${sourceSha}`]);
    git(["push", "-q", remote, "HEAD:refs/heads/main"]);
    console.log(`Published ${sourceSha.slice(0, 12)} to ${namespace}/${UPSTREAM_REPO} as ${git(["rev-parse", "HEAD"])}.`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

// Also after "nothing to publish": a notice lost last time is sent again.
await announce();
