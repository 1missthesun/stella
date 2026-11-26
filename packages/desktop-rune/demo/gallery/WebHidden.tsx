// A `<window visible={false}>` whose webview must load and run while the window is hidden, as
// Electron's `show: false` windows do (Turnstile solves there before ever showing). The page
// posts a tick every 200 ms; the window shows after SHOW_MS (default 5000). Run with
// STELLA_RUNE_APP=demo/gallery/WebHidden.tsx.
import { useEffect, useState } from "react";

const PAGE = `<body style="margin:0;height:100vh;background:#f6f5f0;color:#222;font:600 20px sans-serif;padding:24px">
<div id="t">hidden page</div>
<script>
const t0=Date.now();let n=0;
const post=(m)=>window.parent.postMessage(m,"*");
setInterval(()=>{n++;document.getElementById("t").textContent="ticks "+n;post({ticks:n,ms:Date.now()-t0,visibility:document.visibilityState,w:innerWidth,h:innerHeight})},200);
</script></body>`;
const SHOW_MS = Number(process.env.SHOW_MS ?? 5000);

export function Root() {
  const [shown, setShown] = useState(false);
  const [msg, setMsg] = useState("no message");
  useEffect(() => {
    const id = setTimeout(() => setShown(true), SHOW_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <>
      <window id="main" title="webview hidden" bg="#111214" w={700} h={200}>
        <col id="wh-root" w="full" h="full" pad={16} gap={8}>
          <text id="wh-status" size={13} color="#ececf1">{`shown ${shown} · ${msg}`}</text>
        </col>
      </window>
      <window id="hidden" title="Verify" visible={shown} w={440} h={560} bg="#f6f5f0">
        <webview id="wh-web" w="full" h="full" html={PAGE} onMessage={(m) => setMsg(JSON.stringify(m.data))} />
      </window>
    </>
  );
}
