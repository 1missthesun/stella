// Live-edits ui/app/Sidebar.tsx while the compiled engine runs, and times each swap from the
// file write to the first frame that shows it (engine metrics log).
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("..", import.meta.url).pathname;
const file = `${root}ui/app/Sidebar.tsx`;
const metrics = process.env.METRICS!;
const card = readFileSync(`${root}scripts/edits/now-card.tsx.txt`, "utf8");
const base = readFileSync(file, "utf8");
const edited = base.replace("{/* live-edit-slot */}", "{/* live-edit-slot */}\n" + card).replace("const W = 264;", "const W = 288;");
const n = Number(process.argv[2] ?? 10);
const leave = process.argv[3] === "leave-edited";
const now = () => performance.timeOrigin + performance.now();
const rows: any[] = [];
const seen = () => readFileSync(metrics, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.metric === "hot_swap");
for (let i = 0; i < n; i++) {
  const before = seen().length;
  const wrote = now();
  writeFileSync(file, i % 2 === 0 ? edited : base);
  let m: any;
  for (let k = 0; k < 400 && !m; k++) { await Bun.sleep(5); const s = seen(); if (s.length > before) m = s[s.length - 1]; }
  if (!m) { console.error("swap", i, "not seen"); continue; }
  rows.push({ i, variant: i % 2 === 0 ? "edited" : "base", write_to_frame_ms: +(m.frame_at - wrote).toFixed(2), seen_to_frame_ms: +m.t0_to_frame_ms.toFixed(2), bridge_ms: +m.bridge_ms.toFixed(2), applied_to_frame_ms: +m.applied_to_frame_ms.toFixed(2) });
  await Bun.sleep(600);
}
if (leave && n % 2 === 0) writeFileSync(file, edited);
if (!leave && n % 2 === 1) writeFileSync(file, base);
const w = rows.map((r) => r.write_to_frame_ms).sort((a, b) => a - b);
console.log(JSON.stringify({ rows, write_to_frame_p50: w[Math.floor((w.length - 1) / 2)], min: w[0], max: w[w.length - 1] }, null, 1));
