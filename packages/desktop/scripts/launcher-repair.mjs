#!/usr/bin/env bun
// Repair, from the launcher's "Stella couldn't start" screen: one bounded pass of the user's own
// model at the checkout that fails to start, keeping their change rather than reverting it.
//
// The launcher copies this file out of the last version that started (refs/stella/known-good,
// else HEAD) and runs it with its Bun, so a change that broke Stella can't break its repair. It
// must stay one file with no imports beyond Node's own modules.
//
// Routes, from the user's saved model choice (<data dir>/preferences.json):
// - Claude Code (claude_code_local): `claude -p` in the checkout, on the signed-in login;
// - Antigravity (antigravity/<model>): `agy -p`;
// - Codex CLI (codex_cli): `codex exec`;
// - anything else (Stella's models, ChatGPT, API keys): Stella's headless runtime
//   (packages/runtime/headless/cli.ts) from an export of the last version that started, with
//   the desktop's own sign-in and saved keys (--desktop-user-data).
// The runner commits what the model changed; the launcher signs it and starts Stella.
//
// usage: bun launcher-repair.mjs --app <checkout> --data-dir <dir> --user-data <dir> --work <dir>
//          --failure <file> [--log <file>]... [--known-good <sha>] [--backend <url>]
//          [--timeout <seconds>] --result <file>
// The result file gets {"ok":bool,"route":string,"message":string}; message is one short line.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const options = (name) => args.flatMap((arg, i) => (arg === `--${name}` && i + 1 < args.length ? [args[i + 1]] : []));

const app = path.resolve(option("app"));
const dataDir = path.resolve(option("data-dir", path.join(os.homedir(), ".stella")));
const userData = option("user-data");
const work = path.resolve(option("work", path.join(os.tmpdir(), "stella-repair")));
const resultFile = option("result");
const backend = option("backend");
const timeoutSeconds = Math.max(30, Number(option("timeout", "180")) || 180);
const deadline = Date.now() + timeoutSeconds * 1000;
const isWindows = process.platform === "win32";
const gitBin = process.env.STELLA_GIT_BIN?.trim() || "git";
const identity = {
  GIT_AUTHOR_NAME: "Stella",
  GIT_AUTHOR_EMAIL: "stella@localhost",
  GIT_COMMITTER_NAME: "Stella",
  GIT_COMMITTER_EMAIL: "stella@localhost",
};

const say = (line) => process.stderr.write(`repair: ${line}\n`);
const finish = (ok, route, message) => {
  const body = JSON.stringify({ ok, route, message: String(message).replace(/\s+/g, " ").trim().slice(0, 300) });
  if (resultFile) fs.writeFileSync(resultFile, `${body}\n`);
  say(`${ok ? "done" : "failed"} (${route}): ${message}`);
  process.exit(ok ? 0 : 1);
};

const git = (gitArgs, extra = {}) => {
  const r = spawnSync(gitBin, gitArgs, {
    cwd: app,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extra },
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
};

const readText = (file, limit) => {
  try {
    const text = fs.readFileSync(file, "utf8");
    return text.length > limit ? `…\n${text.slice(-limit)}` : text;
  } catch {
    return "";
  }
};

const capped = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters)` : text);

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// ---- What failed and what changed ----

const commitExists = (ref) => Boolean(ref) && git(["cat-file", "-e", `${ref}^{commit}`]).ok;
const knownGood = commitExists(option("known-good")) ? option("known-good") : "";
const upstream = commitExists("refs/remotes/stella-upstream/main") ? "refs/remotes/stella-upstream/main" : "";
const base = knownGood || (upstream && git(["merge-base", upstream, "HEAD"]).out) || "";
const headBefore = git(["rev-parse", "HEAD"]).out;
const statusBefore = git(["status", "--porcelain=v1", "--untracked-files=all"]).out;

const failure = readText(option("failure"), 12_000);
const logs = options("log")
  .map((file) => {
    const text = readText(file, 10_000);
    return text ? `--- ${path.basename(file)} (end) ---\n${text}` : "";
  })
  .filter(Boolean)
  .join("\n\n");
const excluded = [":(exclude)bun.lock", ":(exclude)**/*.png", ":(exclude)**/*.jpg", ":(exclude)**/*.woff2"];
const committed = base ? git(["diff", "--stat", base, "HEAD"]).out : "";
const committedDiff = base ? git(["diff", base, "HEAD", "--", ".", ...excluded]).out : "";
const uncommittedDiff = git(["diff", "HEAD", "--", ".", ...excluded]).out;
const recent = base ? git(["log", "--format=%h %s", `${base}..HEAD`, "-n", "20"]).out : git(["log", "--format=%h %s", "-n", "5"]).out;

const prompt = `Stella, the desktop app whose source checkout is ${app}, fails to start since a recent change. Make it start again.

