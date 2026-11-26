// Isolated Rune Stella sessions for proofs, like verify-stella's `session launch` for Electron:
// a run folder outside the home with its own data dir, user-data dir, HOME, protected-storage key
// and (optionally) a signed-in dev test account. Never touches the user's ~/.stella or account.
//
//   bun scripts/session.ts start [--account pro|signed-out] [--email <test account>] [--headless] [--show] [--installed] [--first-run] [--name <run>]
//   bun scripts/session.ts eval '<async function body using api, windows, electron>'
//   bun scripts/session.ts shot <file.png>
//   bun scripts/session.ts stop
// --installed lets app-source updates move this checkout, as in an installed app (prove those from a clone).
// With STELLA_LAUNCHER=1 and a socket on fd 3, the app gets that launcher channel, as from a launcher.
// Linux runs the engine on a private Xvfb. macOS runs windows unseen (RUNE_UNSEEN: invisible,
// click-through, never activated, still presenting for shot/record/input); --show puts a real
// window on screen under a shared window slot (~/projects/rune-window-slot.sh), without focus.
// Linux --show runs on the real display (Hyprland: floating, no initial focus, W×H at POS="x y").

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const REPO = path.resolve(ROOT, "../..");
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? "") : undefined; };
const has = (name: string) => args.includes(name);
const runName = flag("--name") ?? process.env.STELLA_RUNE_RUN ?? "default";
const MAC = process.platform === "darwin";
const WIN = process.platform === "win32";
/** Runtime and bridge sockets live under the run folder: macOS caps socket paths at 104 bytes. */
const RUN_DIR = path.join(WIN ? os.tmpdir() : "/tmp", `sr-${runName}`);
if (!WIN && RUN_DIR.length > 30) throw new Error(`Run folder ${RUN_DIR} is too long for runtime sockets; use a shorter --name.`);
const POINTER = path.join(RUN_DIR, "run.json");
const DEV_BACKEND = "https://stella-v2-cloud-builder-dev.fromyou.workers.dev";
const XVFB = process.env.XVFB ?? path.join(os.homedir(), ".cache/stella-verify/xvfb/usr/bin/Xvfb");
const ENGINE = process.env.BIN ?? [path.join(os.homedir(), "projects/.rune-target/release/stella-engine"), path.join(ROOT, "engine/target/release/stella-engine")].find(existsSync) ?? "stella-engine";
const SLOTS = path.join(os.homedir(), "projects/rune-window-slot.sh");

type Run = { runDir: string; dataDir: string; userDataDir: string; homeDir: string; ctlPort: number; display?: string; slot?: string; unseen?: boolean; pids: Record<string, number>; account?: { email: string; plan?: string }; headless: boolean; startedAt: string };

const acquireSlot = () => {
  const r = spawnSync(SLOTS, ["acquire", `rune-session-${runName}`], { encoding: "utf8", timeout: 600_000 });
  const slot = r.stdout?.trim();
  if (r.status !== 0 || !slot) throw new Error(`No window slot (${SLOTS}): ${r.stderr}`);
  return slot;
};
const releaseSlot = (slot?: string) => { if (slot) spawnSync(SLOTS, ["release", slot]); };

const readRun = (): Run => JSON.parse(readFileSync(POINTER, "utf8"));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const cmdline = (pid: number): string[] => {
  if (WIN) {
    const ps = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8" });
    return ps.status === 0 ? ps.stdout.trim().split(/\s+/) : [];
  }
  if (MAC) {
    const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    return ps.status === 0 ? ps.stdout.trim().split(/\s+/) : [];
  }
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0"); } catch { return []; }
};

/** A display no other X server (the verify harness's, another agent's) holds, outside the harness's range. */
const freeDisplay = () => {
  for (let n = 140; n < 200; n++) {
    if (!existsSync(`/tmp/.X11-unix/X${n}`) && !existsSync(`/tmp/.X${n}-lock`)) return `:${n}`;
  }
  throw new Error("No free X display in :140-:199.");
};

