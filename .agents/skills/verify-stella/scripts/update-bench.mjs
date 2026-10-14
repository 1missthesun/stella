#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  closeSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const RUN_NAME = "update-bench";
const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const benchDir = path.resolve(option("dir", path.join(os.homedir(), ".stella", "tmp", "update-bench")));
const appDir = path.join(benchDir, "app");
const resultsFile = path.resolve(
  option("results", path.join(os.homedir(), ".stella", "outputs", "update-bench", "results.jsonl")),
);
const skillCli = path.join(appDir, ".agents", "skills", "verify-stella", "control-stella.mjs");
const pointerFile = path.join(appDir, ".agents", "skills", "verify-stella", ".run", `current-${RUN_NAME}.json`);
const bun = process.env.STELLA_BUN_PATH?.trim() || "bun";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const git = (cwd, gitArgs, input) =>
  execFileSync("git", gitArgs, { cwd, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 }).trim();
const USAGE = `update-bench: how long Update takes until Stella is back and usable, on an isolated sandbox clone.

  setup                     clone this checkout's HEAD into the sandbox and install
  sync [--ref r]            move the sandbox to this checkout's HEAD or r (reinstalls on a lock change)
  launch [--mode m]         start the sandbox's Stella (m: production | development renderer)
  run --variation v [--iterations n] [--label l]
                            v: renderer | main | runtime | deps | stale | undo
  report [--label l]        medians per label and variation
  stop                      stop the sandbox's Stella

Results append to ~/.stella/outputs/update-bench/results.jsonl.`;
const log = (message) => process.stderr.write(`[update-bench] ${message}\n`);

const install = () => {
  const started = Date.now();
  const result = spawnSync(bun, ["install", "--frozen-lockfile"], { cwd: appDir, stdio: "ignore" });
  if (result.status !== 0) throw new Error("bun install failed in the sandbox");
  log(`installed in ${Date.now() - started}ms`);
};

const setup = () => {
  mkdirSync(benchDir, { recursive: true });
  if (!existsSync(appDir)) {
    git(benchDir, ["clone", "--quiet", "--shared", repoRoot, appDir]);
  }
  sync();
};

const sync = () => {
  const sha = git(repoRoot, ["rev-parse", option("ref", "HEAD")]);
  const lockBefore = existsSync(path.join(appDir, "bun.lock"))
    ? readFileSync(path.join(appDir, "bun.lock"), "utf8")
    : "";
  git(appDir, ["fetch", "--quiet", repoRoot, sha]);
  git(appDir, ["checkout", "--quiet", "-B", "master", sha]);
  git(appDir, ["reset", "--quiet", "--hard", sha]);
  for (const ref of git(appDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/draft/"]).split("\n")) {
    if (ref) git(appDir, ["branch", "-D", ref]);
  }
  const lockAfter = readFileSync(path.join(appDir, "bun.lock"), "utf8");
  if (lockBefore !== lockAfter || !existsSync(path.join(appDir, "node_modules"))) install();
  log(`sandbox at ${sha.slice(0, 12)}`);
};

const readRun = () => JSON.parse(readFileSync(pointerFile, "utf8"));

const harness = (harnessArgs, extraEnv = {}) => {
  const result = spawnSync(process.execPath, [skillCli, ...harnessArgs], {
    cwd: appDir,
    env: { ...process.env, STELLA_VERIFY_RUN: RUN_NAME, ...extraEnv },
    encoding: "utf8",
    timeout: 300_000,
  });
  const out = (result.stdout || "").trim().split("\n").at(-1) || "";
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`harness ${harnessArgs.join(" ")} failed: ${result.stderr?.slice(-2000)}`);
  }
};

const runElectronPids = (run) => {
  if (process.platform !== "linux") return run.electronPid ? [run.electronPid] : [];
  const pids = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      if (cmdline.includes("--type=")) continue;
      const environ = readFileSync(`/proc/${entry}/environ`, "utf8");
      if (environ.includes(`STELLA_V2_DEV_USER_DATA_DIR=${run.userDataDir}\0`)) pids.push(Number(entry));
    } catch {
      // Gone, or not ours.
    }
  }
  return pids;
};