The person using Stella changed it on purpose (their own customizations live in this checkout), so keep what the change is for: fix the mistake that stops Stella from starting, don't revert or drop the change. Only if the change can't work at all, take out the part that breaks the start and keep the rest.

Work only inside ${app}. Don't run git commands that change history or the index (commit, reset, checkout, stash, rebase): the launcher commits your fix and starts Stella once you finish. Don't start Stella yourself. Check what you changed compiles: \`bun build --no-bundle <file> > /dev/null\` for a single file, and \`bun packages/desktop/scripts/dev-electron-build.mjs\` (run in ${app}) when anything under packages/desktop/electron changed. You have about ${Math.round(timeoutSeconds / 60)} minutes. When you are done, reply with one short sentence saying what you fixed.

## Why Stella didn't start
${capped(failure || "(no message)", 12_000)}
${logs ? `\n## Stella's log\n${logs}\n` : ""}
## Changes since the last version that started${base ? ` (${base.slice(0, 12)}..HEAD)` : ""}
${recent || "(no commits)"}
${committed}

${capped(committedDiff, 60_000) || "(no committed changes)"}
${uncommittedDiff ? `\n## Not committed yet\n${capped(uncommittedDiff, 20_000)}\n` : ""}`;

// ---- Running a route, bounded ----

const remainingMs = () => Math.max(5_000, deadline - Date.now());

const stopTree = (child) => {
  if (!child.pid) return;
  if (isWindows) spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  }
};

const runBounded = (command, commandArgs, { env = process.env, cwd = app, input } = {}) =>
  new Promise((resolve) => {
    let out = "";
    let err = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(command, commandArgs, {
        cwd,
        env,
        detached: !isWindows,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: -1, out: "", err: String(error), timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child);
    }, remainingMs());
    if (input !== undefined) child.stdin.end(input);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 2_000_000) out = out.slice(-1_000_000);
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
      if (err.length > 200_000) err = err.slice(-100_000);
      for (const line of String(chunk).split("\n")) if (line.trim()) say(`| ${line.trim().slice(0, 300)}`);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: `${err}\n${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err, timedOut });
    });
  });

