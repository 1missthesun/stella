// A webview mounted at zero height that grows to full size after GROW_MS (default 1500), as a
// viewer's panel does while it opens. Run with STELLA_RUNE_APP=demo/gallery/WebGrow.tsx.
import { useEffect, useState } from "react";

const PAGE = `<body style="margin:0;height:100vh;background:linear-gradient(135deg,#0ea5e9,#22c55e);color:#fff;font:600 20px sans-serif;padding:24px">
<div style="display:flex;flex-direction:column;gap:12px;align-items:flex-start"><div id="t">grown page</div><input id="f" placeholder="type here" style="font:16px sans-serif;padding:6px"><div id="s">scroll 0</div></div>
<div style="height:3000px"></div>
<script>
const post=(m)=>window.parent.postMessage(m,"*");
document.addEventListener("click",(e)=>{document.getElementById("t").textContent="clicked at "+e.clientX+","+e.clientY+" trusted "+e.isTrusted+" detail "+e.detail;post({click:[e.clientX,e.clientY],trusted:e.isTrusted,detail:e.detail})});
document.getElementById("f").addEventListener("input",(e)=>post({value:e.target.value,trusted:e.isTrusted}));
document.addEventListener("keydown",(e)=>{if(e.key==="Enter")post({enter:document.getElementById("f").value})});
addEventListener("scroll",()=>{document.getElementById("s").textContent="scroll "+Math.round(scrollY);post({scrollY:Math.round(scrollY)})});
</script></body>`;
const GROW_MS = Number(process.env.GROW_MS ?? 1500);

export function Root() {
  const [h, setH] = useState(0);
  const [msg, setMsg] = useState("no message");
  useEffect(() => {
    const id = setTimeout(() => setH(360), GROW_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <window id="main" title="webview grow" bg="#111214" w={900} h={620}>
      <col id="wg-root" w="full" h="full" pad={16} gap={8}>
        <text id="wg-status" size={13} color="#ececf1">{`height ${h} · ${msg}`}</text>
        <webview id="wg-web" w="full" h={h} html={PAGE} transparent={process.env.WG_TRANSPARENT === "1"} onMessage={(m) => setMsg(JSON.stringify(m.data))} />
      </col>
    </window>
  );
}
