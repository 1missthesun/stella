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
// The prompt goes to the model in a file or on stdin, never as one command-line argument (Windows
// caps a whole command line at 32K characters, Linux one argument at 128K).
// Only a run that finished in time, exited cleanly and left code that still parses is kept: the
// runner then commits the files the model changed (never other edits already in the checkout) and
// the launcher signs it and starts Stella. Anything else puts back what the model changed, with
// its version of each file kept in <work>/unfinished-<time>/.
//
// usage: bun launcher-repair.mjs --app <checkout> --data-dir <dir> --user-data <dir> --work <dir>
//          --failure <file> [--log <file>]... [--known-good <sha>] [--backend <url>]
//          [--timeout <seconds>] --result <file>
// The result file gets {"ok":bool,"route":string,"message":string}; message is one short line.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

// Paths `git status` lists (both sides of a rename), from its NUL-separated form.
const dirtyPaths = () => {
  const r = spawnSync(gitBin, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: app,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const entries = String(r.stdout ?? "").split("\0");
  const paths = new Set();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    paths.add(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2)) && i + 1 < entries.length) paths.add(entries[++i]);
  }
  return paths;
};

// What a path holds right now, to tell the model's edits from edits that were already there.
const fingerprint = (relative) => {
  const file = path.join(app, relative);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return "absent";
  }
  if (stat.isSymbolicLink()) {
    try {
      return `link:${fs.readlinkSync(file)}`;
    } catch {
      return "link";
    }
  }
  if (!stat.isFile()) return `other:${stat.mtimeMs}`;
  if (stat.size > 64 * 1024 * 1024) return `big:${stat.size}:${stat.mtimeMs}`;
  try {
    return `file:${stat.mode}:${createHash("sha1").update(fs.readFileSync(file)).digest("hex")}`;
  } catch {
    return `unreadable:${stat.mtimeMs}`;
  }
};

const unfinishedDir = path.join(work, `unfinished-${Date.now().toString(36)}`);
const beforeDir = path.join(work, "before");
fs.rmSync(beforeDir, { recursive: true, force: true });
// Files already changed before the repair, with a copy of each to put back if the model's run
// isn't kept. Very large ones are only fingerprinted.
const before = new Map();
{
  let copied = 0;
  for (const relative of dirtyPaths()) {
    const print = fingerprint(relative);
    let backup = null;
    if (print.startsWith("file:")) {
      const file = path.join(app, relative);
      const size = fs.statSync(file).size;
      if (size <= 8 * 1024 * 1024 && copied + size <= 128 * 1024 * 1024) {
        try {
          backup = path.join(beforeDir, String(before.size));
          fs.mkdirSync(beforeDir, { recursive: true });
          fs.copyFileSync(file, backup);
          copied += size;
        } catch {
          backup = null;
        }
      }
    }
    before.set(relative, { print, backup });
  }
}

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

fs.mkdirSync(work, { recursive: true });
const promptFile = path.join(work, "repair-brief.md");
fs.writeFileSync(promptFile, prompt);
// For a CLI that only takes its prompt as an argument: a short one that points at the brief.
const pointerPrompt = `Read the file ${promptFile} in full: it explains why Stella, the app checked out at ${app}, fails to start, and what to do. Then do what it asks, working in ${app}.`;

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

