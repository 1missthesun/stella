// Isolated Rune Stella sessions for proofs, like verify-stella's `session launch` for Electron:
// a run folder outside the home with its own data dir, user-data dir, HOME, protected-storage key
// and (optionally) a signed-in dev test account. Never touches the user's ~/.stella or account.
//
//   bun scripts/session.ts start [--account pro|signed-out] [--headless] [--name <run>]
//   bun scripts/session.ts eval '<async function body using api, windows, electron>'
//   bun scripts/session.ts shot <file.png>
//   bun scripts/session.ts stop

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const REPO = path.resolve(ROOT, "../..");
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? "") : undefined; };
const has = (name: string) => args.includes(name);
const runName = flag("--name") ?? process.env.STELLA_RUNE_RUN ?? "default";
const RUN_DIR = path.join(os.tmpdir(), `stella-rune-${process.getuid?.() ?? "u"}-${runName}`);
const POINTER = path.join(RUN_DIR, "run.json");
const DEV_BACKEND = "https://stella-v2-cloud-builder-dev.fromyou.workers.dev";
const XVFB = process.env.XVFB ?? path.join(os.homedir(), ".cache/stella-verify/xvfb/usr/bin/Xvfb");
const ENGINE = process.env.BIN ?? path.join(ROOT, "engine/target/release/stella-engine");

type Run = { runDir: string; dataDir: string; userDataDir: string; homeDir: string; ctlPort: number; display?: string; pids: Record<string, number>; account?: { email: string; plan?: string }; headless: boolean; startedAt: string };

const readRun = (): Run => JSON.parse(readFileSync(POINTER, "utf8"));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const adminSecret = (): string | null => {
  if (process.env.STELLA_ADMIN_API_SECRET?.trim()) return process.env.STELLA_ADMIN_API_SECRET.trim();
  for (const repo of [REPO, path.join(os.homedir(), "Projects/stella-v2"), path.join(os.homedir(), "projects/stella-v2")]) {
    try {
      const m = readFileSync(path.join(repo, "workers/cloud-builder/.dev.vars"), "utf8").match(/^STELLA_ADMIN_API_SECRET\s*=\s*"?([^"\n]+)"?/m);
      if (m) return m[1]!.trim();
    } catch {}
  }
  return null;
};

const mint = async (mode: string) => {
  const secret = adminSecret();
  if (!secret) throw new Error("STELLA_ADMIN_API_SECRET is unavailable (env or workers/cloud-builder/.dev.vars).");
  const body: Record<string, string> = { email: `agent-rune-${runName}-${Date.now().toString(36)}@test.stella.local` };
  if (mode === "plus" || mode === "pro" || mode === "max") { body.plan = mode; body.usageMode = "unlimited"; }
  const site = (process.env.STELLA_BACKEND_URL?.trim() || DEV_BACKEND).replace(/\/+$/, "");
  const response = await fetch(`${site}/api/admin/test-accounts/session`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { sessionToken?: string; email?: string; plan?: string } | null;
  if (!response.ok || !payload?.sessionToken) throw new Error(`Test account mint failed: HTTP ${response.status}`);
  return { sessionToken: payload.sessionToken, email: payload.email ?? body.email!, plan: payload.plan };
};

const freePort = async () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
};

const BUN = (() => {
  const pinned = path.join(os.homedir(), ".local/share/stella/runtimes/bun-1.4.4/bun");
  return existsSync(pinned) ? pinned : process.execPath;
})();

