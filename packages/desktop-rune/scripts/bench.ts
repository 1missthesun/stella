// Full benchmark of the compiled Rune engine + TS UI host, on the real display.
// Same metric definitions as the Electron baseline: cold start, RSS/PSS, idle/active CPU,
// frame intervals, input latency, hot-swap latency.
//   bun scripts/bench.ts [out.json]
import { readFileSync, existsSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { $ } from "bun";

const root = new URL("..", import.meta.url).pathname;
const RUN = `${root}.run/bench`;
const OUT = process.argv[2] ?? `${process.env.HOME}/.stella/outputs/stella-rune-poc/rune-results.json`;
const C = "http://127.0.0.1:47833";
const HZ = 100; // CLK_TCK
const sleep = (ms: number) => Bun.sleep(ms);
const q = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.round((s.length - 1) * p)]; };
const r2 = (n: number) => Math.round(n * 100) / 100;

function metrics(): any[] {
  const f = `${RUN}/metrics.jsonl`;
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function children(pid: number): number[] {
  const out: number[] = [];
  for (const t of readdirSync(`/proc/${pid}/task`)) {
    try { out.push(...readFileSync(`/proc/${pid}/task/${t}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number)); } catch {}
  }
  return out;
}
function tree(pid: number): number[] { return [pid, ...children(pid).flatMap(tree)]; }
function cpuTicks(pid: number): number {
  const s = readFileSync(`/proc/${pid}/stat`, "utf8");
  const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
  return Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14]); // utime stime cutime cstime
}
function mem(pid: number) {
  const r = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
  const kb = (k: string) => Number(r.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? 0);
  return { rss_mb: r2(kb("Rss") / 1024), pss_mb: r2(kb("Pss") / 1024) };
}
function name(pid: number) { return readFileSync(`/proc/${pid}/comm`, "utf8").trim(); }

async function launch(): Promise<number> {
  rmSync(RUN, { recursive: true, force: true });
  await $`RUN=${RUN} ${root}scripts/launch.sh`.quiet();
  return Number(readFileSync(`${RUN}/pid`, "utf8"));
}
async function waitFirst(): Promise<any> {
  for (let i = 0; i < 300; i++) { const m = metrics().find((x) => x.metric === "first_content_frame"); if (m) return m; await sleep(10); }
  throw new Error("no first frame");
}
async function stop(pid: number) {
  const pids = tree(pid);
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100 && pids.some((p) => existsSync(`/proc/${p}`)); i++) await sleep(20);
  const left = pids.filter((p) => existsSync(`/proc/${p}`));
  if (left.length) throw new Error(`left running: ${left}`);
}
async function cpuOver(pids: number[], run: () => Promise<unknown>) {
  const t0 = performance.now(); const c0 = pids.map(cpuTicks);
  const result = await run();
  const dt = (performance.now() - t0) / 1000; const c1 = pids.map(cpuTicks);
  const per = pids.map((p, i) => ({ pid: p, name: name(p), cpu_pct_of_core: r2(((c1[i] - c0[i]) / HZ / dt) * 100) }));
  return { seconds: r2(dt), total_cpu_pct_of_core: r2(per.reduce((a, b) => a + b.cpu_pct_of_core, 0)), per, result };
}
const get = async (path: string) => (await fetch(`${C}/${path}`)).json();
const pick = (r: any) => r && { frames: r.frames, fps: r2(r.fps), interval_p50_ms: r2(r.interval_p50_ms), interval_p95_ms: r2(r.interval_p95_ms), interval_p99_ms: r2(r.interval_p99_ms), interval_max_ms: r2(r.interval_max_ms), late_frames: r.over_8_3ms, frame_cpu_p50_ms: r2(r.frame_cpu_p50_ms), frame_cpu_p95_ms: r2(r.frame_cpu_p95_ms), frame_cpu_max_ms: r2(r.frame_cpu_max_ms) };

const results: any = { when: new Date().toISOString(), machine: "omarchy: Ryzen (32 threads), RTX 5090, Hyprland 0.56, DP-1 3840x2160@240Hz scale 1.6", window: "1100x760 pt (1760x1216 px)", rune_rev: (await $`git -C ${root}vendor/rune rev-parse --short HEAD`.text()).trim() };

// 1. Cold start (warm OS file cache), 7 launches.
const starts: number[] = [];
for (let i = 0; i < 7; i++) {
  const pid = await launch();
  const m = await waitFirst();
  starts.push(m.since_spawn_ms);
  await sleep(300);
  await stop(pid);
  await sleep(400);
}
results.cold_start_ms = { runs: starts.map(r2), median: r2(q(starts, 0.5)), min: r2(Math.min(...starts)), max: r2(Math.max(...starts)), definition: "hyprctl exec issued → first frame with the TS-built UI encoded (engine on_frame_encoded)" };
console.error("cold start", results.cold_start_ms);

// 2. Steady instance.
const pid = await launch();
try {
await waitFirst();
await sleep(10_000);
const pids = tree(pid);
results.processes = pids.map((p) => ({ pid: p, name: name(p) }));
results.memory_after_10s = { per: pids.map((p) => ({ name: name(p), ...mem(p) })), total_rss_mb: r2(pids.reduce((a, p) => a + mem(p).rss_mb, 0)), total_pss_mb: r2(pids.reduce((a, p) => a + mem(p).pss_mb, 0)) };
console.error("memory", results.memory_after_10s);

// 3. Idle CPU, 30 s, window visible, no input.
results.idle_cpu_30s = await cpuOver(pids, () => sleep(30_000));
console.error("idle", results.idle_cpu_30s.total_cpu_pct_of_core);

// 4. Active: scroll glides, continuous scroll, sidebar, theme, resize.
const active: any = {};
for (const [label, path] of [["scroll_glides", "scroll?cycles=8&glide=0.6"], ["scroll_continuous_poll_stepped", "wheel?dur=6&speed=5000"], ["sidebar_toggle_x12", "sidebar?n=12"], ["theme_switch_x6", "theme?n=6"], ] as const) {
  const r = await cpuOver(pids, () => get(path));
  active[label] = { ...pick(r.result), cpu_pct_of_core: r.total_cpu_pct_of_core, seconds: r.seconds };
  console.error(label, active[label]);
  await sleep(500);
}
// Real window resize: the compositor resizes the floating window (as a corner drag does),
// as fast as hyprctl allows (~same request rate as the Electron baseline), for 3 s.
{
  let calls = 0;
  const r = await cpuOver(pids, async () => {
    await get("recstart?label=resize");
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      const k = 0.5 - 0.5 * Math.cos(((performance.now() - t0) / 1500) * Math.PI * 2);
      const w = Math.round(900 + 600 * k), h = 760;
      Bun.spawnSync(["hyprctl", "dispatch", `hl.dsp.window.resize({ x = ${w}, y = ${h}, window = "pid:${pid}" })`]);
      calls++;
    }
    await sleep(200);
    return get("recstop");
  });
  Bun.spawnSync(["hyprctl", "dispatch", `hl.dsp.window.resize({ x = 1100, y = 760, window = "pid:${pid}" })`]);
  active.window_resize_compositor = { ...pick(r.result), cpu_pct_of_core: r.total_cpu_pct_of_core, seconds: r.seconds, resize_requests_per_s: Math.round(calls / 3) };
  console.error("resize", active.window_resize_compositor);
}
results.active = active;

// 5. Input latency with real compositor key events (send_shortcut to this window only).
let mark = metrics().length;
await $`${root}scripts/keys.sh ${pid} type thequickbrownfoxjumpsoverthelazydogagain`.quiet();
await sleep(300);
const typing = metrics().slice(mark).filter((m) => m.metric === "typing").map((m) => m.input_to_frame_ms);
mark = metrics().length;
await $`${root}scripts/keys.sh ${pid} sidebar 16`.quiet();
await sleep(600);
const keys = metrics().slice(mark).filter((m) => m.event === "key");
mark = metrics().length;
await $`${root}scripts/keys.sh ${pid} enter`.quiet();
await sleep(800);
const submit = metrics().slice(mark).filter((m) => m.event === "submit");
results.input_latency = {
  definition: "OS key event taken by the window (Tx::input_time) → frame showing the result encoded",
  native_typing_into_composer: { n: typing.length, p50_ms: r2(q(typing, 0.5)), p95_ms: r2(q(typing, 0.95)), max_ms: r2(Math.max(...typing)) },
  ts_handled_shortcut_ctrl_b: { n: keys.length, p50_ms: r2(q(keys.map((k) => k.input_to_frame_ms), 0.5)), p95_ms: r2(q(keys.map((k) => k.input_to_frame_ms), 0.95)), bridge_roundtrip_p50_ms: r2(q(keys.map((k) => k.ts_roundtrip_ms), 0.5)) },
  ts_handled_submit_enter: submit.map((s) => ({ input_to_frame_ms: r2(s.input_to_frame_ms), bridge_roundtrip_ms: r2(s.ts_roundtrip_ms) })),
};
console.error("latency", results.input_latency);
await sleep(1500);

// 6. Hot swap: 12 live edits of ui/app/Sidebar.tsx.
const hs = JSON.parse(await $`METRICS=${RUN}/metrics.jsonl bun ${root}scripts/hotswap.ts 12`.text());
results.hot_swap = { definition: "file write → first frame showing the edited TS UI (Bun.build + import + React commit + bridge + Rune commit)", n: hs.rows.length, p50_ms: hs.write_to_frame_p50, min_ms: hs.min, max_ms: hs.max, rows: hs.rows };
console.error("hot swap", results.hot_swap.p50_ms);

// 7. Memory after all of that.
await sleep(3000);
results.memory_after_bench = { per: pids.map((p) => ({ name: name(p), ...mem(p) })), total_rss_mb: r2(pids.reduce((a, p) => a + mem(p).rss_mb, 0)), total_pss_mb: r2(pids.reduce((a, p) => a + mem(p).pss_mb, 0)) };
results.ui_host_stats = await get("stats");
} finally {
  if (existsSync(`/proc/${pid}`)) await stop(pid);
}
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.error("wrote", OUT);
