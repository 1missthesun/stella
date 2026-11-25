// Engine gallery: every element family and engine API on one screen, for checking the engine.
// Run with STELLA_RUNE_APP=demo/gallery/App.tsx.
import { useCallback, useEffect, useState, type ReactNode } from "react";

const c = {
  bg: "#111214", raised: "#1b1c1f", inset: "#0c0d0f", border: "#2a2b30", text: "#ececf1", weak: "#9a9ba3",
  weaker: "#6b6c74", accent: "#4f8cff", hover: "#ffffff12", press: "#ffffff1f", good: "#3ccf8e",
};

const SPARK = `<path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" fill="currentColor"/>`;
const SPIN = `<path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
const COPY = `<rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="2" fill="none"/>`;
const SVG_IMAGE = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="96"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#c04fff"/></linearGradient></defs><rect width="160" height="96" rx="14" fill="url(#g)"/><circle cx="120" cy="30" r="16" fill="#ffffff55"/></svg>`,
);
const PNG = `${process.env.STELLA_RUNE_ROOT}/../desktop-ui/public/stella-app-icon.png`;

const MD = `### Markdown

Native **rune-kit** markdown with \`inline code\`, [a link](https://example.com), a [Gmail](stella://connector/gmail) chip and lists:

- streaming and selection
- syntax highlighting
- tables and mermaid

\`\`\`ts
const iso = /^\\d{4}-\\d{2}-\\d{2}$/;
iso.test("2026-11-25"); // true
\`\`\`

| Engine | Frame |
|---|---|
| Rune | 4 ms |
| Chromium | 16 ms |

![Icon](app-icon)
`;

const BUBBLE = "Short reply that **hugs** its text.";

const PAGE = `<!doctype html><html><body style="margin:0;font:14px system-ui;background:#f5f6f8;color:#111;display:flex;flex-direction:column;gap:8px;padding:14px">
<b>WebView (wry)</b><div id="log">waiting for TS…</div>
<button id="b" style="width:160px">postMessage to TS</button><img id="img" style="width:48px;height:48px">
<script>
let n = 0;
window.addEventListener("message", (e) => { document.getElementById("log").textContent = "from TS: " + JSON.stringify(e.data); });
document.getElementById("b").onclick = () => window.parent.postMessage({ hello: "from page", n: ++n }, "*");
fetch("gallery://data/info.json").then((r) => r.json()).then((j) => { document.getElementById("log").textContent += " · protocol: " + j.answer; });
document.getElementById("img").src = "gallery://data/dot.svg";
</script></body></html>`;

function Button({ id, children, onPress, primary }: { id: string; children: ReactNode; onPress?: () => void; primary?: boolean }) {
  return (
    <box id={id} px={12} h={30} radius={8} center fill={primary ? c.accent : c.raised} border={primary ? undefined : c.border}
      hover={primary ? "#5d97ff" : c.hover} press={primary ? "#3f7af0" : c.press} pressScale={0.97} cursor="pointer" role="button"
      focusRing={{ color: c.accent, width: 2, offset: 2 }} focusable onPress={onPress}>
      <text size={13} weight={600} color={primary ? "#fff" : c.text}>{children}</text>
    </box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <col w="full" gap={10} pad={16} fill={c.raised} radius={14} border={c.border}>
      <text size={11} weight={700} color={c.weak} textCase="upper" tracking={0.6}>{title}</text>
      {children}
    </col>
  );
}

function Inputs() {
  const [value, setValue] = useState("controlled");
  const [last, setLast] = useState("—");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState(1);
  const [pasted, setPasted] = useState("");
  const at = notes.indexOf("@stella");
  return (
    <Section title="Inputs">
      <row gap={10} w="full">
        <col grow={1} gap={6}>
          <input id="g-input" w="full" h={32} px={10} radius={8} fill={c.inset} border={c.border} focusBorder={c.accent}
            size={14} color={c.text} placeholder="Type here" placeholderColor={c.weaker} value={value}
            keys={["mod+k", "Escape"]} onKey={(e) => setLast(`${e.chord} @ ${e.start}`)}
            onInput={setValue} onSubmit={(v) => setLast(`submit "${v}"`)} />
          <text size={12} color={c.weak}>{`value: ${value} · last key: ${last}`}</text>
        </col>
        <input id="g-secure" w={160} h={32} px={10} radius={8} fill={c.inset} border={c.border} size={14} color={c.text} secure placeholder="password" placeholderColor={c.weaker} />
      </row>
      <input id="g-notes" w="full" pad={10} radius={8} fill={c.inset} border={c.border} size={14} lineHeight={20}
        color={c.text} multiline spellcheck placeholder="Multiline: grows 2 to 5 lines, marks @stella, long pastes become events" placeholderColor={c.weaker}
        minLines={2} maxLines={5} value={notes} onInput={setNotes} onLines={(e) => setLines(e.lines)}
        marks={at >= 0 ? [{ start: at, end: at + 7, bg: "#4f8cff33", color: "#9cc0ff", radius: 4, pad: 2 }] : []}
        pasteAsEvent={{ minChars: 200, minLines: 8 }} onPaste={(p) => setPasted(`${p.text.length} chars as an attachment`)} />
      <text id="g-notes-info" size={12} color={c.weaker}>{`${notes.length} chars · ${lines} lines${pasted ? ` · pasted ${pasted}` : ""}`}</text>
    </Section>
  );
}