const runMainPid = async (run) => {
  try {
    const version = await fetch(`http://127.0.0.1:${run.cdpPort}/json/version`, {
      signal: AbortSignal.timeout(2000),
    }).then((response) => response.json());
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    const info = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out")), 2000);
      ws.addEventListener("error", reject, { once: true });
      ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method: "SystemInfo.getProcessInfo" })), { once: true });
      ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
        resolve(message.result);
      });
    }).finally(() => ws.close());
    return info?.processInfo?.find((entry) => entry.type === "browser")?.id;
  } catch {
    return process.platform === "linux" ? undefined : run.electronPid;
  }
};

const stop = async () => {
  if (!existsSync(pointerFile)) return;
  const run = readRun();
  for (const pid of new Set([...runElectronPids(run), await runMainPid(run)].filter(Boolean))) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  harness(["cleanup", "apply"]);
};

const launch = async () => {
  const mode = option("mode", "production");
  if (existsSync(pointerFile)) await stop();
  const result = harness(["session", "launch", "--replace", "--account", "signed-in"], {
    STELLA_RENDERER_MODE: mode,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const run = readRun();
  run.benchMode = mode;
  run.benchSha = git(appDir, ["rev-parse", "HEAD"]);
  writeFileSync(pointerFile, JSON.stringify(run, null, 2));
  log(`launched (${mode} renderer) on CDP ${run.cdpPort}`);
  await waitForLive(run, Date.now() + 60_000);
  const label = option("label");
  if (!label) return;
  const tail = new LogTail(run);
  tail.offset = 0;
  const startupDeadline = Date.now() + 10_000;
  await tail.waitFor("startup.first-app-paint", startupDeadline);
  const starting = tail.find("main.starting");
  const elapsed = (event) => tail.find(event)?.fields.elapsedMs;
  const ready = tail.find("renderer.source", (entry) => /modules ready/.test(entry.fields.message ?? ""));
  const record = {
    label,
    sha: run.benchSha,
    at: new Date().toISOString(),
    variation: "launch",
    mode,
    startup: {
      mainStartingMs: starting?.fields.startupMs,
      windowCreatedMs: elapsed("startup.window-created"),
      sourceReadyMs: ready && starting ? Math.round(ready.at - (starting.at - starting.fields.startupMs)) : undefined,
      firstPaintMs: elapsed("startup.first-paint"),
      firstAppPaintMs: elapsed("startup.first-app-paint"),
      hostReadyMs: elapsed("startup.host-runner.ready"),
    },
  };
  mkdirSync(path.dirname(resultsFile), { recursive: true });
  appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
  console.log(JSON.stringify(record));
};

const TICK_MS = 1000 / 100;

const procStat = (pid) => {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    return text.slice(text.lastIndexOf(")") + 2).split(" ");
  } catch {
    return null;
  }
};

const rssKb = (pid) => {
  try {
    return Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0);
  } catch {
    return 0;
  }
};

class ResourceSampler {
  constructor(mainPid) {
    this.mainPid = mainPid;
    this.enabled = process.platform === "linux" && Boolean(mainPid);
    if (!this.enabled) return;
    this.baseline = new Set(this.descendants());
    this.startCpu = this.cpuTicks();
    this.lastCpu = this.startCpu;
    this.mainRssStart = rssKb(mainPid);
    this.peakKb = 0;
    this.peakMainKb = this.mainRssStart;
    this.timer = setInterval(() => this.sample(), 20);
  }
  descendants() {
    const children = new Map();
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const stat = procStat(entry);
      if (!stat) continue;
      const ppid = Number(stat[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(entry));
    }
    const found = [];
    const pending = [...(children.get(this.mainPid) ?? [])];
    while (pending.length > 0) {
      const pid = pending.pop();
      found.push(pid);
      pending.push(...(children.get(pid) ?? []));
    }
    return found;
  }
  cpuTicks() {
    const stat = procStat(this.mainPid);
    if (!stat) return null;
    return Number(stat[11]) + Number(stat[12]) + Number(stat[13]) + Number(stat[14]);
  }
  sample() {
    const cpu = this.cpuTicks();
    if (cpu !== null) this.lastCpu = cpu;
    let kb = 0;
    for (const pid of this.descendants()) if (!this.baseline.has(pid)) kb += rssKb(pid);
    this.peakKb = Math.max(this.peakKb, kb);
    this.peakMainKb = Math.max(this.peakMainKb, rssKb(this.mainPid));
  }
  stop() {
    if (!this.enabled) return undefined;
    clearInterval(this.timer);
    this.sample();
    return {
      peakWorkMb: Math.round(this.peakKb / 1024),
      mainGrowthMb: Math.round((this.peakMainKb - this.mainRssStart) / 1024),
      cpuMs: Math.round((this.lastCpu - this.startCpu) * TICK_MS),
    };
  }
}

