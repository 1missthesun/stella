import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(skillRoot, "../../..");

const isAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const spawnDetached = (command, args, { env, logPath, cwd }) => {
  mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = openSync(logPath, "a");
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  child.on("error", (error) => writeFileSync(logPath, `[spawn error] ${error.message}\n`, { flag: "a" }));
  child.unref();
  return child;
};

export const killGroup = async (pid) => {
  if (!isAlive(pid)) return;
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        return;
      }
    }
    const deadline = Date.now() + (signal === "SIGTERM" ? 4_000 : 2_000);
    while (Date.now() < deadline && isAlive(pid)) await delay(100);
    if (!isAlive(pid)) return;
  }
};

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh", "env", "timeout", "nohup"]);

const processTable = () => {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
};

export const runOwnedProcesses = (runId) => {
  const marker = `stella-verify-${runId}`;
  const table = processTable();
  const ancestors = new Set();
  const byPid = new Map(table.map((entry) => [entry.pid, entry]));
  for (let pid = process.pid; pid && !ancestors.has(pid); pid = byPid.get(pid)?.ppid) ancestors.add(pid);
  return table.filter(({ pid, command }) => {
    if (ancestors.has(pid) || !command.includes(marker)) return false;
    const argv0 = path.basename(command.split(/\s+/)[0] ?? "");
    if (SHELLS.has(argv0)) return false;
    return /--listen\b|--user-data-dir=|--type=|stella-browser|crashpad/.test(command);
  });
};

export const stopRunOwnedProcesses = async (runId) => {
  const owned = runOwnedProcesses(runId);
  for (const { pid } of owned) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline && owned.some(({ pid }) => isAlive(pid))) await delay(150);
  for (const { pid } of owned) {
    if (!isAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  return owned.map(({ pid, command }) => ({ pid, command: command.slice(0, 160) }));
};

const xvfbCacheDir = () =>
  path.join(process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache"), "stella-verify", "xvfb");

export const resolveXvfb = () => {
  const candidates = [process.env.STELLA_VERIFY_XVFB?.trim(), "/usr/bin/Xvfb", path.join(xvfbCacheDir(), "usr/bin/Xvfb")];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
};

const fetchXvfb = () => {
  const script = path.join(skillRoot, "scripts/fetch-xvfb.sh");
  const result = spawnSync(script, [], { encoding: "utf8", env: { ...process.env, STELLA_VERIFY_XVFB_DIR: xvfbCacheDir() } });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(-600) };
};

const displayInUse = (n) =>
  existsSync(`/tmp/.X${n}-lock`) || existsSync(`/tmp/.X11-unix/X${n}`);

export const startXvfb = async ({ runDir }) => {
  if (process.platform !== "linux") return { mode: "host", reason: "Only Linux runs a private display." };
  let binary = resolveXvfb();
  let fetched = null;
  if (!binary) {
    fetched = fetchXvfb();
    binary = resolveXvfb();
  }
  if (!binary) {
    return {
      mode: "host",
      reason: `No Xvfb (${fetched?.output || "scripts/fetch-xvfb.sh found none"}). The window opens on the real display; install xorg-server-xvfb to avoid that.`,
    };
  }
  for (let n = 90; n < 160; n += 1) {
    if (displayInUse(n)) continue;
    const child = spawnDetached(binary, [`:${n}`, "-screen", "0", "1600x1000x24", "-nolisten", "tcp", "-noreset"], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      logPath: path.join(runDir, "xvfb.log"),
      cwd: runDir,
    });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && isAlive(child.pid) && !existsSync(`/tmp/.X11-unix/X${n}`)) await delay(100);
    if (isAlive(child.pid) && existsSync(`/tmp/.X11-unix/X${n}`)) {
      return { mode: "xvfb", display: `:${n}`, pid: child.pid, binary };
    }
    await killGroup(child.pid);
  }
  return { mode: "host", reason: "No free X display between :90 and :159." };
};

export const ensureDisplay = async (run, requested) => {
  if (requested === "host" || process.platform !== "linux") {
    return { mode: "host", display: process.env.DISPLAY ?? null };
  }
  if (run.display?.mode === "xvfb" && isAlive(run.display.pid) && existsSync(`/tmp/.X11-unix/X${run.display.display.slice(1)}`)) {
    return run.display;
  }
  const started = await startXvfb({ runDir: run.runDir });
  return started.mode === "xvfb" ? started : { ...started, display: process.env.DISPLAY ?? null };
};

