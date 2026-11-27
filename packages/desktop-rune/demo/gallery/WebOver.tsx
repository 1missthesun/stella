// Elements drawn over live webviews: a pill over a page (like the canvas Share bar) and webviews
// partly scrolled out of a scroll view. Run with STELLA_RUNE_APP=demo/gallery/WebOver.tsx.
import { useState } from "react";

const PAGE = `<body style="margin:0;height:100vh;background:linear-gradient(135deg,#1d4ed8,#9333ea);color:#fff;font:14px sans-serif">
<div id="clicks" style="padding:16px">page clicks: 0</div>
<script>let n=0;document.body.addEventListener("click",(e)=>{n++;document.getElementById("clicks").textContent="page clicks: "+n+" at "+e.clientX+","+e.clientY;window.parent.postMessage({click:n,x:e.clientX,y:e.clientY},"*")});</script>
</body>`;

const card = (i: number) => `<body style="margin:0;height:100vh;background:hsl(${i * 70},70%,45%);color:#fff;font:600 18px sans-serif;display:flex;align-items:center;justify-content:center">map card ${i}</body>`;

export function Root() {
  const [pill, setPill] = useState(0);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState("none");
  return (
    <window id="main" title="webview over" bg="#111214" w={900} h={620}>
      <row id="wo-root" w="full" h="full" gap={16} pad={16}>
        <col id="wo-hero" w={480} minW={480} h="full" clip={0} radius={12}>
          <row id="wo-share" absolute={{ top: 10, right: 12 }} raise={3} align="center" gap={6}>
            <row id="wo-pill" onPress={() => { setPill((p) => p + 1); setOpen((o) => !o); }} h={30} px={12} radius={15} fill="#ffffff" align="center">
              <text size={13} weight={600} color="#111214">{`Share ${pill}`}</text>
            </row>
            <box id="wo-links" w={30} h={30} radius={15} fill="#ffffffcc" />
          </row>
          {open ? (
            <col id="wo-pop" absolute={{ top: 48, right: 12 }} raise={4} w={220} h={120} radius={10} fill="#1b1c1f" pad={12} gap={6} border="#2a2b30">
              <text size={13} weight={600} color="#ececf1">Share popover</text>
              <text size={12} color="#9a9ba3">drawn over the page</text>
            </col>
          ) : null}
          <col id="wo-frame-wrap" grow={1} minH={0}>
            <webview id="wo-web" w="full" h="full" html={PAGE} onMessage={(m) => setPage(JSON.stringify(m.data))} />
          </col>
        </col>
        <col id="wo-side" grow={1} h="full" minH={0} gap={10}>
          <text id="wo-status" size={13} color="#ececf1">{`pill ${pill} · open ${open} · page ${page}`}</text>
          <col id="wo-scroll" grow={1} minH={0} scrollY radius={10} fill="#1b1c1f">
            <col pad={12} gap={12}>
              {[1, 2, 3, 4].map((i) => (
                <col key={i} id={`wo-card-${i}`} gap={6}>
                  <text size={12} color="#9a9ba3">{`card ${i}`}</text>
                  <webview id={`wo-map-${i}`} w="full" h={180} radius={10} html={card(i)} />
                </col>
              ))}
            </col>
          </col>
        </col>
      </row>
    </window>
  );
}
