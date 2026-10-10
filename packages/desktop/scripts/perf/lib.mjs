import { spawn, execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const skillRoot = path.join(repoRoot, ".agents/skills/verify-stella");
const POINTER = path.join(skillRoot, ".run/current.json");

export const parseArgs = (argv, defaults) => {
  const options = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) options[key] = true;
    else {
      options[key] = typeof defaults[key] === "number" ? Number(next) : next;
      i += 1;
    }
  }
  return options;
};

export const readRun = () => {
  if (!existsSync(POINTER)) {
    throw new Error(
      "No harness run. Launch one first: node .agents/skills/verify-stella/control-stella.mjs session launch --account pro",
    );
  }
  return JSON.parse(readFileSync(POINTER, "utf8"));
};

const writeRun = (run) => {
  writeFileSync(POINTER, `${JSON.stringify(run, null, 2)}\n`);
  writeFileSync(path.join(run.runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
};

const SYSTEM_ENV = ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "XDG_RUNTIME_DIR"];

const electronEnv = (run, mode) => ({
  ...Object.fromEntries(SYSTEM_ENV.filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
  ...run.providerHomes,
  STELLA_SKIP_BROWSER_HYDRATE: "1",
  STELLA_DATA_DIR: run.dataDir,
  STELLA_V2_DEV_DATA_DIR: run.dataDir,
  STELLA_DEV_HARNESS: "1",
  STELLA_DEV_HARNESS_STORAGE_KEY: readFileSync(path.join(run.runDir, "protected-storage.key"), "utf8").trim(),
  STELLA_V2_DEV_USER_DATA_DIR: run.userDataDir,
  STELLA_RUNTIME_IPC_DIR: path.dirname(run.userDataDir),
  STELLA_REMOTE_DEBUG_PORT: String(run.cdpPort),
  STELLA_RENDERER_MODE: mode,
  NODE_ENV: "development",
});

const isAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const ownedPids = (run) => {
  let out = "";
  try {
    out = execFileSync("pgrep", ["-f", `stella-verify-${run.runId}`], { encoding: "utf8" });
  } catch {
    return [];
  }
  return out
    .split("\n")
    .map(Number)
    .filter((pid) => pid > 0 && pid !== process.pid);
};

export const stopElectron = async (run) => {
  for (const pid of [run.electronPid, ...ownedPids(run)].filter(isAlive)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && [run.electronPid, ...ownedPids(run)].some(isAlive)) await delay(50);
  for (const pid of [run.electronPid, ...ownedPids(run)].filter(isAlive)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  await delay(200);
};

export const spawnElectron = (run, { mode = "production", extraArgs = [] } = {}) => {
  const require = createRequire(path.join(repoRoot, "package.json"));
  const logPath = path.join(run.runDir, "perf-electron.log");
  mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = openSync(logPath, "a");
  const args = [];
  if (process.platform === "linux") args.push("--no-sandbox", "--disable-dev-shm-usage");
  args.push("--remote-allow-origins=*", ...extraArgs, repoRoot, "--dev");
  const startedAt = Date.now();
  const child = spawn(require("electron"), args, {
    cwd: repoRoot,
    env: electronEnv(run, mode),
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  child.unref();
  run.electronPid = child.pid;
  writeRun(run);
  return { child, startedAt, logPath };
};

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 1024 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async evaluate(expression, sessionId) {
    const result = await this.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }
  close() {
    this.ws.close();
  }
}

export const browserWsUrl = async (port, timeoutMs = 60000, intervalMs = 5) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {}
    await delay(intervalMs);
  }
  throw new Error("CDP did not come up");
};

export const attachShell = async (port, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const target = (await response.json()).find(
        (entry) => entry.type === "page" && entry.url.includes("index.html?window=full"),
      );
      if (target) return { cdp: await Cdp.connect(target.webSocketDebuggerUrl), target };
    } catch {}
    await delay(100);
  }
  throw new Error("Shell page target not found");
};

export const stats = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const sd = Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length);
  const round = (value) => Math.round(value * 10) / 10;
  return {
    n: sorted.length,
    median: round(at(0.5)),
    p75: round(at(0.75)),
    min: round(sorted[0]),
    max: round(sorted.at(-1)),
    sd: round(sd),
  };
};

export const writeResult = (file, result) => {
  if (!file) return;
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
};
