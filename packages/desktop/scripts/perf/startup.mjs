import { setTimeout as delay } from "node:timers/promises";
import { browserWsUrl, Cdp, parseArgs, readRun, spawnElectron, stats, stopElectron, writeResult } from "./lib.mjs";

const options = parseArgs(process.argv.slice(2), { runs: 7, warmup: 1, mode: "production", out: "", settle: 3000 });

const PROBE = String.raw`(() => {
  if (!location.href.includes("window=full")) return;
  const perf = (window.__stellaPerf = { marks: {}, longTasks: [] });
  const mark = (name) => {
    if (!(name in perf.marks)) perf.marks[name] = performance.now();
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) perf.longTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  const tick = () => {
    if (document.querySelector(".shell-topbar-full")) mark("shell");
    const field = document.querySelector("textarea.chat-composer-textarea");
    if (field && !field.disabled && field.offsetParent !== null) mark("composer");
    const splash = document.getElementById("stella-launch");
    if (!splash || splash.dataset.exiting === "true") mark("splashExit");
    if ("composer" in perf.marks && "splashExit" in perf.marks) {
      mark("typeable");
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

const HOST_READY = String.raw`(async () => {
  try {
    const id = await window.electronAPI?.system?.getDeviceId?.();
    const health = await window.electronAPI?.agent?.healthCheck?.();
    return Boolean(id && health && typeof health === "object");
  } catch {
    return false;
  }
})()`;

const COLLECT = String.raw`(() => {
  const perf = window.__stellaPerf;
  const nav = performance.getEntriesByType("navigation")[0];
  const paints = Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]));
  const resources = performance.getEntriesByType("resource");
  const scripts = resources.filter((entry) => entry.initiatorType === "script" || /\.(m?[jt]sx?)(\?|$)/.test(entry.name) || entry.name.includes("/@deps/"));
  return {
    timeOrigin: performance.timeOrigin,
    marks: perf?.marks ?? null,
    longTasks: perf?.longTasks ?? [],
    domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
    load: nav?.loadEventEnd ?? null,
    firstPaint: paints["first-paint"] ?? null,
    firstContentfulPaint: paints["first-contentful-paint"] ?? null,
    resourceCount: resources.length,
    scriptCount: scripts.length,
    lastScriptEnd: scripts.reduce((max, entry) => Math.max(max, entry.responseEnd), 0),
    jsHeapUsedMb: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
  };
})()`;

const launchOnce = async (run) => {
  await stopElectron(run);
  const { startedAt } = spawnElectron(run, { mode: options.mode });
  const browser = await Cdp.connect(await browserWsUrl(run.cdpPort, 60000, 2));
  const cdpAt = Date.now();
  const pageSessions = [];
  browser.on((message) => {
    if (message.method !== "Target.attachedToTarget") return;
    const { sessionId, targetInfo, waitingForDebugger } = message.params;
    const go = async () => {
      if (targetInfo.type === "page") {
        pageSessions.push(sessionId);
        await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE }, sessionId).catch(() => {});
      }
      if (waitingForDebugger) await browser.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
    };
    void go();
  });
  const existing = (await browser.send("Target.getTargets")).targetInfos.filter((info) => info.type === "page");
  await browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const deadline = Date.now() + 90000;
  let shell = null;
  let data = null;
  while (Date.now() < deadline) {
    for (const sessionId of pageSessions) {
      const value = await browser
        .evaluate(`location.href.includes("window=full") && window.__stellaPerf ? window.__stellaPerf.marks : null`, sessionId)
        .catch(() => null);
      if (value) shell = sessionId;
      if (value?.typeable !== undefined) data = value;
    }
    if (data) break;
    await delay(50);
  }
  if (!data) throw new Error("Shell never became typeable");
  const typeableAt = Date.now();
  let hostReadyAt = null;
  while (Date.now() - typeableAt < 60000) {
    if (await browser.evaluate(HOST_READY, shell).catch(() => false)) {
      hostReadyAt = Date.now();
      break;
    }
    await delay(25);
  }
  await delay(options.settle);
  const collected = await browser.evaluate(COLLECT, shell);
  browser.close();
  const origin = collected.timeOrigin;
  const typeable = collected.marks.typeable;
  const blocking = (from, to) =>
    collected.longTasks
      .filter(([start]) => start >= from && start < to)
      .reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0);
  return {
    missedPageStart: existing.some((info) => info.url.includes("window=full")),
    spawnToCdpMs: cdpAt - startedAt,
    spawnToNavigationMs: origin - startedAt,
    navToFirstPaintMs: collected.firstPaint,
    navToDomContentLoadedMs: collected.domContentLoaded,
    navToShellMs: collected.marks.shell,
    navToComposerMs: collected.marks.composer,
    navToSplashExitMs: collected.marks.splashExit,
    navToTypeableMs: typeable,
    spawnToTypeableMs: origin + typeable - startedAt,
    spawnToHostReadyMs: hostReadyAt ? hostReadyAt - startedAt : null,
    blockingBeforeTypeableMs: blocking(0, typeable),
    blockingAfterTypeableMs: blocking(typeable, typeable + options.settle),
    longTasksAfterTypeable: collected.longTasks.filter(([start]) => start >= typeable).length,
    scriptCount: collected.scriptCount,
    resourceCount: collected.resourceCount,
    jsHeapUsedMb: collected.jsHeapUsedMb && Math.round(collected.jsHeapUsedMb),
  };
};

const run = readRun();
const samples = [];
for (let i = 0; i < options.warmup + options.runs; i += 1) {
  const sample = await launchOnce(run);
  const warm = i < options.warmup;
  process.stderr.write(
    `${warm ? "warmup" : `run ${i - options.warmup + 1}`}: typeable ${Math.round(sample.spawnToTypeableMs)}ms (main ${Math.round(sample.spawnToNavigationMs)}ms + renderer ${Math.round(sample.navToTypeableMs)}ms), host ${sample.spawnToHostReadyMs}ms, scripts ${sample.scriptCount}\n`,
  );
  if (!warm) samples.push(sample);
}
const summary = Object.fromEntries(
  Object.keys(samples[0])
    .filter((key) => typeof samples[0][key] === "number")
    .map((key) => [key, stats(samples.map((sample) => sample[key]))]),
);
const result = { mode: options.mode, runs: options.runs, at: new Date().toISOString(), summary, samples };
writeResult(options.out, result);
console.log(JSON.stringify({ mode: options.mode, summary }, null, 2));