const fullPage = async (port) => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
  return list.find((target) => target.type === "page" && target.url.includes("window=full")) ?? null;
};

let socket = null;
let socketTarget = null;
let nextId = 1;
const evaluate = async (port, expression, timeoutMs = 2000) => {
  const page = await fullPage(port);
  if (!page) throw new Error("no full window");
  if (!socket || socketTarget !== page.webSocketDebuggerUrl || socket.readyState !== WebSocket.OPEN) {
    socket?.close();
    socket = new WebSocket(page.webSocketDebuggerUrl);
    socketTarget = page.webSocketDebuggerUrl;
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
  }
  const id = nextId++;
  const ws = socket;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error("evaluate timed out"));
    }, timeoutMs);
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text));
      else resolve(message.result?.result?.value);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
};
const tryEvaluate = (port, expression) => evaluate(port, expression).catch(() => undefined);

const LIVE = `document.readyState === "complete" && !document.getElementById("stella-launch") && Boolean(document.querySelector(".shell-topbar-full"))`;
const HOST = `(async () => { try { const id = await window.electronAPI.system.getDeviceId(); const catalog = await window.electronAPI.system.listLlmModels(); return Boolean(id) && Boolean(catalog) && typeof catalog === "object"; } catch { return false; } })()`;

const waitForLive = async (run, deadline) => {
  while (Date.now() < deadline) {
    if (await tryEvaluate(run.cdpPort, LIVE)) return Date.now();
    await sleep(25);
  }
  throw new Error("window never became live");
};

const processLog = (run) => {
  const root = path.join(run.dataDir, "logs");
  let newest = null;
  for (const dir of existsSync(root) ? readdirSync(root) : []) {
    for (const name of readdirSync(path.join(root, dir))) {
      if (!name.startsWith("process-")) continue;
      const file = path.join(root, dir, name);
      const mtime = statSync(file).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { file, mtime };
    }
  }
  return newest?.file ?? null;
};

const parseLine = (line) => {
  const match = /^(\S+) \[\w+\] \[(\w+)\] event=(\S+)(.*)$/.exec(line);
  if (!match) return null;
  const fields = {};
  for (const field of match[4].matchAll(/([\w.-]+)=("(?:[^"\\]|\\.)*"|\S+)/g)) {
    const raw = field[2];
    fields[field[1]] = raw.startsWith('"') ? JSON.parse(raw) : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  }
  return { at: Date.parse(match[1]), source: match[2], event: match[3], fields };
};

class LogTail {
  constructor(run) {
    this.run = run;
    this.file = processLog(run);
    this.offset = this.file ? statSync(this.file).size : 0;
    this.events = [];
  }
  poll() {
    const file = processLog(this.run);
    if (!file) return;
    if (file !== this.file) {
      this.file = file;
      this.offset = 0;
    }
    const size = statSync(file).size;
    if (size <= this.offset) return;
    const fd = openSync(file, "r");
    const buffer = Buffer.alloc(size - this.offset);
    readSync(fd, buffer, 0, buffer.length, this.offset);
    closeSync(fd);
    this.offset = size;
    for (const line of buffer.toString("utf8").split("\n")) {
      const parsed = parseLine(line);
      if (parsed) this.events.push(parsed);
    }
  }
  find(event, predicate = () => true) {
    return this.events.find((entry) => entry.event === event && predicate(entry)) ?? null;
  }
  async waitFor(event, deadline, predicate) {
    while (Date.now() < deadline) {
      this.poll();
      const found = this.find(event, predicate);
      if (found) return found;
      await sleep(25);
    }
    return null;
  }
}

