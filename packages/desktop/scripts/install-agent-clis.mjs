#!/usr/bin/env bun
// Installs Claude Code and Google Antigravity's `agy` during a first install,
// when this computer has neither, with each vendor's own installer, so they
// are there when Stella opens instead of being one more install in the app.
//
//   bun packages/desktop/scripts/install-agent-clis.mjs [--log <file>]
//       [--after-ready <launcher.log>]
//
// install-deps.mjs starts it in the background once its own downloads are in.
// With --after-ready it waits for the launcher to log that Stella is up (or
// two minutes): ~500 MB of downloads and the first runs of two new binaries
// slow Stella's own first start. From the start until it's done it holds
// that CLI's lock (packages/node-shared/integrations/cli-install-lock.ts),
// which Stella's own installers wait on. A failure is only logged: Stella
// still offers its usual install. STELLA_SKIP_AGENT_CLIS=1 turns it off.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { holdCliInstallLock } from "../../node-shared/integrations/cli-install-lock.ts";
import {
  findExternalCliPath,
  findUnrunnableExternalCliPath,
} from "../../node-shared/integrations/external-cli-resolution.ts";

const startedAt = performance.now();
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};
const logFile = option("--log");
const launcherLog = option("--after-ready");
const READY_WAIT_MS = 120_000;
const log = (message) => {
  const line = `[agent-clis] ${message} (+${((performance.now() - startedAt) / 1000).toFixed(1)}s)\n`;
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line);
      return;
    } catch {}
  }
  process.stdout.write(line);
};
const describe = (error) =>
  error instanceof Error ? error.message : String(error);
const windows = process.platform === "win32";
const home =
  (windows ? process.env.USERPROFILE : process.env.HOME)?.trim() ||
  os.homedir();
const INSTALL_TIMEOUT_MS = 15 * 60_000;

const fetchScript = async (url) => {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return await response.text();
};

const run = (command, args, { env, cwd }) =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn(command, args, {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: INSTALL_TIMEOUT_MS,
    });
    const collect = (chunk) => {
      output = `${output}${chunk}`.slice(-2_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) =>
      resolve({ code: null, output: `${output}\n${error.message}` }),
    );
    child.once("close", (code) => resolve({ code, output: output.trim() }));
  });

const lastLine = (text) =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";

const runScript = async (url, args, env, work) => {
  const script = path.join(work, windows ? "install.ps1" : "install.sh");
  fs.writeFileSync(script, await fetchScript(url), { mode: 0o700 });
  return windows
    ? await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          ...args,
        ],
        { env, cwd: work },
      )
    : await run("bash", [script, ...args], { env, cwd: work });
};

const versionOf = async (binary) => {
  const result = await run(binary, ["--version"], {
    env: process.env,
    cwd: os.tmpdir(),
  });
  return result.code === 0
    ? (/\d+\.\d+\.\d+/u.exec(result.output)?.[0] ?? null)
    : null;
};

// The same installer Stella's Claude Code install runs
// (packages/runtime/kernel/integrations/claude-cli-install.ts).
const installClaude = async (work) => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const result = await runScript(
    windows ? "https://claude.ai/install.ps1" : "https://claude.ai/install.sh",
    [],
    env,
    work,
  );
  const installed = findExternalCliPath("claude");
  if (result.code !== 0 || !installed) {
    throw new Error(
      lastLine(result.output) ||
        `the installer exited with code ${result.code}`,
    );
  }
  return installed;
};

// As Stella's Antigravity install does
// (packages/runtime/kernel/integrations/antigravity-cli-install.ts): into a
// staging folder beside the target, without touching shell profiles or PATH.
const installAgy = async (work) => {
  const directory = windows
    ? path.join(
        process.env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local"),
        "agy",
        "bin",
      )
    : path.join(home, ".local", "bin");
  const program = windows ? "agy.exe" : "agy";
  fs.mkdirSync(directory, { recursive: true });
  const staged = fs.mkdtempSync(path.join(directory, ".stella-agy-"));
  try {
    const scratchHome = path.join(work, "home");
    fs.mkdirSync(scratchHome);
    const env = windows
      ? process.env
      : {
          ...process.env,
          HOME: scratchHome,
          SHELL: "/bin/sh",
          ZDOTDIR: scratchHome,
          XDG_CONFIG_HOME: path.join(scratchHome, ".config"),
        };
    const result = await runScript(
      windows
        ? "https://antigravity.google/cli/install.ps1"
        : "https://antigravity.google/cli/install.sh",
      windows
        ? ["--dir", staged, "--skip-path", "--skip-aliases"]
        : ["--dir", staged],
      env,
      work,
    );
    const fresh = path.join(staged, program);
    if (!fs.existsSync(fresh) || !(await versionOf(fresh))) {
      throw new Error(
        lastLine(result.output) ||
          `the installer exited with code ${result.code}`,
      );
    }
    const target = path.join(directory, program);
    if (fs.existsSync(target)) return target;
    fs.renameSync(fresh, target);
    return target;
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
};

const CLIS = [
  { cli: "claude", name: "Claude Code", install: installClaude },
  { cli: "agy", name: "Google Antigravity", install: installAgy },
];

const sizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

// Resolves once the launcher logs "supervisor: ready" after `from` bytes.
const stellaReady = (file, from) =>
  new Promise((resolve) => {
    const deadline = Date.now() + READY_WAIT_MS;
    const check = () => {
      let text = "";
      try {
        const size = sizeOf(file);
        const start = size < from ? 0 : from;
        const fd = fs.openSync(file, "r");
        try {
          const buffer = Buffer.alloc(Math.max(0, size - start));
          fs.readSync(fd, buffer, 0, buffer.length, start);
          text = buffer.toString("utf8");
        } finally {
          fs.closeSync(fd);
        }
      } catch {}
      if (text.includes("supervisor: ready")) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(check, 250);
    };
    check();
  });

const ensure = async ({ cli, name, install }, ready) => {
  const present =
    findExternalCliPath(cli) ?? findUnrunnableExternalCliPath(cli);
  if (present) {
    log(`${name} is already at ${present}`);
    return;
  }
  const release = holdCliInstallLock(cli);
  let work;
  try {
    await ready;
    work = fs.mkdtempSync(path.join(os.tmpdir(), `stella-${cli}-install-`));
    const started = performance.now();
    const installed = await install(work);
    log(
      `installed ${name} at ${installed} in ${((performance.now() - started) / 1000).toFixed(1)}s`,
    );
  } catch (error) {
    log(
      `${name} didn't install (Stella offers it in the app): ${describe(error)}`,
    );
  } finally {
    release();
    if (work) fs.rmSync(work, { recursive: true, force: true });
  }
};

if (process.env.STELLA_SKIP_AGENT_CLIS === "1") {
  log("skipped (STELLA_SKIP_AGENT_CLIS=1)");
} else {
  const ready = launcherLog
    ? stellaReady(launcherLog, sizeOf(launcherLog)).then((seen) =>
        log(seen ? "Stella is up" : "Stella isn't up yet; installing anyway"),
      )
    : Promise.resolve();
  await Promise.all(
    CLIS.map((entry) =>
      ensure(entry, ready).catch((error) =>
        log(`${entry.name}: ${describe(error)}`),
      ),
    ),
  );
  log("done");
}