// `token` goes to the child on a private pipe, fd 3 (Claude Code's CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR).
const runBounded = (command, commandArgs, { env = process.env, cwd = app, input, token } = {}) =>
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
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe", ...(token === undefined ? [] : ["pipe"])],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: -1, out: "", err: String(error), timedOut: false });
      return;
    }
    if (token !== undefined) {
      child.stdio[3]?.on("error", () => {});
      child.stdio[3]?.end(`${token}\n`);
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
  // The login Stella's turns use, by the rules of claude-local-accounts.ts (activeConfig and
  // readStatus): the account chosen in Stella's settings, else Claude Code's own login, else the
  // first one Stella added; a claude.ai login only, past its time limit or refused by Anthropic
  // (Stella records refusals in claude-accounts/active.json) counting as signed out.
  const accountsDir = path.join(dataDir, "claude-accounts");
  const active = readJson(path.join(accountsDir, "active.json")) ?? {};
  const rejected = active.rejected && typeof active.rejected === "object" ? active.rejected : {};
  const lower = (value) => (typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined);
  const epochMs = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || !value.trim()) return undefined;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const defaultDir = process.env.CLAUDE_CONFIG_DIR?.trim() || null;
  // The login stored for a config dir, where Claude Code keeps it, by the rules of
  // readClaudeLogin (packages/node-shared/integrations/claude-login-store.ts): on macOS the login
  // keychain by path (Claude Code's own lookup goes through the Keychain search list, which a
  // wrong setting empties), then a keychain an ordinary lookup finds, then its credentials file.
  // Secrets only travel through stdin, stdout and memory.
  const SECURITY = "/usr/bin/security";
  const securityRun = (securityArgs, input) => {
    const result = spawnSync(SECURITY, securityArgs, {
      input: input ?? "",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 10_000,
    });
    return { code: result.status, stdout: result.stdout ?? "" };
  };
  const configDirFor = (dir) => dir || process.env.CLAUDE_CONFIG_DIR || null;
  const serviceFor = (configDir) =>
    configDir
      ? `Claude Code-credentials-${createHash("sha256").update(configDir.normalize("NFC")).digest("hex").slice(0, 8)}`
      : "Claude Code-credentials";
  const keychainAccount = (() => {
    let name;
    try {
      name = process.env.USER || os.userInfo().username;
    } catch {
      name = "claude-code-user";
    }
    return /^[a-zA-Z0-9._-]+$/.test(name) ? name : "claude-code-user";
  })();
  const loginKeychain = (() => {
    if (process.platform !== "darwin") return null;
    // The account's home from the user database: Bun's os.userInfo() follows $HOME.
    const passwd = spawnSync("/usr/bin/id", ["-P"], { encoding: "utf8", timeout: 5_000 });
    const accountHome = (passwd.status === 0 ? passwd.stdout.trim().split(":")[8] : undefined) || home;
    for (const name of ["login.keychain-db", "login.keychain"]) {
      const candidate = path.join(accountHome, "Library", "Keychains", name);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  })();
  const parseDocument = (raw) => {
    const value = String(raw ?? "").trim();
    for (const candidate of [value, /^[0-9a-f]+$/i.test(value) ? Buffer.from(value, "hex").toString("utf8") : null]) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return null;
  };
  const loginFrom = (document, source) => {
    const oauth = document?.claudeAiOauth;
    return oauth && typeof oauth === "object" && typeof oauth.accessToken === "string" && oauth.accessToken
      ? { oauth, document, source }
      : null;
  };
  const readLogin = (dir) => {
    const configDir = configDirFor(dir);
    if (process.platform === "darwin") {
      const service = serviceFor(configDir);
      const fromKeychain = (keychain) => {
        const { code, stdout } = securityRun(["find-generic-password", "-a", keychainAccount, "-w", "-s", service, keychain]);
        return code === 0 ? loginFrom(parseDocument(stdout), { kind: "keychain", keychain, service }) : null;
      };
      const found = loginKeychain ? fromKeychain(loginKeychain) : null;
      if (found) return found;
      const attributes = securityRun(["find-generic-password", "-a", keychainAccount, "-s", service]);
      const elsewhere = attributes.code === 0 ? /^keychain: "(\/[^"\n]+)"/m.exec(attributes.stdout)?.[1] : undefined;
      if (elsewhere && elsewhere !== loginKeychain) {
        const there = fromKeychain(elsewhere);
        if (there) return there;
      }
    }
    const file = path.join(configDir ?? path.join(home, ".claude"), ".credentials.json");
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
    return loginFrom(parseDocument(raw), { kind: "file", file });
  };
  // readStoredClaudeLogin (packages/contracts/claude-login.ts), on that login.
  const storedLogin = (dir) => {
    const oauth = readLogin(dir)?.oauth;
    if (!oauth) return { alive: false };
    const now = Date.now();
    const expiresAt =
      typeof oauth.refreshTokenExpiresAt === "number" && Number.isFinite(oauth.refreshTokenExpiresAt) ? oauth.refreshTokenExpiresAt : undefined;
    const refreshes = typeof oauth.refreshToken === "string" && oauth.refreshToken.length > 0;
    const longLived =
      !refreshes && expiresAt === undefined && typeof oauth.accessToken === "string" && oauth.accessToken.length > 0 &&
      typeof oauth.expiresAt === "number" && oauth.expiresAt > now;
    const alive = oauth.loginEnded === undefined && (longLived || (refreshes && (expiresAt === undefined || expiresAt > now)));
    return { alive, expiresAt };
  };
  const storedEmail = (dir) => lower(readJson(path.join(dir ?? defaultDir ?? home, ".claude.json"))?.oauthAccount?.emailAddress);
  const configs = [{ configId: "default", dir: null, createdAt: 0 }];
  try {
    for (const entry of fs.readdirSync(accountsDir)) {
      if (!/^[a-f0-9]{6,64}$/.test(entry)) continue;
      try {
        // Real paths: Claude Code keys its Keychain login by the config dir's path.
        const dir = fs.realpathSync(path.join(accountsDir, entry));
        const stat = fs.statSync(dir);
        if (stat.isDirectory()) configs.push({ configId: entry, dir, createdAt: stat.birthtimeMs || stat.ctimeMs });
      } catch {}
    }
  } catch {}
  configs.sort((a, b) => a.createdAt - b.createdAt);
  // Only the login on disk: a key or token in the environment would answer for every account.
  const cliEnv = (dir) => {
    const env = { ...process.env };
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]) delete env[key];
    if (dir) env.CLAUDE_CONFIG_DIR = dir;
    return env;
  };
  const statusOf = ({ configId, dir }) =>
    new Promise((resolve) => {
      const child = spawn(cli, ["auth", "status", "--json"], { env: cliEnv(dir), stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      let out = "";
      const timer = setTimeout(() => child.kill(), 20_000);
      child.stdout.on("data", (chunk) => (out += chunk));
      child.on("error", () => {});
      child.on("close", () => {
        clearTimeout(timer);
        let status = null;
        try {
          status = JSON.parse(out);
        } catch {}
        if (!status || typeof status !== "object") {
          resolve({ configId, dir, loggedIn: false });
          return;
        }
        // `claude auth status` describes a token from Claude Code's settings when there is one;
        // the claude.ai login stored here is what Stella's turns run on.
        let loggedIn;
        let email;
        let expiresAt;
        if (status.authMethod === "claude.ai") {
          loggedIn = status.loggedIn === true;
          email = lower(status.email);
          expiresAt = epochMs(status.loginExpiresAt);
        } else {
          const stored = storedLogin(dir);
          loggedIn = stored.alive;
          expiresAt = stored.expiresAt;
        }
        email ??= storedEmail(dir);
        if (loggedIn && expiresAt !== undefined && expiresAt <= Date.now()) loggedIn = false;
        if (loggedIn && Object.hasOwn(rejected, configId) && rejected[configId] === (expiresAt ?? null)) loggedIn = false;
        resolve({ configId, dir, loggedIn, email });
      });
    });
  const signedIn = (await Promise.all(configs.map(statusOf))).filter((config) => config.loggedIn);
  const wanted = lower(active.chosenEmail);
  const chosen =
    (wanted && signedIn.find((config) => config.email === wanted)) ||
    signedIn.find((config) => config.dir === null) ||
    signedIn[0];
  if (!chosen) finish(false, "claude-code", "Claude Code isn't signed in.");
  if (wanted && chosen.email !== wanted) say(`the Claude account chosen in Stella (${wanted}) isn't signed in here`);
  const env = cliEnv(chosen.dir);
  for (const key of ["CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "CLAUDE_CODE_OAUTH_401_WAIT_MS", "CLAUDE_CODE_SUBSCRIPTION_TYPE", "CLAUDE_CODE_RATE_LIMIT_TIER"]) delete env[key];
  // On macOS the login is handed to Claude Code on a private pipe (fd 3), as Stella's turns do
  // (claude-code-host-login.ts), so the Keychain search list can't make it read as signed out.
  const handed = process.platform === "darwin" ? await loginForRun(chosen.dir) : null;
  if (handed) {
    env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR = "3";
    if (typeof handed.subscriptionType === "string" && handed.subscriptionType) env.CLAUDE_CODE_SUBSCRIPTION_TYPE = handed.subscriptionType;
    if (typeof handed.rateLimitTier === "string" && handed.rateLimitTier) env.CLAUDE_CODE_RATE_LIMIT_TIER = handed.rateLimitTier;
  }
  const model = (prefs.claudeCodeModel || "opus").trim();
  say(`claude-code (${model}) as ${chosen.email ?? chosen.configId} in ${app}`);
  return await runBounded(cli, ["-p", "--permission-mode", "bypassPermissions", "--model", model, "--output-format", "text"], {
    env,
    input: prompt,
    ...(handed ? { token: handed.accessToken } : {}),
  });

  // The access token to hand this run, renewed first (as Claude Code would, under its refresh
  // lock, written back where it was read) when it would end before the run can. Null leaves
  // Claude Code to find its login itself.
  async function loginForRun(dir) {
    const stored = readLogin(dir);
    if (!stored || stored.oauth.loginEnded !== undefined) return null;
    const now = Date.now();
    const expiresAt = typeof stored.oauth.expiresAt === "number" ? stored.oauth.expiresAt : undefined;
    const refreshes = typeof stored.oauth.refreshToken === "string" && stored.oauth.refreshToken.length > 0;
    if (expiresAt === undefined || expiresAt > now + remainingMs() + 120_000) return stored.oauth;
    if (!refreshes) return expiresAt > now ? stored.oauth : null;
    const renewed = await renewLogin(dir, stored.oauth.accessToken);
    if (renewed) return renewed.oauth;
    return expiresAt > now ? stored.oauth : null;
  }

  async function renewLogin(dir, heldAccessToken) {
    const configDir = configDirFor(dir);
    const folder = configDir ?? path.join(home, ".claude");
    let real = folder;
    try {
      real = fs.realpathSync(folder);
    } catch {}
    // Claude Code's own lock (proper-lockfile: stale after 60 s), so one refresh token is never spent twice.
    const locks = [path.join(folder, ".oauth_refresh.lock"), `${real}.lock`];
    const held = [];
    const release = () => {
      for (const lock of held.reverse()) fs.rmSync(lock, { recursive: true, force: true });
      held.length = 0;
    };
    for (let attempt = 0; attempt < 20 && held.length < locks.length; attempt += 1) {
      for (const lock of locks) {
        try {
          fs.mkdirSync(lock);
          held.push(lock);
        } catch {
          try {
            if (Date.now() - fs.statSync(lock).mtimeMs > 60_000) {
              fs.rmSync(lock, { recursive: true, force: true });
              fs.mkdirSync(lock);
              held.push(lock);
              continue;
            }
          } catch {}
          release();
          await new Promise((resolve) => setTimeout(resolve, 1_000 + Math.random() * 1_000));
          break;
        }
      }
    }
    if (held.length < locks.length) return null;
    const touch = setInterval(() => {
      const at = new Date();
      for (const lock of held) {
        try {
          fs.utimesSync(lock, at, at);
        } catch {}
      }
    }, 5_000);
    try {
      const current = readLogin(dir);
      if (!current) return null;
      if (current.oauth.accessToken !== heldAccessToken) return current;
      const serialize = (document) =>
        JSON.stringify(document).replace(/[^\x20-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
      const writeLine = (document) =>
        `add-generic-password -U -a "${keychainAccount}" -s "${current.source.service}" -X "${Buffer.from(serialize(document), "utf8").toString("hex")}" "${current.source.keychain}"\n`;
      // `security -i` drops a line of 4000 characters or more; never pass the login as an argument instead.
      if (current.source.kind === "keychain" && writeLine(current.document).length + 1_200 >= 4_000) return null;
      const scopes = Array.isArray(current.oauth.scopes) && current.oauth.scopes.length > 0
        ? current.oauth.scopes
        : ["user:inference", "user:profile", "user:sessions:claude_code"];
      let response;
      let body = {};
      try {
        response = await fetch(["https://platform.claude.com", "v1", "oauth", "token"].join("/"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: current.oauth.refreshToken,
            client_id: typeof current.oauth.clientId === "string" && current.oauth.clientId ? current.oauth.clientId : "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
            scope: scopes.join(" "),
          }),
          signal: AbortSignal.timeout(30_000),
        });
        body = await response.json().catch(() => ({}));
      } catch {
        return null;
      }
      if (!response.ok || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
        say(`renewing the Claude login didn't work (${typeof body.error === "string" ? body.error : `http_${response.status}`})`);
        return null;
      }
      const at = Date.now();
      const oauth = {
        ...current.oauth,
        accessToken: body.access_token,
        refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : current.oauth.refreshToken,
        expiresAt: at + body.expires_in * 1000,
        ...(typeof body.refresh_token_expires_in === "number" && body.refresh_token_expires_in > 0
          ? { refreshTokenExpiresAt: at + body.refresh_token_expires_in * 1000 }
          : {}),
        ...(typeof body.scope === "string" && body.scope.trim() ? { scopes: body.scope.trim().split(/\s+/) } : {}),
      };
      const document = { ...current.document, claudeAiOauth: oauth };
      if (current.source.kind === "keychain") {
        if (securityRun(["-i"], writeLine(document)).code !== 0) say("the renewed Claude login couldn't be saved");
      } else {
        try {
          const temp = `${current.source.file}.${process.pid}.${Date.now()}.tmp`;
          fs.writeFileSync(temp, serialize(document), { mode: 0o600 });
          fs.renameSync(temp, current.source.file);
        } catch {
          say("the renewed Claude login couldn't be saved");
        }
      }
      return { ...current, oauth, document };
    } finally {
      clearInterval(touch);
      release();
    }
  }
};

const antigravityRoute = async (model) => {
  const cli = findCli("agy", ["STELLA_ANTIGRAVITY_CLI_BIN", "ANTIGRAVITY_CLI_PATH"], [
    path.join(home, ".local", "bin"),
    ...(isWindows && process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "agy", "bin")] : []),
  ]);
  if (!cli) finish(false, "antigravity", "Antigravity isn't installed on this computer.");
  if (!(await online("https://generativelanguage.googleapis.com"))) finish(false, "antigravity", "Repair needs the internet, and this computer is offline.");
  say(`antigravity (${model}) in ${app}`);
  // agy's text mode takes its prompt only as an argument, so it gets the brief as a file.
  const cliArgs = ["-p", pointerPrompt, "--add-dir", work, "--dangerously-skip-permissions", "--print-timeout", `${Math.round(remainingMs() / 1000)}s`];
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
    // A runtime from before --prompt-file gets a short prompt that points at the brief.
    ...(readText(cli, 1_000_000).includes('"--prompt-file"') ? ["--prompt-file", promptFile] : ["--prompt", pointerPrompt]),
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
  if (!last) {
    result.code = result.code || 1;
  } else if (!last.ok) {
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
const headMoved = headAfter !== headBefore;
// The model's changes: paths it changed that were clean, and changed paths it changed again.
const owned = [];
for (const relative of new Set([...before.keys(), ...dirtyPaths()])) {
  const was = before.get(relative);
  if (!was || fingerprint(relative) !== was.print) owned.push(relative);
}
owned.sort();

const nulInput = (paths) => paths.join("\0");
const literal = { GIT_LITERAL_PATHSPECS: "1" };
const gitWithPaths = (gitArgs, paths, extra = {}) => {
  const r = spawnSync(gitBin, [...gitArgs, "--pathspec-from-file=-", "--pathspec-file-nul"], {
    cwd: app,
    encoding: "utf8",
    input: nulInput(paths),
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...literal, ...extra },
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
};

// What the model left has to parse: each script it touched builds, each JSON file still reads.
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const validate = () => {
  for (const relative of owned) {
    const file = path.join(app, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    if (SCRIPT.test(relative) && !relative.endsWith(".d.ts") && process.versions.bun) {
      const built = spawnSync(process.execPath, ["build", "--no-bundle", file], {
        cwd: app,
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 30_000,
        windowsHide: true,
      });
      if (built.status !== 0) {
        const error = String(built.stderr ?? "").split("\n").find((line) => /^\s*error:/.test(line));
        return `${relative} doesn't build: ${error?.replace(/^\s*error:\s*/, "") || summaryOf(built.stderr) || `exit ${built.status ?? "timeout"}`}`;
      }
    } else if (/\.json$/i.test(relative)) {
      const parses = (text) => {
        try {
          JSON.parse(text);
          return true;
        } catch {
          return false;
        }
      };
      // A file that didn't parse before either is JSON with comments (tsconfig and the like).
      const was = before.get(relative)?.backup;
      const previous = was ? readText(was, 64 * 1024 * 1024) : git(["show", `${headBefore}:${relative}`], literal).out;
      if (!parses(fs.readFileSync(file, "utf8")) && (!previous || parses(previous))) return `${relative} isn't valid JSON`;
    }
  }
  return "";
};

// Puts back what the model changed, keeping its version of each file in unfinishedDir.
const putBack = () => {
  if (!owned.length) return;
  const headFiles = new Set(
    git(["ls-tree", "-r", "-z", "--name-only", headBefore]).out.split("\0").filter(Boolean),
  );
  const fromHead = [];
  const kept = [];
  for (const relative of owned) {
    const file = path.join(app, relative);
    try {
      if (fs.lstatSync(file).isFile()) {
        const copy = path.join(unfinishedDir, relative);
        fs.mkdirSync(path.dirname(copy), { recursive: true });
        fs.copyFileSync(file, copy);
        kept.push(relative);
      }
    } catch {}
    const was = before.get(relative);
    try {
      if (was) {
        // Already changed before the repair: back to that version.
        if (was.print === "absent") fs.rmSync(file, { force: true });
        else if (was.backup) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.rmSync(file, { force: true });
          fs.copyFileSync(was.backup, file);
          const mode = Number(was.print.split(":")[1]);
          if (Number.isFinite(mode)) fs.chmodSync(file, mode & 0o7777);
        } else say(`can't put back ${relative}: it was too large to copy`);
      } else if (headFiles.has(relative)) fromHead.push(relative);
      else fs.rmSync(file, { recursive: true, force: true });
    } catch (error) {
      say(`can't put back ${relative}: ${error.message}`);
    }
  }
  // Clean before the repair: the index and the file go back to the last commit.
  const cleanBefore = owned.filter((relative) => !before.has(relative));
  if (cleanBefore.length) gitWithPaths(["reset", "-q", headBefore], cleanBefore);
  if (fromHead.length) {
    const restored = spawnSync(gitBin, ["checkout-index", "-f", "-z", "--stdin"], {
      cwd: app,
      input: nulInput(fromHead),
      encoding: "utf8",
      windowsHide: true,
    });
    if (restored.status !== 0) say(`couldn't put back ${fromHead.length} files: ${summaryOf(restored.stderr)}`);
  }
  if (kept.length) {
    fs.writeFileSync(path.join(unfinishedDir, "FILES.txt"), `${kept.join("\n")}\n`);
    say(`put back ${owned.length} changed paths; the model's versions are in ${unfinishedDir}`);
  }
  if (headMoved) say(`the model committed on its own (${headAfter.slice(0, 12)}); that commit stays, unsigned`);
};

const fail = (message) => {
  putBack();
  finish(false, route, message);
};

if (!headMoved && !owned.length) {
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
if (result.timedOut) fail("Repair ran out of time before it finished, so it changed nothing.");
if (result.code !== 0) fail(`Repair stopped before it finished (${summaryOf(result.err) || `exit ${result.code}`}), so it changed nothing.`);
const invalid = validate();
if (invalid) fail(`Repair's fix didn't hold up (${invalid}), so it changed nothing.`);

const summary = summaryOf(result.out) || "Repaired Stella's start";
if (owned.length) {
  const added = gitWithPaths(["add", "-A"], owned);
  if (!added.ok) fail(`Repair couldn't save its fix: ${summaryOf(added.err)}`);
  const ownedSet = new Set(owned);
  const staged = git(["diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD"]).out.split("\0").filter((p) => ownedSet.has(p));
  if (staged.length) {
    const commit = gitWithPaths(["commit", "-q", "--no-verify", "--only", "-m", `Repair: ${summary.slice(0, 72)}`, "-m", summary], staged, identity);
    if (!commit.ok) fail(`Repair couldn't save its fix: ${summaryOf(commit.err)}`);
  } else if (!headMoved) {
    finish(false, route, "Repair didn't find anything to change.");
  }
}
fs.rmSync(beforeDir, { recursive: true, force: true });
finish(true, route, summary);