const onPath = (name) => {
  const exts = isWindows ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext.toLowerCase()}`);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
};

const findCli = (name, envNames, extra) => {
  for (const key of envNames) {
    const value = process.env[key]?.trim();
    if (value && fs.existsSync(value)) return value;
  }
  const exe = isWindows ? `${name}.exe` : name;
  for (const dir of extra) {
    const candidate = path.join(dir, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return onPath(name);
};

const online = async (url) => {
  try {
    await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(6_000) });
    return true;
  } catch {
    return false;
  }
};

const summaryOf = (text) =>
  String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop() ?? "";

const prefs = readJson(path.join(dataDir, "preferences.json")) ?? {};
const chosenModel = prefs.modelOverrides?.general || prefs.modelOverrides?.orchestrator || "";
const home = os.homedir();

const claudeRoute = async () => {
  const cli = findCli("claude", ["STELLA_CLAUDE_CLI_PATH", "CLAUDE_CLI_PATH"], [
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "local"),
    path.join(home, ".claude", "bin"),
  ]);
  if (!cli) finish(false, "claude-code", "Claude Code isn't installed on this computer.");
  if (!(await online("https://api.anthropic.com"))) finish(false, "claude-code", "Repair needs the internet, and this computer is offline.");
  // The login Stella's turns use: Claude Code's own config, else one Stella added.
  const dirs = [null];
  try {
    // Real paths: Claude Code keys its Keychain login by the config dir's path.
    for (const entry of fs.readdirSync(path.join(dataDir, "claude-accounts"))) {
      try {
        dirs.push(fs.realpathSync(path.join(dataDir, "claude-accounts", entry)));
      } catch {}
    }
  } catch {}
  let configDir;
  for (const dir of dirs) {
    const env = { ...process.env };
    if (dir) env.CLAUDE_CONFIG_DIR = dir;
    const status = spawnSync(cli, ["auth", "status", "--json"], { env, encoding: "utf8", timeout: 20_000, windowsHide: true });
    try {
      if (JSON.parse(status.stdout).loggedIn === true) {
        configDir = dir;
        break;
      }
    } catch {}
  }
  if (configDir === undefined) finish(false, "claude-code", "Claude Code isn't signed in.");
  const env = { ...process.env };
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]) delete env[key];
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  const model = (prefs.claudeCodeModel || "opus").trim();
  say(`claude-code (${model}) in ${app}`);
  return await runBounded(cli, ["-p", "--permission-mode", "bypassPermissions", "--model", model, "--output-format", "text"], {
    env,
    input: prompt,
  });
};

const antigravityRoute = async (model) => {
  const cli = findCli("agy", ["STELLA_ANTIGRAVITY_CLI_BIN", "ANTIGRAVITY_CLI_PATH"], [
    path.join(home, ".local", "bin"),
    ...(isWindows && process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "agy", "bin")] : []),
  ]);
  if (!cli) finish(false, "antigravity", "Antigravity isn't installed on this computer.");
  if (!(await online("https://generativelanguage.googleapis.com"))) finish(false, "antigravity", "Repair needs the internet, and this computer is offline.");
  say(`antigravity (${model}) in ${app}`);
  const cliArgs = ["-p", prompt, "--dangerously-skip-permissions", "--print-timeout", `${Math.round(remainingMs() / 1000)}s`];
  if (model) cliArgs.push("--model", model);
  return await runBounded(cli, cliArgs);
};

const codexRoute = async () => {
  const cli = findCli("codex", ["STELLA_CODEX_CLI_PATH"], [path.join(home, ".local", "bin")]);
  if (!cli) finish(false, "codex", "The Codex CLI isn't installed on this computer.");
  if (!(await online("https://chatgpt.com"))) finish(false, "codex", "Repair needs the internet, and this computer is offline.");
  const cliArgs = ["exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-C", app];
  if (prefs.codexModel) cliArgs.push("-m", prefs.codexModel);
  cliArgs.push("-");
  say(`codex (${prefs.codexModel || "default"}) in ${app}`);
  return await runBounded(cli, cliArgs, { input: prompt });
};

// ---- Stella's headless runtime, from the last version that started ----

const RUNNER_PACKAGES = ["runtime", "agent", "contracts", "node-shared", "views", "model-catalog", "theme", "home-seed"];
const isLink = (file) => {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
};

// Links first, so removing the tree never follows one into the installed app (Windows junctions).
const removeRunner = (dir) => {
  const unlinkIn = (folder, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (isLink(full)) {
        try {
          fs.unlinkSync(full);
        } catch {
          try {
            fs.rmdirSync(full);
          } catch {}
        }
      } else if (entry.isDirectory() && depth < 4) unlinkIn(full, depth + 1);
    }
  };
  for (const modules of [path.join(dir, "node_modules"), ...RUNNER_PACKAGES.map((p) => path.join(dir, "packages", p, "node_modules"))])
    unlinkIn(modules, 0);
  fs.rmSync(dir, { recursive: true, force: true });
};

const link = (target, file) => {
  const isDir = fs.statSync(target).isDirectory();
  fs.symlinkSync(target, file, isWindows ? (isDir ? "junction" : "file") : isDir ? "dir" : "file");
};

// A node_modules folder of links into the app's, except workspace packages, which point at the
// runner's own copy so the runtime never loads the broken checkout's code.
const linkModules = (runner, relative) => {
  const source = path.join(app, relative);
  const dest = path.join(runner, relative);
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(dest, { recursive: true });
  const placeEntry = (from, to) => {
    if (isLink(from)) {
      let target;
      try {
        target = fs.realpathSync(from);
      } catch {
        return;
      }
      const packages = path.join(app, "packages") + path.sep;
      if (target.startsWith(packages)) {
        const mapped = path.join(runner, "packages", target.slice(packages.length));
        if (fs.existsSync(mapped)) link(mapped, to);
        return;
      }
      link(target, to);
      return;
    }
    link(from, to);
  };
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(dest, entry.name);
    try {
      if (entry.name.startsWith("@") && entry.isDirectory() && !isLink(from)) {
        fs.mkdirSync(to, { recursive: true });
        for (const scoped of fs.readdirSync(from)) placeEntry(path.join(from, scoped), path.join(to, scoped));
      } else if (entry.isDirectory() || isLink(from)) {
        placeEntry(from, to);
      }
    } catch (error) {
      say(`could not link ${relative}/${entry.name}: ${error.message}`);
    }
  }
};

const prepareRunner = (commit) => {
  fs.mkdirSync(work, { recursive: true });
  const runner = path.join(work, `runner-${commit.slice(0, 12)}`);
  if (fs.existsSync(path.join(runner, ".complete"))) return runner;
  for (const entry of fs.readdirSync(work)) if (entry.startsWith("runner-")) removeRunner(path.join(work, entry));
  const index = path.join(work, "runner.index");
  fs.rmSync(index, { force: true });
  const env = { GIT_INDEX_FILE: index };
  if (!git(["read-tree", commit], env).ok) throw new Error(`could not read ${commit.slice(0, 12)}`);
  const files = git(["ls-files"], env)
    .out.split("\n")
    .filter((file) => file && (!file.includes("/") || RUNNER_PACKAGES.some((p) => file.startsWith(`packages/${p}/`))));
  const written = spawnSync(gitBin, ["checkout-index", "-f", "--stdin", `--prefix=${runner}${path.sep}`], {
    cwd: app,
    env: { ...process.env, ...env },
    input: files.join("\n"),
    encoding: "utf8",
    windowsHide: true,
  });
  fs.rmSync(index, { force: true });
  if (written.status !== 0) throw new Error(`could not export ${commit.slice(0, 12)}: ${written.stderr}`);
  linkModules(runner, "node_modules");
  for (const p of RUNNER_PACKAGES) linkModules(runner, path.join("packages", p, "node_modules"));
  fs.writeFileSync(path.join(runner, ".complete"), `${commit}\n`);
  return runner;
};

const runtimeRoute = async () => {
  if (!userData) finish(false, "stella", "Repair couldn't find Stella's sign-in on this computer.");
  const commit = knownGood || (upstream && git(["rev-parse", upstream]).out) || headBefore;
  let runner;
  try {
    runner = prepareRunner(commit);
  } catch (error) {
    finish(false, "stella", `Repair couldn't set itself up: ${error.message}`);
  }
  const cli = path.join(runner, "packages", "runtime", "headless", "cli.ts");
  if (!fs.existsSync(cli)) finish(false, "stella", "This version of Stella can't repair itself.");
  const cliArgs = [
    cli,
    "--mode", "chat",
    "--agent", "general",
    "--app-dir", runner,
    "--data-dir", dataDir,
    "--desktop-user-data", userData,
    "--conversation", `launcher-repair-${Date.now().toString(36)}`,
    "--timeout", String(Math.round(remainingMs() / 1000)),
    "--prompt", prompt,
  ];
  if (backend) cliArgs.push("--backend-url", backend);
  say(`stella runtime from ${commit.slice(0, 12)} (${chosenModel || "default model"})`);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("STELLA_DEV_") || key === "STELLA_APP_DIR") delete env[key];
  const result = await runBounded(process.execPath, cliArgs, { env, cwd: runner });
  let last = null;
  for (const line of result.out.split("\n")) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.kind === "cli.result") last = parsed;
    } catch {}
  }
  if (last && !last.ok) {
    const reason = String(last.error ?? last.status ?? "");
    if (/sign|auth|401|403/i.test(reason)) finish(false, "stella", "Repair needs you to be signed in to Stella.");
    if (/timeout/i.test(reason)) result.timedOut = true;
    else result.code = result.code || 1;
    result.err = `${result.err}\n${reason}`;
  }
  return { ...result, out: last?.finalText ?? "" };
};