function Visuals() {
  return (
    <Section title="Paint, motion, media">
      <row gap={14} align="center" wrap>
        <box w={72} h={72} radius={14} gradient={{ angle: 135, stops: [[0, "#4f8cff"], [1, "#c04fff"]] }} shadows={[{ y: 8, blur: 24, color: "#4f8cff55" }, { y: 1, blur: 2, color: "#0008" }]} />
        <box w={72} h={72} corners={[24, 4, 24, 4]} fill={c.inset} borderSides={[0, 0, 0, 4]} border={c.good} />
        <box w={72} h={72} radius={36} fill="#ffffff10" border={c.border} rotate={12} scale={0.9} center>
          <icon svg={SPARK} size={28} color="#ffd34f" />
        </box>
        <box w={72} h={72} radius={14} fill={c.inset} center loop={{ kind: "opacity", period: 1.4, low: 0.35, high: 1 }}>
          <text size={12} color={c.weak}>pulse</text>
        </box>
        <icon svg={SPIN} size={28} color={c.accent} spin={0.9} />
        <row gap={5}>
          {[0, 1, 2].map((i) => (
            <box key={i} w={8} h={8} radius={4} fill={c.weak}
              loop={{ kind: "sequence", period: 1.2, delay: i * 0.15, frames: [{ at: 0, y: 0 }, { at: 0.25, y: -6 }, { at: 0.5, y: 0 }, { at: 1, y: 0 }] }} />
          ))}
        </row>
        <image src={SVG_IMAGE} w={160} h={96} radius={14} />
        <image src={PNG} w={72} h={72} radius={16} fit="cover" border={c.border} borderWidth={1} />
        <Morph />
        <Rig />
      </row>
    </Section>
  );
}

function blob(t: number): string {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    const r = 26 + Math.sin(t * 3 + i * 1.7) * 6;
    return [32 + Math.cos(a) * r, 32 + Math.sin(a) * r];
  });
  return pts.map(([x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length];
    return `${i ? "" : `M${(x + nx) / 2} ${(y + ny) / 2} `}Q${nx} ${ny} ${(nx + pts[(i + 2) % pts.length][0]) / 2} ${(ny + pts[(i + 2) % pts.length][1]) / 2}`;
  }).join(" ") + "Z";
}