/** The run's Xvfb, only while it is the process this script started and still serves the run's display. */
const ownDisplay = (run: Run) => {
  const pid = run.pids.xvfb;
  if (!run.display || !pid || !alive(pid) || !cmdline(pid).includes(run.display)) throw new Error(`Run ${runName} has no live display of its own.`);
  return run.display;
};

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
  const body: Record<string, string> = { email: flag("--email") ?? `agent-rune-${runName}-${Date.now().toString(36)}@test.stella.local` };
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

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Linux `--show`: Hyprland execs the engine as a floating window that never takes focus; the wrapper records the engine's pid. */
const showOnHyprland = async (env: Record<string, string>, w: number, h: number) => {
  const pidFile = path.join(RUN_DIR, "engine.pid");
  const script = path.join(RUN_DIR, "engine.sh");
  const vars = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ");
  const log = shellQuote(path.join(RUN_DIR, "host.log"));
  writeFileSync(script, `#!/bin/sh\ncd ${shellQuote(REPO)} || exit 1\necho $$ > ${shellQuote(pidFile)}\nexec env -i ${vars} ${shellQuote(ENGINE)} >> ${log} 2>&1\n`, { mode: 0o700 });
  const at = (process.env.POS ?? "80 80").trim();
  const rules = `{ float = true, size = "${w} ${h}", move = "${at}", no_initial_focus = true }`;
  const r = spawnSync("hyprctl", ["dispatch", `hl.dsp.exec_cmd([[${script}]], ${rules})`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`hyprctl exec failed: ${r.stderr || r.stdout}`);
  for (let i = 0; i < 200 && !existsSync(pidFile); i++) await Bun.sleep(20);
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!pid) throw new Error("The engine did not start.");
  return pid;
};

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
  symlinkSync(dataDir, path.join(homeDir, ".stella"), WIN ? "junction" : "dir");
  writeFileSync(path.join(homeDir, ".gitconfig"), "[user]\n\tname = Stella Rune Verify\n\temail = verify@test.stella.local\n");
  const keyFile = path.join(RUN_DIR, "protected-storage.key");
  writeFileSync(keyFile, randomBytes(32).toString("base64url"), { mode: 0o600 });
  const accountMode = flag("--account") ?? "pro";
  const firstRun = has("--first-run");
  writeFileSync(path.join(dataDir, "ui-state.json"), JSON.stringify(firstRun ? {} : { "stella-onboarding-complete": "true" }));
  writeFileSync(path.join(dataDir, "preferences.json"), JSON.stringify(firstRun ? {} : { onboardingCompleted: true }));
  const minted = accountMode === "signed-out" ? null : await mint(accountMode);
  const ctlPort = await freePort();
  const headless = has("--headless");

  const env: Record<string, string> = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ", "XDG_RUNTIME_DIR", "TMPDIR", "XMODIFIERS", "DBUS_SESSION_BUS_ADDRESS"]) if (process.env[key]) env[key] = process.env[key]!;
  env.MIMALLOC_PURGE_DELAY = "0";
  for (const [key, value] of Object.entries(process.env)) if (/^(MIMALLOC_|BUN_JSC_|RUNE_|STELLA_CHAT_FIXTURE_|STELLA_RUNE_(VOICE_HOST|CHROMIUM)$)/.test(key) && value) env[key] = value;
  const launcherChannel = (() => { try { return process.env.STELLA_LAUNCHER === "1" && fstatSync(3).isSocket(); } catch { return false; } })();
  if (launcherChannel) env.STELLA_LAUNCHER = "1";
  if (has("--installed")) env.STELLA_APP_SOURCE_INSTALLED = "1";
  env.PATH = (env.PATH ?? "").split(path.delimiter).filter((p) => path.basename(p) !== "shell-shims").join(path.delimiter);
  const realHome = os.homedir();
  for (const [key, rel] of [["BUN_INSTALL_CACHE_DIR", ".bun/install/cache"], ["MISE_DATA_DIR", ".local/share/mise"]] as const) {
    if (existsSync(path.join(realHome, rel))) env[key] = path.join(realHome, rel);
  }
  Object.assign(env, {
    HOME: homeDir,
    STELLA_RUNE_ACCOUNT_HOME: realHome,
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
  let slot: string | undefined;
  const unseen = MAC && !headless && !has("--show");
  if (headless) {
    const stdoutLog = openSync(path.join(RUN_DIR, "host.stdout"), "a");
    const child = spawn(BUN, [path.join(ROOT, "host/services/headless.ts")], { cwd: REPO, env, stdio: ["ignore", stdoutLog, log, ...(launcherChannel ? [3] : [])], detached: true });
    closeSync(stdoutLog);
    pids.host = child.pid!;
    child.unref();
  } else {
    const w = Number(process.env.W ?? 1400);
    const h = Number(process.env.H ?? 940);
    if (WIN) {
      env.RUNE_OPEN_INACTIVE = "1";
      for (const key of ["SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"]) {
        if (process.env[key]) env[key] = process.env[key]!;
      }
      env.USERPROFILE = homeDir;
    } else if (MAC) {
      env.RUNE_OPEN_INACTIVE = "1";
      if (unseen) env.RUNE_UNSEEN = "1";
      else slot = acquireSlot();
    } else if (has("--show")) {
      for (const key of ["DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP", "HYPRLAND_INSTANCE_SIGNATURE", "XMODIFIERS", "GTK_IM_MODULE", "QT_IM_MODULE", "GDK_SCALE", "XCURSOR_THEME", "XCURSOR_SIZE", "XCURSOR_PATH"]) {
        if (process.env[key]) env[key] = process.env[key]!;
      }
      if (process.env.STELLA_RUNE_BACKEND) env.STELLA_RUNE_BACKEND = process.env.STELLA_RUNE_BACKEND;
    } else {
      display = flag("--display") ?? freeDisplay();
      const xvfb = spawn(XVFB, [display, "-screen", "0", `${w + 40}x${h + 40}x24`, "-nolisten", "tcp"], { stdio: ["ignore", log, log], detached: true });
      pids.xvfb = xvfb.pid!;
      xvfb.unref();
      for (let i = 0; i < 100 && alive(xvfb.pid!) && !existsSync(`/tmp/.X11-unix/X${display.slice(1)}`); i++) await Bun.sleep(50);
      if (!alive(xvfb.pid!)) throw new Error(`Xvfb could not start on ${display}; see ${path.join(RUN_DIR, "host.log")}.`);
      Object.assign(env, {
        DISPLAY: display,
        VK_ICD_FILENAMES: "/usr/share/vulkan/icd.d/lvp_icd.json",
        STELLA_RUNE_SCREEN_W: String(w + 40),
        STELLA_RUNE_SCREEN_H: String(h + 40),
      });
    }
    Object.assign(env, {
      STELLA_RUNE_ROOT: ROOT,
      STELLA_RUNE_BUN: BUN,
      STELLA_RUNE_T0: String(Date.now()),
      STELLA_RUNE_METRICS: path.join(RUN_DIR, "metrics.jsonl"),
      STELLA_RUNE_W: String(w),
      STELLA_RUNE_H: String(h),
      STELLA_RUNE_THEME: process.env.THEME ?? "dark",
      STELLA_RUNE_SERVICES: has("--no-services") ? "0" : "1",
      ...(process.env.STELLA_RUNE_APP ? { STELLA_RUNE_APP: process.env.STELLA_RUNE_APP } : {}),
    });
    // Rune's own diagnostics (RUNE_FRAME_LOG, RUNE_LOOP_CHECK) reach the engine as set.
    for (const [key, value] of Object.entries(process.env)) if (key.startsWith("RUNE_") && key !== "RUNE_RUN" && value) env[key] ??= value;
    if (!MAC && !WIN && has("--show")) pids.engine = await showOnHyprland(env, w, h);
    else {
      const engine = spawn(ENGINE, [], { cwd: REPO, env, stdio: ["ignore", log, log, ...(launcherChannel ? [3] : [])], detached: true });
      pids.engine = engine.pid!;
      engine.unref();
    }
  }
  closeSync(log);
  const run: Run = { runDir: RUN_DIR, dataDir, userDataDir, homeDir, ctlPort, display, slot, unseen: unseen || undefined, pids, headless, account: minted ? { email: minted.email, plan: minted.plan } : undefined, startedAt: new Date().toISOString() };
  writeFileSync(POINTER, JSON.stringify(run, null, 1));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (!Object.values(pids).every(alive)) break;
    try { if ((await fetch(`http://127.0.0.1:${ctlPort}/health`)).ok) break; } catch {}
    await Bun.sleep(300);
  }
  const ready = await fetch(`http://127.0.0.1:${ctlPort}/health`).then((r) => r.ok).catch(() => false);
  console.log(JSON.stringify({ ...run, ready, log: path.join(RUN_DIR, "host.log") }, null, 1));
}