const CHROMIUM_CANDIDATES = () => {
  const home = os.homedir();
  const playwright = (base, tail) => {
    try {
      return readdirSync(base)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort()
        .reverse()
        .map((name) => path.join(base, name, tail));
    } catch {
      return [];
    }
  };
  if (process.platform === "darwin") {
    return [
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      path.join(home, "Applications/Chromium.app/Contents/MacOS/Chromium"),
      ...playwright(path.join(home, "Library/Caches/ms-playwright"), "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
      ...playwright(path.join(home, "Library/Caches/ms-playwright"), "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium"),
    ];
  }
  return [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    ...playwright(path.join(home, ".cache/ms-playwright"), "chrome-linux/chrome"),
    ...playwright(path.join(home, ".cache/ms-playwright"), "chrome-linux64/chrome"),
  ];
};

export const resolveChromium = () =>
  [process.env.STELLA_VERIFY_CHROMIUM?.trim(), ...CHROMIUM_CANDIDATES()].find((candidate) => candidate && existsSync(candidate)) ?? null;

const stellaBrowserBinary = () => {
  const key = (() => {
    const arch = os.arch();
    if (process.platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
    if (process.platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64";
    return null;
  })();
  if (!key) return null;
  const root = path.join(repoRoot, "packages/stella-browser");
  return [path.join(root, "out", key, "stella-browser"), path.join(root, "bin", `stella-browser-${key}`)].find((candidate) => existsSync(candidate)) ?? null;
};

const NATIVE_HOST_NAME = "com.stella.browser_bridge";
const BRIDGE_SESSION = "stella-app-bridge";

const extensionId = () => {
  const source = readFileSync(path.join(repoRoot, "packages/contracts/browser-extension.js"), "utf8");
  return source.match(/STELLA_BROWSER_EXTENSION_ID\s*=\s*["']([a-p]{32})["']/)?.[1] ?? null;
};

export const prepareTestExtension = ({ runDir, socketDir, extPort }) => {
  const binary = stellaBrowserBinary();
  if (!binary) throw new Error("No stella-browser binary in packages/stella-browser/out; run `bun install` (it hydrates the binary).");
  const id = extensionId();
  if (!id) throw new Error("Could not read STELLA_BROWSER_EXTENSION_ID from the bridge config.");
  const base = path.join(runDir, "browser-extension");
  const extensionDir = path.join(base, "extension");
  const profileDir = path.join(base, "chromium-profile");
  rmSync(extensionDir, { recursive: true, force: true });
  cpSync(path.join(repoRoot, "packages/stella-browser/extension"), extensionDir, {
    recursive: true,
    filter: (source) => !source.endsWith(".test.js"),
  });
  const connection = path.join(extensionDir, "lib/connection.js");
  const original = readFileSync(connection, "utf8");
  const patched = original.replace("http://127.0.0.1:39040/healthz", `http://127.0.0.1:${extPort}/healthz`);
  if (patched === original) throw new Error("The extension's bridge health URL moved; update prepareTestExtension.");
  writeFileSync(connection, patched);
  const hostScript = path.join(base, "native-host.sh");
  const quote = (value) => `'${value.replace(/'/g, `'"'"'`)}'`;
  writeFileSync(
    hostScript,
    `#!/bin/sh\nexport STELLA_BROWSER_SESSION=${BRIDGE_SESSION}\nexport STELLA_BROWSER_SOCKET_DIR=${quote(socketDir)}\nexec ${quote(binary)} native-host "$@"\n`,
  );
  chmodSync(hostScript, 0o755);
  const manifestDir = path.join(profileDir, "NativeMessagingHosts");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, `${NATIVE_HOST_NAME}.json`),
    `${JSON.stringify({ name: NATIVE_HOST_NAME, description: "Stella verify-run bridge", path: hostScript, type: "stdio", allowed_origins: [`chrome-extension://${id}/`] }, null, 2)}\n`,
  );
  return { extensionDir, profileDir, extensionId: id, extPort, socketDir };
};

export const startTestBrowser = async ({ runDir, extension, display, softwareGl }) => {
  const chromium = resolveChromium();
  if (!chromium) {
    throw new Error(
      "No Chromium for the test extension. Google Chrome ignores --load-extension; install Chromium (`pacman -S chromium`, `brew install --cask chromium`) or `bunx playwright install chromium`, or set STELLA_VERIFY_CHROMIUM.",
    );
  }
  const args = [
    `--user-data-dir=${extension.profileDir}`,
    `--load-extension=${extension.extensionDir}`,
    `--disable-extensions-except=${extension.extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--password-store=basic",
    "--use-mock-keychain",
    ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
    ...(softwareGl ? ["--disable-gpu"] : []),
    "about:blank",
  ];
  const env = { ...process.env, ...(display ? { DISPLAY: display } : {}) };
  delete env.WAYLAND_DISPLAY;
  const child = spawnDetached(chromium, args, { env, logPath: path.join(runDir, "browser-extension", "chromium.log"), cwd: runDir });
  await delay(1_500);
  if (!isAlive(child.pid)) throw new Error(`The test Chromium exited at start; see ${path.join(runDir, "browser-extension", "chromium.log")}.`);
  return { pid: child.pid, chromium };
};

const claudeSourceDirs = () => [
  ...new Set([process.env.STELLA_VERIFY_CLAUDE_SOURCE_DIR?.trim(), process.env.CLAUDE_CONFIG_DIR?.trim(), path.join(os.homedir(), ".claude")].filter(Boolean)),
];

const claudeCredentialSources = () => claudeSourceDirs().map((dir) => path.join(dir, ".credentials.json"));

const claudeKeychainServices = () => [
  "Claude Code-credentials",
  ...claudeSourceDirs()
    .filter((dir) => dir !== path.join(os.homedir(), ".claude"))
    .map((dir) => `Claude Code-credentials-${createHash("sha256").update(dir).digest("hex").slice(0, 8)}`),
];

const readMacKeychainCredential = (service) => {
  if (process.platform !== "darwin") return null;
  try {
    const raw = execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const MIN_TOKEN_LIFETIME_MS = 30 * 60_000;

export const borrowClaudeLogin = ({ claudeConfigDir, oauthToken }) => {
  let oauth;
  let source;
  if (oauthToken) {
    oauth = {
      accessToken: oauthToken,
      refreshToken: null,
      expiresAt: Date.now() + 365 * 24 * 3600_000,
      scopes: ["user:inference", "user:profile"],
      subscriptionType: null,
    };
    source = "STELLA_VERIFY_CLAUDE_OAUTH_TOKEN";
  } else {
    const candidates = [];
    for (const file of claudeCredentialSources()) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8"))?.claudeAiOauth;
        if (parsed?.accessToken) candidates.push({ oauth: parsed, source: file });
      } catch {}
    }
    for (const service of claudeKeychainServices()) {
      const keychain = readMacKeychainCredential(service)?.claudeAiOauth;
      if (keychain?.accessToken) candidates.push({ oauth: keychain, source: `macOS keychain: ${service}` });
    }
    candidates.sort((a, b) => (b.oauth.expiresAt ?? 0) - (a.oauth.expiresAt ?? 0));
    const best = candidates[0];
    if (!best) throw new Error("No Claude Code login on this computer to borrow (looked at $CLAUDE_CONFIG_DIR, ~/.claude and the macOS keychain).");
    if ((best.oauth.expiresAt ?? 0) - Date.now() < MIN_TOKEN_LIFETIME_MS) {
      throw new Error("The newest Claude access token here expires within 30 minutes. Run any `claude` command to refresh it, then launch again.");
    }
    oauth = {
      accessToken: best.oauth.accessToken,
      refreshToken: null,
      expiresAt: best.oauth.expiresAt,
      scopes: best.oauth.scopes,
      subscriptionType: best.oauth.subscriptionType ?? null,
      rateLimitTier: best.oauth.rateLimitTier ?? null,
    };
    source = best.source;
  }
  mkdirSync(claudeConfigDir, { recursive: true, mode: 0o700 });
  const file = path.join(claudeConfigDir, ".credentials.json");
  writeFileSync(file, `${JSON.stringify({ claudeAiOauth: oauth })}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  let status = null;
  try {
    const claude = execFileSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" }).trim().split("\n")[0];
    const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigDir };
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]) delete env[name];
    const out = execFileSync(claude, ["auth", "status", "--json"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"], timeout: 20_000 });
    const parsed = JSON.parse(out);
    status = { loggedIn: Boolean(parsed.loggedIn ?? parsed.logged_in), subscriptionType: parsed.subscriptionType ?? null };
  } catch {
    status = { loggedIn: null };
  }
  return {
    source,
    refreshToken: "not copied",
    expiresAt: new Date(oauth.expiresAt).toISOString(),
    file,
    status,
  };
};

export const removeBorrowedClaudeLogin = (claudeConfigDir) => {
  if (!claudeConfigDir) return false;
  const file = path.join(claudeConfigDir, ".credentials.json");
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
};