function rigSvg(t: number): string {
  const d = blob(t);
  const sweep = 64 * ((t * 0.6) % 1.4) - 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs>
<linearGradient id="ink" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7aa7ff"/><stop offset="0.5" stop-color="#4f6cff"/><stop offset="1" stop-color="#9b4dff"/></linearGradient>
<linearGradient id="sweep" x1="0" y1="${sweep}" x2="0" y2="${sweep + 16}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="glow" cx="32" cy="32" r="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4878db" stop-opacity="0.26"/><stop offset="0.5" stop-color="#00aad8" stop-opacity="0.1"/><stop offset="1" stop-color="#00aad8" stop-opacity="0"/></radialGradient>
<clipPath id="body"><path d="${d}"/></clipPath>
</defs>
<circle cx="32" cy="32" r="32" fill="url(#glow)"/>
<path d="${d}" fill="url(#ink)"/>
<g clip-path="url(#body)"><rect x="0" y="0" width="64" height="64" fill="url(#sweep)"/><g transform="translate(0 ${Math.sin(t * 4)})"><rect x="22" y="27" width="5" height="9" rx="2.5" fill="#fff"/><rect x="37" y="27" width="5" height="9" rx="2.5" fill="#fff"/></g></g>
</svg>`;
}

function Rig() {
  const [t, setT] = useState(0.4);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const start = performance.now();
    const id = setInterval(() => {
      const now = (performance.now() - start) / 1000;
      setT(0.4 + now);
      if (now > 3) setOn(false);
    }, 16);
    return () => clearInterval(id);
  }, [on]);
  return <vector id="g-rig" w={72} h={72} svg={rigSvg(t)} onPress={() => setOn(true)} />;
}

function Morph() {
  const [t, setT] = useState(0);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const start = performance.now();
    const id = setInterval(() => {
      const now = (performance.now() - start) / 1000;
      setT(now);
      if (now > 3) setOn(false);
    }, 16);
    return () => clearInterval(id);
  }, [on]);
  return (
    <vector id="g-morph" w={72} h={72} viewBox={[64, 64]} onPress={() => setOn(true)}
      paths={[{ d: blob(t), fill: c.accent, opacity: 0.85 }, { d: "M24 30h4M36 30h4", stroke: "#ffffff", strokeWidth: 3 }]} />
  );
}

function Overlays({ togglePanel, mountHidden }: { togglePanel: () => void; mountHidden: () => void }) {
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [picked, setPicked] = useState("nothing yet");
  return (
    <Section title="Overlays, menus, windows">
      <row gap={8} wrap>
        <Button id="g-menu" onPress={() => setMenu((m) => !m)}>Popover</Button>
        <Button id="g-dialog" onPress={() => setDialog(true)}>Dialog</Button>
        <Button id="g-native" onPress={async () => {
          const id = await stella.engine.menu.popup([{ id: "copy", label: "Copy" }, { type: "separator" }, { id: "rename", label: "Rename…" }], { anchor: "g-native" });
          setPicked(`native menu: ${id ?? "dismissed"}`);
        }}>Native menu</Button>
        <Button id="g-panel" onPress={togglePanel}>Toggle panel window</Button>
        <Button id="g-panel-hidden" onPress={mountHidden}>Mount panel hidden</Button>
        <box id="g-tip" px={10} h={30} radius={8} center fill={c.inset} title="A native tooltip" titleSide="top">
          <text size={13} color={c.weak}>Hover me</text>
        </box>
      </row>
      <text size={12} color={c.weak}>{picked}</text>
      {menu ? (
        <col id="g-popover" anchor={{ to: "g-menu", side: "bottom", align: "start", gap: 6 }} w={200} pad={6} radius={10} fill={c.raised}
          border={c.border} shadows={[{ y: 12, blur: 32, color: "#000a" }]} enter="pop" exit="fade" modal={{ clickOutside: true }}
          onDismiss={() => setMenu(false)} focusGroup role="menu">
          {["New chat", "Rename", "Archive"].map((label) => (
            <box key={label} id={`g-item-${label}`} h={30} px={10} radius={6} hover={c.hover} focusFill={c.hover} focusable role="menuitem"
              align="center" onPress={() => { setPicked(`popover: ${label}`); setMenu(false); }}>
              <text size={13} color={c.text}>{label}</text>
            </box>
          ))}
        </col>
      ) : null}
      {dialog ? (
        <box id="g-scrim" fixed fill="#0009" center enter="fade" exit="fade" modal={{ clickOutside: true }} onDismiss={() => setDialog(false)}>
          <col id="g-dialog-card" w={340} pad={20} gap={12} radius={16} fill={c.raised} border={c.border} enter={{ opacity: 0, scale: 0.96, dur: 0.25 }} role="dialog" label="Example dialog">
            <text size={16} weight={700} color={c.text}>A modal dialog</text>
            <text size={13} color={c.weak} lineHeight={19}>Fixed to the window's top layer. Escape or a click outside dismisses it; the rest of the window is inert.</text>
            <row justify="end" gap={8}><Button id="g-dialog-close" primary onPress={() => setDialog(false)}>Close</Button></row>
          </col>
        </box>
      ) : null}
    </Section>
  );
}

function Docs() {
  const [action, setAction] = useState("");
  return (
    <Section title="Markdown">
      <col id="g-selgroup" gap={4} selectionGroup>
        <text id="g-sel-1" size={13} color={c.weak} selectable>Select across these two paragraphs; selection.get reads the group.</text>
        <text id="g-sel-2" size={13} color={c.weak} selectable>The second paragraph joins the same selection.</text>
      </col>
      <markdown id="g-md" src={MD} selectable onLink={(href) => setAction(`link ${href}`)}
        onLinkContextMenu={(e) => setAction(`context menu on ${e.href} at ${Math.round(e.x)},${Math.round(e.y)}`)}
        linkStyles={[{ prefix: "stella://", color: c.text, weight: 600, bg: "#4f8cff33", pad: 4, ring: ["#4f8cff66", 1], hover: { bg: "#4f8cff55" }, help: "Open the connector" }]}
        images={{ "app-icon": PNG }} imageRadius={14} onImage={(e) => setAction(`image ${e.alt}`)}
        onCodeAction={(a) => { void stella.engine.clipboard.writeText(a.source); setAction(`${a.action} ${a.language} block ${a.index}`); }}
        mdStyle={{
          dark: true, text: c.text, muted: c.weak, link: c.accent, inlineCodeBg: "#ffffff14", codeBlock: ["transparent", "transparent"],
          codeBlockPadding: [0, 10], body: { size: 14, lineHeight: 21 }, tableFullWidth: true, tableFlushLeft: true,
          codeFrame: {
            label: c.weak, labelSize: 12, labelGap: 0, actionColor: c.weak, actionHover: c.hover, actions: [{ id: "copy", label: "Copy", svg: COPY }],
            inside: { fill: c.inset, border: c.border, radius: 10, pad: [14, 6, 2] }, actionsAt: [6, 6],
          },
        }} />
      <row w="full" justify="end">
        <markdown id="g-bubble" w="fit" maxW={420} src={BUBBLE} fill={c.raised} radius={14} px={12} py={8} mdStyle={{ dark: true, text: c.text, body: { size: 14, lineHeight: 21 } }} />
      </row>
      <text size={12} color={c.weaker}>{action || "Hover the code block for Copy"}</text>
    </Section>
  );
}

const ROWS = Array.from({ length: 1000 }, (_, i) => i);

function Rows() {
  const [seen, setSeen] = useState("");
  const [far, setFar] = useState(false);
  return (
    <Section title="Virtual list · 1,000 rows">
      <col id="g-list-scroll" w="full" h={180} scrollY radius={8} fill={c.inset} farFromBottom={400} onFarFromBottom={setFar}
        scrollFade={{ top: { size: 24, stops: [[0.25, 0.16], [0.5, 0.5], [0.75, 0.84]] }, bottom: { size: 32, linear: true } }}>
        <list id="g-list" estimate={28} growth={{ dur: 0.35, edge: "none" }} onVisibleRows={(r) => setSeen(`rows ${r.first + 1}–${r.last + 1}`)}>
          {ROWS.map((i) => (
            <row key={i} id={`g-row-${i}`} h={28} px={12} align="center" justify="between" hover={c.hover}>
              <text size={13} color={c.text}>{`Row ${i + 1}`}</text>
              <text size={12} color={c.weaker} mono>{(i * 2654435761 % 4294967296).toString(16).padStart(8, "0")}</text>
            </row>
          ))}
        </list>
      </col>
      <row gap={8} align="center">
        <Button id="g-row-jump" onPress={() => void stella.engine.scroll.toKey("g-list-scroll", "g-row-499", 8)}>Row 500</Button>
        <Button id="g-row-top" onPress={() => void stella.engine.scroll.to("g-list-scroll", 0)}>Top</Button>
        <text id="g-rows-seen" size={12} color={c.weaker}>{`${seen}${far ? " · far from bottom" : ""}`}</text>
      </row>
    </Section>
  );
}

const FRAMES = process.env.STELLA_GALLERY_FRAMES;

function Surface() {
  const [src, setSrc] = useState<string>();
  const [last, setLast] = useState("no input yet");
  useEffect(() => {
    if (!FRAMES) return;
    const files = Array.from({ length: 30 }, (_, i) => `${FRAMES}/f${String(i).padStart(2, "0")}.jpg`);
    let i = 0;
    let prev: number | undefined;
    const id = setInterval(async () => {
      const bytes = new Uint8Array(await Bun.file(files[i++ % files.length]).arrayBuffer());
      const blob = stella.engine.blob(bytes);
      setSrc(`blob:${blob}`);
      if (prev !== undefined) stella.engine.freeBlob(prev);
      prev = blob;
    }, 33);
    return () => clearInterval(id);
  }, []);
  return (
    <Section title="Surface · streamed frames">
      <surface id="g-surface" w={320} h={180} radius={10} src={src} fill={c.inset}
        onPointer={(e) => { if (e.kind !== "move") setLast(`${e.kind} ${e.button ?? ""} ${Math.round(e.x)},${Math.round(e.y)} clicks ${e.clicks}`); }}
        onWheel={(e) => setLast(`wheel ${Math.round(e.dx)},${Math.round(e.dy)} ${e.mode}`)}
        onKeyRaw={(e) => setLast(`key ${e.type} ${e.key}${e.text ? ` "${e.text}"` : ""}`)} />
      <text id="g-surface-last" size={12} color={c.weaker}>{FRAMES ? last : "Set STELLA_GALLERY_FRAMES to a folder of f00..f29.jpg to stream"}</text>
    </Section>
  );
}

function Web() {
  const [got, setGot] = useState("nothing yet");
  const [n, setN] = useState(0);
  return (
    <Section title="WebView">
      <webview id="g-web" w="full" h={170} radius={10} html={PAGE} protocols={["gallery"]}
        onMessage={(m) => setGot(JSON.stringify(m.data))}
        onRequest={(r) => {
          if (r.url.endsWith("dot.svg")) {
            void stella.engine.webview.respond(r.rid, { headers: { "content-type": "image/svg+xml" }, body: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="20" fill="#3ccf8e"/></svg>` });
          } else {
            void stella.engine.webview.respond(r.rid, { headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify({ answer: `answered by TS for ${r.url}` }) });
          }
        }} />
      <row gap={8} align="center">
        <Button id="g-web-post" onPress={() => { setN(n + 1); void stella.engine.webview.post("g-web", { ping: n + 1 }); }}>Post to page</Button>
        <text size={12} color={c.weak}>{`from page: ${got}`}</text>
      </row>
    </Section>
  );
}

