// A 60 Hz counter with a live webview only from 5 s to 15 s after start: the commit metrics
// (apply_wait_ms, applied_to_frame_ms) before, during and after show what a live page costs the
// frame loop. Run with STELLA_RUNE_APP=demo/gallery/WebStall.tsx; STALL_WHERE=background puts the
// page in a 1×1 background window like the media page (STALL_BG_TICK=1 repaints it every tick,
// STALL_BG_NOWEB=1 drops the page), STALL_WHERE=hidden in a hidden window.
import { useEffect, useState } from "react";

const PAGE = `<body style="margin:0;height:100vh;background:linear-gradient(135deg,#1d4ed8,#9333ea);color:#fff;font:14px sans-serif"><div style="padding:16px">live page</div></body>`;

export function Root() {
  const [tick, setTick] = useState(0);
  const [start] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 16);
    return () => clearInterval(t);
  }, []);
  const s = (Date.now() - start) / 1000;
  const web = s >= 5 && s < 15;
  const where = process.env.STALL_WHERE ?? "main";
  return (
    <>
      <window id="main" title="webview stall" bg="#111214" w={900} h={620}>
        <col id="ws-root" w="full" h="full" gap={16} pad={16}>
          <text id="ws-tick" size={20} weight={600} color="#ececf1">{`tick ${tick} · ${s.toFixed(1)} s · page ${web ? "live" : "none"}`}</text>
          <box id="ws-bar" w={(tick % 100) * 8} h={12} radius={6} fill="#9333ea" />
          <col id="ws-frame" w={480} h={320} radius={12} clip={0}>
            {web && where === "main" ? <webview id="ws-web" w="full" h="full" html={PAGE} /> : null}
          </col>
        </col>
      </window>
      {web && where === "background" ? (
        <window id="ws-bg" kind="background" title="stall background" transparent bg="#00000000">
          {process.env.STALL_BG_NOWEB ? null : <webview id="ws-bg-web" w="full" h="full" transparent html={PAGE} />}
          {process.env.STALL_BG_TICK ? <box id="ws-bg-tick" w={1 + (tick % 2)} h={1} fill="#00000001" /> : null}
        </window>
      ) : null}
      {web && where === "hidden" ? (
        <window id="ws-hidden" title="stall hidden" visible={false} w={400} h={300}>
          <webview id="ws-hidden-web" w="full" h="full" html={PAGE} />
        </window>
      ) : null}
    </>
  );
}