const TOPBAR = "packages/desktop-ui/src/shell/ShellTopBarFull.tsx";
const TOPBAR_ANCHOR = `<div className="shell-topbar-full__spacer" aria-hidden="true" />`;
const NAV = "packages/desktop-ui/src/shell/ShellTopBarActivity.tsx";
const NAV_ANCHOR = `<div className="shell-topbar-activity" data-busy={busy ? "true" : "false"}>`;
const MAIN = "packages/desktop/electron/main.ts";
const RUNTIME = "packages/runtime/worker/entry.ts";
const DEP_PACKAGE = "packages/contracts/package.json";

const show = (cwd, rev, file) => git(cwd, ["show", `${rev}:${file}`]);

const markUi = (source, anchor, attribute, nonce) => {
  const marker = new RegExp(`\\s*<span ${attribute}="[^"]*">[^<]*</span>`, "g");
  const clean = source.replace(marker, "");
  if (!clean.includes(anchor)) throw new Error(`anchor not found: ${anchor}`);
  return clean.replace(anchor, `${anchor}\n      <span ${attribute}="${nonce}">${nonce}</span>`);
};

const markCode = (source, nonce) =>
  `${source.replace(/\n\/\/ update-bench [^\n]*\n.*$/s, "\n")}\n// update-bench ${nonce}\nexport const __updateBench = "${nonce}";\n`;

const toggleDependency = (head) => {
  const lockgen = path.join(benchDir, "lockgen");
  if (!existsSync(lockgen)) git(appDir, ["worktree", "add", "--quiet", "--detach", lockgen, head]);
  git(lockgen, ["checkout", "--quiet", "--detach", "--force", head]);
  const pkg = JSON.parse(readFileSync(path.join(lockgen, DEP_PACKAGE), "utf8"));
  const adding = !pkg.dependencies?.ms;
  if (adding) pkg.dependencies = { ...(pkg.dependencies ?? {}), ms: "2.1.3" };
  else delete pkg.dependencies.ms;
  if (pkg.dependencies && Object.keys(pkg.dependencies).length === 0) delete pkg.dependencies;
  writeFileSync(path.join(lockgen, DEP_PACKAGE), `${JSON.stringify(pkg, null, 2)}\n`);
  const result = spawnSync(bun, ["install", "--lockfile-only"], { cwd: lockgen, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`lockfile generation failed: ${result.stderr}`);
  const files = {
    [DEP_PACKAGE]: readFileSync(path.join(lockgen, DEP_PACKAGE), "utf8"),
    "bun.lock": readFileSync(path.join(lockgen, "bun.lock"), "utf8"),
  };
  git(lockgen, ["checkout", "--quiet", "--force", head]);
  return { files, note: adding ? "add ms" : "remove ms" };
};

const commitOnto = (base, files, message) => {
  const index = path.join(benchDir, `index-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const run = (gitArgs, input) =>
    execFileSync("git", gitArgs, { cwd: appDir, env, encoding: "utf8", input }).trim();
  run(["read-tree", base]);
  for (const [file, content] of Object.entries(files)) {
    const blob = run(["hash-object", "-w", "--stdin"], content);
    run(["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`]);
  }
  const tree = run(["write-tree"]);
  return execFileSync(
    "git",
    ["-c", "user.name=Update Bench", "-c", "user.email=bench@localhost", "commit-tree", tree, "-p", base, "-m", message],
    { cwd: appDir, encoding: "utf8" },
  ).trim();
};

const prepareChange = (variation, nonce) => {
  const head = git(appDir, ["rev-parse", "HEAD"]);
  switch (variation) {
    case "renderer":
      return { base: head, files: { [TOPBAR]: markUi(show(appDir, head, TOPBAR), TOPBAR_ANCHOR, "data-update-bench", nonce) } };
    case "stale": {
      const parents = git(appDir, ["rev-list", "--parents", "-n1", head]).split(" ").slice(1);
      const base = parents.length > 1 ? parents[1] : parents[0];
      if (git(appDir, ["diff", "--name-only", base, head]).split("\n").includes(NAV)) {
        throw new Error("the last change touched the stale variation's file; run another variation first");
      }
      return { base, files: { [NAV]: markUi(show(appDir, base, NAV), NAV_ANCHOR, "data-update-bench-stale", nonce) } };
    }
    case "main":
      return { base: head, files: { [MAIN]: markCode(show(appDir, head, MAIN), nonce) } };
    case "runtime":
      return { base: head, files: { [RUNTIME]: markCode(show(appDir, head, RUNTIME), nonce) } };
    case "deps": {
      const { files, note } = toggleDependency(head);
      return { base: head, files, note };
    }
    default:
      throw new Error(`unknown variation ${variation}`);
  }
};