function Panel({ close, shown }: { close: () => void; shown: boolean }) {
  const [bounds, setBounds] = useState("");
  const [nav, setNav] = useState<string[]>([]);
  useEffect(() => stella.on("window", (e) => {
    if (e.id === "panel" && e.kind === "close-requested") close();
  }), [close]);
  return (
    <window id="panel" kind="panel" title="Gallery panel" w={380} h={330} minSize={[280, 160]} bg={c.raised} visible={shown}>
      <col w="full" h="full" pad={18} gap={10}>
        <text size={16} weight={700} color={c.text}>Second window</text>
        <text size={13} color={c.weak} lineHeight={19}>Its own native window, rendered from the same React tree and closed by unmounting it.</text>
        <row gap={8}>
          <Button id="p-bounds" onPress={async () => { const b = await stella.engine.window.getBounds("panel"); setBounds(`${b.width}×${b.height} at ${b.x},${b.y}`); }}>Bounds</Button>
          <Button id="p-close" primary onPress={close}>Close</Button>
        </row>
        <text size={12} color={c.weaker}>{bounds}</text>
        <webview id="p-web" w="full" h={64} radius={8} onNavigate={(e) => setNav((l) => [...l.slice(-2), `${e.mainFrame === false ? "frame" : "main"} ${e.url}`])}
          html={`<body style="margin:0;background:#20242c;color:#ececf1;font:13px sans-serif;display:flex;gap:8px;align-items:center;height:100vh">webview in the panel<iframe src="https://example.com/" width="120" height="50"></iframe></body>`} />
        <row gap={8} align="center">
          <Button id="p-load" onPress={() => void stella.engine.webview.load("p-web", "https://example.org/")}>Load page</Button>
          <text id="p-nav" size={11} color={c.weaker}>{nav.join(" · ") || "no navigations"}</text>
        </row>
      </col>
    </window>
  );
}