async function evaluate(body: string) {
  const run = readRun();
  const response = await fetch(`http://127.0.0.1:${run.ctlPort}/eval`, { method: "POST", body });
  console.log(JSON.stringify(await response.json(), null, 1));
}

async function shot(file: string) {
  const run = readRun();
  if (MAC || WIN) {
    const target = path.resolve(file);
    const response = await fetch(`http://127.0.0.1:${run.ctlPort}/control/screenshot?path=${encodeURIComponent(target)}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`screenshot failed: ${response.status} ${await response.text()}`);
    console.log(target);
    return;
  }
  const r = spawnSync("import", ["-window", "root", file], { env: { ...process.env, DISPLAY: ownDisplay(run) }, stdio: "inherit" });
  if (r.status !== 0) throw new Error("screenshot failed");
  console.log(file);
}

/** Every live process under `root`, from `ps` (pid → command); all were started by this run. */
const descendants = (root: number) => {
  const ps = WIN
    ? spawnSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }"], { encoding: "utf8" })
    : spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  const children = new Map<number, number[]>();
  for (const line of ps.stdout.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && ppid) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const out: number[] = [];
  const walk = (pid: number) => { for (const c of children.get(pid) ?? []) { out.push(c); walk(c); } };
  walk(root);
  return out;
};

async function stop() {
  if (!existsSync(POINTER)) { console.log("no run"); return; }
  const run = readRun();
  const app = run.pids.host ?? run.pids.engine;
  const marker: Record<string, string | undefined> = { host: "host/services/headless.ts", engine: ENGINE, xvfb: run.display };
  const ours = (name: string, pid: number) => alive(pid) && !!marker[name] && cmdline(pid).join(" ").includes(marker[name]!);
  const tree = app && ours(run.pids.host ? "host" : "engine", app) ? descendants(app) : [];
  const quitAt = Date.now();
  if (app && alive(app)) {
    await fetch(`http://127.0.0.1:${run.ctlPort}/eval`, { method: "POST", body: "setTimeout(() => electron.app.quit(), 10); return true;" }).catch(() => {});
    for (let i = 0; i < 80 && alive(app); i++) await Bun.sleep(100);
  }
  const appExitMs = app && !alive(app) ? Date.now() - quitAt : null;
  for (let i = 0; i < 30 && tree.some(alive); i++) await Bun.sleep(100);
  const lingering = tree.filter(alive).map((pid) => ({ pid, command: cmdline(pid).slice(0, 3).join(" ") }));
  const signal = (sig: NodeJS.Signals) => {
    for (const name of ["host", "engine", "xvfb"]) {
      const pid = run.pids[name];
      if (!pid || !ours(name, pid)) continue;
      try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch {} }
    }
    for (const pid of tree) if (alive(pid)) { try { process.kill(pid, sig); } catch {} }
  };
  const pids = [...Object.entries(run.pids).filter(([name, pid]) => ours(name, pid)).map(([, pid]) => pid), ...tree.filter(alive)];
  signal("SIGTERM");
  for (let i = 0; i < 50 && pids.some(alive); i++) await Bun.sleep(100);
  if (pids.some(alive)) signal("SIGKILL");
  for (let i = 0; i < 20 && pids.some(alive); i++) await Bun.sleep(100);
  releaseSlot(run.slot);
  if (pids.some(alive)) throw new Error(`Run ${runName} did not stop: ${pids.filter(alive).join(", ")}`);
  rmSync(POINTER, { force: true });
  console.log(JSON.stringify({ stopped: run.pids, appExitMs, lingeringAfterQuit: lingering }));
}

const [command, ...rest] = args;
if (command === "start") await start();
else if (command === "eval") await evaluate(rest.join(" "));
else if (command === "shot") await shot(rest[0] ?? path.join(RUN_DIR, "shot.png"));
else if (command === "stop") await stop();
else if (command === "dir") console.log(RUN_DIR);
else { console.error("usage: session.ts start|eval|shot|stop|dir"); process.exit(2); }