// ---- Run, then keep what changed ----

const route =
  prefs.agentRuntimeEngine === "claude_code_local"
    ? "claude-code"
    : chosenModel.startsWith("antigravity/")
      ? "antigravity"
      : prefs.agentRuntimeEngine === "codex_cli"
        ? "codex"
        : "stella";
say(`route ${route}; base ${base ? base.slice(0, 12) : "none"}; timeout ${timeoutSeconds}s`);
const result =
  route === "claude-code"
    ? await claudeRoute()
    : route === "antigravity"
      ? await antigravityRoute(chosenModel.slice("antigravity/".length))
      : route === "codex"
        ? await codexRoute()
        : await runtimeRoute();

if (result.timedOut) say(`the model ran out of time after ${timeoutSeconds}s`);
const headAfter = git(["rev-parse", "HEAD"]).out;
const statusAfter = git(["status", "--porcelain=v1", "--untracked-files=all"]).out;
const changed = headAfter !== headBefore || statusAfter !== statusBefore;
if (!changed) {
  finish(
    false,
    route,
    result.timedOut
      ? "Repair ran out of time."
      : result.code !== 0
        ? `Repair couldn't run: ${summaryOf(result.err) || `exit ${result.code}`}`
        : "Repair didn't find anything to change.",
  );
}
const summary = summaryOf(result.out) || "Repaired Stella's start";
if (statusAfter) {
  git(["add", "-A"]);
  const commit = git(["commit", "-q", "--no-verify", "-m", `Repair: ${summary.slice(0, 72)}`, "-m", summary], identity);
  if (!commit.ok) finish(false, route, `Repair couldn't save its fix: ${summaryOf(commit.err)}`);
}
finish(true, route, summary);