function Main({ togglePanel, mountHidden }: { togglePanel: () => void; mountHidden: () => void }) {
  return (
    <col id="g-root" w="full" h="full" fill={c.bg}>
      <row id="g-titlebar" w="full" h={44} px={16} align="center" justify="between" borderSides={[0, 0, 1, 0]} border={c.border} windowDrag>
        <text size={14} weight={700} color={c.text}>Rune engine gallery</text>
        <text size={12} color={c.weaker}>protocol v1</text>
      </row>
      <col id="g-scroll" w="full" grow={1} scrollY>
        <col w="full" maxW={880} pad={20} gap={14} selfAlign="center">
          <Inputs />
          <Overlays togglePanel={togglePanel} mountHidden={mountHidden} />
          <Visuals />
          <Surface />
          <Web />
          <Docs />
          <Rows />
        </col>
      </col>
    </col>
  );
}

export function Root() {
  const [panel, setPanel] = useState<"off" | "shown" | "hidden">("off");
  const close = useCallback(() => setPanel("off"), []);
  useEffect(() => stella.on("open-url", (e) => console.error(`[gallery] open-url ${e.url} argv ${process.argv.slice(2).join(" ")}`)), []);
  return (
    <>
      <window id="main" title="Rune engine gallery" bg={c.bg}>
        <Main togglePanel={() => setPanel((p) => (p === "shown" ? "hidden" : "shown"))} mountHidden={() => setPanel("hidden")} />
      </window>
      {panel !== "off" ? <Panel close={close} shown={panel === "shown"} /> : null}
    </>
  );
}
