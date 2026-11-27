import { useEffect, useRef, useState } from "react";
import type { FxLayer, Lighting } from "../../host/rune-jsx/props";

const ART = `${process.env.STELLA_RUNE_ROOT ?? "."}/../mobile-screenshots/public/art`;
const SHOW = new Set((process.env.STELLA_FX_SHOW ?? "glass,scroll,fluted,metal,metaballs,light").split(","));
const on = (name: string) => SHOW.has(name);
const OFF = !!process.env.STELLA_FX_OFF;

const INK = "#f5f5f7";
const MUTED = "#a1a1aa";
const PANEL = "#18181b";

const GLASS: FxLayer = { glass: { bevel: 18, depth: 18, dispersion: 0.12, magnification: 1.05, rim: 1.4, shadow: 0.3, veil: 0.12, tint: "#ffffff" } };

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <col w={372} h={360} gap={10}>
      <text size={13} weight={600} color={MUTED}>{title}</text>
      <box w={372} h={332} radius={18} clip={18} fill={PANEL}>{children}</box>
    </col>
  );
}

function GlassPanel() {
  const [at, setAt] = useState({ x: 236, y: 196 });
  const from = useRef(at);
  return (
    <Panel title="Liquid Glass">
      <image src={`${ART}/tram.jpg`} w={372} h={332} fit="cover" />
      <row absolute={{ left: 24, top: 24 }} w={240} h={52} radius={26} fx={OFF ? undefined : GLASS} align="center" justify="evenly">
        <text size={14} weight={600} color="#111114">Chats</text>
        <text size={14} weight={500} color="#111114">Apps</text>
        <text size={14} weight={500} color="#111114">Files</text>
      </row>
      <box id="lens" absolute={{ left: at.x, top: at.y }} w={96} h={96} radius={48} fx={OFF ? undefined : { glass: { bevel: 26, depth: 30, magnification: 1.12, dispersion: 0.2, rim: 1.6 } }}
        onDrag={(d) => {
          if (d.phase === "start") from.current = at;
          setAt({ x: from.current.x + d.dx, y: from.current.y + d.dy });
        }} cursor="grab" />
    </Panel>
  );
}

const LINES = Array.from({ length: 40 }, (_, i) => i % 5 === 0
  ? `Section ${i / 5 + 1}: scrolling under the glass`
  : "The lens bends and magnifies whatever is painted behind it, every frame, from the same backdrop the UI draws.");

function ScrollPanel() {
  return (
    <Panel title="Glass over scrolling content">
      <col id="fx-scroll" w={372} h={332} scrollY pad={20} pt={84} gap={10}>
        {LINES.map((l, i) => (
          <row key={i} gap={10} align="center">
            <box w={28} h={28} radius={8} fill={["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#a855f7"][i % 5]} />
            <text size={i % 5 === 0 ? 15 : 13} weight={i % 5 === 0 ? 600 : 400} color={INK} grow={1}>{l}</text>
          </row>
        ))}
      </col>
      <row absolute={{ left: 16, top: 14 }} w={340} h={48} radius={24} fx={OFF ? undefined : { glass: { bevel: 16, depth: 16, veil: 0.18, tint: "#202024", rim: 1.2 } }} align="center" px={18} gap={12}>
        <text size={14} weight={600} color={INK} grow={1}>New chat</text>
        <box w={28} h={28} radius={14} fx={OFF ? undefined : { glass: { bevel: 10, depth: 10, rim: 1.4 } }} />
      </row>
    </Panel>
  );
}

function FlutedPanel() {
  return (
    <Panel title="Fluted glass">
      <image src={`${ART}/plant2.jpg`} w={372} h={332} fit="cover" />
      <col absolute={{ left: 150, top: 0 }} w={222} h={332} fx={OFF ? undefined : { fill: "flutedGlass", preset: "reeded", rib: 16, refraction: 14, frost: 0.15 }} justify="end" pad={20}>
        <text size={22} weight={600} color="#ffffff">Reeded</text>
      </col>
    </Panel>
  );
}

function MetalPanel() {
  return (
    <Panel title="Liquid metal">
      <col w={372} h={332} align="center" justify="center" gap={28}>
        <col gap={10} align="center">
          <box w={220} h={64} radius={32} fx={OFF ? undefined : { fill: "liquidMetal", preset: "chrome", anchor: "element" }} />
          <text size={13} color={MUTED}>Chrome</text>
        </col>
        <row w={220} h={64} radius={32} fx={OFF ? undefined : { fill: "liquidMetal", preset: "gold", border: 4 }} align="center" justify="center">
          <text size={17} weight={600} color={INK}>Gold rim</text>
        </row>
      </col>
    </Panel>
  );
}

function MetaballPanel() {
  return (
    <Panel title="Metaballs">
      <box w={372} h={332} fx={OFF ? undefined : { fill: "metaballs", preset: "mint" }} />
    </Panel>
  );
}

function lighting(t: number): Lighting {
  return {
    ambient: 0.35,
    lights: [{ x: 186 + Math.cos(t) * 120, y: 150 + Math.sin(t) * 90, z: 90, color: "#ffe2bd", intensity: 2.2, radius: 14, range: 700, bulb: 0.8 }],
  };
}

function LightPanel() {
  const ref = useRef<{ set(p: object): void } | null>(null);
  useEffect(() => {
    if (OFF || process.env.STELLA_FX_LIGHT_STILL) return;
    const t0 = Date.now();
    const id = setInterval(() => ref.current?.set({ light: lighting((Date.now() - t0) / 1600) }), 16);
    return () => clearInterval(id);
  }, []);
  return (
    <Panel title="rune-light">
      <col ref={ref} w={372} h={332} fill="#26262b" light={OFF ? undefined : lighting(0)} pad={28} gap={18}>
        <row gap={18}>
          <col w={140} h={110} radius={16} fill="#3a3a40" lit={OFF ? undefined : { raised: 10, bevel: [8, 3], gloss: [0.5, 0.4] }} pad={14}>
            <text size={14} weight={600} color={INK}>Raised</text>
          </col>
          <col w={140} h={110} radius={16} fill="#3a3a40" lit={OFF ? undefined : { raised: 4, bevel: [6, 2], gloss: [0.3, 0.6] }} pad={14}>
            <text size={14} weight={600} color={INK}>Low</text>
          </col>
        </row>
        <row w={298} h={90} radius={20} fill="#3a3a40" lit={OFF ? undefined : { floating: [6, 16], bevel: [10, 4], gloss: [0.6, 0.35] }} align="center" justify="center">
          <text size={15} weight={600} color={INK}>Floating</text>
        </row>
      </col>
    </Panel>
  );
}

function Blank({ title }: { title: string }) {
  return <Panel title={title}><box w={372} h={332} /></Panel>;
}

export function Root() {
  return (
    <window id="main" title="rune-fx" bg="#0b0b0d" w={1200} h={820}>
      <col id="fx-page" grow={1} pad={24} gap={22}>
        <row gap={20}>
          {on("glass") ? <GlassPanel /> : <Blank title="Liquid Glass" />}
          {on("scroll") ? <ScrollPanel /> : <Blank title="Glass over scrolling content" />}
          {on("fluted") ? <FlutedPanel /> : <Blank title="Fluted glass" />}
        </row>
        <row gap={20}>
          {on("metal") ? <MetalPanel /> : <Blank title="Liquid metal" />}
          {on("metaballs") ? <MetaballPanel /> : <Blank title="Metaballs" />}
          {on("light") ? <LightPanel /> : <Blank title="rune-light" />}
        </row>
      </col>
    </window>
  );
}