const KIND = {
  renderer: "renderer",
  stale: "renderer",
  undo: "renderer",
  main: "relaunch",
  deps: "relaunch",
  runtime: "runtime",
};

const steps = (line) =>
  Object.fromEntries(
    (line ?? "")
      .split(" | ")
      .filter(Boolean)
      .map((step) => {
        const space = step.lastIndexOf(" ");
        return [step.slice(0, space), Number(step.slice(space + 1))];
      }),
  );

let pendingPrepare = null;

const iterate = async (variation) => {
  let run = readRun();
  const nonce = `b${Date.now().toString(36)}`;
  let action;
  let markerSelector = null;
  if (variation === "undo") {
    const sha = git(appDir, ["log", "-1", "--format=%H", "--first-parent", "--", TOPBAR]);
    action = `window.electronAPI.appSource.undo(${JSON.stringify(sha)})`;
    const previous = git(appDir, ["show", `${sha}^:${TOPBAR}`]).match(/data-update-bench="([^"]+)"/)?.[1];
    markerSelector = previous ? `[data-update-bench="${previous}"]` : `.shell-topbar-full:not(:has([data-update-bench]))`;
  } else {
    const change = prepareChange(variation, nonce);
    const name = `bench-${variation}-${nonce}`;
    const commit = commitOnto(change.base, change.files, `Update bench: ${variation} ${nonce}${change.note ? ` (${change.note})` : ""}`);
    const prepareTail = new LogTail(run);
    const prepareResources = new ResourceSampler(await runMainPid(run));
    const createdAt = Date.now();
    git(appDir, ["branch", "--force", `draft/${name}`, commit]);
    const offeredBy = Date.now() + 180_000;
    let offeredAt = null;
    while (Date.now() < offeredBy) {
      const ready = await tryEvaluate(
        run.cdpPort,
        `window.electronAPI.appSource.getState().then((state) => [...(state?.ready ?? []), ...(state?.stale ?? [])].some((draft) => draft.name === ${JSON.stringify(name)}))`,
      );
      if (ready) {
        offeredAt = Date.now();
        break;
      }
      await sleep(100);
    }
    prepareTail.poll();
    const prepared = prepareTail.find("app-source.prepared");
    pendingPrepare = {
      offerMs: offeredAt ? offeredAt - createdAt : undefined,
      prepareMs: prepared?.fields.ms,
      gate: prepared?.fields.gate,
      bundles: prepared?.fields.bundles,
      resources: prepareResources.stop(),
    };
    await sleep(1000);
    action = `window.electronAPI.appSource.apply(${JSON.stringify(name)})`;
    if (variation === "renderer") markerSelector = `[data-update-bench="${nonce}"]`;
    if (variation === "stale") markerSelector = `[data-update-bench-stale="${nonce}"]`;
  }
  const kind = KIND[variation];
  const tail = new LogTail(run);
  const oldPids = new Set(runElectronPids(run));
  const clickResources = new ResourceSampler(await runMainPid(run));
  const t0 = Date.now();
  await evaluate(run.cdpPort, `(${action}.then((result) => { window.__benchResult = result; }), true)`);
  const deadline = t0 + 120_000;
  const record = { at: new Date(t0).toISOString(), variation, mode: run.benchMode ?? "development", nonce };
  if (pendingPrepare) record.prepare = pendingPrepare;
  pendingPrepare = null;
  const clickDone = tail.waitFor("app-source.timing", deadline).then(() => {
    record.clickResources = clickResources.stop();
  });

  if (kind === "renderer") {
    let visibleAt = null;
    while (Date.now() < deadline && !visibleAt) {
      if (await tryEvaluate(run.cdpPort, `Boolean(document.querySelector(${JSON.stringify(markerSelector)})) && (${LIVE})`)) {
        visibleAt = Date.now();
      } else await sleep(10);
    }
    const timing = await tail.waitFor("app-source.timing", deadline);
    if (!visibleAt || !timing) throw new Error("the change never showed");
    tail.poll();
    const transition = tail.find("app-source.transition");
    const failed = tail.find("app-source.action-failed");
    if (failed) throw new Error(`apply failed: ${failed.fields.message}`);
    const appPaint = tail.find("renderer.app-paint", (entry) => entry.fields.url === "index.html");
    if (appPaint) record.appPaint = { clickMs: appPaint.at - t0, navMs: appPaint.fields.navMs };
    record.visibleMs = visibleAt - t0;
    record.doneMs = Math.max(visibleAt, timing.at) - t0;
    record.steps = steps(timing.fields.steps);
    record.gateMs = tail.find("app-source.update-gate")?.fields.ms;
    if (transition) {
      record.transition = Object.fromEntries(
        ["coverMs", "swapMs", "paintMs", "compareMs", "prepMs", "totalMs"].map((key) => [key, transition.fields[key]]),
      );
    }
  } else if (kind === "runtime") {
    const timing = await tail.waitFor("app-source.timing", deadline);
    const ready = await tail.waitFor("worker.ready.timing", deadline);
    if (!timing || !ready) throw new Error("the runtime never came back");
    let hostAt = null;
    while (Date.now() < deadline && !hostAt) {
      if (await tryEvaluate(run.cdpPort, HOST)) hostAt = Date.now();
      else await sleep(25);
    }
    const restart = tail.find("host.runtime-restart");
    const shutdown = tail.find("worker.shutdown");
    const starting = tail.find("worker.starting");
    record.doneMs = Math.max(ready.at, hostAt ?? 0) - t0;
    record.steps = steps(timing.fields.steps);
    record.runtime = {
      applyMs: timing.at - t0,
      requestToRestartMs: restart ? restart.at - timing.at : undefined,
      shutdownMs: shutdown && starting ? starting.at - shutdown.at : undefined,
      startMs: starting ? ready.at - starting.at : undefined,
    };
  } else {
    const timing = await tail.waitFor("app-source.timing", deadline);
    if (!timing) throw new Error("the update never reached relaunch");
    const quit = await tail.waitFor("main.quit", deadline);
    const starting = await tail.waitFor("main.starting", deadline, (entry) => !oldPids.has(entry.fields.pid));
    if (!quit || !starting) throw new Error("Stella never came back");
    const liveAt = await waitForLive(run, deadline);
    let hostAt = null;
    while (Date.now() < deadline && !hostAt) {
      if (await tryEvaluate(run.cdpPort, HOST)) hostAt = Date.now();
      else await sleep(25);
    }
    const transition = await tail.waitFor("app-source.relaunch-transition", Math.min(deadline, Date.now() + 15_000));
    tail.poll();
    const processStart = starting.at - starting.fields.startupMs;
    const firstPaint = tail.find("startup.first-paint", (entry) => entry.at > starting.at);
    const firstAppPaint = await tail.waitFor("startup.first-app-paint", Math.min(deadline, Date.now() + 5_000), (entry) => entry.at > starting.at);
    const hostReady = tail.find("startup.host-runner.ready", (entry) => entry.at > starting.at);
    const shown = tail.find("startup.window-shown", (entry) => entry.at > starting.at);
    const resumeHold = tail.find("app-source.resume-hold", (entry) => entry.at > starting.at);
    const quitElapsed = tail.find("main.quit-cleanup-elapsed");
    const phases = tail.events.filter((entry) => entry.event === "main.quit-phase");
    record.liveMs = liveAt - t0;
    record.doneMs = Math.max(liveAt, hostAt ?? 0, transition?.at ?? 0) - t0;
    record.steps = steps(timing.fields.steps);
    record.relaunch = {
      applyMs: timing.at - t0,
      quitMs: quitElapsed?.fields.elapsedMs,
      quitCleanups: phases.map((entry) => `${entry.fields.phase}: ${entry.fields.cleanups}`).join(" / "),
      exitToSpawnMs: Math.round(processStart - quit.at),
      spawnToMainMs: starting.fields.startupMs,
      firstPaintMs: firstPaint ? firstPaint.at - processStart : undefined,
      firstAppPaintMs: firstAppPaint?.fields.elapsedMs,
      hostReadyMs: hostReady ? hostReady.at - processStart : undefined,
      liveMs: liveAt - processStart,
      transitionDoneMs: transition ? transition.at - processStart : undefined,
      windowShownMs: shown ? shown.at - processStart : undefined,
      shownWith: shown?.fields.shownWith,
      resumeHold: resumeHold ? `attach ${resumeHold.fields.attachMs} hold ${resumeHold.fields.holdMs}` : undefined,
    };
    const pid = starting.fields.pid;
    run = { ...readRun(), electronPid: pid };
    writeFileSync(pointerFile, JSON.stringify(run, null, 2));
    if (variation === "main") {
      const bundle = readFileSync(path.join(appDir, "packages/desktop/dist-electron/electron/main.js"), "utf8");
      if (!bundle.includes(nonce)) throw new Error("the relaunched main does not hold the change");
    }
  }
  tail.poll();
  const readiness = tail.events.filter((entry) => entry.event === "renderer.cloud_readiness");
  if (readiness.length > 0) {
    record.readiness = Object.fromEntries(readiness.map((entry) => [entry.fields.phase, entry.fields.elapsedMs]));
  }
  await clickDone;
  return record;
};