async function start() {
  if (existsSync(POINTER)) {
    const old = readRun();
    if (Object.values(old.pids).some(alive)) throw new Error(`Run ${runName} is still running; stop it first.`);
  }
  rmSync(RUN_DIR, { recursive: true, force: true });
  const dataDir = path.join(RUN_DIR, "data");
  const userDataDir = path.join(RUN_DIR, "user-data");
  const homeDir = path.join(RUN_DIR, "home");
  for (const dir of [dataDir, userDataDir, homeDir]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  symlinkSync(dataDir, path.join(homeDir, ".stella"), "dir");
  writeFileSync(path.join(homeDir, ".gitconfig"), "[user]\n\tname = Stella Rune Verify\n\temail = verify@test.stella.local\n");
  const keyFile = path.join(RUN_DIR, "protected-storage.key");
  writeFileSync(keyFile, randomBytes(32).toString("base64url"), { mode: 0o600 });
  const accountMode = flag("--account") ?? "pro";
  writeFileSync(path.join(dataDir, "ui-state.json"), JSON.stringify({ "stella-onboarding-complete": "true" }));
  writeFileSync(path.join(dataDir, "preferences.json"), JSON.stringify({ onboardingCompleted: true }));
  const minted = accountMode === "signed-out" ? null : await mint(accountMode);
  const ctlPort = await freePort();
  const headless = has("--headless");

  const env: Record<string, string> = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ", "XDG_RUNTIME_DIR", "TMPDIR"]) if (process.env[key]) env[key] = process.env[key]!;
  env.PATH = (env.PATH ?? "").split(path.delimiter).filter((p) => path.basename(p) !== "shell-shims").join(path.delimiter);
  const realHome = os.homedir();
  for (const [key, rel] of [["BUN_INSTALL_CACHE_DIR", ".bun/install/cache"], ["MISE_DATA_DIR", ".local/share/mise"]] as const) {
    if (existsSync(path.join(realHome, rel))) env[key] = path.join(realHome, rel);
  }
  Object.assign(env, {
    HOME: homeDir,
    NODE_ENV: "development",
    STELLA_DATA_DIR: dataDir,
    STELLA_V2_DEV_DATA_DIR: dataDir,
    STELLA_DEV_HARNESS: "1",
    STELLA_DEV_HARNESS_STORAGE_KEY_FILE: keyFile,
    STELLA_V2_DEV_USER_DATA_DIR: userDataDir,
    STELLA_RUNE_USER_DATA_DIR: userDataDir,
    STELLA_RUNTIME_IPC_DIR: RUN_DIR,
    STELLA_REMOTE_DEBUG_PORT: "0",
    STELLA_SAVED_VALUES_STORE: "protected_file",
    STELLA_SKIP_BROWSER_HYDRATE: "1",
    STELLA_CLAUDE_CLI_UPDATES: "off",
    STELLA_ANTIGRAVITY_CLI_UPDATES: "off",
    STELLA_RUNE_EXTERNAL_OPEN: "log",
    STELLA_RUNE_CTL_PORT: String(ctlPort),
    STELLA_BUN_PATH: BUN,
    ...(process.env.STELLA_BACKEND_URL?.trim() ? { VITE_STELLA_BACKEND_URL: process.env.STELLA_BACKEND_URL.trim() } : {}),
    ...(minted ? { STELLA_DEV_HARNESS_SESSION_TOKEN: minted.sessionToken } : {}),
  });

  const pids: Record<string, number> = {};
  const log = openSync(path.join(RUN_DIR, "host.log"), "a");
  let display: string | undefined;
  if (headless) {
    const child = spawn(BUN, [path.join(ROOT, "host/services/headless.ts")], { cwd: REPO, env, stdio: ["ignore", log, log], detached: true });
    pids.host = child.pid!;
    child.unref();
  } else {
    display = flag("--display") ?? `:${90 + (Math.abs([...runName].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % 9)}`;
    const w = Number(process.env.W ?? 1400);
    const h = Number(process.env.H ?? 940);
    const xvfb = spawn(XVFB, [display, "-screen", "0", `${w + 40}x${h + 40}x24`, "-nolisten", "tcp"], { stdio: ["ignore", log, log], detached: true });
    pids.xvfb = xvfb.pid!;
    xvfb.unref();
    for (let i = 0; i < 100 && !existsSync(`/tmp/.X11-unix/X${display.slice(1)}`); i++) await Bun.sleep(50);
    Object.assign(env, {
      DISPLAY: display,
      VK_ICD_FILENAMES: "/usr/share/vulkan/icd.d/lvp_icd.json",
      STELLA_RUNE_ROOT: ROOT,
      STELLA_RUNE_BUN: BUN,
      STELLA_RUNE_T0: String(Date.now()),
      STELLA_RUNE_METRICS: path.join(RUN_DIR, "metrics.jsonl"),
      STELLA_RUNE_W: String(w),
      STELLA_RUNE_H: String(h),
      STELLA_RUNE_THEME: process.env.THEME ?? "dark",
      STELLA_RUNE_SERVICES: "1",
      STELLA_RUNE_SCREEN_W: String(w + 40),
      STELLA_RUNE_SCREEN_H: String(h + 40),
    });
    const engine = spawn(ENGINE, [], { cwd: REPO, env, stdio: ["ignore", log, log], detached: true });
    pids.engine = engine.pid!;
    engine.unref();
  }
  closeSync(log);
  const run: Run = { runDir: RUN_DIR, dataDir, userDataDir, homeDir, ctlPort, display, pids, headless, account: minted ? { email: minted.email, plan: minted.plan } : undefined, startedAt: new Date().toISOString() };
  writeFileSync(POINTER, JSON.stringify(run, null, 1));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (!Object.values(pids).every(alive)) break;
    try { if ((await fetch(`http://127.0.0.1:${ctlPort}/health`)).ok) break; } catch {}
    await Bun.sleep(300);
  }
  console.log(JSON.stringify({ ...run, ready: await fetch(`http://127.0.0.1:${ctlPort}/health`).then((r) => r.ok).catch(() => false), log: path.join(RUN_DIR, "host.log") }, null, 1));
}

async function evaluate(body: string) {
  const run = readRun();
  const response = await fetch(`http://127.0.0.1:${run.ctlPort}/eval`, { method: "POST", body });
  console.log(JSON.stringify(await response.json(), null, 1));
}

function shot(file: string) {
  const run = readRun();
  if (!run.display) throw new Error("Headless run has no display.");
  const r = spawnSync("import", ["-window", "root", file], { env: { ...process.env, DISPLAY: run.display }, stdio: "inherit" });
  if (r.status !== 0) throw new Error("screenshot failed");
  console.log(file);
}

async function stop() {
  if (!existsSync(POINTER)) { console.log("no run"); return; }
  const run = readRun();
  const app = run.pids.host ?? run.pids.engine;
  if (app && alive(app)) {
    await fetch(`http://127.0.0.1:${run.ctlPort}/eval`, { method: "POST", body: "setTimeout(() => electron.app.quit(), 10); return true;" }).catch(() => {});
    for (let i = 0; i < 80 && alive(app); i++) await Bun.sleep(100);
  }
  for (const name of ["host", "engine", "xvfb"]) {
    const pid = run.pids[name];
    if (!pid || !alive(pid)) continue;
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
  }
  console.log(`stopped ${JSON.stringify(run.pids)}`);
}

const [command, ...rest] = args;
if (command === "start") await start();
else if (command === "eval") await evaluate(rest.join(" "));
else if (command === "shot") shot(rest[0] ?? path.join(RUN_DIR, "shot.png"));
else if (command === "stop") await stop();
else if (command === "dir") console.log(RUN_DIR);
else { console.error("usage: session.ts start|eval|shot|stop|dir"); process.exit(2); }