const runBench = async () => {
  const variation = option("variation");
  if (!variation || !KIND[variation]) throw new Error("--variation renderer|main|runtime|deps|stale|undo");
  const iterations = Number(option("iterations", "3"));
  const label = option("label", git(repoRoot, ["rev-parse", "--short=12", "HEAD"]));
  mkdirSync(path.dirname(resultsFile), { recursive: true });
  for (let i = 0; i < iterations; i += 1) {
    // Let the previous swap, focus-in and background refresh settle. A
    // runtime restarted seconds after the last one is still starting up and
    // stops slower than any the user would see, so that one waits longer.
    await sleep(Number(option("settle", variation === "runtime" ? "12000" : "3000")));
    const record = { label, sha: readRun().benchSha ?? null, ...(await iterate(variation)), iteration: i };
    appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
    console.log(JSON.stringify(record));
  }
};

const median = (values) => {
  const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const report = () => {
  const only = option("label");
  const rows = readFileSync(resultsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => !only || row.label === only);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.label}\t${row.variation}\t${row.mode}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const [key, group] of groups) {
    const flat = (row) => ({
      doneMs: row.doneMs,
      visibleMs: row.visibleMs,
      liveMs: row.liveMs,
      ...Object.fromEntries(Object.entries(row.steps ?? {}).map(([k, v]) => [`step.${k}`, v])),
      ...Object.fromEntries(Object.entries(row.transition ?? {}).map(([k, v]) => [`transition.${k}`, v])),
      ...Object.fromEntries(
        Object.entries(row.relaunch ?? {}).filter(([, v]) => typeof v === "number").map(([k, v]) => [`relaunch.${k}`, v]),
      ),
      ...Object.fromEntries(Object.entries(row.runtime ?? {}).map(([k, v]) => [`runtime.${k}`, v])),
      ...Object.fromEntries(Object.entries(row.appPaint ?? {}).map(([k, v]) => [`appPaint.${k}`, v])),
      ...Object.fromEntries(Object.entries(row.startup ?? {}).map(([k, v]) => [`startup.${k}`, v])),
      gateMs: row.gateMs,
    });
    const flats = group.map(flat);
    const keys = [...new Set(flats.flatMap((entry) => Object.keys(entry)))];
    const medians = Object.fromEntries(keys.map((k) => [k, median(flats.map((entry) => entry[k]))]).filter(([, v]) => v !== undefined));
    console.log(`${key}\tn=${group.length}\t${JSON.stringify(medians)}`);
  }
};

try {
  if (command === "setup") setup();
  else if (command === "sync") sync();
  else if (command === "launch") await launch();
  else if (command === "run") await runBench();
  else if (command === "report") report();
  else if (command === "stop") await stop();
  else {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }
  socket?.close();
  process.exit(0);
} catch (error) {
  log(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
